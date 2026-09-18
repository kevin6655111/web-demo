import { describe, expect, it } from 'vitest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { assertTagsWithin, keepDocumented, pickByTag } from '@/api-docs/swagger.helper';
import { safeEqual } from '@/util/app-crypto';
import { VENDOR_DOCS } from '@/api-docs/api-docs.const';

/** 造一份最小的 OpenAPI 文件 */
function makeDoc(operations: { path: string; method: string; summary?: string; tags?: string[] }[]): OpenAPIObject {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const op of operations) {
    paths[op.path] ??= {};
    paths[op.path][op.method] = { ...(op.summary ? { summary: op.summary } : {}), tags: op.tags ?? [] };
  }

  return {
    openapi: '3.0.0',
    info: { title: '測試文件', version: '1.0.0' },
    paths: paths as OpenAPIObject['paths'],
    tags: [{ name: 'Device' }, { name: 'Mobile' }, { name: 'Internal' }]
  };
}

/**
 * 文件的過濾是對外隔離的唯一機制。
 *
 * 這一層錯了不會報錯、不會少東西 —— 文件照樣產得出來，只是別家的介面
 * 出現在對方的文件裡。所以它必須有測試，而不是靠人記得檢查。
 */
describe('API 文件過濾', () => {
  it('沒有 summary 的端點不進文件(opt-in)', () => {
    const doc = keepDocumented(
      makeDoc([
        { path: '/a', method: 'get', summary: '有整理過', tags: ['Device'] },
        { path: '/b', method: 'get', tags: ['Device'] }
      ])
    );

    expect(Object.keys(doc.paths)).toEqual(['/a']);
  });

  it('沒有任何端點留下來的 tag 會被移除，不留空章節', () => {
    const doc = keepDocumented(makeDoc([{ path: '/a', method: 'get', summary: 'x', tags: ['Device'] }]));

    expect(doc.tags?.map((t) => t.name)).toEqual(['Device']);
  });

  it('依 tag 過濾只留下該章節的端點', () => {
    const doc = pickByTag(
      makeDoc([
        { path: '/device', method: 'post', summary: '車機', tags: ['Device'] },
        { path: '/mobile', method: 'post', summary: 'App', tags: ['Mobile'] }
      ]),
      'Device'
    );

    expect(Object.keys(doc.paths)).toEqual(['/device']);
  });

  it('端點掛了不屬於這份文件的 tag 時，啟動就要失敗', () => {
    const doc = makeDoc([{ path: '/x', method: 'post', summary: '誤標', tags: ['Internal'] }]);

    // 這正是資料外洩的情境：內部端點被撈進對外文件
    expect(() => assertTagsWithin(doc, ['Device'])).toThrow(/tag 不乾淨/);
    expect(() => assertTagsWithin(doc, ['Device'])).toThrow(/POST \/x/);
  });

  it('端點同時掛兩個 tag 也要失敗', () => {
    // @ApiTags 在 class 層與 method 層是疊加的，這是最容易發生的誤標方式
    const doc = makeDoc([{ path: '/x', method: 'post', summary: '疊加', tags: ['Device', 'Internal'] }]);

    expect(() => assertTagsWithin(doc, ['Device'])).toThrow(/tag 不乾淨/);
  });

  it('沒有 summary 的鍵不列入檢查(pathItem 上可能有 parameters)', () => {
    const doc = makeDoc([{ path: '/x', method: 'parameters', tags: [] }]);

    expect(() => assertTagsWithin(doc, ['Device'])).not.toThrow();
  });

  it('每個對外單位的 tag 都不重複 —— 重複的話兩份文件會互相撈到對方的端點', () => {
    const tags = VENDOR_DOCS.map((v) => v.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('每個對外單位的代號都不重複 —— 代號就是網址，重複會讓後面那份蓋掉前面那份', () => {
    const codes = VENDOR_DOCS.map((v) => v.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

/**
 * 金鑰比較。
 *
 * 一般的 `===` 在第一個不同的字元就返回，比較時間會洩漏「前幾個字元對了」——
 * 對這種長期有效、可以無限次嘗試的祕密特別重要。
 */
describe('safeEqual', () => {
  it('相同字串回 true', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
  });

  it('不同字串回 false', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false);
  });

  it('長度不同也回 false 而不是丟錯', () => {
    expect(safeEqual('abc', 'abcdef')).toBe(false);
  });

  it('空字串不會炸', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'x')).toBe(false);
  });
});
