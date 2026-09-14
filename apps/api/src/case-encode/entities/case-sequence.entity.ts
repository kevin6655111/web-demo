import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 案件編號的流水號。
 *
 * 一列代表「某個前綴、某一天」的計數器，例如 `DEMO01PA` + `260905`。
 * 分到「天」而不是全域一個計數器，是因為單號本身要看得出日期，
 * 而且跨日之後重新從 1 開始，數字才不會無止境長大。
 *
 * **這張表存在的唯一理由是併發安全**：沒有它的話，產生下一號要先
 * `SELECT MAX(...)` 再 `INSERT`，而那兩步之間別人也可能拿到同一個號。
 * 有了它，取號是一句 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` ——
 * 由資料庫在單一敘述裡完成讀改寫，同時進來一百個請求也不會撞號。
 */
@Entity({ name: 'case_sequences' })
export class CaseSequence {
  /** 公司/標案代碼 + 表單代碼，例如 `DEMO01PA` */
  @PrimaryColumn({ name: 'prefix', type: 'varchar', length: 20 })
  prefix!: string;

  /** 案件日期 YYMMDD */
  @PrimaryColumn({ name: 'seq_date', type: 'varchar', length: 6 })
  seqDate!: string;

  @Column({ name: 'last_number', type: 'int', default: 0 })
  lastNumber!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
