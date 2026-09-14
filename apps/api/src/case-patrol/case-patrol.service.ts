import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { PatrolCase, type CaseSource } from './entities/patrol-case.entity';
import { PatrolCaseAddress } from './entities/patrol-case-address.entity';
import { PatrolCaseStatus } from './entities/patrol-case-status.entity';
import { Project } from '@/project/entities/project.entity';
import { ProjectVehicle } from '@/project/entities/project-vehicle.entity';
import { GeoService } from '@/geo/geo.service';
import { CaseIngestProducer } from '@/queue/case-ingest.producer';
import { StorageService } from '@/storage/storage.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { CaseEncodeService } from '@/case-encode/case-encode.service';
import { CRACK_TYPE_DEF, normalizeCrackType } from '@road-patrol/shared';
import { userRef, type AuthUser } from '@app-types/user-auth.type';
import {
  AddCaseDto,
  BatchUpdateStatusDto,
  CaseQueryDto,
  CaseStatsQueryDto,
  MileageQueryDto,
  NearbyQueryDto,
  UpdateCaseDto,
  UpdateCaseStatusDto
} from './case-patrol.dto';

/** 重複判定的門檻：30 公尺內、前後 30 天、同一種破壞 */
const DUPLICATE_RADIUS_M = 30;
const DUPLICATE_WINDOW_DAYS = 30;

/**
 * 連續破壞警示的判定門檻。
 *
 * 相鄰兩筆距離不超過 10 公尺、且序號連號或同號，才算同一段連續破壞。
 * 中間夾雜其他破壞類型不會中斷序列 —— 車機是照拍攝順序編號的，
 * 一段龜裂的路面上本來就會混著坑洞。
 */
const ALLIGATOR_GAP_M = 10;
const ALLIGATOR_MIN_GROUP = 2;

/**
 * GPS 校正的位移量(度)。
 *
 * 車機的天線裝在車頂，回報的座標是**車輛的位置**而不是破壞的位置 ——
 * 破壞在鏡頭正前方約 5 公尺處。0.00004 度約等於 4.4 公尺。
 *
 * 不校正的話，地圖上的點會系統性地偏在道路後方，
 * 派工人員到現場會找不到那個坑。
 */
const GPS_FORWARD_OFFSET_DEG = 0.00004;

@Injectable()
export class CasePatrolService {
  private readonly logger = new Logger('CasePatrol');

