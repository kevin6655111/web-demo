import '@/env.bootstrap';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SeedModule } from './seed.module';
import { StorageService } from '@/storage/storage.service';
import { PatrolCase } from '@entities/patrol-case.entity';
import { WorkOrderImage } from '@/work-order/entities/work-order-image.entity';
import { CRACK_TYPE_DEF } from '@road-patrol/shared';

/**
 * 產生示範用的圖片並上傳到物件儲存。
 *
 * 為什麼要真的產圖：清單頁的縮圖、案件詳情的照片、派工單的驗收照片，
 * 少了圖片就只剩下一串路徑字串 —— 那看不出這些畫面實際上長什麼樣，
 * 而「縮圖排版會不會爆」正是要用真圖才驗得出來的事。
 *
 * 用 SVG 而不是外部圖庫：不需要網路、不需要授權，
 * 而且每張圖上標了案件編號與破壞類型 —— 截圖時看得出哪張對應哪一筆。
 */

/** 破壞類型的示意配色與形狀；不是寫實照片，但一眼分得出彼此 */
const CRACK_STYLE: Record<string, { bg: string; ink: string; shape: 'blob' | 'line' | 'net' | 'rect' }> = {
  Potholes: { bg: '#3f3f46', ink: '#111827', shape: 'blob' },
  Cracking: { bg: '#52525b', ink: '#18181b', shape: 'line' },
  Alligator_Cracking: { bg: '#4b5563', ink: '#111827', shape: 'net' },
  Rutting: { bg: '#57534e', ink: '#1c1917', shape: 'line' },
  Patch: { bg: '#44403c', ink: '#292524', shape: 'rect' },
  Cover: { bg: '#3f3f46', ink: '#18181b', shape: 'blob' },
  Subsidence: { bg: '#4b5563', ink: '#1f2937', shape: 'blob' }
};

/** 固定種子的亂數：每次跑出來的圖一樣，截圖才有比較基準 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

/** 產生一張示意的破壞照片(SVG) */
function crackSvg(opts: { caseNum: string; crackType: string; degree: string; detected: string; detect: boolean; seed: number }): string {
  const style = CRACK_STYLE[opts.crackType] ?? CRACK_STYLE.Potholes;
  const rand = makeRandom(opts.seed);
  const name = CRACK_TYPE_DEF.find((c) => c.key === opts.crackType)?.name ?? opts.crackType;

  const marks: string[] = [];

  // 路面的顆粒感：純色矩形看起來像色票，不像路面
  for (let i = 0; i < 150; i += 1) {
    const x = rand() * 640;
    const y = rand() * 360;
    marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(rand() * 1.6 + 0.4).toFixed(1)}" fill="#000" opacity="${(rand() * 0.18).toFixed(2)}"/>`);
  }

  const cx = 200 + rand() * 220;
  const cy = 130 + rand() * 110;

  if (style.shape === 'blob') {
    const pts = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      const r = 40 + rand() * 34;
      return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r * 0.7).toFixed(1)}`;
    });
    marks.push(`<polygon points="${pts.join(' ')}" fill="${style.ink}" opacity="0.92"/>`);
  }

  if (style.shape === 'line') {
    for (let i = 0; i < 3; i += 1) {
      const y = cy - 30 + i * 30 + rand() * 10;
      marks.push(
        `<path d="M ${cx - 150} ${y} q 60 ${(rand() * 24 - 12).toFixed(1)} 120 0 q 60 ${(rand() * 24 - 12).toFixed(1)} 120 4" stroke="${style.ink}" stroke-width="${(3 + rand() * 4).toFixed(1)}" fill="none" opacity="0.9"/>`
      );
    }
  }

  if (style.shape === 'net') {
    for (let i = 0; i < 7; i += 1) {
      const x = cx - 90 + i * 30;
      marks.push(`<path d="M ${x} ${cy - 60} l ${(rand() * 30 - 15).toFixed(1)} 120" stroke="${style.ink}" stroke-width="2.5" fill="none" opacity="0.85"/>`);
      const y = cy - 60 + i * 20;
      marks.push(`<path d="M ${cx - 100} ${y} l 200 ${(rand() * 20 - 10).toFixed(1)}" stroke="${style.ink}" stroke-width="2.5" fill="none" opacity="0.85"/>`);
    }
  }

  if (style.shape === 'rect') {
    marks.push(`<rect x="${cx - 80}" y="${cy - 45}" width="160" height="90" rx="6" fill="${style.ink}" opacity="0.85"/>`);
  }

  // 判讀圖多一個框選與信心度：那是 AI 產出的那一張，與原始照片要分得出來
  const detectBox = opts.detect
    ? `<rect x="${cx - 95}" y="${cy - 62}" width="190" height="124" fill="none" stroke="#22d3ee" stroke-width="3"/>
       <rect x="${cx - 95}" y="${cy - 84}" width="190" height="22" fill="#22d3ee"/>
       <text x="${cx - 88}" y="${cy - 68}" font-family="monospace" font-size="14" fill="#083344">${name} ${(0.72 + rand() * 0.26).toFixed(2)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="${style.bg}"/>
  ${marks.join('\n  ')}
  ${detectBox}
  <rect x="0" y="312" width="640" height="48" fill="#000" opacity="0.55"/>
  <text x="14" y="332" font-family="monospace" font-size="15" fill="#e2e8f0">${opts.caseNum}</text>
  <text x="14" y="351" font-family="monospace" font-size="13" fill="#94a3b8">${name} · 程度 ${opts.degree} · ${opts.detected}</text>
  <text x="530" y="332" font-family="monospace" font-size="13" fill="#64748b">示範影像</text>
</svg>`;
}

/** 派工單照片：施工前中後的示意圖 */
function workSvg(caseNum: string, typeName: string, tone: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="${tone}"/>
  <rect x="0" y="240" width="640" height="120" fill="#000" opacity="0.12"/>
  <rect x="60" y="120" width="520" height="140" rx="8" fill="#000" opacity="0.18"/>
  <rect x="0" y="312" width="640" height="48" fill="#000" opacity="0.55"/>
  <text x="14" y="332" font-family="monospace" font-size="15" fill="#e2e8f0">${caseNum}</text>
  <text x="14" y="351" font-family="monospace" font-size="13" fill="#94a3b8">${typeName} · 示範影像</text>
</svg>`;
}

