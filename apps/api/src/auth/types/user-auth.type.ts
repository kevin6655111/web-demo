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
};
