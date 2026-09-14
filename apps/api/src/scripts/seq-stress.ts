import '@/env.bootstrap';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SeedModule } from '@/scripts/seed.module';
import { CaseEncodeService } from '@/case-encode/case-encode.service';
import { DataSource } from 'typeorm';

/**
 * 案件編號的併發壓測。
 *
 * 驗證的是「同時取號不會撞號，也不會跳號」。這件事無法用單元測試涵蓋 ——
 * 它的正確性來自資料庫在單一敘述內完成讀改寫，必須對真實的 PostgreSQL 執行。
 *
 *   yarn seq:stress
 *
 * 判定標準：相異號碼數等於總取號數，且流水號連續無缺口。
 * 任一項不成立時以非零狀態碼結束。
 */
(async () => {
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: false });
  const ds = app.get(DataSource);
  const encode = new CaseEncodeService(ds);

  const PREFIX = `STRESS${Date.now() % 100000}`;
  const CONCURRENCY = 200;
  const PER_CALL = 5;

  const started = Date.now();

  // 200 個並行呼叫，每個要 5 個號 —— 全部指向同一組計數器列
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      encode.nextMany(
        Array.from({ length: PER_CALL }, (_, j) => ({ key: `${i}-${j}`, prefix: PREFIX, seqDate: '2609' }))
      )
    )
  );

  const elapsed = Date.now() - started;
  const nums = results.flat().map((r) => r.caseNum);
  const unique = new Set(nums);

  const serials = nums.map((n) => Number(n.slice(-4))).sort((a, b) => a - b);
  const contiguous = serials.every((v, i) => v === i + 1);

  console.log(`  併發呼叫      ${CONCURRENCY} 個 × 每次 ${PER_CALL} 號 = ${nums.length} 個號`);
  console.log(`  相異號碼      ${unique.size}`);
  console.log(`  重複          ${nums.length - unique.size}`);
  console.log(`  連續無缺口    ${contiguous ? '是' : '否'}（${serials[0]} … ${serials[serials.length - 1]}）`);
  console.log(`  耗時          ${elapsed} ms`);

  await ds.query('DELETE FROM case_sequences WHERE prefix = $1', [PREFIX]);
  await app.close();
  process.exit(nums.length === unique.size && contiguous ? 0 : 1);
})();
