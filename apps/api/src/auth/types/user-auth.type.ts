/**
 * 機器身分的 uid。
 *
 * API Key 換來的 `AuthUser` 沒有對應的 `users` 列 —— 車機不是人。
 * 用 0 而不是 null：`AuthUser.uid` 是必填的數字，改成可選會讓每個讀它的地方
 * 都要多一次判斷；而 0 在資料庫裡永遠對不到任何一列，寫入時一定會被外鍵擋下，
 * 不會安靜地掛到錯的人身上。
 */
export const MACHINE_UID = 0;

/**
 * 寫入「誰做的」外鍵時用它。
 *
 * 機器身分回 `undefined`，欄位留空 —— 那筆資料的來源記在稽核紀錄的
 * `account`(`key:<金鑰名稱>`)與歷程的 `source: 'DEVICE'` 上，不需要假造一個人。
 */
export const userRef = (uid: number): { id: number } | undefined => (uid > MACHINE_UID ? { id: uid } : undefined);

/** JWT payload：只放權限判斷需要的欄位，不放個資 */
export type AuthUser = {
  uid: number;
  account: string;
  name: string;
  companyId: number;
  roleName: string;
  actions: string[];
};

export type LoginResult = {
  token: string;
  expiresInSec: number;
  user: Omit<AuthUser, 'actions'> & { actions: string[] };
  /** 首次登入、管理者重設過、或密碼已到期：前端要先帶去改密碼 */
  mustChangePassword?: boolean;
  /** 登入後預設進入的模組 */
  homeSys?: string | null;
};
