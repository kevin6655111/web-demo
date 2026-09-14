import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/** 能執行 SQL 的東西：DataSource 或交易中的 EntityManager */
type Executor = Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>;

/**
 * 單號的格式。
 *
 * 三種單的格式不同，而差別是有意義的：
 *
 * | 單別 | 例 | 分段 |
 * |---|---|---|
 * | 車巡案件 | `DEMO01000123` | 標案號 + 六位流水，**不分日期** |
 * | 派工單 | `DEMO01PA26090001` | 標案號+類型 + 年月 + 四位流水 |
 * | 巡查單 | `DEMO01RA26090162` | 同上 |
 *
 * 車巡案件不分日期，是因為它一天可能進來幾千筆，分日之後號碼會很快用完四位；
 * 而人開的單一個月不會超過四位數，分到月讓單號自己帶著時間資訊。
 */
export type CaseNumFormat = {
  /** 前綴，例如 `DEMO01PA` */
  prefix: string;
  /** 日期分段（例如 `2609`）；不給就是同一個前綴共用一條連續流水 */
  seqDate?: string;
  /** 流水位數，預設 4 */
  pad?: number;
};

/** 批次取號的一筆請求：`key` 讓呼叫端把結果對回去 */
export type EncodeRequest = CaseNumFormat & { key: string };

/** 沒有日期分段時，計數器那一列的 seq_date 用這個值 —— 主鍵不吃 NULL */
const NO_DATE = '-';

@Injectable()
export class CaseEncodeService {
  private readonly logger = new Logger('CaseEncode');

  constructor(private readonly dataSource: DataSource) {}

  /**
   * 取下一個案件編號。
   *
   * 格式：`前綴 + YYMMDD + 四位流水`，例如 `DEMO01PA2609` + `0001`。
   * 從單號就看得出是哪個標案、哪種單、哪一天的第幾張。
   *
   * **併發安全的關鍵在於這是「一句」SQL**：
   *
   * ```sql
   * INSERT ... VALUES (prefix, date, 1)
   * ON CONFLICT (prefix, seq_date) DO UPDATE SET last_number = last_number + 1
   * RETURNING ...
   * ```
   *
   * 讀、加一、寫、回傳全部由資料庫在同一個敘述裡完成，`ON CONFLICT DO UPDATE`
   * 會在那一列上加鎖，所以同時進來一百個請求會拿到一百個不同的號碼。
   *
   * 先前的作法是 `SELECT MAX(case_num) + 1` 再 INSERT —— 兩步之間別人也可能讀到
   * 同一個 MAX，於是靠唯一鍵擋下來再重試。在低流量下看不出差別，
   * 但車機是整批上傳的：一次五十筆同時進來，那個迴圈會退避重試到逾時。
   *
   * @param prefix 前綴，例如 `DEMO01PA`
   * @param date   要編碼的日期；不給就用今天
   * @param executor 在交易裡取號時傳入該交易的 manager，讓號碼與資料一起成敗
   */
  public async next(format: CaseNumFormat, executor?: Executor): Promise<string> {
    const [result] = await this.nextMany([{ key: format.prefix, ...format }], executor);
    return result.caseNum;
  }

  /** 由日期產生年月分段 `YYMM`；派工單與巡查單用它 */
  public static monthOf(date?: Date | string): string {
    const d = date ? new Date(date) : new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);

