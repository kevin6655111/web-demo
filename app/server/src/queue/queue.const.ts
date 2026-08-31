/** 佇列名稱 */
export const QUEUE = {
  CASE_INGEST: 'case-ingest',
  REPORT: 'report'
} as const;

/** 微服務事件名稱(Redis transport 的 pattern) */
export const EVENT = {
  CASE_CREATED: 'case.created',
  CASE_ENRICHED: 'case.enriched',
  WORK_ORDER_CHANGED: 'workorder.changed',
  REPORT_DONE: 'report.done'
} as const;

/** case-ingest 佇列的工作內容 */
export type CaseIngestJob = {
  caseId: number;
  externalId: string;
  companyId: number;
  lng: number;
  lat: number;
  photoKey?: string;
};

/** report 佇列的工作內容 */
export type ReportJobPayload = {
  reportId: number;
  companyId: number;
  format: 'XLSX' | 'DOCX';
  params: Record<string, unknown>;
};

export type CaseCreatedEvent = CaseIngestJob & { crackType: string; detectedAt: string };
export type CaseEnrichedEvent = { caseId: number; companyId: number; roadName: string };
export type WorkOrderChangedEvent = { companyId: number; workOrderId: number; orderNo: string; state: string; caseId: number };
export type ReportDoneEvent = { companyId: number; reportId: number; format: string; state: string; rowCount: number };

export const CLIENT_EVENT_BUS = Symbol('CLIENT_EVENT_BUS');
