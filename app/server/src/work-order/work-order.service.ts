import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { WorkOrder, type WorkOrderType } from './entities/work-order.entity';
import { WorkOrderStatus } from './entities/work-order-status.entity';
import { WorkOrderImage } from './entities/work-order-image.entity';
import { WorkOrderImprovement } from './entities/work-order-improvement.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { Project } from '@/project/entities/project.entity';
import { StorageService } from '@/storage/storage.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { IMAGE_GROUPS, IMAGE_TYPE_DEF, REQUIRED_IMAGES, WORK_ORDER_STATUS_DEF, WORK_ORDER_TYPE_DEF } from '@/core/constants/type-def.const';
import type { AuthUser } from '@app-types/user-auth.type';
import { AddWorkOrderDto, DeleteImageDto, UpdateOrderStatusDto, UpdateWorkOrderDto, WorkOrderQueryDto } from './work-order.dto';

/** 上傳進來的檔案 */
export type UploadedImage = { fieldname: string; originalname: string; mimetype: string; size: number; buffer: Buffer };

@Injectable()
export class WorkOrderService {
  private readonly logger = new Logger('WorkOrder');

  constructor(
    @InjectRepository(WorkOrder) private readonly orderRepo: Repository<WorkOrder>,
    @InjectRepository(WorkOrderStatus) private readonly statusRepo: Repository<WorkOrderStatus>,
    @InjectRepository(WorkOrderImage) private readonly imageRepo: Repository<WorkOrderImage>,
    @InjectRepository(WorkOrderImprovement) private readonly improvementRepo: Repository<WorkOrderImprovement>,
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(PatrolCaseStatus) private readonly caseStatusRepo: Repository<PatrolCaseStatus>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    private readonly storageService: StorageService,
    private readonly caseHistoryService: CaseHistoryService,
    private readonly dataSource: DataSource
  ) {}