(async () => {
  const logger = new Logger('SeedImages');
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['warn', 'error'] });

  const storage = app.get(StorageService);
  const caseRepo = app.get<Repository<PatrolCase>>(getRepositoryToken(PatrolCase));
  const imageRepo = app.get<Repository<WorkOrderImage>>(getRepositoryToken(WorkOrderImage));

  // 預設全部產。
  //
  // 曾經只產「最新的 N 筆」，結果是清單有些列有圖、有些沒有 ——
  // 因為清單照檢測時間排序，而挑圖是照 id 挑的，兩者對不上。
  // 那看起來像系統壞了，而不是示範資料不完整。SVG 每張只有幾 KB，全產也不貴。
  const LIMIT = Number(process.env.SEED_IMAGE_LIMIT ?? 0);

  const cases = await caseRepo.find({ order: { id: 'DESC' }, ...(LIMIT ? { take: LIMIT } : {}) });

  let caseImages = 0;
  for (const c of cases) {
    if (!c.img && !c.imgDetect) continue;

    const detected = new Date(c.dtRecord).toISOString().slice(0, 16).replace('T', ' ');
    const base = { caseNum: c.caseNum ?? c.externalId, crackType: c.crackType, degree: c.degree, detected, seed: c.id * 7919 };

    if (c.img) {
      await storage.putObject(c.img, Buffer.from(crackSvg({ ...base, detect: false }), 'utf8'), 'image/svg+xml');
      caseImages += 1;
    }

    if (c.imgDetect) {
      await storage.putObject(c.imgDetect, Buffer.from(crackSvg({ ...base, detect: true }), 'utf8'), 'image/svg+xml');
      caseImages += 1;
    }
  }

  // 派工單照片：seed 只寫了資料庫紀錄，物件本身沒有 ——
  // 於是清單有縮圖欄位卻永遠是破圖，那比沒有縮圖更糟
  // 全部產：漏掉的那些在畫面上是破圖圖示，看起來像資料壞了而不是圖沒補齊
  const images = await imageRepo.find({ relations: { workOrder: true } });

  const TONE: Record<string, string> = {
    IMG_BEFORE: '#57534e',
    IMG_DURING: '#78716c',
    IMG_AFTER: '#3f6212',
    IMG_MILLING_ALTER: '#44403c',
    IMG_SURFACE_PAVING: '#374151',
    IMG_SUBGRADE_REHAB: '#4b5563',
    IMG_COMPACTION_TEST: '#334155'
  };

  let orderImages = 0;
  for (const img of images) {
    await storage.putObject(
      img.imgPath,
      Buffer.from(workSvg(img.workOrder?.caseNum ?? '', img.imgTypeCh, TONE[img.imgType] ?? '#52525b'), 'utf8'),
      'image/svg+xml'
    );
    orderImages += 1;
  }

  logger.log(`✅ 圖片產生完成：案件 ${caseImages} 張、派工單 ${orderImages} 張`);
  await app.close();
  process.exit(0);
})();
