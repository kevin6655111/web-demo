import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { WorkOrder, type WorkOrderType } from './entities/work-order.entity';
import { WorkOrderStatus } from './entities/work-order-status.entity';
import { WorkOrderImage } from './entities/work-order-image.entity';
import { WorkOrderImprovement } from './entities/work-order-improvement.entity';
import { WorkOrderUser } from './entities/work-order-user.entity';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { Maintenance } from '@/maintenance/entities/maintenance.entity';
import { MaintenanceStatus } from '@/maintenance/entities/maintenance-status.entity';
import { User } from '@entities/user.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { Project } from '@/project/entities/project.entity';
import { StorageService } from '@/storage/storage.service';
import { CaseHistoryService } from '@/case-history/case-history.service';
import { CaseEncodeService } from '@/case-encode/case-encode.service';
import {
  IMAGE_GROUPS,
  IMAGE_TYPE_DEF,
  ORDER_LOCKED_FROM,
  REQUIRED_IMAGES,
  UNASSIGNED_WORKER,
  WORK_ORDER_ACTION,
  WORK_ORDER_STATUS_DEF,
  WORK_ORDER_TYPE_DEF,
  WORK_UNIT_DEF
} from '@road-patrol/shared';
import { CaseEventPublisher } from '@/queue/case-event.publisher';
import { MaintenanceService } from '@/maintenance/maintenance.service';
import type { AuthUser } from '@app-types/user-auth.type';
import {
  AddWorkOrderDto,
  DeleteImageDto,
  UpdateOrderStatusDto,
  UpdateWorkOrderDto,
  WorkOrderQueryDto
} from './work-order.dto';

/** 上傳進來的檔案 */
export type UploadedImage = { fieldname: string; originalname: string; mimetype: string; size: number; buffer: Buffer };

/** 派工單狀態碼 */
const STATUS = { DELETED: -1, PENDING: 0, WORKING: 1, REPORTED: 2, FINISHED: 3 } as const;

/** 巡查單狀態碼；轉派與復原時要動它 */
const MAINTENANCE_STATUS = { DELETED: -1, WATCHING: 1, DISPATCHED: 2 } as const;

/**
 * 這幾個值不能直接寫進資料庫 —— 要先看這張單當前在哪裡才知道該寫什麼。
 *
 * 刪除也在其中：已回報或已完工的單不允許直接刪，要先撤回。
 */