  constructor(
    @InjectRepository(PatrolCase) private readonly caseRepo: Repository<PatrolCase>,
    @InjectRepository(PatrolCaseAddress) private readonly addressRepo: Repository<PatrolCaseAddress>,
    @InjectRepository(PatrolCaseStatus) private readonly statusRepo: Repository<PatrolCaseStatus>,
    @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectVehicle) private readonly projectVehicleRepo: Repository<ProjectVehicle>,
    private readonly geoService: GeoService,
    private readonly caseIngestProducer: CaseIngestProducer,
    private readonly storageService: StorageService,
    private readonly caseHistoryService: CaseHistoryService,
    private readonly caseEncodeService: CaseEncodeService,
    private readonly dataSource: DataSource
  ) {}

  /**
   * 新增案件。
   *
   * 冪等第三道：external_id 唯一鍵 + ON CONFLICT DO NOTHING。
   * 另外還有 (dt_record, img_detect, crack_id) 的唯一鍵 ——
   * 車機在重送時 external_id 會一致，但若上游改用新的識別碼重送，
   * 這組值仍然擋得住同一個破壞被記兩次。
   *
   * 主表、地址、狀態三張表在同一個交易裡建立：
   * 只有主表而沒有狀態的案件，在二篩畫面上會神祕地消失。
   */
  public async addCase(dto: AddCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const before = await this.caseRepo.findOne({ where: { externalId: dto.EXTERNAL_ID }, select: { id: true } });

    if (before) {
      this.logger.warn(`重複案件，已略過寫入: ${dto.EXTERNAL_ID}`);
      return HttpResponse.success({ message: '案件已存在(重複遞送)', data: { ID: before.id, DUPLICATED: true } });
    }

    /**
     * 破壞類型正規化。
     *
     * 不同世代的車機與不同縣市的判讀模型送來的字串不一樣：
     * 舊車機送 `pothole`、有的送中文、臺北格式送 `Manhole`。
     * 不轉的話，同一種破壞在統計上會被拆成三種，而報表要交給業主。
     *
     * DTO 已經用 `@IsIn` 擋掉不認得的值，這裡處理的是「認得但寫法不同」。
     */
    const crackType = normalizeCrackType(dto.CRACK_TYPE);

    /**
     * GPS 校正：把座標往行進方向推 5 公尺。
     *
     * 車機的天線在車頂，回報的是車輛位置；破壞在鏡頭正前方。
     * 沒有方位角時不校正 —— 猜方向比不校正更糟。
     */
    const { lng, lat } = this.adjustCoords(dto.LNG, dto.LAT, dto.HEADING);

    // 標案與車輛：車機只帶代碼與車號，要換成關聯
    const project = await this.projectRepo.findOne({ where: { prjId: dto.PRJ_ID } });
    const projectVehicle = project
      ? await this.projectVehicleRepo.findOne({
          where: { project: { id: project.id }, vehicle: { plateNo: dto.CAR }, isActive: true },
          relations: { vehicle: true }
        })
      : null;

    const saved = await this.dataSource.transaction(async (manager) => {
      const caseRepo = manager.getRepository(PatrolCase);

      // 進來就編號。
      //
      // 過去這裡不編號，案件的 case_num 一路是 NULL，畫面上只能顯示車機給的
      // 外部編號，而報表與公文要的是我們自己的編號 —— 那筆案件在對帳時對不到。
      //
      // 取號在交易裡：號碼與案件一起成敗，寫入失敗不會留下一個被跳過的號。
      // 車巡案件的編號不分日期（一個標案一條連續的流水），所以 seqDate 固定。
      // 車巡案件不分日期：一天可能進來幾千筆，分日之後四位流水很快就不夠用
      const caseNum = project ? await this.caseEncodeService.next({ prefix: project.prjId, pad: 6 }, manager) : null;

      await caseRepo
        .createQueryBuilder()
        .insert()
        .into(PatrolCase)
        .values({
          company: { id: user.companyId },
          project: project ? { id: project.id } : undefined,
          // 車機用 API Key 上傳時沒有對應的使用者列，回報人留空
          reporter: userRef(user.uid),
          caseNum: caseNum ?? undefined,
          externalId: dto.EXTERNAL_ID,
          source: (dto.SOURCE ?? 'VEHICLE') as CaseSource,
          dtRecord: dto.DT_RECORD,
          car: dto.CAR,
          vehicle: projectVehicle?.vehicle ? { id: projectVehicle.vehicle.id } : undefined,
          crackType,
          degree: dto.DEGREE,
          crackId: dto.CRACK_ID ?? 0,
          length: dto.LENGTH,
          width: dto.WIDTH,
          area: dto.AREA,
          depth: dto.DEPTH,
          img: dto.IMG,
          imgDetect: dto.IMG_DETECT,
          imgMapArea: dto.IMG_MAP_AREA,
          longitude: lng,
          latitude: lat,
          altitude: dto.ALTITUDE,
          heading: dto.HEADING,
          // 原始座標留著：校正的假設(天線在車頂、破壞在正前方 5 公尺)
          // 不見得每種車機都成立，出事時要回得去
          rawLongitude: dto.LNG,
          rawLatitude: dto.LAT,
          geom: { type: 'Point', coordinates: [lng, lat] },
          serialNo: dto.SERIAL_NO,
          path: dto.PATH,
          remark: dto.REMARK
        })
        .orIgnore()
        .execute();

      const row = await caseRepo.findOneOrFail({ where: { externalId: dto.EXTERNAL_ID } });

      // 狀態與地址同時建立：缺了狀態的案件在二篩畫面上會神祕地消失
      await manager
        .getRepository(PatrolCaseStatus)
        .save(
          manager
            .getRepository(PatrolCaseStatus)
            .create({ patrolCase: { id: row.id }, status: 0, edited: 0, needRepair: 0 })
        );
      await manager
        .getRepository(PatrolCaseAddress)
        .save(manager.getRepository(PatrolCaseAddress).create({ patrolCase: { id: row.id } }));

      return row;
    });

    await this.caseHistoryService.record({
      caseType: 'CASE_PATROL',
      caseId: saved.id,
      action: 'CREATED',
      snapshot: this.toSnapshot(saved),
      operatorId: user.uid,
      source: 'DEVICE',
      note: user.uid ? undefined : `由 ${user.account} 上傳`,
      clientIp
    });

    // 慢的活丟給 worker：逆地理編碼、案件編碼，都不該卡住車機的回應
    await this.caseIngestProducer.dispatch(
      {
        caseId: saved.id,
        externalId: saved.externalId,
        companyId: user.companyId,
        lng,
        lat,
        photoKey: saved.img
      },
      { crackType: saved.crackType, detectedAt: saved.dtRecord.toISOString() }
    );

    return HttpResponse.success({ message: '案件已建立', data: { ID: saved.id, DUPLICATED: false } });
  }

  /** 查詢案件（完整條件） */
  public async getCases(dto: CaseQueryDto, companyId: number): Promise<HttpResult> {
    const page = dto.PAGE ?? 1;
    const size = dto.SIZE ?? 50;

    const qb = this.buildQuery(dto, companyId)
      .leftJoinAndSelect('c.reporter', 'u')
      .leftJoinAndSelect('c.vehicle', 'v')
      .skip((page - 1) * size)
      .take(size);

    // 排序欄位用白名單映射到實體屬性：把使用者輸入拼進 orderBy 就是 SQL injection
    const SORT: Record<string, string> = {
      DT_RECORD: 'c.dtRecord',
      AREA: 'c.area',
      DEGREE: 'c.degree',
      STATUS: 'st.status',
      CASE_NUM: 'c.caseNum'
    };
    qb.orderBy(SORT[dto.SORT_BY ?? 'DT_RECORD'], (dto.SORT_DIR ?? 'DESC') as 'ASC' | 'DESC');

    const [rows, total] = await qb.getManyAndCount();

    return HttpResponse.successOrWarn({
      data: { TOTAL: total, PAGE: page, SIZE: size, ROWS: await this.withImageUrls(rows.map((c) => this.toRow(c))) },
      isEmpty: (v) => !v?.ROWS?.length
    });
  }

  /** 單筆詳情 */
  public async getCaseById(id: number, companyId: number): Promise<HttpResult> {
    const row = await this.caseRepo.findOne({
      where: { id, company: { id: companyId } },
      // 巢狀關聯要明寫：只寫 status: true 的話，狀態列會載入但「誰改的」是空的 ——
      // 而那正是詳情頁最想知道的欄位
      relations: {
        address: true,
        status: { updStatusUsr: true, updStatusAdm: true, updEditedUsr: true, updNeedRepairUsr: true },
        reporter: true,
        vehicle: true,
        project: true
      }
    });
    if (!row) throw new NotFoundException(`找不到案件：${id}`);

    return HttpResponse.success({ data: (await this.withImageUrls([this.toRow(row, true)]))[0] });
  }

  /**
   * 可能重複回報的案件。
   *
   * 同一個坑洞常被不同班次、不同來源重複拍到 —— 車機今天拍一次、
   * 民眾用 APP 又報一次。它們的 `external_id` 不同，去重機制擋不掉，
   * 但派工時應該併成一張單，否則會派兩班人去修同一個坑。
   *
   * 判定條件是「同類型 + 半徑內 + 時間相近 + 還沒完修」——
   * 只比座標的話，同一個路口不同時期的破壞會被誤判成同一件。
   */
  public async getDuplicates(id: number, companyId: number): Promise<HttpResult> {
    const target = await this.caseRepo.findOne({ where: { id, company: { id: companyId } } });
    if (!target) throw new NotFoundException(`找不到案件：${id}`);

    const rows = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.address', 'ad')
      .leftJoinAndSelect('c.status', 'st')
      .where('c.company_id = :companyId', { companyId })
      .andWhere('c.id != :id', { id })
      .andWhere('c.crack_type = :crackType', { crackType: target.crackType })
      // 半徑用 geography：單位就是公尺，而且吃得到 GiST 索引
      .andWhere('ST_DWithin(c.geom, :origin::geography, :radius)', {
        origin: `SRID=4326;POINT(${target.longitude} ${target.latitude})`,
        radius: DUPLICATE_RADIUS_M
      })
      .andWhere('c.dt_record BETWEEN :from AND :to', {
        from: new Date(target.dtRecord.getTime() - DUPLICATE_WINDOW_DAYS * 86400000),
        to: new Date(target.dtRecord.getTime() + DUPLICATE_WINDOW_DAYS * 86400000)
      })
      // 已完修的不算重複：那個坑已經處理掉了
      .andWhere('COALESCE(st.need_repair, 0) != -1')
      .orderBy('c.dt_record', 'DESC')
      .limit(20)
      .getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((c) => ({
        ID: c.id,
        CASE_NUM: c.caseNum ?? c.externalId,
        CRACK_TYPE: c.crackType,
        DEGREE: c.degree,
        DT_RECORD: c.dtRecord,
        ROAD: c.address?.road ?? null,
        ADDRESS: c.address?.address ?? null,
        NEED_REPAIR: c.status?.needRepair ?? 0,
        // 距離直接算好回去：前端要顯示「30 公尺外」，自己用座標算會有投影誤差
        DISTANCE_M: Math.round(this.haversine(target.longitude, target.latitude, c.longitude, c.latitude))
      })),
      warnMsg: '沒有可能重複的案件'
    });
  }

  /** 兩點距離(公尺)；只用在顯示，不用在篩選 —— 篩選交給 PostGIS */
  private haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /** 更新案件欄位 */
  public async updateCase(dto: UpdateCaseDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const current = await this.caseRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { address: true, status: true, project: true }
    });
    if (!current) throw new NotFoundException(`找不到案件：${dto.ID}`);

    const before = this.toSnapshot(current);

    const patch: Record<string, unknown> = {};
    if (dto.CRACK_TYPE) patch.crackType = dto.CRACK_TYPE;
    if (dto.DEGREE) patch.degree = dto.DEGREE;
    if (dto.LENGTH !== undefined) patch.length = dto.LENGTH;
    if (dto.WIDTH !== undefined) patch.width = dto.WIDTH;
    if (dto.AREA !== undefined) patch.area = dto.AREA;
    if (dto.DEPTH !== undefined) patch.depth = dto.DEPTH;
    if (dto.PROJECT_ID !== undefined) patch.project = { id: dto.PROJECT_ID };
    if (dto.REMARK !== undefined) patch.remark = dto.REMARK;

    const addrPatch: Record<string, unknown> = {};
    if (dto.COUNTY !== undefined) addrPatch.county = dto.COUNTY;
    if (dto.DISTRICT !== undefined) addrPatch.district = dto.DISTRICT;
    if (dto.CAVLGE !== undefined) addrPatch.cavlge = dto.CAVLGE;
    if (dto.ROAD !== undefined) addrPatch.road = dto.ROAD;
    if (dto.ADDRESS !== undefined) addrPatch.address = dto.ADDRESS;

    if (!Object.keys(patch).length && !Object.keys(addrPatch).length) throw new BadRequestException('沒有要更新的欄位');

    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(patch).length) await manager.getRepository(PatrolCase).update({ id: dto.ID }, patch);

      if (Object.keys(addrPatch).length) {
        const addrRepo = manager.getRepository(PatrolCaseAddress);
        const existing = await addrRepo.findOne({ where: { patrolCase: { id: dto.ID } } });

        if (existing) await addrRepo.update({ id: existing.id }, addrPatch);
        else await addrRepo.save(addrRepo.create({ patrolCase: { id: dto.ID }, ...addrPatch }));
      }

      // 人工改過就標記 edited：稽核要看的是「有沒有被人動過」
      const statusRepo = manager.getRepository(PatrolCaseStatus);
      const status = await statusRepo.findOne({ where: { patrolCase: { id: dto.ID } } });
      if (status) {
        await statusRepo.update(
          { id: status.id },
          { edited: 1, updEditedUsr: { id: user.uid } as never, updEditedAt: new Date() }
        );
      }
    });

    const after = await this.caseRepo.findOne({
      where: { id: dto.ID },
      relations: { address: true, status: true, project: true }
    });

    await this.caseHistoryService.record({
      caseType: 'CASE_PATROL',
      caseId: dto.ID,
      action: 'UPDATED',
      snapshot: after ? this.toSnapshot(after) : {},
      before,
      operatorId: user.uid,
      note: dto.REMARK,
      clientIp
    });

    return HttpResponse.success({ message: '案件已更新' });
  }

  /**
   * 更新狀態。
   *
   * 三組狀態分開更新，各自記錄「誰改的、什麼時候」。
   * 管理者覆核另外記一組 —— 覆核紀錄不該被使用者的後續操作蓋掉。
   */
  public async updateStatus(dto: UpdateCaseStatusDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const current = await this.caseRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { status: true, address: true, project: true }
    });
    if (!current) throw new NotFoundException(`找不到案件：${dto.ID}`);
    if (dto.STATUS === undefined && dto.NEED_REPAIR === undefined) throw new BadRequestException('沒有要更新的狀態');

    const before = this.toSnapshot(current);
    const now = new Date();

    const patch: Record<string, unknown> = {};

    if (dto.STATUS !== undefined) {
      patch.status = dto.STATUS;

      if (dto.AS_ADMIN) {
        patch.updStatusAdm = { id: user.uid };
        patch.updStatusAdmAt = now;
      } else {
        patch.updStatusUsr = { id: user.uid };
        patch.updStatusUsrAt = now;
      }
    }

    if (dto.NEED_REPAIR !== undefined) {
      patch.needRepair = dto.NEED_REPAIR;
      patch.updNeedRepairUsr = { id: user.uid };
      patch.updNeedRepairAt = now;
    }

    const statusRepo = this.statusRepo;
    const existing = current.status ?? (await statusRepo.findOne({ where: { patrolCase: { id: dto.ID } } }));

    if (existing) await statusRepo.update({ id: existing.id }, patch as never);
    else await statusRepo.save(statusRepo.create({ patrolCase: { id: dto.ID }, ...patch } as never));

    const after = await this.caseRepo.findOne({
      where: { id: dto.ID },
      relations: { status: true, address: true, project: true }
    });

    await this.caseHistoryService.record({
      caseType: 'CASE_PATROL',
      caseId: dto.ID,
      action: 'STATUS_CHANGED',
      snapshot: after ? this.toSnapshot(after) : {},
      before,
      fromState: String(current.status?.status ?? 0),
      toState: String(dto.STATUS ?? current.status?.status ?? 0),
      operatorId: user.uid,
      note: dto.REMARK,
      clientIp
    });

    return HttpResponse.success({ message: '狀態已更新' });
  }

  /**
   * 批次更新狀態。
   *
   * 二篩是一批一批做的 —— 一次看幾十張圖，全部通過。
   * 一筆一筆送的話，五十筆就是五十次往返，而且中途失敗會留下一半改一半沒改。
   */
  public async batchUpdateStatus(dto: BatchUpdateStatusDto, user: AuthUser): Promise<HttpResult> {
    if (!dto.IDS.length) throw new BadRequestException('沒有指定案件');
    if (dto.STATUS === undefined && dto.NEED_REPAIR === undefined) throw new BadRequestException('沒有要更新的狀態');

    const cases = await this.caseRepo.find({
      where: dto.IDS.map((id) => ({ id, company: { id: user.companyId } })),
      relations: { status: true, address: true, project: true }
    });

    const now = new Date();
    let updated = 0;

    for (const c of cases) {
      const before = this.toSnapshot(c);
      const patch: Record<string, unknown> = {};

      if (dto.STATUS !== undefined) {
        patch.status = dto.STATUS;
        if (dto.AS_ADMIN) {
          patch.updStatusAdm = { id: user.uid };
          patch.updStatusAdmAt = now;
        } else {
          patch.updStatusUsr = { id: user.uid };
          patch.updStatusUsrAt = now;
        }
      }

      if (dto.NEED_REPAIR !== undefined) {
        patch.needRepair = dto.NEED_REPAIR;
        patch.updNeedRepairUsr = { id: user.uid };
        patch.updNeedRepairAt = now;
      }

      if (c.status) await this.statusRepo.update({ id: c.status.id }, patch as never);
      else await this.statusRepo.save(this.statusRepo.create({ patrolCase: { id: c.id }, ...patch } as never));

      await this.caseHistoryService.record({
        caseType: 'CASE_PATROL',
        caseId: c.id,
        action: 'STATUS_CHANGED',
        snapshot: { ...before, status: dto.STATUS ?? before.status, needRepair: dto.NEED_REPAIR ?? before.needRepair },
        before,
        operatorId: user.uid,
        note: '批次更新'
      });

      updated += 1;
    }

    return HttpResponse.success({ message: `已更新 ${updated} 筆`, data: { UPDATED: updated } });
  }

  /** 查詢附近案件 */
  public async getNearby(dto: NearbyQueryDto, companyId: number): Promise<HttpResult> {
    const rows = await this.geoService.findNearby(dto.LNG, dto.LAT, dto.RADIUS_M ?? 500, companyId);
    return HttpResponse.successOrWarn({ data: rows, warnMsg: '半徑內查無案件' });
  }

  /** 多維度統計 */
  public async getStats(dto: CaseStatsQueryDto, companyId: number): Promise<HttpResult> {
    const GROUP_EXPR: Record<string, string> = {
      DAY: "to_char(date_trunc('day', c.dt_record), 'YYYY-MM-DD')",
      WEEK: `to_char(date_trunc('week', c.dt_record), 'YYYY-"W"IW')`,
      MONTH: "to_char(date_trunc('month', c.dt_record), 'YYYY-MM')",
      DISTRICT: "COALESCE(addr.district, '未分區')",
      CAVLGE: "COALESCE(addr.cavlge, '未分里')",
      ROAD: "COALESCE(addr.road, '未定位')",
      CRACK_TYPE: 'c.crack_type',
      DEGREE: 'c.degree',
      CAR: "COALESCE(c.car, '未知')",
      PRJ_ID: "COALESCE(p.prj_id, '未歸屬')"
    };

    const expr = GROUP_EXPR[dto.GROUP_BY ?? 'DAY'];

    const qb = this.buildQuery(dto as CaseQueryDto, companyId)
      .select(expr, 'GROUP_KEY')
      .addSelect('COUNT(*)::int', 'TOTAL')
      .addSelect('COUNT(*) FILTER (WHERE st.status = 1)::int', 'PASSED')
      .addSelect('COUNT(*) FILTER (WHERE st.need_repair = 2)::int', 'DISPATCHED')
      .addSelect('ROUND(SUM(c.area)::numeric, 2)::float8', 'AREA')
      .groupBy(expr)
      .limit(200);

    // 時間維度照時間排序，其餘照數量 —— 折線圖的 x 軸不能亂序
    if (['DAY', 'WEEK', 'MONTH'].includes(dto.GROUP_BY ?? 'DAY')) qb.orderBy('"GROUP_KEY"', 'ASC');
    else qb.orderBy('"TOTAL"', 'DESC');

    return HttpResponse.successOrWarn({ data: await qb.getRawMany() });
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  /** 查詢條件組裝；查詢、統計、報表共用同一份 */
  private buildQuery(dto: CaseQueryDto, companyId: number) {
    const qb = this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.address', 'addr')
      .leftJoinAndSelect('c.status', 'st')
      .leftJoinAndSelect('c.project', 'p')
      .where('c.company_id = :companyId', { companyId });

    if (dto.START_DATE) qb.andWhere('c.dt_record >= :start', { start: new Date(dto.START_DATE) });
    if (dto.END_DATE) qb.andWhere('c.dt_record < :end', { end: new Date(`${dto.END_DATE}T23:59:59.999`) });

    if (dto.CASE_NUM) qb.andWhere('c.case_num ILIKE :caseNum', { caseNum: `${dto.CASE_NUM}%` });
    if (dto.EXTERNAL_ID) qb.andWhere('c.external_id ILIKE :extId', { extId: `%${dto.EXTERNAL_ID}%` });

    if (dto.CRACK_TYPE?.length) qb.andWhere('c.crack_type IN (:...crackType)', { crackType: dto.CRACK_TYPE });
    if (dto.DEGREE?.length) qb.andWhere('c.degree IN (:...degree)', { degree: dto.DEGREE });
    if (dto.AREA_MIN !== undefined) qb.andWhere('c.area >= :areaMin', { areaMin: dto.AREA_MIN });
    if (dto.AREA_MAX !== undefined) qb.andWhere('c.area <= :areaMax', { areaMax: dto.AREA_MAX });
    if (dto.DEPTH_MIN !== undefined) qb.andWhere('c.depth >= :depthMin', { depthMin: dto.DEPTH_MIN });

    if (dto.COUNTY) qb.andWhere('addr.county = :county', { county: dto.COUNTY });
    if (dto.DISTRICT?.length) qb.andWhere('addr.district IN (:...district)', { district: dto.DISTRICT });

    // 工務段沒有寫在案件上：轄區是「標案-工務段」關聯出來的行政區清單。
    // 用子查詢而不是把 sections 一路 join 進主查詢 ——
    // 那會讓一個案件對到多列轄區，分頁的總筆數就跟著錯
    if (dto.SECTION_ID?.length) {
      qb.andWhere(
        `addr.district IN (
           SELECT a.district
             FROM project_sections ps
             JOIN section_areas sa ON sa.project_section_id = ps.id AND sa.is_active = true
             JOIN areas a ON a.id = sa.area_id
            WHERE ps.section_id IN (:...sectionIds) AND ps.is_active = true
         )`,
        { sectionIds: dto.SECTION_ID }
      );
    }
    if (dto.CAVLGE) qb.andWhere('addr.cavlge = :cavlge', { cavlge: dto.CAVLGE });
    if (dto.ROAD) qb.andWhere('addr.road ILIKE :road', { road: `%${dto.ROAD}%` });
    if (dto.ADDRESS) qb.andWhere('addr.address ILIKE :addrText', { addrText: `%${dto.ADDRESS}%` });

    if (dto.STATUS?.length) qb.andWhere('st.status IN (:...status)', { status: dto.STATUS });
    if (dto.EDITED?.length) qb.andWhere('st.edited IN (:...edited)', { edited: dto.EDITED });
    if (dto.NEED_REPAIR?.length) qb.andWhere('st.need_repair IN (:...needRepair)', { needRepair: dto.NEED_REPAIR });

    if (dto.PRJ_ID?.length) qb.andWhere('p.prj_id IN (:...prjId)', { prjId: dto.PRJ_ID });
    if (dto.CAR) qb.andWhere('c.car ILIKE :car', { car: `%${dto.CAR}%` });
    if (dto.SOURCE?.length) qb.andWhere('c.source IN (:...source)', { source: dto.SOURCE });

    // 「還沒派工」用 NOT EXISTS 而不是 LEFT JOIN IS NULL：後者在分頁時會讓計數失準
    if (dto.UNDISPATCHED) qb.andWhere('NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.case_patrol_id = c.id)');
    if (dto.HAS_IMAGE) qb.andWhere('c.img IS NOT NULL');

    if (dto.KEYWORD) {
      qb.andWhere(
        '(addr.road ILIKE :kw OR addr.address ILIKE :kw OR c.remark ILIKE :kw OR c.case_num ILIKE :kw OR c.external_id ILIKE :kw)',
        {
          kw: `%${dto.KEYWORD}%`
        }
      );
    }

    return qb;
  }

  /** 歷程快照：只記會被追究的欄位，不是整個實體 */
  private toSnapshot(c: PatrolCase): Record<string, unknown> {
    return {
      caseNum: c.caseNum ?? null,
      crackType: c.crackType,
      degree: c.degree,
      length: c.length,
      width: c.width,
      area: c.area,
      depth: c.depth ?? null,
      longitude: c.longitude,
      latitude: c.latitude,
      img: c.img ?? null,
      imgDetect: c.imgDetect ?? null,
      projectId: c.project?.id ?? null,
      county: c.address?.county ?? null,
      district: c.address?.district ?? null,
      cavlge: c.address?.cavlge ?? null,
      road: c.address?.road ?? null,
      address: c.address?.address ?? null,
      status: c.status?.status ?? 0,
      edited: c.status?.edited ?? 0,
      needRepair: c.status?.needRepair ?? 0,
      remark: c.remark ?? null
    };
  }

  /**
   * 補上可直接顯示的圖片網址。
   *
   * 資料庫存的是物件 key，不是網址 —— bucket 不開公開讀取，
   * 所以每次都要現簽一組短效網址。簽名是本機 HMAC 運算，不會連出去，
   * 一頁五十筆一起簽也只是微秒等級。
   *
   * 網址每次重新簽發，前端不要存起來重複使用。
   */
  private async withImageUrls<T extends { IMG?: string | null; IMG_DETECT?: string | null }>(rows: T[]): Promise<T[]> {
    return await Promise.all(
      rows.map(async (r) => ({
        ...r,
        IMG_URL: r.IMG ? await this.storageService.signGetUrl(r.IMG, 600) : null,
        IMG_DETECT_URL: r.IMG_DETECT ? await this.storageService.signGetUrl(r.IMG_DETECT, 600) : null
      }))
    );
  }

  /** entity → 對外欄位 */
  private toRow(c: PatrolCase, detail = false) {
    const crack = CRACK_TYPE_DEF.find((t) => t.key === c.crackType);

    const base = {
      ID: c.id,
      CASE_NUM: c.caseNum ?? null,
      EXTERNAL_ID: c.externalId,
      SOURCE: c.source,
      DT_RECORD: c.dtRecord,
      PRJ_ID: c.project?.prjId ?? null,
      PROJECT_ID: c.project?.id ?? null,
      PROJECT_NAME: c.project?.prjName ?? null,
      CAR: c.car ?? null,
      VEHICLE_ID: c.vehicle?.id ?? null,
      CRACK_TYPE: c.crackType,
      CRACK_TYPE_NAME: crack?.name ?? c.crackType,
      DEGREE: c.degree,
      CRACK_ID: c.crackId,
      LENGTH: c.length,
      WIDTH: c.width,
      AREA: c.area,
      DEPTH: c.depth ?? null,
      IMG: c.img ?? null,
      IMG_DETECT: c.imgDetect ?? null,
      IMG_MAP_AREA: c.imgMapArea ?? null,
      LNG: c.longitude,
      LAT: c.latitude,
      ALTITUDE: c.altitude ?? null,
      SERIAL_NO: c.serialNo ?? null,
      COUNTY: c.address?.county ?? null,
      DISTRICT: c.address?.district ?? null,
      CAVLGE: c.address?.cavlge ?? null,
      NEIGHBOR: c.address?.neighbor ?? null,
      ROAD: c.address?.road ?? null,
      HOUSE_NUMBER: c.address?.houseNumber ?? null,
      ADDRESS: c.address?.address ?? null,
      STATUS: c.status?.status ?? 0,
      EDITED: c.status?.edited ?? 0,
      NEED_REPAIR: c.status?.needRepair ?? 0,
      REMARK: c.remark ?? null,
      REPORTER: c.reporter?.name ?? null,
      CREATED_AT: c.createdAt
    };

    if (!detail) return base;

    // 詳情才回傳「誰在什麼時候改的」：清單頁不需要，多查會拖慢分頁
    return {
      ...base,
      PATH: c.path ?? null,
      O_ADDRESS: c.address?.oAddress ?? null,
      UPD_STATUS_USR: c.status?.updStatusUsr?.name ?? null,
      UPD_STATUS_USR_AT: c.status?.updStatusUsrAt ?? null,
      UPD_STATUS_ADM: c.status?.updStatusAdm?.name ?? null,
      UPD_STATUS_ADM_AT: c.status?.updStatusAdmAt ?? null,
      UPD_EDITED_USR: c.status?.updEditedUsr?.name ?? null,
      UPD_EDITED_AT: c.status?.updEditedAt ?? null,
      UPD_NEED_REPAIR_USR: c.status?.updNeedRepairUsr?.name ?? null,
      UPD_NEED_REPAIR_AT: c.status?.updNeedRepairAt ?? null,
      UPDATED_AT: c.updatedAt
    };
  }
  /**
   * GPS 座標校正。
   *
   * 把座標沿著行進方向推 5 公尺 —— 車機的天線在車頂，回報的是車輛位置，
   * 而破壞在鏡頭正前方。不校正的話，地圖上的點會系統性地偏在道路後方，
   * 派工人員到現場會找不到那個坑。
   *
   * **沒有方位角就不校正**：猜方向比不校正更糟，往反方向推 5 公尺
   * 等於把誤差放大成 10 公尺。
   *
   * 經度的每一度在不同緯度上代表的距離不同，所以要除以 cos(緯度)；
   * 台灣在北緯 24 度附近，忽略這一項會有大約一成的誤差。
   */
  private adjustCoords(lng: number, lat: number, heading?: number): { lng: number; lat: number } {
    if (heading === undefined || heading === null) return { lng, lat };

    const rad = (heading * Math.PI) / 180;
    const dLat = GPS_FORWARD_OFFSET_DEG * Math.cos(rad);
    const dLng = (GPS_FORWARD_OFFSET_DEG * Math.sin(rad)) / Math.max(0.1, Math.cos((lat * Math.PI) / 180));

    return { lng: Number((lng + dLng).toFixed(7)), lat: Number((lat + dLat).toFixed(7)) };
  }

  /**
   * 依案件編號查詢單筆。
   *
   * 業主與公文用的是案件編號而不是 id ——「DEMO01000123 這件修好了沒有」
   * 是最常被問的一句話，而承辦手上只有那個編號。
   */
  public async getByCaseNum(caseNum: string, companyId: number): Promise<HttpResult> {
    const row = await this.caseRepo.findOne({
      where: [
        { caseNum, company: { id: companyId } },
        // 編碼失敗或還沒編號的案件只有外部編號，兩者都要查得到
        { externalId: caseNum, company: { id: companyId } }
      ],
      relations: {
        address: true,
        status: { updStatusUsr: true, updStatusAdm: true, updEditedUsr: true, updNeedRepairUsr: true },
        reporter: true,
        vehicle: true,
        project: true
      }
    });
    if (!row) throw new NotFoundException(`找不到案件編號：${caseNum}`);

    return HttpResponse.success({ data: (await this.withImageUrls([this.toRow(row, true)]))[0] });
  }

  /**
   * 連續鱷魚狀裂縫警示。
   *
   * 單獨一處龜裂是局部修補，但**連續一整段**代表路基已經失效 ——
   * 那要整段刨鋪，而且是預算等級不同的工程。這個差別在逐筆的清單上看不出來，
   * 承辦要一件一件對座標才會發現。
   *
   * 判定：同一輛車、相鄰兩筆距離不超過 10 公尺、序號連號或同號。
   * **必須先依車輛分組再掃描** —— 不同車輛的紀錄依時間交錯排列，
   * 混在一起會把兩台車在不同路段的破壞誤判成一段連續破壞。
   *
   * 中間夾雜其他破壞類型不會中斷序列，只是不列入群組：
   * 一段龜裂的路面上本來就會混著坑洞。
   */
  public async getAlligatorWarnings(dto: CaseQueryDto, companyId: number): Promise<HttpResult> {
    const rows = await this.buildQuery(dto, companyId)
      .select('c.id', 'id')
      .addSelect('COALESCE(c.case_num, c.external_id)', 'caseNum')
      .addSelect('c.crack_type', 'crackType')
      .addSelect('c.degree', 'degree')
      .addSelect('c.car', 'car')
      .addSelect('c.serial_no', 'serialNo')
      .addSelect('c.dt_record', 'dtRecord')
      .addSelect('c.longitude', 'lng')
      .addSelect('c.latitude', 'lat')
      .addSelect('c.area', 'area')
      .addSelect('addr.road', 'road')
      .addSelect('addr.district', 'district')
      .orderBy('c.car', 'ASC')
      .addOrderBy('c.dt_record', 'ASC')
      .limit(20000)
      .getRawMany<{
        id: number;
        caseNum: string;
        crackType: string;
        degree: string;
        car: string | null;
        serialNo: number | null;
        dtRecord: Date;
        lng: number;
        lat: number;
        area: number;
        road: string | null;
        district: string | null;
      }>();

    const groups = this.detectAlligatorGroups(rows);

    return HttpResponse.successOrWarn({
      data: groups.map((g, i) => ({
        GROUP_NO: i + 1,
        CAR: g[0].car,
        DISTRICT: g[0].district,
        ROAD: g[0].road,
        COUNT: g.length,
        TOTAL_AREA: Number(g.reduce((s, r) => s + Number(r.area), 0).toFixed(2)),
        // 群組的長度用頭尾距離：整段刨鋪的估價要的是這個數字
        SPAN_M: Math.round(this.haversine(g[0].lng, g[0].lat, g[g.length - 1].lng, g[g.length - 1].lat)),
        START_AT: g[0].dtRecord,
        END_AT: g[g.length - 1].dtRecord,
        CASES: g.map((r) => ({ ID: r.id, CASE_NUM: r.caseNum, DEGREE: r.degree, LNG: r.lng, LAT: r.lat }))
      })),
      warnMsg: '這個範圍沒有連續的鱷魚狀裂縫'
    });
  }

  /**
   * 掃出連續群組。
   *
   * @param rows 已依「車輛、時間」排序的案件
   */
  private detectAlligatorGroups<
    T extends { crackType: string; car: string | null; serialNo: number | null; lng: number; lat: number }
  >(rows: T[]): T[][] {
    const groups: T[][] = [];

    // 依車輛分組：不同車輛的紀錄依時間交錯，混在一起會誤判
    const byCar = new Map<string, T[]>();
    for (const row of rows) {
      const key = row.car ?? '(未指定)';
      byCar.set(key, [...(byCar.get(key) ?? []), row]);
    }

    for (const list of byCar.values()) {
      let current: T[] = [];
      let lastAlligator: T | null = null;

      for (const row of list) {
        if (row.crackType !== 'Alligator_Cracking') continue; // 夾雜其他類型不中斷序列

        const near = lastAlligator && this.haversine(lastAlligator.lng, lastAlligator.lat, row.lng, row.lat) <= ALLIGATOR_GAP_M;
        // 序號連號或同號：同一張影像上的多處龜裂會共用一個序號
        const sequential =
          lastAlligator &&
          row.serialNo !== null &&
          lastAlligator.serialNo !== null &&
          row.serialNo - lastAlligator.serialNo <= 1;

        if (near && sequential) {
          current.push(row);
        } else {
          if (current.length >= ALLIGATOR_MIN_GROUP) groups.push(current);
          current = [row];
        }

        lastAlligator = row;
      }

      if (current.length >= ALLIGATOR_MIN_GROUP) groups.push(current);
    }

    return groups.sort((a, b) => b.length - a.length);
  }

  /**
   * 巡查里程統計。
   *
   * 依 (日期, 標案, 縣市, 行政區) 拆開 —— 請款是按行政區結算的，
   * 一台車一天跑過三個區，那一天的里程要分成三筆。
   *
   * 演算法：依 `is_trip_start` 分段，跟上一筆原始點距離 **大於 5 公尺才計入** ——
   * 車子停在紅燈前的那兩分鐘會產生二十幾個幾乎重疊的點，
   * 不濾掉的話 GPS 的原地跳動會被算成里程。
   */
  public async getMileage(dto: MileageQueryDto, companyId: number): Promise<HttpResult> {
    const rows = await this.caseRepo.query(
      `
      WITH ordered AS (
        SELECT t.vehicle_id,
               t.project_id,
               t.recorded_at,
               t.geom::geometry AS geom,
               t.is_trip_start,
               LAG(t.geom::geometry) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) AS prev_geom,
               LAG(t.is_trip_start) OVER (PARTITION BY t.vehicle_id ORDER BY t.recorded_at) AS prev_start
          FROM vehicle_tracks t
         WHERE t.company_id = $1
           AND t.recorded_at >= $2 AND t.recorded_at < $3
           AND ($4::int IS NULL OR t.vehicle_id = $4)
      ),
      legs AS (
        SELECT o.vehicle_id,
               o.project_id,
               date_trunc('day', o.recorded_at) AS day,
               ST_Distance(o.geom::geography, o.prev_geom::geography) AS seg_m,
               o.geom
          FROM ordered o
         WHERE o.prev_geom IS NOT NULL
           -- 一趟行程的起點不接續上一趟：中間那段是回廠的路，不是巡查里程
           AND o.is_trip_start = false
           AND ST_Distance(o.geom::geography, o.prev_geom::geography) > 5
      )
      SELECT to_char(l.day, 'YYYY-MM-DD')                              AS "DAY",
             v.plate_no                                                AS "CAR",
             COALESCE(p.prj_id, '未歸屬')                              AS "PRJ_ID",
             COALESCE(a.county, '未定位')                              AS "COUNTY",
             COALESCE(a.district, '未分區')                            AS "DISTRICT",
             ROUND((SUM(l.seg_m) / 1000)::numeric, 2)::float8          AS "KM",
             COUNT(*)::int                                             AS "SEGMENTS"
        FROM legs l
        JOIN vehicles v ON v.id = l.vehicle_id
        LEFT JOIN projects p ON p.id = l.project_id
        -- 行政區由最近的案件地址推得：軌跡點本身沒有行政區，
        -- 而為了幾千個點各做一次逆地理編碼並不划算
        LEFT JOIN LATERAL (
          SELECT ad.county, ad.district
            FROM patrol_cases c
            JOIN patrol_case_addresses ad ON ad.case_id = c.id
           WHERE c.company_id = $1 AND ad.district IS NOT NULL
           ORDER BY c.geom <-> l.geom::geography
           LIMIT 1
        ) a ON true
       GROUP BY l.day, v.plate_no, p.prj_id, a.county, a.district
       ORDER BY "DAY" DESC, "CAR", "DISTRICT"
      `,
      [
        companyId,
        new Date(dto.DATE_START),
        new Date(new Date(dto.DATE_END).getTime() + 86400000),
        dto.VEHICLE_ID ?? null
      ]
    );

    return HttpResponse.successOrWarn({
      data: {
        ROWS: rows,
        TOTAL_KM: Number(rows.reduce((s: number, r: { KM: number }) => s + Number(r.KM), 0).toFixed(2)),
        DAYS: new Set(rows.map((r: { DAY: string }) => r.DAY)).size
      },
      isEmpty: (v) => !v?.ROWS?.length,
      warnMsg: '這個區間沒有軌跡'
    });
  }

}
