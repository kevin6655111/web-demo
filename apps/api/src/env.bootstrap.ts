import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as dotenv from 'dotenv';
import type { AppConfig } from '@/env/types/env.type';

/**
 * 設定載入：yaml(產品行為與環境座標) + .env(機密)
 *
 * 分工的理由是「誰有權決定」：
 *   config/config.{dev,prod}.yaml  連哪台主機、用哪個 vendor、排程開關 —— 每個站台一份，可進版控
 *   .env                            帳密、金鑰 —— 開發與部署共用一份，永不進版控
 *
 * yaml 裡的機密欄位一律寫成 ${VAR}，啟動時由這裡展開。
 * 缺任何一個變數就列出「缺哪個、對應哪個設定路徑」然後中止，不讓服務帶著空密碼跑起來。
 */

const isProd = process.env.NODE_ENV === 'production';
const envName = isProd ? 'prod' : 'dev';

/** 從 startDir 逐層往上找 relPath，找到就回傳絕對路徑 */
function findUp(startDir: string, relPath: string): string | undefined {
  let dir = startDir;

  for (;;) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const missing: string[] = [];
const consumed = new Set<string>();

/**
 * 遞迴把字串裡的 ${VAR} 換成環境變數值
 * - 數值/布林原樣保留，型別不被字串化
 * - trail 記錄目前的設定路徑(如 database.postgres.pass)，只用於缺值時的錯誤訊息
 */
function expand(value: unknown, trail: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      consumed.add(name);
      const found = process.env[name];
      if (found === undefined || found === '') {
        missing.push(`${name}  ← ${trail}`);
        return '';
      }
      return found;
    });
  }

  if (Array.isArray(value)) return value.map((item, i) => expand(item, `${trail}[${i}]`));

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, expand(val, trail ? `${trail}.${key}` : key)]));
  }

  return value;
}

const file = `config.${envName}.yaml`;
const configPath = findUp(__dirname, path.join('config', file));
if (!configPath) throw new Error(`Config file not found: no config/${file} above ${__dirname}`);

const envPath = findUp(path.dirname(configPath), '.env');
if (envPath) dotenv.config({ path: envPath });

const expanded = expand(yaml.load(fs.readFileSync(configPath, 'utf8')), '') as AppConfig;

if (missing.length > 0) {
  const where = isProd
    ? 'Ensure the root .env is filled in and mounted into the backend (see docker-compose.yml).'
    : envPath
      ? `Add these variables to ${envPath}.`
      : `No .env found (searched upward from ${path.dirname(configPath)}). Create one first: cp .env.example .env`;

  throw new Error(
    `${file} needs the following environment variables but they are unset:\n` + missing.map((m) => `  - ${m}`).join('\n') + `\n${where}`
  );
}

// 展開後就從 process.env 拿掉，避免機密被子行程或錯誤堆疊帶出去
for (const name of consumed) delete process.env[name];

export const config = expanded;
