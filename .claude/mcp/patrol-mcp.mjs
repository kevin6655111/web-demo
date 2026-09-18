#!/usr/bin/env node
/**
 * 道路巡查 Demo 的 MCP 伺服器。
 *
 * 存在的理由：這個專案要回答的問題有一半不在程式碼裡 ——
 * 「排程現在是什麼狀態」「這支端點的權限是什麼」「資料庫裡真的有幾筆」。
 * 那些答案要靠一串 docker exec 與 curl 拼出來，而拼錯了只會得到誤導性的結論。
 * 把它們包成工具，問法就固定了。
 *
 * **零執行期依賴**，和 `packages/shared` 一樣的理由：
 * 這是開發輔助工具，不該讓人為了用它先跑一次 yarn install。
 * MCP 的 stdio 傳輸就是換行分隔的 JSON-RPC 2.0，自己實作比背一個 SDK 便宜。
 *
 * 所有工具都是**唯讀**的。要改東西請走一般的開發流程 ——
 * 一個能改資料庫的 MCP 工具，出錯時沒有 code review 擋得住。
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 讀 .env；不存在就回空物件 —— 沒設定不該讓整個伺服器起不來 */
const env = (() => {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      })
  );
})();

const DB = { container: 'patrol-postgres', user: env.POSTGRES_USER ?? 'patrol', name: env.POSTGRES_DB ?? 'patrol_demo' };
const REDIS_CONTAINER = 'patrol-redis';
const API = 'http://localhost:3008';

/** 六個行程各自的埠；沒有埠的行程靠行程名判斷 */
const PROCESSES = [
  { name: 'api', port: 3008, why: '對外 API 與 WebSocket' },
  { name: 'tiles', port: 3010, why: '圖層；不起來的話圖台是空的' },
  { name: 'web', port: 3005, why: '前端 dev server' },
  { name: 'case-worker', match: 'case-worker.ts', why: '案件佇列；不起來案件不會有地址' },
  { name: 'report-worker', match: 'report-worker.ts', why: '報表佇列；不起來報表永遠在排隊' },
  { name: 'mail-worker', match: 'mail-worker.ts', why: '郵件佇列；不起來郵件停在 PENDING' },
  { name: 'scheduler', match: 'scheduler.ts', why: '排程；不起來排程狀態是空的' }
];

// ─── 工具實作 ───────────────────────────────────────────────────

