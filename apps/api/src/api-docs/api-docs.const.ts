import { type AuthMode, tagDescription } from './swagger.helper';
import { IntegrationModule } from '@/integration/integration.module';

/** 一份對外文件的定義 */
export type VendorDoc = {
  /** 出現在網址上的單位代號 `/api-docs/<code>`，需與設定的 `apiDocs.vendors` 對應 */
  code: string;
  /** 顯示在文件標題的單位名稱 */
  name: string;
  /** 納入的模組；第一層過濾 */
  modules: Function[];
  /** 章節 tag，需與 controller 上 `@ApiTags` 的名稱一致；第二層過濾 */
  tag: string;
  /** 章節開頭的說明 */
  tagDescription: string;
  /** 認證方式 */
  auth: AuthMode;
};

/**
 * 對外文件：一個對接單位一份 `/api-docs/<單位代號>`。
 *
 * 內容隔離是**兩層**：`modules` 篩到模組，`tag` 再篩到端點。
 * 因此對方就算直接抓 spec JSON，也只看得到自己那幾支。
 *
 * ⚠️ 新增端點若沒掛上這裡列出的任一 tag，不會出現在任何一份對外文件。
 *    這是刻意的預設：**漏列只是少一支(可以補)，誤列是把別家的介面攤給對方看**。
 */
export const VENDOR_DOCS: VendorDoc[] = [
  {
    code: 'device',
    name: '車機廠商',
    modules: [IntegrationModule],
    tag: 'Device',
    tagDescription: tagDescription(
      { auth: 'apiKey' },
      '車機端的上傳介面：路面破壞案件與巡查軌跡。',
      '',
      '兩支端點都支援重送去重 —— 車機在收不到回應時會自動重送，',
      '重複遞送會回傳既有資料並帶 `DUPLICATED: true`，HTTP 狀態仍是成功。',
      '',
      '座標請一併帶 `HEADING`(方位角)：系統會把座標往行進方向校正約 5 公尺，',
      '因為天線在車頂而破壞在鏡頭正前方。沒帶方位角就不校正。'
    ),
    auth: 'apiKey'
  },
  {
    code: 'app',
    name: '行動應用廠商',
    modules: [IntegrationModule],
    tag: 'Mobile',
    tagDescription: tagDescription(
      { auth: 'apiKey' },
      '行動應用的現場收案介面：鋪面調查點。',
      '',
      '明細(`DETAIL_ID`)是選填的 —— 現場人員不一定知道這個點屬於委託單的第幾項，',
      '沒帶就由系統依路名比對，比不到就當成臨時加測。',
      '',
      '破壞面積由長寬算出來，不需要 App 傳：兩邊各算一次一定會有對不上的資料。'
    ),
    auth: 'apiKey'
  }
];

/**
 * 內部文件納入的模組。
 *
 * 「全部」而不是逐一列出：內部文件的讀者是自己人，漏列一個模組
 * 只會讓同事找不到端點然後來問。與對外文件的取捨方向正好相反。
 */
export const INTERNAL_DOC_MODULES: Function[] | undefined = undefined;

/** 內部文件的章節；順序就是文件上的順序 */
export const INTERNAL_DOC_TAGS: { name: string; description: string }[] = [
  { name: 'Auth', description: '登入、續期、臨時 Token、密碼政策、帳號與部門、個人授權覆蓋、API Key' },
  { name: 'Role', description: '角色與權限矩陣' },
  { name: 'Core', description: '代碼表、系統公告、圖形驗證碼' },
  { name: 'Orgstruct', description: '使用者導覽選單(資料驅動的側邊欄)' },
  { name: 'Project', description: '標案、工務段與轄區' },
  { name: 'Case-Patrol', description: '車巡案件：新增、查詢、統計、連續破壞警示、里程' },
  { name: 'Sift', description: '二篩：判定、覆核、統計、薪資' },
  { name: 'Case-History', description: '案件版本歷程：快照、比較、還原' },
  { name: 'Maintenance', description: '巡查單 RA／巡修單 RB' },
  { name: 'Work-Order', description: '派工、施工回報、驗收' },
  { name: 'Fleet', description: '車隊與軌跡' },
  { name: 'Vehicle-Comm', description: '車機通訊：連線狀態、下指令、模擬器' },
  { name: 'Road-Eval', description: '路段評估' },
  { name: 'Patrol-Setting', description: '巡查計畫與路線覆蓋率' },
  { name: 'Road-Setting', description: '道路線段、區塊、巡查點與點位覆蓋率' },
  { name: 'Survey', description: '鋪面調查：委託單、明細、調查點、專家系統' },
  { name: 'Report', description: '報表產製(十一種)' },
  { name: 'Dashboard', description: '儀表板、每日檢查、結算' },
  { name: 'Geo', description: '行政區界線、地址自動完成' },
  { name: 'Location', description: '門牌圖資：反查、正查、自動完成' },
  { name: 'Mail', description: '郵件工作' },
  { name: 'FireBase', description: '推播裝置' },
  { name: 'Realtime', description: '即時通訊(WebSocket 的 HTTP 補充介面)' },
  { name: 'Support', description: '客服對話' },
  { name: 'Task', description: '排程' },
  { name: 'Device', description: '車機上傳介面(對外)' },
  { name: 'Mobile', description: '行動應用收案介面(對外)' }
];

/** 內部文件的整體說明 */
export const INTERNAL_API_DESCRIPTION = [
  '道路巡查 Demo 的**內部介面文件**，未對外開放。',
  '',
  '### 回應格式',
  '',
  '所有端點都回傳同一個信封：',
  '',
  '```json',
  '{ "status": true, "code": 200, "message": "", "data": {} }',
  '```',
  '',
  '`status` 為 false 代表「查無資料」或業務層的警告，HTTP 狀態碼仍可能是 200；',
  '真正的錯誤會以對應的 HTTP 狀態碼回傳，`data` 不存在。',
  '',
  '### 冪等性',
  '',
  '標示 `Idempotency-Key` 表頭的端點支援去重：同一把 key 重送會回放第一次的結果，',
  '不會重複建立資料。上游車機在收不到回應時的自動重送就是靠這個機制。',
  '',
  '### 權限',
  '',
  '每支端點所需的權限寫在說明的「所需權限」一行，權限總表見 `GET /api/auth/action`。'
].join('\n');
