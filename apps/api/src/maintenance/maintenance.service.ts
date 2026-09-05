import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { Maintenance, type MaintenanceType } from './entities/maintenance.entity';
import { MaintenanceStatus } from './entities/maintenance-status.entity';
import { MaintenanceRepair } from './entities/maintenance-repair.entity';
import { MaintenanceImage } from './entities/maintenance-image.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { Project } from '@/project/entities/project.entity';
import { StorageService } from '@/storage/storage.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { CaseEventPublisher } from '@/queue/case-event.publisher';
import {
  CRACK_TYPE_DEF,
  DEGREE_DEF,
  IMAGE_TYPE_DEF,
  MAINTENANCE_IMAGE_GROUPS,
  MAINTENANCE_REQUIRED_IMAGES,
  MAINTENANCE_STATUS_DEF,
  MAINTENANCE_TYPE_DEF,
  MATERIAL_DEF,
  ORDER_LOCKED_FROM,
  WORK_ORDER_ACTION,
  WORK_ORDER_STATUS_DEF
} from '@road-patrol/shared';
import type { AuthUser } from '@app-types/user-auth.type';
import type { UploadedImage } from '@/work-order/work-order.service';
import {
  AddMaintenanceDto,
  DeleteMaintenanceImageDto,
  MaintenanceQueryDto,
  UpdateMaintenanceDto,
  UpdateMaintenanceStatusDto
} from './maintenance.dto';

/** 巡查單狀態碼 */
const STATUS = { DELETED: -1, PENDING: 0, WATCHING: 1, DISPATCHED: 2 } as const;

/** 派工單狀態碼；判斷來源單能不能刪要看它 */
const ORDER_STATUS = { DELETED: -1 } as const;

/** 巡查單會寫進歷程的動作 */
type MaintenanceHistoryAction = 'DELETED' | 'RESTORED' | 'STATUS_CHANGED' | 'DISPATCHED';

/** 一次批次操作的結果：做掉的、跳過的（附原因） */
type BatchResult = { done: string[]; skipped: { caseNum: string; message: string }[] };

