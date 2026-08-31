import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral, Repository } from 'typeorm';
import { PatrolCase } from '@/case-patrol/entities/patrol-case.entity';
import { PatrolCaseAddress } from '@/case-patrol/entities/patrol-case-address.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { WorkOrderStatus } from '@/work-order/entities/work-order-status.entity';
import { WorkOrderImprovement } from '@/work-order/entities/work-order-improvement.entity';
import { Project } from '@/project/entities/project.entity';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { CaseHistory, type CaseType, type FieldChanges, type HistoryAction } from './entities/case-history.entity';

export type RecordHistoryInput = {
  caseType: CaseType;
  caseId: number;
  action: HistoryAction;
  /** 這個版本的完整樣貌；由呼叫端組好，因為只有它知道該記哪些欄位 */
  snapshot: Record<string, unknown>;
  /** 變更前的樣貌；有給就自動算差異 */
  before?: Record<string, unknown>;
  fromState?: string;
  toState?: string;
  operatorId?: number;
  source?: 'USER' | 'TASK' | 'WORKER' | 'DEVICE';
  note?: string;
  clientIp?: string;
};

/**
 * 一個可還原的資料表：實體、可還原的欄位、以及它掛在主表的哪個外鍵欄。
 *
 * `link` 是分表用的：主表用自己的 id，狀態表與地址表用外鍵。
 */
type RestoreTarget = { entity: EntityTarget<ObjectLiteral>; fields: string[]; link?: string };

/**
 * 各類型可還原的欄位。
 *
 * **刻意不還原全部欄位**：座標、照片路徑、外部系統 id、單號這些是「這筆資料是什麼」，
 * 不是「有人改過的內容」—— 還原成舊座標只會讓案件跑到地圖上的另一個地方。
 * 能還原的是人改得動的欄位。
 */
const RESTORE_MAP: Record<CaseType, RestoreTarget[]> = {
  CASE_PATROL: [
    { entity: PatrolCase, fields: ['crackType', 'degree', 'length', 'width', 'area', 'depth', 'remark'] },
    { entity: PatrolCaseAddress, link: 'case_id', fields: ['county', 'district', 'cavlge', 'road', 'address'] },
    { entity: PatrolCaseStatus, link: 'case_id', fields: ['status', 'edited', 'needRepair'] }
  ],
  WORK_ORDER: [
    {
      entity: WorkOrder,
      fields: [
        'dispatchDate', 'dueDate', 'workStartDate', 'workEndDate',
        'county', 'district', 'cavlge', 'address', 'startAddr', 'endAddr',
        'material', 'materialSize', 'workLength', 'workWidth', 'workDepthMilling', 'workDepthPaving', 'remark'
      ]
    },
    { entity: WorkOrderStatus, link: 'work_order_id', fields: ['status'] },
    { entity: WorkOrderImprovement, link: 'work_order_id', fields: ['sampleTaken', 'sampleDate', 'testItem'] }
  ],
  PROJECT: [
    { entity: Project, fields: ['prjNo', 'prjName', 'prjMain', 'prjSub', 'proprietor', 'proprietorLevel', 'startDate', 'endDate', 'budget', 'roadKm', 'state'] }
  ],
  // 檢測案件的內容來自儀器量測，人工只會標註而不會改數值 —— 沒有「改回去」這件事
  SURVEY: []
};

/**
 * 版本化歷程。
 *
 * 一張表記所有實體類型的歷程：稽核要問的是「這段期間誰改了什麼」，
 * 跨實體查詢比較常見，而版本化的邏輯也只需要寫一次。
 */
@Injectable()
export class CaseHistoryService {
  private readonly logger = new Logger('CaseHistory');

  constructor(
    @InjectRepository(CaseHistory) private readonly historyRepo: Repository<CaseHistory>,
    private readonly dataSource: DataSource
  ) {}

