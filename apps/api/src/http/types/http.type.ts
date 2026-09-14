import type { Request } from 'express';
import type { AuthUser } from '@/auth/types/user-auth.type';

/** 通過 AuthGuard 之後的請求：一定帶 user */
export type HttpRequest = Request & {
  user?: AuthUser;
  cookies?: Record<string, string>;
  __audit?: { action: string; start: number };
};

/** 全系統統一的回應信封 */
export type HttpResult<T = any> = {
  status: boolean;
  code: number;
  message?: string;
  data?: T;
  errors?: unknown;
  /** 這次回應是否取自快取；只加在信封層，不動 data 的形狀 */
  cached?: boolean;
};

export type SuccessArgs<T = any> = { data?: T; message?: string; code?: number; errors?: unknown };
export type ErrorArgs = { data?: any; message?: string; status?: boolean; code?: number; errors?: unknown };
export type SuccessOrWarnArgs<T = any> = {
  data?: T;
  okMsg?: string;
  warnMsg?: string;
  code?: number;
  errors?: unknown;
  isEmpty?: (v: any) => boolean;
};
