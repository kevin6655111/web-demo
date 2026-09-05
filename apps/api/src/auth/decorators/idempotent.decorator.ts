import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_META_KEY = 'idempotent:meta';

export type IdempotentMeta = {
  /** 去重視窗(秒)。要涵蓋上游最長的重試週期，但別長到把正常的第二筆也擋掉 */
  ttlSec: number;
};

/** 標註這支 API 需要冪等保護，去重依據為 `Idempotency-Key` 表頭 */
export const Idempotent = (ttlSec = 600) => SetMetadata(IDEMPOTENT_META_KEY, { ttlSec } satisfies IdempotentMeta);
