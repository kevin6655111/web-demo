import { SetMetadata } from '@nestjs/common';
import { ACTION } from '@constants/module.const';

export { ACTION };

export const FEATURE_ACTION_META_KEY = 'permission:meta';
export type FeatureActionMeta = { keys: string[] };

/** 標註這支 API 需要哪些功能權限(全部都要有) */
export const RequireAction = (...actions: string[]) => SetMetadata(FEATURE_ACTION_META_KEY, { keys: actions } satisfies FeatureActionMeta);