    return local.toISOString().slice(2, 7).replace('-', '');
  }

  /**
   * 批次取號。
   *
   * 車機是整批上傳的，逐筆取號就是逐筆往返。這裡用一句 SQL 一次取完 ——
   * `generate_series` 展開每個前綴要的數量，`ON CONFLICT` 一次把計數器推上去。
   *
   * **依前綴排序後再取**：多個交易同時更新同一組計數器列時，
   * 順序不一致就會互相等待成環（死鎖）。固定順序讓它們排成一直線。
   *
   * @param requests 每一筆要編號的東西：`key` 是呼叫端用來對回去的識別，`prefix` 是前綴
   * @param date     要編碼的日期；不給就用今天
   * @param executor 在交易裡取號時傳入該交易的 manager
   * @returns 與輸入等長的結果，順序照輸入
   */
  public async nextMany(requests: EncodeRequest[], executor?: Executor): Promise<{ key: string; caseNum: string }[]> {
    if (!requests.length) return [];

    const db = executor ?? this.dataSource;

    // 計數器的主鍵是 (prefix, seqDate)，同一組要幾個號先加總
    const rowKey = (f: CaseNumFormat) => `${f.prefix}\u0000${f.seqDate ?? NO_DATE}`;
    const counts = new Map<string, number>();
    for (const r of requests) counts.set(rowKey(r), (counts.get(rowKey(r)) ?? 0) + 1);

    // 排序後再取：多個交易同時更新同一組列時，順序不一致會互相等待成環（死鎖）
    const keys = [...counts.keys()].sort();
    const prefixes = keys.map((k) => k.split('\u0000')[0]);
    const dates = keys.map((k) => k.split('\u0000')[1]);
    const needs = keys.map((k) => counts.get(k) as number);

    const rows: { prefix: string; seq_date: string; last_number: number; need: number }[] = await db.query(
      `WITH want AS (
         SELECT unnest($1::text[]) AS prefix, unnest($2::text[]) AS seq_date, unnest($3::int[]) AS need
       ), bumped AS (
         INSERT INTO case_sequences (prefix, seq_date, last_number)
         SELECT prefix, seq_date, need FROM want
         ON CONFLICT (prefix, seq_date)
         DO UPDATE SET last_number = case_sequences.last_number + EXCLUDED.last_number,
                       updated_at  = now()
         RETURNING prefix, seq_date, last_number
       )
       SELECT b.prefix, b.seq_date, b.last_number, w.need
         FROM bumped b
         JOIN want w ON w.prefix = b.prefix AND w.seq_date = b.seq_date`,
      [prefixes, dates, needs]
    );

    // 回傳的是「加完之後」的值，所以這一批拿到的是 (last - need, last]
    const pools = new Map<string, number[]>();
    for (const row of rows) {
      const last = Number(row.last_number);
      const need = Number(row.need);

      pools.set(
        `${row.prefix}\u0000${row.seq_date}`,
        Array.from({ length: need }, (_, i) => last - need + 1 + i)
      );
    }

    // 照輸入順序發號，呼叫端可以直接對回去
    return requests.map((r) => {
      const n = pools.get(rowKey(r))?.shift();
      if (n === undefined) throw new Error(`取號失敗：${r.prefix} 沒有拿到號碼`);

      return { key: r.key, caseNum: `${r.prefix}${r.seqDate ?? ''}${String(n).padStart(r.pad ?? 4, '0')}` };
    });
  }

  /**
   * 把既有資料的計數器補到正確位置。
   *
   * 導入這張表時，舊資料的單號已經發到某個號碼了 —— 計數器從 0 開始的話，
   * 下一張單會撞上舊的。migration 與 seed 都會呼叫它。
   *
   * @param rows 現有的最大號：`{ prefix, seqDate, lastNumber }`
   */
  public async seedCounters(
    rows: { prefix: string; seqDate: string; lastNumber: number }[],
    executor?: Executor
  ): Promise<void> {
    if (!rows.length) return;

    const db = executor ?? this.dataSource;

    await db.query(
      `INSERT INTO case_sequences (prefix, seq_date, last_number)
       SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::int[])
       ON CONFLICT (prefix, seq_date)
       DO UPDATE SET last_number = GREATEST(case_sequences.last_number, EXCLUDED.last_number)`,
      [rows.map((r) => r.prefix), rows.map((r) => r.seqDate), rows.map((r) => r.lastNumber)]
    );

    this.logger.log(`🔢 已校正 ${rows.length} 組流水號`);
  }
}