  /**
   * 寫入一個新版本。
   *
   * 刻意不丟例外：歷程失敗不該讓派工失敗。
   * 讓使用者因為寫不了歷程就派不了工，一定是更糟的選擇 —— 但失敗要留痕。
   */
  public async record(input: RecordHistoryInput): Promise<void> {
    try {
      const changes = input.before ? this.diff(input.before, input.snapshot) : undefined;

      // 版本號在交易裡算：兩個同時發生的變更不能拿到同一個版本，
      // 而 (caseType, caseId, version) 是主鍵，撞號會直接失敗
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(CaseHistory);

        const last = await repo
          .createQueryBuilder('h')
          .select('COALESCE(MAX(h.version), 0)', 'max')
          .where('h.case_type = :caseType', { caseType: input.caseType })
          .andWhere('h.case_id = :caseId', { caseId: input.caseId })
          .getRawOne<{ max: string }>();

        // 用 save 而不是 insert：jsonb 欄位在 insert 的型別推導下會被當成要展開的 partial
        await repo.save(
          repo.create({
            caseType: input.caseType,
            caseId: input.caseId,
            version: Number(last?.max ?? 0) + 1,
            snapshotJson: input.snapshot,
            changesJson: changes,
            action: input.action,
            fromState: input.fromState,
            toState: input.toState,
            source: input.source ?? 'USER',
            note: input.note,
            clientIp: input.clientIp,
            modifiedBy: input.operatorId ? ({ id: input.operatorId } as never) : undefined
          })
        );
      });
    } catch (error: any) {
      this.logger.warn(`歷程寫入失敗(${input.caseType}#${input.caseId}): ${error?.message}`);
    }
  }

  /** 完整歷程（依版本正序，讀起來就是一條時間軸） */
  public async getHistory(caseType: CaseType, caseId: number): Promise<HttpResult> {
    const rows = await this.historyRepo.find({
      where: { caseType, caseId },
      relations: { modifiedBy: true },
      order: { version: 'ASC' }
    });

    return HttpResponse.successOrWarn({
      data: rows.map((h) => ({
        VERSION: h.version,
        ACTION: h.action,
        FROM_STATE: h.fromState ?? null,
        TO_STATE: h.toState ?? null,
        SOURCE: h.source,
        CHANGES: h.changesJson ?? null,
        SNAPSHOT: h.snapshotJson,
        NOTE: h.note ?? null,
        CLIENT_IP: h.clientIp ?? null,
        MODIFIED_BY: h.modifiedBy?.name ?? null,
        MODIFIED_AT: h.modifiedAt
      })),
      warnMsg: '尚無歷程'
    });
  }

  /** 取某一版的完整快照 */
  public async getVersion(caseType: CaseType, caseId: number, version: number): Promise<HttpResult> {
    const row = await this.findVersion(caseType, caseId, version);

    return HttpResponse.success({
      data: {
        VERSION: row.version,
        ACTION: row.action,
        SNAPSHOT: row.snapshotJson,
        CHANGES: row.changesJson ?? null,
        MODIFIED_BY: row.modifiedBy?.name ?? null,
        MODIFIED_AT: row.modifiedAt
      }
    });
  }

  /** 比較兩個版本 */
  public async compare(caseType: CaseType, caseId: number, from: number, to: number): Promise<HttpResult> {
    const [a, b] = await Promise.all([this.findVersion(caseType, caseId, from), this.findVersion(caseType, caseId, to)]);

    return HttpResponse.success({ data: { FROM: from, TO: to, CHANGES: this.diff(a.snapshotJson, b.snapshotJson) } });
  }

  /** 取某版的快照給呼叫端還原用；還原本身由各領域服務執行 */
  public async getSnapshot(caseType: CaseType, caseId: number, version: number): Promise<Record<string, unknown>> {
    const row = await this.findVersion(caseType, caseId, version);
    return row.snapshotJson;
  }

  /**
   * 還原到指定版本。
   *
   * 還原不刪任何東西 —— 它自己也是一筆新版本(`RESTORE`)。
   * 「這筆資料曾經被還原過、從哪一版還原的」在稽核時看得到，
   * 若還原改成覆蓋，被還原掉的那一版就永遠說不清楚發生過什麼。
   */
  public async restore(caseType: CaseType, caseId: number, version: number, operatorId: number, clientIp?: string): Promise<HttpResult> {
    const targets = RESTORE_MAP[caseType];
    if (!targets?.length) throw new BadRequestException(`${caseType} 不支援版本還原`);

    const snapshot = await this.getSnapshot(caseType, caseId, version);
    if (!Object.keys(snapshot).length) throw new NotFoundException(`第 ${version} 版沒有可還原的快照`);

    const before: Record<string, unknown> = {};
    const applied: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      for (const target of targets) {
        const repo = manager.getRepository(target.entity);

        // 分表可能整列不存在（例如案件還沒補到地址），這時補建一列而不是靜靜跳過
        const row = target.link
          ? await repo.createQueryBuilder('t').where(`t.${target.link} = :id`, { id: caseId }).getOne()
          : await repo.findOne({ where: { id: caseId } as never });

        const patch: Record<string, unknown> = {};

        for (const field of target.fields) {
          if (!(field in snapshot)) continue;

          before[field] = row ? (row as Record<string, unknown>)[field] : null;
          patch[field] = snapshot[field];
          applied.push(field);
        }

        if (!Object.keys(patch).length) continue;

        if (row) await repo.update({ id: (row as { id: number }).id }, patch as never);
        else if (target.link) await repo.insert({ ...patch, [target.link]: caseId } as never);
      }
    });

    if (!applied.length) throw new BadRequestException('該版本沒有任何可還原的欄位');

    await this.record({
      caseType,
      caseId,
      action: 'RESTORED',
      snapshot,
      before,
      operatorId,
      clientIp,
      note: `還原自第 ${version} 版`
    });

    return HttpResponse.success({ message: `已還原至第 ${version} 版`, data: { RESTORED_FROM: version, FIELDS: applied } });
  }

  /** 稽核查詢：某段期間、某個人做了什麼 */
  public async audit(params: { caseType?: CaseType; operatorId?: number; from?: string; to?: string }): Promise<HttpResult> {
    const qb = this.historyRepo
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.modifiedBy', 'u')
      .orderBy('h.modifiedAt', 'DESC')
      // 用 limit 而不是 take：take 會為了處理一對多而套上以主鍵去重的子查詢，
      // 而這張表的主鍵是三欄複合鍵。這裡只 join 了操作者(多對一)，不會有列數膨脹的問題
      .limit(300);

    if (params.caseType) qb.andWhere('h.case_type = :caseType', { caseType: params.caseType });
    if (params.operatorId) qb.andWhere('h.modified_by = :uid', { uid: params.operatorId });
    if (params.from) qb.andWhere('h.modified_at >= :from', { from: new Date(params.from) });
    if (params.to) qb.andWhere('h.modified_at < :to', { to: new Date(`${params.to}T23:59:59.999`) });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({
      data: rows.map((h) => ({
        CASE_TYPE: h.caseType,
        CASE_ID: h.caseId,
        VERSION: h.version,
        ACTION: h.action,
        CHANGES: h.changesJson ?? null,
        MODIFIED_BY: h.modifiedBy?.name ?? null,
        MODIFIED_AT: h.modifiedAt,
        CLIENT_IP: h.clientIp ?? null
      }))
    });
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  private async findVersion(caseType: CaseType, caseId: number, version: number): Promise<CaseHistory> {
    const row = await this.historyRepo.findOne({ where: { caseType, caseId, version }, relations: { modifiedBy: true } });
    if (!row) throw new NotFoundException(`找不到版本：${caseType}#${caseId} 第 ${version} 版`);

    return row;
  }

  /**
   * 比較兩個快照。
   *
   * 用字串比對，避免 numeric 的 '1.00' 與 1 被當成不同 ——
   * 那會讓每次儲存都產生一堆假的「變更」，真正的變更就淹沒在裡面。
   */
  private diff(before: Record<string, unknown>, after: Record<string, unknown>): FieldChanges {
    const changes: FieldChanges = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of keys) {
      const from = before[key];
      const to = after[key];

      // 物件與陣列用 JSON 比對：試驗項目、照片清單這類欄位是陣列
      const same =
        typeof from === 'object' || typeof to === 'object'
          ? JSON.stringify(from ?? null) === JSON.stringify(to ?? null)
          : String(from ?? '') === String(to ?? '');

      if (!same) changes[key] = { from: from ?? null, to: to ?? null };
    }

    return changes;
  }
}