const NEEDS_CURRENT: number[] = [STATUS.DELETED, WORK_ORDER_ACTION.RESTORE, WORK_ORDER_ACTION.WITHDRAW];

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
    private readonly caseEncodeService: CaseEncodeService,
    private readonly maintenanceService: MaintenanceService,
    private readonly eventPublisher: CaseEventPublisher,
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

    // 先擋掉不存在或已刪除的來源案件，免得白白編掉一個單號
    await this.assertSourceUsable(dto.TYPE, dto.CASE_PATROL_ID, dto.MAINTENANCE_ID);

    // 一案一單由資料層的唯一鍵保證，但先查一次能給出比「唯一鍵衝突」更好懂的訊息
    if (dto.TYPE === 'PC' && dto.CASE_PATROL_ID) {
      const existing = await this.orderRepo.findOne({ where: { casePatrol: { id: dto.CASE_PATROL_ID } } });
      if (existing) throw new ConflictException(`此案件已有派工單：${existing.caseNum}`);
    }
    if (dto.TYPE === 'PD' && dto.MAINTENANCE_ID) {
      const existing = await this.orderRepo.findOne({ where: { maintenance: { id: dto.MAINTENANCE_ID } } });
      if (existing) throw new ConflictException(`此巡查單已有派工單：${existing.caseNum}`);
    }

    const workerIds = await this.resolveWorkerIds(dto.WORKER_USER_ID);

    // 取號在交易裡：號碼與資料一起成敗，建單失敗不會留下一個被跳過的號
    const { saved, caseNum } = await this.dataSource.transaction(async (manager) => {
      const caseNum = await this.caseEncodeService.next(
        { prefix: `${project.prjId}${dto.TYPE}`, seqDate: CaseEncodeService.monthOf(dto.DISPATCH_DATE) },
        manager
      );
      {
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
            workUnit: dto.WORK_UNIT,
            dispatcher: { id: user.uid },
            county: dto.COUNTY,
            district: dto.DISTRICT,
            cavlge: dto.CAVLGE,
            address: dto.ADDRESS,
            startAddr: dto.START_ADDR,
            endAddr: dto.END_ADDR,
            startGeom:
              dto.START_LNG && dto.START_LAT
                ? { type: 'Point', coordinates: [dto.START_LNG, dto.START_LAT] }
                : undefined,
            endGeom:
              dto.END_LNG && dto.END_LAT ? { type: 'Point', coordinates: [dto.END_LNG, dto.END_LAT] } : undefined,
            material: dto.MATERIAL,
            materialSize: dto.MATERIAL_SIZE,
            workLength: dto.WORK_LENGTH,
            workWidth: dto.WORK_WIDTH,
            workDepthMilling: dto.WORK_DEPTH_MILLING,
            workDepthPaving: dto.WORK_DEPTH_PAVING,
            remark: dto.REMARK,
            casePatrol: dto.CASE_PATROL_ID ? { id: dto.CASE_PATROL_ID } : undefined,
            maintenance: dto.MAINTENANCE_ID ? { id: dto.MAINTENANCE_ID } : undefined
          })
        );

        if (workerIds?.length) {
          await manager
            .getRepository(WorkOrderUser)
            .insert(workerIds.map((id) => ({ workOrder: { id: order.id }, user: { id } })));
        }

        // 有人員就是施工中、沒人員是待處理 —— 這是這張單在還沒回報前的唯一合法狀態
        await manager.getRepository(WorkOrderStatus).save(
          manager.getRepository(WorkOrderStatus).create({
            workOrder: { id: order.id },
            status: workerIds?.length ? STATUS.WORKING : STATUS.PENDING,
            updStatusUsr: { id: user.uid }
          })
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

          if (cs)
            await caseStatusRepo.update(
              { id: cs.id },
              { needRepair: 2, updNeedRepairUsr: { id: user.uid } as never, updNeedRepairAt: new Date() }
            );
        }

        if (dto.MAINTENANCE_ID) {
          await manager
            .getRepository(MaintenanceStatus)
            .update(
              { maintenance: { id: dto.MAINTENANCE_ID } },
              { status: MAINTENANCE_STATUS.DISPATCHED, updStatusUsr: { id: user.uid } as never }
            );
        }

        return { saved: order, caseNum };
      }
    });

    await this.caseHistoryService.record({
      caseType: 'WORK_ORDER',
      caseId: saved.id,
      action: 'CREATED',
      snapshot: await this.snapshot(saved.id),
      toState: String(workerIds?.length ? STATUS.WORKING : STATUS.PENDING),
      operatorId: user.uid,
      note: `派工單 ${caseNum}`,
      clientIp
    });

    // 巡查單那邊也要留一筆：它的狀態剛被這張單改成「已派工」，
    // 不記的話，日後復原這張巡查單會直接跳回開單那天的狀態
    if (dto.MAINTENANCE_ID) {
      await this.maintenanceService.recordStatusHistory(
        dto.MAINTENANCE_ID,
        MAINTENANCE_STATUS.DISPATCHED,
        'DISPATCHED',
        user,
        clientIp
      );
    }

    this.eventPublisher.workOrderChanged({
      companyId: user.companyId,
      workOrderId: saved.id,
      orderNo: caseNum,
      state: 'CREATED',
      caseId: dto.CASE_PATROL_ID ?? dto.MAINTENANCE_ID ?? 0
    });

    return HttpResponse.success({ message: '派工單已建立', data: { ID: saved.id, CASE_NUM: caseNum } });
  }

  /** 更新派工單欄位 */
  public async update(dto: UpdateWorkOrderDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const current = await this.orderRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { status: true, improvement: true, project: true, workers: { user: true } }
    });
    if (!current) throw new NotFoundException(`找不到派工單：${dto.ID}`);
    if (current.status?.status === STATUS.FINISHED) throw new ConflictException('已完工的派工單不可修改');
    if (current.status?.status === STATUS.DELETED) throw new ConflictException('已刪除的派工單不可修改，請先復原');

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
      WORK_UNIT: 'workUnit',
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

    if (dto.START_LNG && dto.START_LAT)
      patch.startGeom = { type: 'Point', coordinates: [dto.START_LNG, dto.START_LAT] };
    if (dto.END_LNG && dto.END_LAT) patch.endGeom = { type: 'Point', coordinates: [dto.END_LNG, dto.END_LAT] };

    // 未帶代表不異動；帶了就是整組取代（空陣列即清空指派）
    const workerIds = await this.resolveWorkerIds(dto.WORKER_USER_ID);
    const currentWorkerIds = (current.workers ?? []).map((w) => w.user?.id).filter((id): id is number => id != null);
    const addWorkerIds = workerIds?.filter((id) => !currentWorkerIds.includes(id)) ?? [];
    const removeWorkerIds = workerIds ? currentWorkerIds.filter((id) => !workerIds.includes(id)) : [];

    const hasSample =
      dto.SAMPLE_TAKEN !== undefined ||
      dto.SAMPLE_DATE !== undefined ||
      dto.TEST_ITEM !== undefined ||
      dto.TEST_RESULT !== undefined;
    if (!Object.keys(patch).length && !hasSample && workerIds === undefined)
      throw new BadRequestException('沒有要更新的欄位');

    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(patch).length) await manager.getRepository(WorkOrder).update({ id: dto.ID }, patch);

      const workerRepo = manager.getRepository(WorkOrderUser);
      if (removeWorkerIds.length)
        await workerRepo.delete({ workOrder: { id: dto.ID }, user: { id: In(removeWorkerIds) } });
      if (addWorkerIds.length)
        await workerRepo.insert(addWorkerIds.map((id) => ({ workOrder: { id: dto.ID }, user: { id } })));

      // 指派了人就代表開工了；還在待處理的單不必等使用者再按一次「開始施工」
      if (workerIds?.length && (current.status?.status ?? STATUS.PENDING) === STATUS.PENDING) {
        await manager
          .getRepository(WorkOrderStatus)
          .update({ workOrder: { id: dto.ID } }, { status: STATUS.WORKING, updStatusUsr: { id: user.uid } as never });
      }

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

    this.eventPublisher.workOrderChanged({
      companyId: user.companyId,
      workOrderId: dto.ID,
      orderNo: current.caseNum,
      state: 'UPDATED',
      caseId: current.casePatrol?.id ?? 0
    });

    return HttpResponse.success({ message: '派工單已更新' });
  }

  /**
   * 更新狀態，或執行撤回／復原／刪除。
   *
   * 完工(3)時要檢查必要照片齊不齊 —— 缺照片的完工單在驗收時會被退回，
   * 與其讓它一路走到驗收才發現，不如在這裡擋住。
   *
   * 撤回與復原不是狀態而是指令：它們要先看這張單當前在哪裡才知道該退到哪。
   * 這一段的規則見 {@link resolveStatus}。
   */
  public async updateStatus(dto: UpdateOrderStatusDto, user: AuthUser, clientIp?: string): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({
      where: { id: dto.ID, company: { id: user.companyId } },
      relations: { status: true, images: true, casePatrol: true, maintenance: true, project: true, workers: true }
    });
    if (!order) throw new NotFoundException(`找不到派工單：${dto.ID}`);

    const before = await this.snapshot(dto.ID);
    const fromStatus = order.status?.status ?? STATUS.PENDING;

    if (dto.STATUS === STATUS.FINISHED) {
      const missing = this.missingImages(order);
      if (missing.length) throw new BadRequestException(`缺少必要照片：${missing.map((m) => m.name).join('、')}`);
    }

    const status =
      dto.STATUS === WORK_ORDER_ACTION.RESTORE
        ? await this.resolveRestore(order)
        : this.resolveStatus(order, dto.STATUS);

    await this.dataSource.transaction(async (manager) => {
      const statusRepo = manager.getRepository(WorkOrderStatus);
      const patch = { status, updStatusUsr: { id: user.uid }, rejectReason: dto.REJECT_REASON ?? null };

      if (order.status) await statusRepo.update({ id: order.status.id }, patch as never);
      else await statusRepo.save(statusRepo.create({ workOrder: { id: dto.ID }, ...patch } as never));

      // 撤回時把來源案件放回「觀察中」，讓它重新進入待派工。
      //
      // 完工**不動**案件狀態：案件的 needRepair 只有 待確認/觀察中/已派工/已刪除 四種，
      // 沒有「已完修」—— 修完了是派工單的事實(status=3)，不是案件的狀態。
      // 硬塞一個值進去會讓案件狀態欄位表達兩件不同的事，而報表要分開統計。
      if (status === STATUS.PENDING || status === STATUS.DELETED) {
        await this.releaseSource(manager, order, user.uid, status === STATUS.DELETED);
      }

      // 復原一張已刪除的單時，被一起刪掉的來源案件也要救回來 ——
      // 派工單必須以來源案件為基底，救回一張指向不存在案件的單沒有意義
      if (dto.STATUS === WORK_ORDER_ACTION.RESTORE) await this.restoreSource(manager, order, user.uid);
    });

    // 來源巡查單的狀態變動同樣要留歷程 —— 見 create() 的說明
    if (order.maintenance) {
      if (status === STATUS.DELETED) {
        await this.maintenanceService.recordStatusHistory(
          order.maintenance.id,
          MAINTENANCE_STATUS.WATCHING,
          'STATUS_CHANGED',
          user,
          clientIp
        );
      } else if (dto.STATUS === WORK_ORDER_ACTION.RESTORE) {
        await this.maintenanceService.recordStatusHistory(
          order.maintenance.id,
          MAINTENANCE_STATUS.DISPATCHED,
          'DISPATCHED',
          user,
          clientIp
        );
      }
    }

    const ACTION_MAP: Record<number, 'WORKING' | 'REPORTED' | 'FINISHED' | 'RETURNED' | 'DELETED'> = {
      [STATUS.DELETED]: 'DELETED',
      [STATUS.PENDING]: 'RETURNED',
      [STATUS.WORKING]: 'WORKING',
      [STATUS.REPORTED]: 'REPORTED',
      [STATUS.FINISHED]: 'FINISHED'
    };

    await this.caseHistoryService.record({
      caseType: 'WORK_ORDER',
      caseId: dto.ID,
      action: dto.STATUS === WORK_ORDER_ACTION.RESTORE ? 'RESTORED' : (ACTION_MAP[status] ?? 'STATUS_CHANGED'),
      snapshot: { ...(await this.snapshot(dto.ID)), status },
      before,
      fromState: String(fromStatus),
      toState: String(status),
      operatorId: user.uid,
      note: dto.REJECT_REASON ?? this.actionNote(dto.STATUS),
      clientIp
    });

    this.eventPublisher.workOrderChanged({
      companyId: user.companyId,
      workOrderId: dto.ID,
      orderNo: order.caseNum,
      state: String(status),
      caseId: order.casePatrol?.id ?? order.maintenance?.id ?? 0
    });

    return HttpResponse.success({ message: this.statusMessage(dto.STATUS, status) });
  }

  /**
   * 決定這次真正要寫入的狀態。
   *
   * 只有刪除與撤回走這裡（復原要讀歷程，見 {@link resolveRestore}）：
   *
   * - 刪除：已回報／已完工不允許，要先撤回 —— 否則「已經回報過的事實」會被靜靜抹掉
   * - 撤回：退一階；退到待處理／施工中這一段時改用 workerStatus，
   *   避免出現一張沒有人員卻標成施工中的單
   */
  private resolveStatus(order: WorkOrder, requested: number): number {
    if (!NEEDS_CURRENT.includes(requested)) return requested;

    const current = order.status?.status ?? STATUS.PENDING;
    const workerStatus = (order.workers?.length ?? 0) > 0 ? STATUS.WORKING : STATUS.PENDING;

    if (requested === STATUS.DELETED) {
      if (current >= ORDER_LOCKED_FROM) throw new ConflictException(`派工單已回報或已完工，無法刪除：${order.caseNum}`);
      return STATUS.DELETED;
    }

    if (current <= STATUS.PENDING) throw new ConflictException(`派工單已在最初的狀態，無法再撤回：${order.caseNum}`);

    const stepped = current - 1;
    return stepped > STATUS.WORKING ? stepped : workerStatus;
  }

  /**
   * 復原時真正要寫回的狀態：回到歷程上一個不同的狀態。
   *
   * 一張被刪掉的單該回到待處理還是施工中，只有它自己的歷程知道。
   * 但不能低於 workerStatus —— 沒有人員卻標成施工中是不合法的。
   */
  private async resolveRestore(order: WorkOrder): Promise<number> {
    if ((order.status?.status ?? STATUS.PENDING) !== STATUS.DELETED) {
      throw new ConflictException(`派工單未刪除，無需復原：${order.caseNum}`);
    }

    const workerStatus = (order.workers?.length ?? 0) > 0 ? STATUS.WORKING : STATUS.PENDING;
    const previous = await this.caseHistoryService.getPreviousDifferentValue(
      'WORK_ORDER',
      order.id,
      STATUS.DELETED,
      'status'
    );
    const parsed = Number(previous);

    return Number.isFinite(parsed) && parsed >= workerStatus ? parsed : workerStatus;
  }

  /**
   * 撤回或刪除時，把來源案件放回待派工。
   *
   * 刪除時要放得更遠一點：刪掉的單不會再回來，來源案件必須重新可以被派工。
   */
  private async releaseSource(
    manager: EntityManager,
    order: WorkOrder,
    userId: number,
    deleted: boolean
  ): Promise<void> {
    if (order.casePatrol) {
      const repo = manager.getRepository(PatrolCaseStatus);
      const cs = await repo.findOne({ where: { patrolCase: { id: order.casePatrol.id } } });
      if (cs)
        await repo.update(
          { id: cs.id },
          { needRepair: 1, updNeedRepairUsr: { id: userId } as never, updNeedRepairAt: new Date() }
        );
    }

    if (order.maintenance && deleted) {
      await manager
        .getRepository(MaintenanceStatus)
        .update(
          { maintenance: { id: order.maintenance.id } },
          { status: MAINTENANCE_STATUS.WATCHING, updStatusUsr: { id: userId } as never }
        );
    }
  }

  /**
   * 復原派工單時，一併復原被刪掉的來源案件。
   *
   * 來源沒被刪就不動它。復原後固定回到「已派工」—— 這張派工單活著，
   * 來源就不可能還在待派工。
   */
  private async restoreSource(manager: EntityManager, order: WorkOrder, userId: number): Promise<void> {
    if (order.casePatrol) {
      const repo = manager.getRepository(PatrolCaseStatus);
      const cs = await repo.findOne({ where: { patrolCase: { id: order.casePatrol.id } } });

      if (cs && cs.needRepair === MAINTENANCE_STATUS.DELETED) {
        await repo.update(
          { id: cs.id },
          { needRepair: 2, updNeedRepairUsr: { id: userId } as never, updNeedRepairAt: new Date() }
        );
      }
    }

    if (order.maintenance) {
      const repo = manager.getRepository(MaintenanceStatus);
      const ms = await repo.findOne({ where: { maintenance: { id: order.maintenance.id } } });

      if (ms && ms.status === MAINTENANCE_STATUS.DELETED) {
        await repo.update(
          { id: ms.id },
          { status: MAINTENANCE_STATUS.DISPATCHED, updStatusUsr: { id: userId } as never }
        );
      }
    }
  }

  /** 動作碼在歷程上要留下「做了什麼」，不然時間軸只看得到狀態跳來跳去 */
  private actionNote(requested: number): string | undefined {
    if (requested === WORK_ORDER_ACTION.WITHDRAW) return '撤回';
    if (requested === WORK_ORDER_ACTION.RESTORE) return '復原';
    if (requested === STATUS.DELETED) return '刪除';
    return undefined;
  }

  /** 回給使用者的訊息要說「結果是什麼」——「已撤回」而不是「狀態已更新」 */
  private statusMessage(requested: number, actual: number): string {
    const name = WORK_ORDER_STATUS_DEF.find((x) => x.value === actual)?.name ?? String(actual);

    if (requested === WORK_ORDER_ACTION.WITHDRAW) return `已撤回，目前為「${name}」`;
    if (requested === WORK_ORDER_ACTION.RESTORE) return `已復原，目前為「${name}」`;
    if (requested === STATUS.DELETED) return '派工單已刪除';
    return `狀態已更新為「${name}」`;
  }

  /**
   * 上傳照片。
   *
   * 同一類型只留一張：驗收要的是「這個階段的照片」，不是同一階段的二十張。
   * 重複上傳會覆寫，而不是長出第二筆 —— 現場重拍是常態。
   */
  public async uploadImages(
    id: number,
    files: UploadedImage[],
    deleteTypes: string[],
    user: AuthUser
  ): Promise<HttpResult> {
    const order = await this.orderRepo.findOne({
      where: { id, company: { id: user.companyId } },
      relations: { images: true }
    });
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
      note: [
        uploaded.length ? `上傳 ${uploaded.join('、')}` : '',
        deleteTypes.length ? `刪除 ${deleteTypes.join('、')}` : ''
      ]
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
    const order = await this.orderRepo.findOne({
      where: { id, company: { id: companyId } },
      relations: { images: true }
    });
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
      .leftJoinAndSelect('w.workers', 'wk')
      .leftJoinAndSelect('wk.user', 'wu')
      .leftJoinAndSelect('w.dispatcher', 'du')
      .leftJoinAndSelect('w.project', 'p')
      .leftJoinAndSelect('w.casePatrol', 'c')
      .leftJoinAndSelect('w.maintenance', 'mt')
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
    // 用 EXISTS 而不是比對已 join 的關聯：join 過濾會把同一張單的其他人員一起濾掉，
    // 於是查「某人的派工單」時，列上只看得到那一個人
    if (dto.WORKER_USER_ID) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM work_order_users wou WHERE wou.work_order_id = w.id AND wou.user_id = :workerId)',
        { workerId: dto.WORKER_USER_ID }
      );
    }
    if (dto.WORK_UNIT?.length) qb.andWhere('w.work_unit IN (:...workUnit)', { workUnit: dto.WORK_UNIT });
    if (dto.MAINTENANCE_ID) qb.andWhere('w.maintenance_id = :maintenanceId', { maintenanceId: dto.MAINTENANCE_ID });
    if (dto.MATERIAL?.length) qb.andWhere('w.material IN (:...material)', { material: dto.MATERIAL });
    if (dto.OVERDUE) qb.andWhere('w.due_date < CURRENT_DATE AND st.status BETWEEN 0 AND 2');

    // 缺件要在 SQL 裡篩，不能取回來再用 JS 過濾 ——
    // 分頁之後才過濾的話，TOTAL 是篩選前的數字，而一頁 50 筆會回傳不到 50 筆。
    // 使用者看到「共 433 筆」卻怎麼翻都翻不完，那是查不出原因的那種錯
    if (dto.MISSING_IMAGE) this.applyMissingImageFilter(qb);

    const [rows, total] = await qb.getManyAndCount();

    return HttpResponse.successOrWarn({
      data: { TOTAL: total, PAGE: page, SIZE: size, ROWS: await this.withThumbnails(rows) },
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
              ].map(async (t) =>
                t.img ? { url: await this.storageService.signGetUrl(t.img.imgPath, 600), title: t.title } : null
              )
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
        workers: { user: true },
        dispatcher: true,
        project: true,
        casePatrol: true,
        maintenance: true,
        improvement: true,
        images: true
      }
    });
    if (!row) throw new NotFoundException(`找不到派工單：${id}`);

    return HttpResponse.success({ data: this.toRow(row, true) });
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  /**
   * 解析施工人員 id：去重，並確認這些使用者真的存在。
   *
   * `undefined` 代表「這次不異動」，空陣列代表「清空指派」——
   * 兩者在 PATCH 裡是不同的意思，不能都當成沒帶。
   *
   * 對外「未指定」是 id 0（{@link UNASSIGNED_WORKER}），它不會進關聯表。
   */
  private async resolveWorkerIds(raw: number[] | undefined): Promise<number[] | undefined> {
    if (raw == null) return undefined;

    const ids = [...new Set(raw.map(Number))].filter((id) => Number.isFinite(id) && id > UNASSIGNED_WORKER.ID);
    if (!ids.length) return [];

    const found = await this.dataSource.getRepository(User).find({ where: { id: In(ids) }, select: { id: true } });
    const missing = ids.filter((id) => !found.some((u) => u.id === id));
    if (missing.length) throw new BadRequestException(`查無施工人員（使用者 id：${missing.join('、')}）`);

    return ids;
  }

  /**
   * 確認 PC/PD 的來源案件存在且未被刪除。
   *
   * 在編單號之前先查 —— 單號一旦編出去就是連號的一部分，
   * 為了一張建不成的單而跳號，對帳時沒有人解釋得了。
   */
  private async assertSourceUsable(type: string, casePatrolId?: number, maintenanceId?: number): Promise<void> {
    if (type === 'PC' && casePatrolId != null) {
      const row = await this.caseStatusRepo.findOne({ where: { patrolCase: { id: casePatrolId } } });
      if (!row) throw new BadRequestException('查無車巡案件，無法派工');
      if (row.needRepair === MAINTENANCE_STATUS.DELETED) throw new BadRequestException('車巡案件已刪除，無法派工');
    }

    if (type === 'PD' && maintenanceId != null) {
      const row = await this.dataSource
        .getRepository(MaintenanceStatus)
        .findOne({ where: { maintenance: { id: maintenanceId } } });
      if (!row) throw new BadRequestException('查無巡查單，無法派工');
      if (row.status === MAINTENANCE_STATUS.DELETED) throw new BadRequestException('巡查單已刪除，無法派工');
    }
  }

  /**
   * 「缺必要照片」的 SQL 條件。
   *
   * 每種類型要求的照片不同（見 `REQUIRED_IMAGES`），所以是一組
   * 「這個類型 且 已上傳的必要照片數 < 應有數」的 OR。
   *
   * 不要求任何照片的類型直接排除：它們永遠不算缺件，
   * 留在條件裡只會讓查詢多掃一遍。
   */
  private applyMissingImageFilter(qb: SelectQueryBuilder<WorkOrder>): void {
    const params: Record<string, unknown> = {};
    const clauses: string[] = [];

    for (const [type, required] of Object.entries(REQUIRED_IMAGES)) {
      if (!required.length) continue;

      const i = clauses.length;
      params[`mt${i}`] = type;
      params[`mi${i}`] = required;
      params[`mc${i}`] = required.length;

      clauses.push(
        `(w.type = :mt${i} AND (
           SELECT COUNT(*) FROM work_order_images img
            WHERE img.work_order_id = w.id AND img.img_type IN (:...mi${i})
         ) < :mc${i})`
      );
    }

    // 沒有任何類型要求照片時，這個篩選問不出東西 —— 回傳空集合比回傳全部誠實
    qb.andWhere(clauses.length ? `(${clauses.join(' OR ')})` : '1 = 0', params);
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
      relations: { status: true, workers: { user: true }, improvement: true, images: true, project: true }
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
      workerUserIds: (w.workers ?? [])
        .map((x) => x.user?.id)
        .filter(Boolean)
        .sort(),
      workUnit: w.workUnit ?? null,
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
      // 未指派時回一個「未指定人員」而不是空陣列：前端不必為了空狀態各寫一套顯示
      WORKERS: (w.workers ?? []).length
        ? (w.workers ?? []).map((x) => ({
            ID: x.user?.id ?? UNASSIGNED_WORKER.ID,
            NAME: x.user?.name ?? UNASSIGNED_WORKER.NAME
          }))
        : [{ ID: UNASSIGNED_WORKER.ID, NAME: UNASSIGNED_WORKER.NAME }],
      WORKER_USER_ID: (w.workers ?? []).map((x) => x.user?.id).filter((id): id is number => id != null),
      WORK_UNIT: w.workUnit ?? null,
      WORK_UNIT_NAME: WORK_UNIT_DEF.find((u) => u.key === w.workUnit)?.name ?? null,
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
      MAINTENANCE_ID: w.maintenance?.id ?? null,
      MAINTENANCE_NUM: w.maintenance?.caseNum ?? null,
      // 來源案件的破壞資訊：派工單的表單上要顯示「這張單在修什麼」，
      // 承辦不必為了看破壞類型再切回案件列表
      CASE_CRACK_TYPE: w.casePatrol?.crackType ?? null,
      CASE_DEGREE: w.casePatrol?.degree ?? null,
      CAR: w.casePatrol?.car ?? null,
      IMAGE_COUNT: w.images?.length ?? 0,
      MISSING_IMAGE_COUNT: missing.length,
      // 已刪除的單不算逾期 —— 逾期清單是要去催的，催一張刪掉的單沒有意義
      OVERDUE:
        !!w.dueDate &&
        new Date(w.dueDate) < new Date() &&
        (w.status?.status ?? 0) >= STATUS.PENDING &&
        (w.status?.status ?? 0) < STATUS.FINISHED
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
      IMAGES: (w.images ?? []).map((i) => ({
        IMG_TYPE: i.imgType,
        IMG_TYPE_CH: i.imgTypeCh,
        IMG_NAME: i.imgName,
        SIZE_BYTES: i.sizeBytes
      })),
      MISSING_IMAGES: missing.map((m) => ({ TYPE: m.type, NAME: m.name })),
      CREATED_AT: w.createdAt,
      UPDATED_AT: w.updatedAt
    };
  }
}