  /**
   * 建立派工單。
   *
   * 主表、狀態、取樣資訊、來源案件的狀態都在同一個交易裡 ——
   * 只建了單卻沒改案件狀態的話，那個案件會被重複派工。
   */
  public async create(dto: AddWorkOrderDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const project = await this.projectRepo.findOne({ where: { prjId: dto.PRJ_ID } });
    if (!project) throw new NotFoundException(`找不到標案：${dto.PRJ_ID}`);

    // PC 類型要檢查來源案件是否已有派工單 —— 一案一單由資料層的唯一鍵保證，
    // 但先查一次能給出比「唯一鍵衝突」更好懂的訊息
    if (dto.TYPE === 'PC' && dto.CASE_PATROL_ID) {
      const existing = await this.orderRepo.findOne({ where: { casePatrol: { id: dto.CASE_PATROL_ID } } });
      if (existing) throw new ConflictException(`此案件已有派工單：${existing.caseNum}`);
    }

    const caseNum = await this.makeCaseNum(project.prjId, dto.TYPE, user.companyId);

    const saved = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(WorkOrder);

      const order = await orderRepo.save(
        orderRepo.create({
          company: { id: user.companyId },
          project: { id: project.id },
          caseNum,
          type: dto.TYPE as WorkOrderType,
          dispatchDate: dto.DISPATCH_DATE,
          dueDate: dto.DUE_DATE,
          workStartDate: dto.WORK_START_DATE,
          workEndDate: dto.WORK_END_DATE,
          workerUser: dto.WORKER_USER_ID ? { id: dto.WORKER_USER_ID } : undefined,
          dispatcher: { id: user.uid },
          county: dto.COUNTY,
          district: dto.DISTRICT,
          cavlge: dto.CAVLGE,
          address: dto.ADDRESS,
          startAddr: dto.START_ADDR,
          endAddr: dto.END_ADDR,
          startGeom: dto.START_LNG && dto.START_LAT ? { type: 'Point', coordinates: [dto.START_LNG, dto.START_LAT] } : undefined,
          endGeom: dto.END_LNG && dto.END_LAT ? { type: 'Point', coordinates: [dto.END_LNG, dto.END_LAT] } : undefined,
          material: dto.MATERIAL,
          materialSize: dto.MATERIAL_SIZE,
          workLength: dto.WORK_LENGTH,
          workWidth: dto.WORK_WIDTH,
          workDepthMilling: dto.WORK_DEPTH_MILLING,
          workDepthPaving: dto.WORK_DEPTH_PAVING,
          remark: dto.REMARK,
          casePatrol: dto.CASE_PATROL_ID ? { id: dto.CASE_PATROL_ID } : undefined
        })
      );

      await manager.getRepository(WorkOrderStatus).save(
        manager.getRepository(WorkOrderStatus).create({ workOrder: { id: order.id }, status: 0, updStatusUsr: { id: user.uid } })
      );

      // 路基改善的取樣資訊：只有 PB 有，所以獨立一張表
      if (dto.TYPE === 'PB') {
        await manager.getRepository(WorkOrderImprovement).save(
          manager.getRepository(WorkOrderImprovement).create({
            workOrder: { id: order.id },
            sampleTaken: dto.SAMPLE_TAKEN ?? false,
            sampleDate: dto.SAMPLE_DATE,
            testItem: dto.TEST_ITEM,
            testResult: dto.TEST_RESULT
          })
        );
      }

      // 來源案件轉為「已派工」
      if (dto.CASE_PATROL_ID) {
        const caseStatusRepo = manager.getRepository(PatrolCaseStatus);
        const cs = await caseStatusRepo.findOne({ where: { patrolCase: { id: dto.CASE_PATROL_ID } } });

        if (cs) await caseStatusRepo.update({ id: cs.id }, { needRepair: 2, updNeedRepairUsr: { id: user.uid } as never, updNeedRepairAt: new Date() });
      }

      return order;
    });

    await this.caseHistoryService.record({
      caseType: 'WORK_ORDER',
      caseId: saved.id,
      action: 'CREATED',
      snapshot: await this.snapshot(saved.id),
      toState: '0',
      operatorId: user.uid,
      note: `派工單 ${caseNum}`,
      clientIp
    });

    return HttpResponse.success({ message: '派工單已建立', data: { ID: saved.id, CASE_NUM: caseNum } });
  }

  /** 更新派工單欄位 */
  public async update(dto: UpdateWorkOrderDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const current = await this.orderRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { status: true, improvement: true, project: true }
    });
    if (!current) throw new NotFoundException(`找不到派工單：${dto.ID}`);
    if (current.status?.status === 3) throw new ConflictException('已完工的派工單不可修改');

    const before = await this.snapshot(dto.ID);

    const patch: Record<string, unknown> = {};
    const map: Record<string, string> = {
      COUNTY: 'county',
      DISTRICT: 'district',
      CAVLGE: 'cavlge',
      ADDRESS: 'address',
      START_ADDR: 'startAddr',
      END_ADDR: 'endAddr',
      MATERIAL: 'material',
      MATERIAL_SIZE: 'materialSize',
      WORK_LENGTH: 'workLength',
      WORK_WIDTH: 'workWidth',
      WORK_DEPTH_MILLING: 'workDepthMilling',
      WORK_DEPTH_PAVING: 'workDepthPaving',
      DISPATCH_DATE: 'dispatchDate',
      DUE_DATE: 'dueDate',
      WORK_START_DATE: 'workStartDate',
      WORK_END_DATE: 'workEndDate',
      REMARK: 'remark'
    };

    for (const [key, field] of Object.entries(map)) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) patch[field] = value;
    }

    if (dto.WORKER_USER_ID !== undefined) patch.workerUser = { id: dto.WORKER_USER_ID };
    if (dto.START_LNG && dto.START_LAT) patch.startGeom = { type: 'Point', coordinates: [dto.START_LNG, dto.START_LAT] };
    if (dto.END_LNG && dto.END_LAT) patch.endGeom = { type: 'Point', coordinates: [dto.END_LNG, dto.END_LAT] };

    const hasSample = dto.SAMPLE_TAKEN !== undefined || dto.SAMPLE_DATE !== undefined || dto.TEST_ITEM !== undefined || dto.TEST_RESULT !== undefined;
    if (!Object.keys(patch).length && !hasSample) throw new BadRequestException('沒有要更新的欄位');

    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(patch).length) await manager.getRepository(WorkOrder).update({ id: dto.ID }, patch);

      if (hasSample) {
        const repo = manager.getRepository(WorkOrderImprovement);
        const existing = await repo.findOne({ where: { workOrder: { id: dto.ID } } });

        const samplePatch = {
          sampleTaken: dto.SAMPLE_TAKEN ?? existing?.sampleTaken ?? false,
          sampleDate: dto.SAMPLE_DATE ?? existing?.sampleDate,
          testItem: dto.TEST_ITEM ?? existing?.testItem,
          testResult: dto.TEST_RESULT ?? existing?.testResult
        };

        if (existing) await repo.update({ id: existing.id }, samplePatch);
        else await repo.save(repo.create({ workOrder: { id: dto.ID }, ...samplePatch }));
      }
    });

    await this.caseHistoryService.record({
      caseType: 'WORK_ORDER',
      caseId: dto.ID,
      action: 'UPDATED',
      snapshot: await this.snapshot(dto.ID),
      before,
      operatorId: user.uid,
      clientIp
    });

    return HttpResponse.success({ message: '派工單已更新' });
  }

  /**
   * 更新狀態。
   *
   * 完工(3)時要檢查必要照片齊不齊 —— 缺照片的完工單在驗收時會被退回，
   * 與其讓它一路走到驗收才發現，不如在這裡擋住。
   */
  public async updateStatus(dto: UpdateOrderStatusDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { status: true, images: true, casePatrol: true, project: true }
    });
    if (!order) throw new NotFoundException(`找不到派工單：${dto.ID}`);

    const before = await this.snapshot(dto.ID);
    const fromStatus = order.status?.status ?? 0;

    if (dto.STATUS === 3) {
      const missing = this.missingImages(order);
      if (missing.length) {
        throw new BadRequestException(`缺少必要照片：${missing.map((m) => m.name).join('、')}`);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const statusRepo = manager.getRepository(WorkOrderStatus);
      const patch = { status: dto.STATUS, updStatusUsr: { id: user.uid }, rejectReason: dto.REJECT_REASON ?? null };

      if (order.status) await statusRepo.update({ id: order.status.id }, patch as never);
      else await statusRepo.save(statusRepo.create({ workOrder: { id: dto.ID }, ...patch } as never));

      // 撤回時把來源案件放回「觀察中」，讓它重新進入待派工。
      //
      // 完工**不動**案件狀態：案件的 needRepair 只有 待確認/觀察中/已派工/已刪除 四種，
      // 沒有「已完修」—— 修完了是派工單的事實(status=3)，不是案件的狀態。
      // 硬塞一個值進去會讓案件狀態欄位表達兩件不同的事，而報表要分開統計。
      if (order.casePatrol && dto.STATUS === 0) {
        const caseStatusRepo = manager.getRepository(PatrolCaseStatus);
        const cs = await caseStatusRepo.findOne({ where: { patrolCase: { id: order.casePatrol.id } } });

        if (cs) {
          await caseStatusRepo.update(
            { id: cs.id },
            { needRepair: 1, updNeedRepairUsr: { id: user.uid } as never, updNeedRepairAt: new Date() }
          );
        }
      }
    });

    const ACTION_MAP: Record<number, 'WORKING' | 'REPORTED' | 'FINISHED' | 'RETURNED'> = {
      0: 'RETURNED',
      1: 'WORKING',
      2: 'REPORTED',
      3: 'FINISHED'
    };

    await this.caseHistoryService.record({
      caseType: 'WORK_ORDER',
      caseId: dto.ID,
      action: ACTION_MAP[dto.STATUS] ?? 'STATUS_CHANGED',
      snapshot: await this.snapshot(dto.ID),
      before,
      fromState: String(fromStatus),
      toState: String(dto.STATUS),
      operatorId: user.uid,
      note: dto.REJECT_REASON,
      clientIp
    });

    return HttpResponse.success({ message: '狀態已更新' });
  }

  /**
   * 上傳照片。
   *
   * 同一類型只留一張：驗收要的是「這個階段的照片」，不是同一階段的二十張。
   * 重複上傳會覆寫，而不是長出第二筆 —— 現場重拍是常態。
   */
  public async uploadImages(id: number, files: UploadedImage[], deleteTypes: string[], user: AuthUser): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({ where: { id, company: { id: user.companyId } }, relations: { images: true } });
    if (!order) throw new NotFoundException(`找不到派工單：${id}`);

    const before = await this.snapshot(id);
    const uploaded: string[] = [];

    for (const file of files) {
      const def = IMAGE_TYPE_DEF.find((t) => t.type === file.fieldname);
      if (!def) continue;

      const ext = file.originalname.split('.').pop()?.toLowerCase() ?? 'jpg';
      const key = `workorders/${order.caseNum}/${def.type}.${ext}`;

      await this.storageService.putObject(key, file.buffer, file.mimetype);

      const existing = order.images?.find((i) => i.imgType === def.type);
      const payload = {
        workOrder: { id },
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

    // 刪除指定類型的既有照片；物件也一併刪掉，不留孤兒檔案
    for (const type of deleteTypes) {
      const existing = order.images?.find((i) => i.imgType === type);
      if (!existing) continue;

      await this.storageService.deleteObject(existing.imgPath).catch(() => {});
      await this.imageRepo.delete({ id: existing.id });
    }

    await this.caseHistoryService.record({
      caseType: 'WORK_ORDER',
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

  /** 刪除單張照片 */
  public async deleteImage(dto: DeleteImageDto, user: AuthUser): Promise<HttpResult> {
    const image = await this.imageRepo.findOne({
      where: { workOrder: { id: dto.ID, company: { id: user.companyId } }, imgType: dto.IMG_TYPE }
    });
    if (!image) throw new NotFoundException(`找不到照片：${dto.IMG_TYPE}`);

    await this.storageService.deleteObject(image.imgPath).catch(() => {});
    await this.imageRepo.delete({ id: image.id });

    return HttpResponse.success({ message: '照片已刪除' });
  }

  /** 取得照片清單，附短效下載網址 */
  public async listImages(id: number, companyId: number): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({ where: { id, company: { id: companyId } }, relations: { images: true } });
    if (!order) throw new NotFoundException(`找不到派工單：${id}`);

    const images = await Promise.all(
      (order.images ?? []).map(async (i) => ({
        IMG_TYPE: i.imgType,
        IMG_TYPE_CH: i.imgTypeCh,
        IMG_NAME: i.imgName,
        SIZE_BYTES: i.sizeBytes,
        UPLOADED_AT: i.uploadedAt,
        // 網址每次重新簽發，不要存起來重複使用
        URL: await this.storageService.signGetUrl(i.imgPath, 300)
      }))
    );

    const missing = this.missingImages(order);
    const uploaded = new Map(images.map((i) => [i.IMG_TYPE, i]));

    // 依分區回傳：哪些照片、擺在哪一區、要不要求，都由後端的定義決定。
    // 前端自己維護一份分區表的話，業主改驗收要求時會有一邊忘記更新
    const groups = (IMAGE_GROUPS[order.type] ?? []).map((g) => ({
      GROUP: g.group,
      TYPES: g.types.map((t) => ({
        TYPE: t,
        NAME: IMAGE_TYPE_DEF.find((d) => d.type === t)?.name ?? t,
        IS_ZIP: IMAGE_TYPE_DEF.find((d) => d.type === t)?.zip ?? false,
        REQUIRED: (REQUIRED_IMAGES[order.type] ?? []).includes(t),
        UPLOADED: uploaded.get(t) ?? null
      }))
    }));

    return HttpResponse.success({
      data: {
        GROUPS: groups,
        IMAGES: images,
        // 帶中文名一起回去：前端不必再維護一份「類型 → 中文」的對照，
        // 兩份對照遲早會有一份忘記更新
        REQUIRED: (REQUIRED_IMAGES[order.type] ?? []).map((type) => ({
          TYPE: type,
          NAME: IMAGE_TYPE_DEF.find((d) => d.type === type)?.name ?? type
        })),
        MISSING: missing.map((m) => ({ TYPE: m.type, NAME: m.name }))
      }
    });
  }

  /** 派工單清單 */
  public async list(dto: WorkOrderQueryDto, companyId: number): Promise<HttpResult> {
    const page = dto.PAGE ?? 1;
    const size = dto.SIZE ?? 50;

    const qb = this.orderRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.status', 'st')
      .leftJoinAndSelect('w.workerUser', 'wu')
      .leftJoinAndSelect('w.dispatcher', 'du')
      .leftJoinAndSelect('w.project', 'p')
      .leftJoinAndSelect('w.casePatrol', 'c')
      .leftJoinAndSelect('w.improvement', 'imp')
      .leftJoinAndSelect('w.images', 'img')
      .where('w.company_id = :companyId', { companyId })
      .skip((page - 1) * size)
      .take(size);

    const SORT: Record<string, string> = {
      DISPATCH_DATE: 'w.dispatchDate',
      DUE_DATE: 'w.dueDate',
      CASE_NUM: 'w.caseNum',
      STATUS: 'st.status'
    };
    qb.orderBy(SORT[dto.SORT_BY ?? 'DISPATCH_DATE'], (dto.SORT_DIR ?? 'DESC') as 'ASC' | 'DESC');

    if (dto.CASE_NUM) qb.andWhere('w.case_num ILIKE :caseNum', { caseNum: `${dto.CASE_NUM}%` });
    if (dto.TYPE?.length) qb.andWhere('w.type IN (:...type)', { type: dto.TYPE });
    if (dto.STATUS?.length) qb.andWhere('st.status IN (:...status)', { status: dto.STATUS });
    if (dto.PRJ_ID?.length) qb.andWhere('p.prj_id IN (:...prjId)', { prjId: dto.PRJ_ID });
    if (dto.START_DATE) qb.andWhere('w.dispatch_date >= :start', { start: dto.START_DATE });
    if (dto.END_DATE) qb.andWhere('w.dispatch_date <= :end', { end: dto.END_DATE });
    if (dto.DUE_FROM) qb.andWhere('w.due_date >= :dueFrom', { dueFrom: dto.DUE_FROM });
    if (dto.DUE_TO) qb.andWhere('w.due_date <= :dueTo', { dueTo: dto.DUE_TO });
    if (dto.COUNTY) qb.andWhere('w.county = :county', { county: dto.COUNTY });
    if (dto.DISTRICT?.length) qb.andWhere('w.district IN (:...district)', { district: dto.DISTRICT });
    if (dto.CASE_PATROL_ID) qb.andWhere('w.case_patrol_id = :casePatrolId', { casePatrolId: dto.CASE_PATROL_ID });

    // 關鍵字打在使用者記得的三個欄位上：單號、地址、備註
    if (dto.KEYWORD) {
      qb.andWhere('(w.case_num ILIKE :kw OR w.address ILIKE :kw OR w.remark ILIKE :kw)', { kw: `%${dto.KEYWORD}%` });
    }
    if (dto.CAVLGE) qb.andWhere('w.cavlge = :cavlge', { cavlge: dto.CAVLGE });
    if (dto.ADDRESS) qb.andWhere('w.address ILIKE :address', { address: `%${dto.ADDRESS}%` });
    if (dto.WORKER_USER_ID) qb.andWhere('w.worker_user_id = :workerId', { workerId: dto.WORKER_USER_ID });
    if (dto.MATERIAL?.length) qb.andWhere('w.material IN (:...material)', { material: dto.MATERIAL });
    if (dto.OVERDUE) qb.andWhere('w.due_date < CURRENT_DATE AND st.status < 3');

    const [rows, total] = await qb.getManyAndCount();

    const filtered = dto.MISSING_IMAGE ? rows.filter((r) => this.missingImages(r).length > 0) : rows;

    return HttpResponse.successOrWarn({
      data: { TOTAL: total, PAGE: page, SIZE: size, ROWS: await this.withThumbnails(filtered) },
      isEmpty: (v) => !v?.ROWS?.length
    });
  }

  /**
   * 清單的縮圖：施工前與施工後各一張。
   *
   * 只簽這兩張而不是全部 —— 驗收時想一眼看到的是「修之前長怎樣、修完長怎樣」，
   * 中間那十幾張是舉證用的，點進去再看。一頁五十筆各簽十七張只是白花時間。
   */
  private async withThumbnails(orders: WorkOrder[]) {
    return await Promise.all(
      orders.map(async (w) => {
        const pick = (type: string) => (w.images ?? []).find((i) => i.imgType === type);
        const before = pick('IMG_BEFORE');
        const after = pick('IMG_AFTER');

        return {
          ...this.toRow(w),
          THUMBNAILS: (
            await Promise.all(
              [
                { img: before, title: '施工前' },
                { img: after, title: '施工後' }
              ].map(async (t) => (t.img ? { url: await this.storageService.signGetUrl(t.img.imgPath, 600), title: t.title } : null))
            )
          ).filter(Boolean)
        };
      })
    );
  }

  /** 單筆詳情 */
  public async getById(id: number, companyId: number): Promise<HttpResult> {
    const row = await this.orderRepo.findOne({
      where: { id, company: { id: companyId } },
      relations: {
        status: { updStatusUsr: true },
        workerUser: true,
        dispatcher: true,
        project: true,
        casePatrol: true,
        improvement: true,
        images: true
      }
    });
    if (!row) throw new NotFoundException(`找不到派工單：${id}`);

    return HttpResponse.success({ data: this.toRow(row, true) });
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  /**
   * 派工單號：標案號 + 類型 + 年月 + 四位流水。
   * 例：DEMO01PA26080001 —— 從單號就看得出是哪個標案、哪種工程、哪個月的第幾張。
   */
  private async makeCaseNum(prjId: string, type: string, companyId: number): Promise<string> {
    const ym = new Date().toISOString().slice(2, 7).replace('-', '');
    const prefix = `${prjId}${type}${ym}`;

    const count = await this.orderRepo
      .createQueryBuilder('w')
      .where('w.company_id = :companyId', { companyId })
      .andWhere('w.case_num LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();

    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }

  /** 缺哪些必要照片 */
  private missingImages(order: WorkOrder) {
    const required = REQUIRED_IMAGES[order.type] ?? [];
    const have = new Set((order.images ?? []).map((i) => i.imgType));

    return required
      .filter((t) => !have.has(t))
      .map((t) => ({ type: t, name: IMAGE_TYPE_DEF.find((d) => d.type === t)?.name ?? t }));
  }

  /** 歷程快照 */
  private async snapshot(id: number): Promise<Record<string, unknown>> {
    const w = await this.orderRepo.findOne({
      where: { id },
      relations: { status: true, workerUser: true, improvement: true, images: true, project: true }
    });
    if (!w) return {};

    return {
      caseNum: w.caseNum,
      type: w.type,
      prjId: w.project?.prjId ?? null,
      dispatchDate: w.dispatchDate,
      dueDate: w.dueDate ?? null,
      workStartDate: w.workStartDate ?? null,
      workEndDate: w.workEndDate ?? null,
      workerUserId: w.workerUser?.id ?? null,
      county: w.county ?? null,
      district: w.district,
      cavlge: w.cavlge ?? null,
      address: w.address,
      startAddr: w.startAddr ?? null,
      endAddr: w.endAddr ?? null,
      material: w.material ?? null,
      materialSize: w.materialSize ?? null,
      workLength: w.workLength ?? null,
      workWidth: w.workWidth ?? null,
      workDepthMilling: w.workDepthMilling ?? null,
      workDepthPaving: w.workDepthPaving ?? null,
      remark: w.remark ?? null,
      status: w.status?.status ?? 0,
      sampleTaken: w.improvement?.sampleTaken ?? null,
      sampleDate: w.improvement?.sampleDate ?? null,
      testItem: w.improvement?.testItem ?? null,
      images: (w.images ?? []).map((i) => i.imgType).sort()
    };
  }

  /** entity → 對外欄位 */
  private toRow(w: WorkOrder, detail = false) {
    const typeDef = WORK_ORDER_TYPE_DEF.find((t) => t.key === w.type);
    const statusDef = WORK_ORDER_STATUS_DEF.find((s) => s.value === (w.status?.status ?? 0));
    const missing = this.missingImages(w);

    const base = {
      ID: w.id,
      CASE_NUM: w.caseNum,
      TYPE: w.type,
      TYPE_NAME: typeDef?.name ?? w.type,
      PRJ_ID: w.project?.prjId ?? null,
      PROJECT_NAME: w.project?.prjName ?? null,
      STATUS: w.status?.status ?? 0,
      STATUS_NAME: statusDef?.name ?? '',
      DISPATCH_DATE: w.dispatchDate,
      DUE_DATE: w.dueDate ?? null,
      WORK_START_DATE: w.workStartDate ?? null,
      WORK_END_DATE: w.workEndDate ?? null,
      WORKER_USER: w.workerUser?.name ?? null,
      WORKER_USER_ID: w.workerUser?.id ?? null,
      DISPATCHER: w.dispatcher?.name ?? null,
      COUNTY: w.county ?? null,
      DISTRICT: w.district,
      CAVLGE: w.cavlge ?? null,
      ADDRESS: w.address,
      MATERIAL: w.material ?? null,
      WORK_LENGTH: w.workLength ?? null,
      WORK_WIDTH: w.workWidth ?? null,
      REMARK: w.remark ?? null,
      CASE_PATROL_ID: w.casePatrol?.id ?? null,
      CASE_PATROL_NUM: w.casePatrol?.caseNum ?? null,
      // 來源案件的破壞資訊：派工單的表單上要顯示「這張單在修什麼」，
      // 承辦不必為了看破壞類型再切回案件列表
      CASE_CRACK_TYPE: w.casePatrol?.crackType ?? null,
      CASE_DEGREE: w.casePatrol?.degree ?? null,
      CAR: w.casePatrol?.car ?? null,
      IMAGE_COUNT: w.images?.length ?? 0,
      MISSING_IMAGE_COUNT: missing.length,
      OVERDUE: !!w.dueDate && new Date(w.dueDate) < new Date() && (w.status?.status ?? 0) < 3
    };

    if (!detail) return base;

    return {
      ...base,
      START_ADDR: w.startAddr ?? null,
      END_ADDR: w.endAddr ?? null,
      START_LNG: w.startGeom?.coordinates?.[0] ?? null,
      START_LAT: w.startGeom?.coordinates?.[1] ?? null,
      END_LNG: w.endGeom?.coordinates?.[0] ?? null,
      END_LAT: w.endGeom?.coordinates?.[1] ?? null,
      MATERIAL_SIZE: w.materialSize ?? null,
      WORK_DEPTH_MILLING: w.workDepthMilling ?? null,
      WORK_DEPTH_PAVING: w.workDepthPaving ?? null,
      SAMPLE_TAKEN: w.improvement?.sampleTaken ?? null,
      SAMPLE_DATE: w.improvement?.sampleDate ?? null,
      TEST_ITEM: w.improvement?.testItem ?? null,
      TEST_RESULT: w.improvement?.testResult ?? null,
      REJECT_REASON: w.status?.rejectReason ?? null,
      UPD_STATUS_USR: w.status?.updStatusUsr?.name ?? null,
      UPD_STATUS_AT: w.status?.updStatusAt ?? null,
      IMAGES: (w.images ?? []).map((i) => ({ IMG_TYPE: i.imgType, IMG_TYPE_CH: i.imgTypeCh, IMG_NAME: i.imgName, SIZE_BYTES: i.sizeBytes })),
      MISSING_IMAGES: missing.map((m) => ({ TYPE: m.type, NAME: m.name })),
      CREATED_AT: w.createdAt,
      UPDATED_AT: w.updatedAt
    };
  }
}
