import type { KeyDef } from './lookup';

/**
 * 報表種類。
 *
 * 一份報表就是「一種讀者要的一種答案」：日報給督導看昨天做了什麼、
 * 月報給業主請款、坑洞報表給養護單位排工、薪資表給二篩人員對帳。
 * 種類決定資料來源與版面，格式(XLSX/DOCX)只決定排版方式。
 *
 * `group` 讓前端把選單分成車巡與鋪面兩段；`params` 是這一種報表接受的條件，
 * 前端依它決定要顯示哪些欄位，後端依它收集參數 —— 兩邊看的是同一份清單。
 *
 * `required` 另外列而不是從參數名推導：同一個 `ORDER_ID` 在調查紀錄表是必填
 * (沒有委託單就沒有東西可印)，在已刪除案件表卻是選填(不給就看全部)。
 * 靠名字猜的話，這種差異只能靠特例來處理。
 */
export const REPORT_KIND_DEF = [
  {
    key: 'CASE_LIST',
    name: '車巡案件清單',
    group: 'PATROL',
    params: ['DATE', 'PRJ_ID', 'COUNTY', 'DISTRICT', 'STATUS', 'NEED_REPAIR', 'CRACK_TYPE'],
    required: [],
    formats: ['XLSX', 'DOCX']
  },
  { key: 'DAILY', name: '每日巡查報表', group: 'PATROL', params: ['DAY', 'PRJ_ID'], required: ['DAY'], formats: ['XLSX', 'DOCX'] },
  { key: 'MONTHLY', name: '月報表', group: 'PATROL', params: ['MONTH', 'PRJ_ID'], required: ['MONTH'], formats: ['XLSX', 'DOCX'] },
  { key: 'POTHOLE', name: '坑洞報表', group: 'PATROL', params: ['DATE', 'PRJ_ID', 'DISTRICT'], required: [], formats: ['XLSX'] },
  { key: 'ROAD_EVAL', name: '道路評估路段報表', group: 'PATROL', params: ['PRJ_ID', 'DISTRICT', 'MAINTAIN_LEVEL'], required: [], formats: ['XLSX'] },
  { key: 'TRACK', name: '巡查軌跡報表', group: 'PATROL', params: ['DATE', 'VEHICLE_ID'], required: [], formats: ['XLSX'] },
  { key: 'SALARY', name: '二篩人員薪資表', group: 'SIFT', params: ['MONTH', 'USER_ID'], required: ['MONTH'], formats: ['XLSX'] },
  {
    key: 'SURVEY_RECORD',
    name: '柔性鋪面狀況調查紀錄表',
    group: 'SURVEY',
    params: ['ORDER_ID'],
    required: ['ORDER_ID'],
    formats: ['XLSX', 'DOCX']
  },
  { key: 'SURVEY_SEGMENT', name: '鋪面路段報表', group: 'SURVEY', params: ['ORDER_ID'], required: ['ORDER_ID'], formats: ['XLSX'] },
  { key: 'SURVEY_PHOTO', name: '鋪面案件清單與照片', group: 'SURVEY', params: ['ORDER_ID'], required: ['ORDER_ID'], formats: ['XLSX'] },
  // 已刪除案件表不指定委託單就看全部：業主問的常常是「這批調查總共刪了幾個點」
  { key: 'SURVEY_DELETED', name: '鋪面已刪除案件表', group: 'SURVEY', params: ['ORDER_ID'], required: [], formats: ['XLSX'] }
] as const;

export type ReportKind = (typeof REPORT_KIND_DEF)[number]['key'];

export const REPORT_GROUP_DEF = [
  { key: 'PATROL', name: '車巡' },
  { key: 'SIFT', name: '二篩' },
  { key: 'SURVEY', name: '鋪面調查' }
] as const satisfies readonly KeyDef[];

/** 報表工作狀態 */
export const REPORT_STATE_DEF = [
  { value: 0, name: '排隊中', color: 'neutral' },
  { value: 1, name: '產製中', color: 'info' },
  { value: 2, name: '完成', color: 'success' },
  { value: 3, name: '失敗', color: 'error' }
] as const;
