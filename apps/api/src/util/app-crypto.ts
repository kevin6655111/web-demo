import { timingSafeEqual } from 'crypto';

/**
 * 定時比較兩個字串。
 *
 * 一般的 `===` 在第一個不同的字元就返回，比較時間會洩漏「前幾個字元對了」——
 * 攻擊者可以一個字元一個字元地把金鑰試出來。這對文件金鑰這種
 * 長期有效、可以無限次嘗試的祕密特別重要。
 *
 * 長度不同時仍然做一次比較再回 false：直接回 false 會讓「長度對不對」
 * 變成一個零成本的探測。
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a ?? '', 'utf8');
  const right = Buffer.from(b ?? '', 'utf8');

  if (left.length !== right.length) {
    // 與自己比一次，讓長度錯誤與內容錯誤花掉相近的時間
    timingSafeEqual(left, left);
    return false;
  }

  return timingSafeEqual(left, right);
}
