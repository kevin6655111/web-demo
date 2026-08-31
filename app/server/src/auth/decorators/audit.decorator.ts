import { SetMetadata } from '@nestjs/common';

export const AUDIT_META_KEY = 'audit:meta';

export type AuditMeta = {
  /** 動作分類，例如 AUTH / CASE */
  action: string;
  /** 要從 body/query 抓進稽核紀錄的欄位名(只記這些，避免把整包 payload 含密碼寫進日誌) */
  keys: string[];
};

/** 標註這支 API 要寫稽核紀錄 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_META_KEY, meta);
