import { SetMetadata } from '@nestjs/common';

export const ALLOW_API_KEY_META_KEY = 'auth:allow-api-key';

/**
 * 標註這支端點接受 `X-Api-Key` 表頭作為憑證。
 *
 * 預設所有端點只收 JWT：API Key 是給機器用的，機器只該碰得到
 * 「上傳」這一類端點。沒標註的端點收到 API Key 一律 401，
 * 而不是安靜地放行 —— 車機的金鑰外流時，它能做的事要是有界的。
 */
export const AllowApiKey = () => SetMetadata(ALLOW_API_KEY_META_KEY, true);