/** 批次查詢時一併取回的派工單狀態 */
type StatusRow = {
  id: number;
  caseNum: string;
  caseStatus: number;
  orderId: number | null;
  orderCaseNum: string | null;
  orderStatus: number | null;
};

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger('Maintenance');

  constructor(
    @InjectRepository(Maintenance) private readonly maintenanceRepo: Repository<Maintenance>,
    @InjectRepository(MaintenanceImage) private readonly imageRepo: Repository<MaintenanceImage>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly storageService: StorageService,
    private readonly caseHistoryService: CaseHistoryService,
    private readonly eventPublisher: CaseEventPublisher,
    private readonly dataSource: DataSource
  ) {}

  /**
   * 建立巡查單。
   *
   * 主表、狀態、巡修內容在同一個交易裡 —— 只建了主表卻沒有狀態列的話，
   * 這張單在列表上會沒有狀態，而且永遠無法被批次操作選中。
   */
  public async create(dto: AddMaintenanceDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const project = await this.projectRepo.findOne({ where: { prjId: dto.PRJ_ID } });
    if (!project) throw new NotFoundException(`找不到標案：${dto.PRJ_ID}`);

    const { result: saved, caseNum } = await this.withCaseNum(project.prjId, dto.TYPE, user.companyId, (caseNum) =>
      this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Maintenance);

        // 坑洞編號在交易裡取，兩個人同時開單才不會拿到同一號
        const potholeNumber = dto.DTYPE === 'Potholes' ? await this.nextPotholeNumber(manager, project.id) : undefined;

        const row = await repo.save(
          repo.create({
            company: { id: user.companyId },
            project: { id: project.id },
            caseNum,
            type: dto.TYPE as MaintenanceType,
            surveyDate: dto.SURVEY_DATE,
            surveyUser: { id: user.uid },
            period: dto.PERIOD,
            weather: dto.WEATHER,
            dtype: dto.DTYPE,
            degree: dto.DEGREE,
            potholeNumber,
            dtypeLength: dto.DTYPE_LENGTH,
            dtypeWidth: dto.DTYPE_WIDTH,
            dtypeArea: dto.DTYPE_LENGTH && dto.DTYPE_WIDTH ? Number((dto.DTYPE_LENGTH * dto.DTYPE_WIDTH).toFixed(3)) : undefined,
            county: dto.COUNTY,
            district: dto.DISTRICT,
            cavlge: dto.CAVLGE,
            address: dto.ADDRESS,
            geom: { type: 'Point', coordinates: [dto.LNG, dto.LAT] },
            remark: dto.REMARK
          })
        );

        const statusRepo = manager.getRepository(MaintenanceStatus);
        await statusRepo.save(statusRepo.create({ maintenance: { id: row.id }, status: STATUS.PENDING, updStatusUsr: { id: user.uid } }));

        if (dto.TYPE === 'RB') {
          const repairRepo = manager.getRepository(MaintenanceRepair);
          await repairRepo.save(
            repairRepo.create({
              maintenance: { id: row.id },
              material: dto.MATERIAL,
              refillLength: dto.REFILL_LENGTH,
              refillWidth: dto.REFILL_WIDTH,
              quantity: dto.QUANTITY
            })
          );
        }

        return row;
      })
    );

    await this.caseHistoryService.record({
      caseType: 'MAINTENANCE',
      caseId: saved.id,
      action: 'CREATED',
      snapshot: await this.snapshot(saved.id),
      toState: String(STATUS.PENDING),
      operatorId: user.uid,
      note: `巡查單 ${caseNum}`,
      clientIp
    });

    this.eventPublisher.maintenanceChanged({ companyId: user.companyId, ids: [saved.id], caseNums: [caseNum], state: 'CREATED' });

    return HttpResponse.success({ message: '巡查單已建立', data: { ID: saved.id, CASE_NUM: caseNum } });
  }

  /**
   * 更新巡查單。
   *
   * 類型可以改（RA ⇄ RB）：巡查員常是先開 RA，材料到了才當場補起來。
   * 改回 RA 時巡修那一列整列刪掉 —— 留著會變成一張沒修過的單上寫著用了幾包冷瀝青。
   */
  public async update(dto: UpdateMaintenanceDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const current = await this.maintenanceRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { status: true, repair: true, project: true }
    });
    if (!current) throw new NotFoundException(`找不到巡查單：${dto.ID}`);
    if (current.status?.status === STATUS.DELETED) throw new ConflictException('已刪除的巡查單不可修改，請先復原');

    const before = await this.snapshot(dto.ID);

    const patch: Record<string, unknown> = {};
    const map: Record<string, string> = {
      TYPE: 'type',
      SURVEY_DATE: 'surveyDate',
      PERIOD: 'period',
      WEATHER: 'weather',
      DTYPE: 'dtype',
      DEGREE: 'degree',
      DTYPE_LENGTH: 'dtypeLength',
      DTYPE_WIDTH: 'dtypeWidth',
      COUNTY: 'county',
      DISTRICT: 'district',
      CAVLGE: 'cavlge',
      ADDRESS: 'address',
      REMARK: 'remark'
    };

    for (const [key, field] of Object.entries(map)) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) patch[field] = value;
    }

    if (dto.LNG !== undefined && dto.LAT !== undefined) patch.geom = { type: 'Point', coordinates: [dto.LNG, dto.LAT] };

    // 面積是長寬算出來的，不讓前端自己送 —— 兩邊各算一次遲早會不一致
    const length = dto.DTYPE_LENGTH ?? current.dtypeLength;
    const width = dto.DTYPE_WIDTH ?? current.dtypeWidth;
    if (dto.DTYPE_LENGTH !== undefined || dto.DTYPE_WIDTH !== undefined) {
      patch.dtypeArea = length && width ? Number((length * width).toFixed(3)) : null;
    }

    const effectiveType = (dto.TYPE ?? current.type) as MaintenanceType;
    const hasRepair = dto.MATERIAL !== undefined || dto.REFILL_LENGTH !== undefined || dto.REFILL_WIDTH !== undefined || dto.QUANTITY !== undefined;

    if (!Object.keys(patch).length && !hasRepair) throw new BadRequestException('沒有要更新的欄位');

    await this.dataSource.transaction(async (manager) => {
      // 破壞類型進出「坑洞」時，坑洞編號要跟著發或收 ——
      // 業主的坑洞管制表用這個編號對帳，留一個對不到的號比沒有更糟
      const newDtype = (patch.dtype as string | undefined) ?? current.dtype;
      if (newDtype === 'Potholes' && current.dtype !== 'Potholes') {
        patch.potholeNumber = await this.nextPotholeNumber(manager, current.project.id);
      } else if (newDtype !== 'Potholes' && current.dtype === 'Potholes') {
        patch.potholeNumber = null;
      }

      if (Object.keys(patch).length) await manager.getRepository(Maintenance).update({ id: dto.ID }, patch);

      const repairRepo = manager.getRepository(MaintenanceRepair);

      if (effectiveType !== 'RB') {
        await repairRepo.delete({ maintenance: { id: dto.ID } });
      } else {
        const repairPatch = {
          material: dto.MATERIAL ?? current.repair?.material,
          refillLength: dto.REFILL_LENGTH ?? current.repair?.refillLength,
          refillWidth: dto.REFILL_WIDTH ?? current.repair?.refillWidth,
          quantity: dto.QUANTITY ?? current.repair?.quantity
        };

        if (current.repair) await repairRepo.update({ id: current.repair.id }, repairPatch);
        else await repairRepo.save(repairRepo.create({ maintenance: { id: dto.ID }, ...repairPatch }));
      }
    });

    await this.caseHistoryService.record({
      caseType: 'MAINTENANCE',
      caseId: dto.ID,
      action: 'UPDATED',
      snapshot: await this.snapshot(dto.ID),
      before,
      operatorId: user.uid,
      clientIp
    });

    this.eventPublisher.maintenanceChanged({ companyId: user.companyId, ids: [dto.ID], caseNums: [current.caseNum], state: 'UPDATED' });

    return HttpResponse.success({ message: '巡查單已更新' });
  }

  /**
   * 批次更新狀態（含刪除與復原）。
   *
   * 整批一起送而不是逐張：一趟巡查會開十幾張單，逐張按十幾次沒有人會做。
   * 不能改的那幾筆會被跳過並附上原因 —— 整批失敗的話，使用者要自己
   * 猜是哪一筆擋住了，然後把其餘的再送一次。
   */
  public async updateStatus(dto: UpdateMaintenanceStatusDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const ids = [...new Set(dto.ID)];
    if (!ids.length) throw new BadRequestException('未指定要更新的巡查單');

    const result = await this.dataSource.transaction(async (manager) => {
      const rows = await manager
        .getRepository(Maintenance)
        .createQueryBuilder('m')
        .innerJoin('m.status', 'ms')
        .leftJoin(WorkOrder, 'wo', 'wo.maintenance_id = m.id')
        .leftJoin('wo.status', 'wos')
        .select('m.id', 'id')
        .addSelect('m.case_num', 'caseNum')
        .addSelect('ms.status', 'caseStatus')
        .addSelect('wo.id', 'orderId')
        .addSelect('wo.case_num', 'orderCaseNum')
        .addSelect('wos.status', 'orderStatus')
        .where('m.id IN (:...ids)', { ids })
        .andWhere('m.company_id = :companyId', { companyId: user.companyId })
        .getRawMany<StatusRow>();

      const missing = ids.filter((id) => !rows.some((r) => Number(r.id) === id));
      if (missing.length) throw new NotFoundException(`找不到巡查單：${missing.join('、')}`);

      if (dto.STATUS === WORK_ORDER_ACTION.RESTORE) return await this.restore(manager, rows, user, clientIp);
      if (dto.STATUS === STATUS.DELETED) return await this.softDelete(manager, rows, user, clientIp);

      return await this.setStatus(manager, rows, dto.STATUS, user, clientIp);
    });

    const verb = dto.STATUS === WORK_ORDER_ACTION.RESTORE ? '復原' : dto.STATUS === STATUS.DELETED ? '刪除' : '更新';

    if (result.done.length) {
      this.eventPublisher.maintenanceChanged({
        companyId: user.companyId,
        ids,
        caseNums: result.done,
        state: String(dto.STATUS)
      });
    }

    const message = this.composeMessage(result, verb);

    // 有任何一筆被跳過就回 warn：訊息一樣，但前端要用不同的顏色提醒使用者去看
    return HttpResponse.successOrWarn({
      data: { DONE: result.done, SKIPPED: result.skipped },
      okMsg: message,
      warnMsg: message,
      isEmpty: () => result.skipped.length > 0
    });
  }

  /**
   * 批次刪除。
   *
   * 只有「沒有活著的派工單」時才可刪。派工單一律由使用者自己處理，不做連帶刪除 ——
   * 刪一張巡查單順手把別人正在施工的派工單也刪掉，是沒有人預期得到的事。
   */
  private async softDelete(manager: EntityManager, rows: StatusRow[], user: AuthUser, clientIp?: string): Promise<BatchResult> {
    const result: BatchResult = { done: [], skipped: [] };
    const targets: { id: number; caseNum: string }[] = [];

    for (const row of rows) {
      const orderId = row.orderId == null ? null : Number(row.orderId);
      const orderStatus = row.orderStatus == null ? null : Number(row.orderStatus);

      if (orderId != null && orderStatus !== ORDER_STATUS.DELETED) {
        const message =
          orderStatus == null || orderStatus >= ORDER_LOCKED_FROM
            ? `派工單 ${row.orderCaseNum} 已回報或已完工，請先撤回並刪除派工單`
            : `派工單 ${row.orderCaseNum} 尚未刪除，請先刪除派工單`;

        result.skipped.push({ caseNum: row.caseNum, message });
        continue;
      }

      if (Number(row.caseStatus) === STATUS.DELETED) {
        result.skipped.push({ caseNum: row.caseNum, message: '巡查單已刪除' });
        continue;
      }

      targets.push({ id: Number(row.id), caseNum: row.caseNum });
    }

    if (!targets.length) return result;

    await manager
      .getRepository(MaintenanceStatus)
      .update({ maintenance: { id: In(targets.map((t) => t.id)) } }, { status: STATUS.DELETED, updStatusUsr: { id: user.uid } as never });

    await this.recordStatusHistoryMany(
      targets.map((t) => ({ id: t.id, status: STATUS.DELETED })),
      'DELETED',
      user,
      clientIp
    );

    result.done = targets.map((t) => t.caseNum);

    return result;
  }

  /**
   * 批次復原。
   *
   * 每筆各自回到歷程上一個不同的狀態 —— 一張被刪掉的單該回到待確認還是觀察中，
   * 只有它自己的歷程知道。查不到歷程時退回待確認。
   *
   * 不連帶復原派工單：巡查單開得出派工單，反過來不成立。
   */
  private async restore(manager: EntityManager, rows: StatusRow[], user: AuthUser, clientIp?: string): Promise<BatchResult> {
    const result: BatchResult = { done: [], skipped: [] };

    const deleted: StatusRow[] = [];
    for (const row of rows) {
      if (Number(row.caseStatus) === STATUS.DELETED) deleted.push(row);
      else result.skipped.push({ caseNum: row.caseNum, message: '巡查單未刪除，無需復原' });
    }

    if (!deleted.length) return result;

    // 一次問完所有人的「上一個不同狀態」，而不是每筆各查一次歷程
    const previous = await this.caseHistoryService.getPreviousDifferentValues(
      'MAINTENANCE',
      deleted.map((r) => Number(r.id)),
      STATUS.DELETED,
      'status'
    );

    const targets = deleted.map((row) => {
      const id = Number(row.id);
      const parsed = Number(previous.get(id));

      return { id, caseNum: row.caseNum, status: Number.isFinite(parsed) ? parsed : STATUS.PENDING };
    });

    // 目標狀態不同的分組各發一次 UPDATE —— 通常只有一兩組，
    // 比逐筆 UPDATE 少一個數量級的往返
    const byStatus = new Map<number, number[]>();
    for (const t of targets) byStatus.set(t.status, [...(byStatus.get(t.status) ?? []), t.id]);

    const statusRepo = manager.getRepository(MaintenanceStatus);
    for (const [status, ids] of byStatus) {
      await statusRepo.update({ maintenance: { id: In(ids) } }, { status, updStatusUsr: { id: user.uid } as never });
    }

    await this.recordStatusHistoryMany(targets, 'RESTORED', user, clientIp);
    result.done = targets.map((t) => t.caseNum);

    return result;
  }

  /** 一般的狀態變更：待確認 / 觀察中 / 已派工 */
  private async setStatus(manager: EntityManager, rows: StatusRow[], status: number, user: AuthUser, clientIp?: string): Promise<BatchResult> {
    const result: BatchResult = { done: [], skipped: [] };
    const targets: { id: number; caseNum: string }[] = [];

    for (const row of rows) {
      if (Number(row.caseStatus) === STATUS.DELETED) {
        result.skipped.push({ caseNum: row.caseNum, message: '巡查單已刪除，請先復原' });
        continue;
      }
      targets.push({ id: Number(row.id), caseNum: row.caseNum });
    }

    if (!targets.length) return result;

    await manager
      .getRepository(MaintenanceStatus)
      .update({ maintenance: { id: In(targets.map((t) => t.id)) } }, { status, updStatusUsr: { id: user.uid } as never });

    await this.recordStatusHistoryMany(
      targets.map((t) => ({ id: t.id, status })),
      'STATUS_CHANGED',
      user,
      clientIp
    );

    result.done = targets.map((t) => t.caseNum);

    return result;
  }

  /**
   * 把批次結果組成可直接顯示的訊息。
   *
   * 換行以 \n 分隔，前端要用 `white-space: pre-line` 呈現。
   * 被跳過的太多時只列前幾筆 —— 五十行的錯誤訊息沒有人會讀完。
   */
  private composeMessage(result: BatchResult, verb: string): string {
    const MAX_LISTED = 5;
    const { done, skipped } = result;

    if (!skipped.length) return `已${verb} ${done.length} 筆：${done.join('、')}`;

    const lines = skipped.slice(0, MAX_LISTED).map((s) => `・${s.caseNum} ${s.message}`);
    if (skipped.length > MAX_LISTED) lines.push(`…另有 ${skipped.length - MAX_LISTED} 筆`);

    const head = done.length ? `已${verb} ${done.length} 筆：${done.join('、')}` : `沒有巡查單被${verb}`;

    return [head, `${skipped.length} 筆未${verb}`, ...lines].join('\n');
  }

  // ─── 照片 ───────────────────────────────────────────────────────

  /** 上傳照片；規則與派工單一致：欄位名就是類型，同一類型只留一張 */
  public async uploadImages(id: number, files: UploadedImage[], deleteTypes: string[], user: AuthUser): Promise<HttpResult> {
    const row = await this.maintenanceRepo.findOne({ where: { id, company: { id: user.companyId } }, relations: { images: true } });
    if (!row) throw new NotFoundException(`找不到巡查單：${id}`);

    const before = await this.snapshot(id);
    const uploaded: string[] = [];

    for (const file of files) {
      const def = IMAGE_TYPE_DEF.find((t) => t.type === file.fieldname);
      if (!def) continue;

      const ext = file.originalname.split('.').pop()?.toLowerCase() ?? 'jpg';
      const key = `maintenances/${row.caseNum}/${def.type}.${ext}`;

      await this.storageService.putObject(key, file.buffer, file.mimetype);

      const existing = row.images?.find((i) => i.imgType === def.type);
      const payload = {
        maintenance: { id },
        imgType: def.type,
        imgTypeCh: def.name,
        imgName: file.originalname,
        imgPath: key,
        sizeBytes: file.size,
        mimeType: file.mimetype,
        uploadedBy: { id: user.uid }
      };

      if (existing) await this.imageRepo.update({ id: existing.id }, payload as never);
      else await this.imageRepo.save(this.imageRepo.create(payload as never));

      uploaded.push(def.type);
    }

    for (const type of deleteTypes) {
      const existing = row.images?.find((i) => i.imgType === type);
      if (!existing) continue;

      await this.storageService.deleteObject(existing.imgPath).catch(() => {});
      await this.imageRepo.delete({ id: existing.id });
    }

    await this.caseHistoryService.record({
      caseType: 'MAINTENANCE',
      caseId: id,
      action: uploaded.length ? 'IMAGE_UPLOADED' : 'IMAGE_DELETED',
      snapshot: await this.snapshot(id),
      before,
      operatorId: user.uid,
      note: [uploaded.length ? `上傳 ${uploaded.join('、')}` : '', deleteTypes.length ? `刪除 ${deleteTypes.join('、')}` : '']
        .filter(Boolean)
        .join('；')
    });

    return HttpResponse.success({
      message: `已上傳 ${uploaded.length} 張、刪除 ${deleteTypes.length} 張`,
      data: { UPLOADED: uploaded, DELETED: deleteTypes }
    });
  }

  /** 照片清單，附短效下載網址與「還缺哪些」 */
  public async listImages(id: number, companyId: number): Promise<HttpResult> {
    const row = await this.maintenanceRepo.findOne({ where: { id, company: { id: companyId } }, relations: { images: true } });
    if (!row) throw new NotFoundException(`找不到巡查單：${id}`);

    const images = await Promise.all(
      (row.images ?? []).map(async (i) => ({
        IMG_TYPE: i.imgType,
        IMG_TYPE_CH: i.imgTypeCh,
        IMG_NAME: i.imgName,
        SIZE_BYTES: i.sizeBytes,
        UPLOADED_AT: i.uploadedAt,
        URL: await this.storageService.signGetUrl(i.imgPath, 300)
      }))
    );

    const uploaded = new Map(images.map((i) => [i.IMG_TYPE, i]));
    const required = MAINTENANCE_REQUIRED_IMAGES[row.type] ?? [];
    const missing = this.missingImages(row);

    const groups = (MAINTENANCE_IMAGE_GROUPS[row.type] ?? []).map((g) => ({
      GROUP: g.group,
      TYPES: g.types.map((t) => ({
        TYPE: t,
        NAME: IMAGE_TYPE_DEF.find((d) => d.type === t)?.name ?? t,
        IS_ZIP: IMAGE_TYPE_DEF.find((d) => d.type === t)?.zip ?? false,
        REQUIRED: required.includes(t),
        UPLOADED: uploaded.get(t) ?? null
      }))
    }));

    return HttpResponse.success({
      data: {
        GROUPS: groups,
        IMAGES: images,
        REQUIRED: required.map((type) => ({ TYPE: type, NAME: IMAGE_TYPE_DEF.find((d) => d.type === type)?.name ?? type })),
        MISSING: missing.map((m) => ({ TYPE: m.type, NAME: m.name }))
      }
    });
  }

  /** 刪除單張照片 */
  public async deleteImage(dto: DeleteMaintenanceImageDto, user: AuthUser): Promise<HttpResult> {
    const image = await this.imageRepo.findOne({
      where: { maintenance: { id: dto.ID, company: { id: user.companyId } }, imgType: dto.IMG_TYPE }
    });
    if (!image) throw new NotFoundException(`找不到照片：${dto.IMG_TYPE}`);

    await this.storageService.deleteObject(image.imgPath).catch(() => {});
    await this.imageRepo.delete({ id: image.id });

    return HttpResponse.success({ message: '照片已刪除' });
  }

  // ─── 查詢 ───────────────────────────────────────────────────────

  /** 巡查單清單 */
  public async list(dto: MaintenanceQueryDto, companyId: number): Promise<HttpResult> {
    const page = dto.PAGE ?? 1;
    const size = dto.SIZE ?? 50;

    const qb = this.maintenanceRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.status', 'st')
      .leftJoinAndSelect('m.repair', 'rp')
      .leftJoinAndSelect('m.surveyUser', 'su')
      .leftJoinAndSelect('m.project', 'p')
      .leftJoinAndSelect('m.images', 'img')
      .leftJoinAndMapOne('m.order', WorkOrder, 'wo', 'wo.maintenance_id = m.id')
      .leftJoinAndSelect('wo.status', 'wos')
      .where('m.company_id = :companyId', { companyId })
      .skip((page - 1) * size)
      .take(size);

    // orderBy 用實體屬性名而不是欄位名：搭配 skip/take 時用欄位名會炸
    const SORT: Record<string, string> = { SURVEY_DATE: 'm.surveyDate', CASE_NUM: 'm.caseNum', STATUS: 'st.status' };
    qb.orderBy(SORT[dto.SORT_BY ?? 'SURVEY_DATE'], (dto.SORT_DIR ?? 'DESC') as 'ASC' | 'DESC');

    if (dto.CASE_NUM) qb.andWhere('m.case_num ILIKE :caseNum', { caseNum: `${dto.CASE_NUM}%` });
    if (dto.TYPE?.length) qb.andWhere('m.type IN (:...type)', { type: dto.TYPE });
    if (dto.STATUS?.length) qb.andWhere('st.status IN (:...status)', { status: dto.STATUS });
    if (dto.PRJ_ID?.length) qb.andWhere('p.prj_id IN (:...prjId)', { prjId: dto.PRJ_ID });
    if (dto.START_DATE) qb.andWhere('m.survey_date >= :start', { start: dto.START_DATE });
    if (dto.END_DATE) qb.andWhere('m.survey_date <= :end', { end: dto.END_DATE });
    if (dto.DTYPE?.length) qb.andWhere('m.dtype IN (:...dtype)', { dtype: dto.DTYPE });
    if (dto.DEGREE?.length) qb.andWhere('m.degree IN (:...degree)', { degree: dto.DEGREE });
    if (dto.DISTRICT?.length) qb.andWhere('m.district IN (:...district)', { district: dto.DISTRICT });
    if (dto.CAVLGE) qb.andWhere('m.cavlge = :cavlge', { cavlge: dto.CAVLGE });
    if (dto.SURVEY_USER_ID) qb.andWhere('m.survey_user_id = :surveyUserId', { surveyUserId: dto.SURVEY_USER_ID });
    if (dto.KEYWORD) {
      qb.andWhere('(m.case_num ILIKE :kw OR m.address ILIKE :kw OR m.remark ILIKE :kw)', { kw: `%${dto.KEYWORD}%` });
    }

    // 待派工清單：還沒開單，或原本那張已經被刪掉的
    if (dto.NO_ORDER) qb.andWhere('(wo.id IS NULL OR wos.status = :orderDeleted)', { orderDeleted: ORDER_STATUS.DELETED });

    const [rows, total] = await qb.getManyAndCount();

    return HttpResponse.successOrWarn({
      data: { TOTAL: total, PAGE: page, SIZE: size, ROWS: await this.withThumbnails(rows) },
      isEmpty: (v) => !v?.ROWS?.length
    });
  }

  /** 單筆詳情 */
  public async getById(id: number, companyId: number): Promise<HttpResult> {
    const row = await this.maintenanceRepo.findOne({
      where: { id, company: { id: companyId } },
      relations: { status: { updStatusUsr: true }, repair: true, surveyUser: true, project: true, images: true }
    });
    if (!row) throw new NotFoundException(`找不到巡查單：${id}`);

    const order = await this.dataSource
      .getRepository(WorkOrder)
      .findOne({ where: { maintenance: { id } }, relations: { status: true } });

    return HttpResponse.success({ data: this.toRow(row, order, true) });
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  /**
   * 巡查單號：標案號 + 類型 + 年月 + 四位流水。
   * 例：DEMO01RA26090001 —— 與派工單同一套編碼規則，從單號就看得出是哪一種單。
   *
   * 取**目前最大的流水號 + 1**，不是「筆數 + 1」。
   * 筆數會在序號有缺口時撞號 —— 而缺口是常態：匯入的資料、
   * 用別的規則產生的示範資料，都會讓筆數與最大號對不上。
   *
   * 併發仍可能兩個請求算到同一號，所以由呼叫端在唯一鍵衝突時重試（見 withCaseNum）。
   */
  private async makeCaseNum(prjId: string, type: string, companyId: number): Promise<string> {
    const ym = new Date().toISOString().slice(2, 7).replace('-', '');
    const prefix = `${prjId}${type}${ym}`;

    const row = await this.maintenanceRepo
      .createQueryBuilder('m')
      .select(`COALESCE(MAX(SUBSTRING(m.case_num FROM ${prefix.length + 1})::int), 0)`, 'max')
      .where('m.company_id = :companyId', { companyId })
      // 只算流水號長度正確的：格式不同的舊資料轉成 int 會直接讓查詢失敗
      .andWhere(`m.case_num ~ :pattern`, { pattern: `^${prefix}[0-9]{4}$` })
      .getRawOne<{ max: string }>();

    return `${prefix}${String(Number(row?.max ?? 0) + 1).padStart(4, '0')}`;
  }

  /**
   * 編號 + 寫入，撞號就重算一次。
   *
   * 兩個人同時開單會算到同一個流水號 —— 資料庫的唯一鍵會擋下第二個，
   * 但使用者看到的是「duplicate key」這種沒有人看得懂的訊息，
   * 而他要做的只是再按一次送出。那一次重算由這裡代勞。
   */
  private async withCaseNum<T>(
    prjId: string,
    type: string,
    companyId: number,
    write: (caseNum: string) => Promise<T>
  ): Promise<{ result: T; caseNum: string }> {
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; ; attempt += 1) {
      const caseNum = await this.makeCaseNum(prjId, type, companyId);

      try {
        return { result: await write(caseNum), caseNum };
      } catch (error: any) {
        const duplicated = error?.code === '23505' && String(error?.detail ?? error?.message).includes('case_num');
        if (!duplicated || attempt >= MAX_ATTEMPTS) throw error;

        this.logger.warn(`單號 ${caseNum} 撞號，重算(第 ${attempt} 次)`);
      }
    }
  }

  /** 同一標案內的下一個坑洞編號 */
  private async nextPotholeNumber(manager: EntityManager, projectId: number): Promise<number> {
    const row = await manager
      .getRepository(Maintenance)
      .createQueryBuilder('m')
      .select('COALESCE(MAX(m.pothole_number), 0)', 'max')
      .where('m.project_id = :projectId', { projectId })
      .getRawOne<{ max: string }>();

    return Number(row?.max ?? 0) + 1;
  }

  /** 缺哪些必要照片 */
  private missingImages(row: Maintenance) {
    const required = MAINTENANCE_REQUIRED_IMAGES[row.type] ?? [];
    const have = new Set((row.images ?? []).map((i) => i.imgType));

    return required
      .filter((t) => !have.has(t))
      .map((t) => ({ type: t, name: IMAGE_TYPE_DEF.find((d) => d.type === t)?.name ?? t }));
  }

  /**
   * 狀態變更的歷程。
   *
   * 公開給派工單用：巡查單的狀態也會被派工流程改動（開單轉已派工、刪單退回觀察中），
   * 那些改動不留歷程的話，之後復原這張巡查單會跳過整段派工的過程 ——
   * 復原要回到的是「上一個不同的狀態」，而它只從歷程裡找得到。
   *
   * 快照要在交易外重讀，才拿得到已經寫進去的新值。
   */
  public async recordStatusHistory(
    id: number,
    status: number,
    action: MaintenanceHistoryAction,
    user: AuthUser,
    clientIp?: string
  ) {
    await this.recordStatusHistoryMany([{ id, status }], action, user, clientIp);
  }

  /**
   * 批次寫入狀態歷程。
   *
   * 一次撈完所有快照、一次寫完所有版本 —— 逐筆的話，50 筆的批次操作
   * 會開 50 個交易、送出 350 趟往返，而它們做的是同一件事。
   *
   * 每一筆的目標狀態可以不同：復原時各自回到自己歷程上的上一步。
   */
  private async recordStatusHistoryMany(
    targets: { id: number; status: number }[],
    action: MaintenanceHistoryAction,
    user: AuthUser,
    clientIp?: string
  ) {
    if (!targets.length) return;

    const snapshots = await this.snapshotMany(targets.map((t) => t.id));

    await this.caseHistoryService.recordMany(
      targets.map((t) => ({
        caseType: 'MAINTENANCE' as const,
        caseId: t.id,
        action,
        // 快照是在狀態寫入後才撈的，但關聯的狀態列可能還在同一個交易裡沒可見，
        // 所以目標狀態直接覆蓋上去，不依賴讀到的值
        snapshot: { ...(snapshots.get(t.id) ?? {}), status: t.status },
        toState: String(t.status),
        operatorId: user.uid,
        clientIp
      }))
    );
  }

  /** 歷程快照 */
  private async snapshot(id: number): Promise<Record<string, unknown>> {
    return (await this.snapshotMany([id])).get(id) ?? {};
  }

  /**
   * 一次取多筆快照。
   *
   * 批次操作原本是逐筆 `findOne`（各自帶四個關聯）—— 50 筆就是 50 趟往返，
   * 而它們要的是同一種形狀的資料。這裡用一次 `IN` 查完。
   */
  private async snapshotMany(ids: number[]): Promise<Map<number, Record<string, unknown>>> {
    if (!ids.length) return new Map();

    const rows = await this.maintenanceRepo.find({
      where: { id: In(ids) },
      relations: { status: true, repair: true, project: true, images: true }
    });

    return new Map(rows.map((m) => [m.id, this.toSnapshot(m)]));
  }

  /** entity → 快照；純轉換，不碰資料庫 */
  private toSnapshot(m: Maintenance): Record<string, unknown> {
    return {
      caseNum: m.caseNum,
      type: m.type,
      prjId: m.project?.prjId ?? null,
      surveyDate: m.surveyDate,
      period: m.period ?? null,
      weather: m.weather ?? null,
      dtype: m.dtype ?? null,
      degree: m.degree ?? null,
      potholeNumber: m.potholeNumber ?? null,
      dtypeLength: m.dtypeLength ?? null,
      dtypeWidth: m.dtypeWidth ?? null,
      dtypeArea: m.dtypeArea ?? null,
      county: m.county ?? null,
      district: m.district ?? null,
      cavlge: m.cavlge ?? null,
      address: m.address ?? null,
      remark: m.remark ?? null,
      status: m.status?.status ?? STATUS.PENDING,
      material: m.repair?.material ?? null,
      refillLength: m.repair?.refillLength ?? null,
      refillWidth: m.repair?.refillWidth ?? null,
      quantity: m.repair?.quantity ?? null,
      images: (m.images ?? []).map((i) => i.imgType).sort()
    };
  }

  /**
   * 清單縮圖：只簽現況那一張。
   *
   * 巡查單在列表上要回答的是「這是什麼破壞」，一張就夠了；
   * 一頁五十筆各簽三張只是白花時間。
   */
  private async withThumbnails(rows: Maintenance[]) {
    return await Promise.all(
      rows.map(async (m) => {
        const img = (m.images ?? []).find((i) => i.imgType === 'IMG') ?? (m.images ?? [])[0];
        const order = (m as Maintenance & { order?: WorkOrder }).order;

        return {
          ...this.toRow(m, order ?? null),
          THUMBNAILS: img ? [{ url: await this.storageService.signGetUrl(img.imgPath, 600), title: '現況' }] : []
        };
      })
    );
  }

  /** entity → 對外欄位 */
  private toRow(m: Maintenance, order: WorkOrder | null | undefined, detail = false) {
    const typeDef = MAINTENANCE_TYPE_DEF.find((t) => t.key === m.type);
    const statusDef = MAINTENANCE_STATUS_DEF.find((s) => s.value === (m.status?.status ?? STATUS.PENDING));
    const dtypeDef = CRACK_TYPE_DEF.find((c) => c.key === m.dtype);
    const missing = this.missingImages(m);

    const base = {
      ID: m.id,
      CASE_NUM: m.caseNum,
      TYPE: m.type,
      TYPE_NAME: typeDef?.name ?? m.type,
      PRJ_ID: m.project?.prjId ?? null,
      PROJECT_NAME: m.project?.prjName ?? null,
      STATUS: m.status?.status ?? STATUS.PENDING,
      STATUS_NAME: statusDef?.name ?? '',
      SURVEY_DATE: m.surveyDate,
      SURVEY_USER: m.surveyUser?.name ?? null,
      SURVEY_USER_ID: m.surveyUser?.id ?? null,
      PERIOD: m.period ?? null,
      WEATHER: m.weather ?? null,
      DTYPE: m.dtype ?? null,
      DTYPE_NAME: dtypeDef?.name ?? m.dtype ?? null,
      DEGREE: m.degree ?? null,
      DEGREE_NAME: DEGREE_DEF.find((d) => d.key === m.degree)?.name ?? null,
      POTHOLE_NUMBER: m.potholeNumber ?? null,
      DTYPE_LENGTH: m.dtypeLength ?? null,
      DTYPE_WIDTH: m.dtypeWidth ?? null,
      DTYPE_AREA: m.dtypeArea ?? null,
      COUNTY: m.county ?? null,
      DISTRICT: m.district ?? null,
      CAVLGE: m.cavlge ?? null,
      ADDRESS: m.address ?? null,
      LNG: m.geom?.coordinates?.[0] ?? null,
      LAT: m.geom?.coordinates?.[1] ?? null,
      REMARK: m.remark ?? null,
      MATERIAL: m.repair?.material ?? null,
      MATERIAL_NAME: MATERIAL_DEF.find((x) => x.key === m.repair?.material)?.name ?? null,
      REFILL_LENGTH: m.repair?.refillLength ?? null,
      REFILL_WIDTH: m.repair?.refillWidth ?? null,
      QUANTITY: m.repair?.quantity ?? null,
      // 派工單資訊帶在列上：巡查單列表最常被問的就是「這張派了沒」
      WORK_ORDER_ID: order?.id ?? null,
      WORK_ORDER_NUM: order?.caseNum ?? null,
      WORK_ORDER_STATUS: order?.status?.status ?? null,
      WORK_ORDER_STATUS_NAME: WORK_ORDER_STATUS_DEF.find((s) => s.value === order?.status?.status)?.name ?? null,
      IMAGE_COUNT: m.images?.length ?? 0,
      MISSING_IMAGE_COUNT: missing.length
    };

    if (!detail) return base;

    return {
      ...base,
      REPAIR_DATE: m.repair?.repairDate ?? null,
      UPD_STATUS_USR: m.status?.updStatusUsr?.name ?? null,
      UPD_STATUS_AT: m.status?.updStatusAt ?? null,
      IMAGES: (m.images ?? []).map((i) => ({ IMG_TYPE: i.imgType, IMG_TYPE_CH: i.imgTypeCh, IMG_NAME: i.imgName, SIZE_BYTES: i.sizeBytes })),
      MISSING_IMAGES: missing.map((x) => ({ TYPE: x.type, NAME: x.name })),
      CREATED_AT: m.createdAt,
      UPDATED_AT: m.updatedAt
    };
  }
}
