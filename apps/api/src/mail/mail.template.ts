/**
 * 郵件樣板。
 *
 * 樣板集中定義而非散落於呼叫端，理由是**寄出去的文字是對外的**：
 * 措辭、署名與連結格式需要一致，而散落各處的字串無法一次校對。
 *
 * 樣板以純函式表示，不依賴任何樣板引擎 —— 這幾封信的結構穩定，
 * 引入引擎只會增加一層需要學習與維護的東西。
 */

type Template = {
  subject: (p: Record<string, string>) => string;
  render: (p: Record<string, string>) => string;
};

/** 共用外框；所有郵件共用同一組樣式與署名 */
const layout = (title: string, body: string): string =>
  `
<div style="font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 16px;font-size:18px;color:#111827">${title}</h2>
  ${body}
  <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb">
  <p style="font-size:12px;color:#6b7280;margin:0">
    本信件由道路巡查系統自動發送，請勿直接回覆。
  </p>
</div>`.trim();

const paragraph = (text: string) => `<p style="margin:0 0 12px;line-height:1.7">${text}</p>`;

export const MAIL_TEMPLATES = {
  /** 密碼變更通知；帳號安全事件一律通知本人 */
  PASSWORD_CHANGED: {
    subject: () => '[道路巡查系統] 密碼已變更',
    render: (p) =>
      layout(
        '密碼已變更',
        paragraph(`您的帳號 <strong>${p.account}</strong> 的密碼已於 ${p.changedAt} 完成變更。`) +
          paragraph('若此操作並非本人執行，請立即聯絡系統管理員。')
      )
  },

  /** 派工通知；指派後寄給施工人員 */
  WORK_ORDER_ASSIGNED: {
    subject: (p) => `[道路巡查系統] 新的派工單 ${p.caseNum}`,
    render: (p) =>
      layout(
        '您有一張新的派工單',
        paragraph(`派工單號：<strong>${p.caseNum}</strong>`) +
          paragraph(`施工地點：${p.address}`) +
          paragraph(`施工期限：${p.dueDate}`) +
          paragraph('請於期限前完成施工並回報，回報時需上傳必要照片。')
      )
  },

  /** 逾期提醒；排程每日彙整後寄出 */
  WORK_ORDER_OVERDUE: {
    subject: (p) => `[道路巡查系統] 您有 ${p.count} 張派工單已逾期`,
    render: (p) =>
      layout(
        '派工單逾期提醒',
        paragraph(`截至 ${p.checkedAt}，您名下有 <strong>${p.count}</strong> 張派工單已超過施工期限。`) +
          paragraph(`最早的一張：${p.earliest}`) +
          paragraph('請盡快回報進度，或聯絡承辦調整期限。')
      )
  },

  /** 報表完成通知；報表可能跑數分鐘，使用者多半已離開畫面 */
  REPORT_READY: {
    subject: (p) => `[道路巡查系統] 報表已產製完成（${p.format}）`,
    render: (p) =>
      layout(
        '報表已產製完成',
        paragraph(`您於 ${p.requestedAt} 申請的報表已完成，共 ${p.rowCount} 筆資料。`) +
          paragraph('請至系統的報表管理頁面下載。下載連結有效期限為 7 天。')
      )
  }
} satisfies Record<string, Template>;

export type MailTemplateKey = keyof typeof MAIL_TEMPLATES;