async function sh(cmd, args) {
  const { stdout } = await exec(cmd, args, { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
  return stdout;
}

/** 唯讀 SQL。只允許單一敘述的 SELECT／WITH —— 這個工具不該能改任何東西 */
async function dbQuery({ sql, limit = 200 }) {
  const trimmed = String(sql).trim().replace(/;\s*$/, '');

  if (/;/.test(trimmed)) throw new Error('一次只能送一個敘述：分號用來串接多個敘述，而那是繞過唯讀限制最簡單的方式');
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error('只接受 SELECT 或 WITH 開頭的查詢；這個工具是唯讀的');
  if (/\b(insert|update|delete|drop|alter|truncate|grant|copy)\b/i.test(trimmed)) {
    throw new Error('查詢裡出現了寫入關鍵字；要改資料請走一般的開發流程');
  }

  // 用 psql 的唯讀交易再擋一層：正規表示式擋得掉手滑，擋不掉刻意繞過
  const wrapped = `BEGIN READ ONLY; SET LOCAL statement_timeout = '20s'; ${trimmed} LIMIT ${Number(limit) || 200}; COMMIT;`;
  const out = await sh('docker', [
    'exec',
    DB.container,
    'psql',
    '-U',
    DB.user,
    '-d',
    DB.name,
    '-q', // 不印 BEGIN/SET/COMMIT 這些包裝敘述的回應 —— 那是實作細節，不是查詢結果
    '-P',
    'pager=off',
    '-c',
    wrapped
  ]);

  return out.trim() || '(沒有結果)';
}

/** 哪些行程活著。回答的是「為什麼這個功能沒反應」 */
async function health() {
  const lines = [];

  let listening = '';
  try {
    listening = await sh('ss', ['-ltn']);
  } catch {
    listening = '';
  }

  let psOut = '';
  try {
    psOut = await sh('ps', ['-eo', 'args']);
  } catch {
    psOut = '';
  }

  for (const p of PROCESSES) {
    const up = p.port ? listening.includes(`:${p.port} `) : psOut.includes(p.match);
    lines.push(`${up ? '✅' : '❌'} ${p.name.padEnd(14)} ${up ? '' : `— ${p.why}`}`);
  }

  let containers = '';
  try {
    containers = await sh('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}']);
  } catch {
    containers = '(docker 無法存取)';
  }

  return `行程：\n${lines.join('\n')}\n\n容器：\n${containers}`;
}

/**
 * 端點清單。
 *
 * 從跑起來的服務的內部文件抓，而不是掃程式碼 ——
 * 掃程式碼看不到裝飾器實際套用的結果，而「文件上有沒有」正是要驗的事之一。
 */
async function endpoints({ keyword, tag }) {
  const key = env.DOCS_INTERNAL_KEY;
  if (!key) throw new Error('.env 沒有 DOCS_INTERNAL_KEY，抓不到內部文件');

  const res = await fetch(`${API}/internal-docs-json?k=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`內部文件回 ${res.status}；api 行程可能沒起來`);

  const spec = await res.json();
  const rows = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      if (tag && !(op.tags ?? []).includes(tag)) continue;

      const text = `${path} ${op.summary ?? ''} ${(op.tags ?? []).join(' ')}`;
      if (keyword && !text.toLowerCase().includes(String(keyword).toLowerCase())) continue;

      // 權限寫在說明裡（「所需權限：`X.Y`」），因為那是給讀文件的人看的
      const action = (op.description ?? '').match(/所需權限：`([A-Z_]+\.[A-Z_]+)`/)?.[1];
      rows.push(`${method.toUpperCase().padEnd(6)} ${path.padEnd(42)} ${action ? `[${action}] ` : ''}${op.summary ?? ''}`);
    }
  }

  if (!rows.length) return '沒有符合的端點';
  return `${rows.length} 支：\n${rows.sort().join('\n')}`;
}

/** 排程狀態。狀態由 scheduler 寫進 Redis，api 只負責讀 —— 空的通常代表 scheduler 沒起來 */
async function taskStatus() {
  const keys = (await sh('docker', ['exec', REDIS_CONTAINER, 'redis-cli', '--scan', '--pattern', 'task:*']))
    .split('\n')
    .filter(Boolean);

  if (!keys.length) return '沒有任何排程狀態。scheduler 行程可能沒起來 —— 狀態是它寫的，api 只負責讀。';

  const out = [];
  for (const k of keys.sort()) {
    const type = (await sh('docker', ['exec', REDIS_CONTAINER, 'redis-cli', 'TYPE', k])).trim();
    const value =
      type === 'hash'
        ? await sh('docker', ['exec', REDIS_CONTAINER, 'redis-cli', 'HGETALL', k])
        : await sh('docker', ['exec', REDIS_CONTAINER, 'redis-cli', 'GET', k]);

    out.push(`${k}\n${value.trim()}`);
  }

  return out.join('\n\n');
}

/** 快取現況。回答「這個查詢是不是真的被快取了」與「該失效的有沒有失效」 */
async function cacheKeys({ pattern = '*' }) {
  const keys = (await sh('docker', ['exec', REDIS_CONTAINER, 'redis-cli', '--scan', '--pattern', pattern]))
    .split('\n')
    .filter(Boolean)
    .sort();

  if (!keys.length) return `沒有符合 ${pattern} 的鍵`;

  const rows = [];
  for (const k of keys.slice(0, 100)) {
    const ttl = (await sh('docker', ['exec', REDIS_CONTAINER, 'redis-cli', 'TTL', k])).trim();
    const human = ttl === '-1' ? '永久' : ttl === '-2' ? '(已消失)' : `${ttl}s`;
    rows.push(`${k.padEnd(46)} TTL ${human}`);
  }

  return `${keys.length} 個鍵${keys.length > 100 ? '（只列前 100）' : ''}：\n${rows.join('\n')}`;
}

/** 隱私掃描。這是公開專案，每次加示範資料都要跑 */
async function privacyScan() {
  const script = resolve(ROOT, '.claude/skills/patrol-dev/scripts/check.sh');
  if (!existsSync(script)) throw new Error('找不到 check.sh');

  try {
    return await sh('bash', [script, '--privacy-only']);
  } catch (error) {
    // 掃到東西時腳本會以非零結束 —— 那是它的正常行為，輸出才是重點
    return `${error.stdout ?? ''}${error.stderr ?? ''}` || String(error.message);
  }
}

const TOOLS = [
  {
    name: 'patrol_health',
    description:
      '檢查七個行程與基礎設施容器是否活著。先問這個 —— 「功能沒反應」十次有八次是某個行程沒起來，而不是程式錯了。',
    inputSchema: { type: 'object', properties: {} },
    run: health
  },
  {
    name: 'patrol_db_query',
    description:
      '對示範資料庫下唯讀 SQL（只接受單一敘述的 SELECT／WITH，跑在唯讀交易裡）。用來確認資料真的寫進去了、統計數字對不對。',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT 或 WITH 開頭的單一查詢，不要加分號' },
        limit: { type: 'number', description: '自動附加的筆數上限，預設 200' }
      },
      required: ['sql']
    },
    run: dbQuery
  },
  {
    name: 'patrol_endpoints',
    description:
      '從執行中服務的內部 Swagger 文件列出端點與所需權限。掃程式碼看不到裝飾器實際套用的結果，而「文件上有沒有」本身就是驗收條件之一。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '路徑、摘要或章節的關鍵字' },
        tag: { type: 'string', description: '章節 tag，例如 Device、Case-Patrol' }
      }
    },
    run: endpoints
  },
  {
    name: 'patrol_task_status',
    description: '讀 Redis 裡的排程狀態。空的通常代表 scheduler 行程沒起來 —— 狀態是它寫的，api 只負責讀。',
    inputSchema: { type: 'object', properties: {} },
    run: taskStatus
  },
  {
    name: 'patrol_cache_keys',
    description: '列出 Redis 的鍵與 TTL。用來確認該快取的有沒有快取、該失效的有沒有失效。',
    inputSchema: {
      type: 'object',
      properties: { pattern: { type: 'string', description: '鍵的樣式，例如 geo:region:*，預設 *' } }
    },
    run: cacheKeys
  },
  {
    name: 'patrol_privacy_scan',
    description: '跑隱私掃描。這是公開的示範專案，每次新增示範資料或文件都要確認沒有混進真實識別字串。',
    inputSchema: { type: 'object', properties: {} },
    run: privacyScan
  }
];

// ─── JSON-RPC over stdio ────────────────────────────────────────

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(req) {
  const { id, method, params } = req;

  // 通知沒有 id，也不該有回應 —— 回了會被當成非法訊息
  if (id === undefined) return;

  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'patrol-dev', version: '1.0.0' }
        }
      });
    }

    if (method === 'tools/list') {
      return send({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
      });
    }

    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) throw new Error(`沒有這個工具：${params?.name}`);

      const text = await tool.run(params.arguments ?? {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(text).slice(0, 100_000) }] } });
    }

    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });

    // 未實作的方法回標準錯誤碼，讓客戶端自己決定要不要退化
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `未實作：${method}` } });
  } catch (error) {
    // 工具執行失敗回成 isError 的結果而不是協定錯誤：
    // 「查詢寫錯了」是使用者要看到的訊息，不是連線壞了
    if (method === 'tools/call') {
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `失敗：${error.message}` }], isError: true }
      });
    }

    send({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // 訊息以換行分隔；最後一段可能是半條，留在緩衝區等下一次
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;

    try {
      handle(JSON.parse(line));
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失敗' } });
    }
  }
});

process.stdin.on('end', () => process.exit(0));
