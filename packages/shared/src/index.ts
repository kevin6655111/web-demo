/**
 * 前後端共用的領域語彙。
 *
 * 這裡放的是「這個系統的世界裡有哪些東西」——破壞類型、單據狀態、施工材料、
 * 照片分區。它們同時是後端的驗證清單與前端的下拉選項與中文標籤。
 *
 * **各自存一份的下場**：前端的材料對照曾經把 `COLD` 寫成「冷瀝青」，
 * 而後端是「冷拌瀝青」；前端還多出一個後端不存在的 `OTHER`。
 * 沒有人會發現，直到報表上出現一個業主不認得的材料名稱。
 *
 * 這個套件刻意**沒有任何執行期依賴**：後端在 NestJS(CommonJS)裡用它，
 * 前端在 Vite(ESM)裡用它，多一個依賴就要同時滿足兩邊。
 */
export * from './lookup';
export * from './case';
export * from './maintenance';
export * from './work-order';
export * from './image';
export * from './survey';
export * from './asset';
export * from './report';
export * from './sift';
export * from './geo';
