import type { ReportQuery } from './shared';
import { caseListReport, dailyReport, monthlyReport, potholeReport, trackReport } from './patrol-reports';
import {
  roadEvalReport,
  siftSalaryReport,
  surveyDeletedReport,
  surveyPhotoReport,
  surveyRecordReport,
  surveySegmentReport
} from './other-reports';

/**
 * 報表種類 → 查詢函式。
 *
 * 這張表是唯一的分派點：新增一種報表 = 寫一個查詢函式、
 * 在 `@road-patrol/shared` 的 `REPORT_KIND_DEF` 宣告它的參數與格式、
 * 然後在這裡連起來。排版、佇列、下載、去重都不必改。
 *
 * 鍵必須與 `REPORT_KIND_DEF` 的 key 一致 —— 啟動時會檢查(見 report.service)。
 */
export const REPORT_QUERIES: Record<string, ReportQuery> = {
  CASE_LIST: caseListReport,
  DAILY: dailyReport,
  MONTHLY: monthlyReport,
  POTHOLE: potholeReport,
  TRACK: trackReport,
  ROAD_EVAL: roadEvalReport,
  SALARY: siftSalaryReport,
  SURVEY_RECORD: surveyRecordReport,
  SURVEY_SEGMENT: surveySegmentReport,
  SURVEY_PHOTO: surveyPhotoReport,
  SURVEY_DELETED: surveyDeletedReport
};

export type { ReportQuery };
