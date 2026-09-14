import * as path from 'path';
import { applyDecorators, BadRequestException, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

type UploadFieldRule = {
  name: string;
  maxCount?: number;
  allowedExts?: string[];
  allowedMimes?: string[];
};

type UploadOptions = {
  /** 單檔大小上限 MB */
  maxSizeMB?: number;
  allowedExts?: string[];
  allowedMimes?: string[];
};

const normalizeExt = (ext: string) => {
  const e = ext.trim().toLowerCase();
  return e.startsWith('.') ? e : `.${e}`;
};

/**
 * 檔案上傳。
 *
 * 用 multipart 欄位而不是一次收一個檔案：派工單一次要傳「施工前／中／後」多張，
 * 分三次請求的話，第二次失敗時前一次已經存進去了，得自己收拾。
 *
 * 三個刻意的限制：
 *   memoryStorage  檔案不落地在容器裡 —— 容器是可拋棄的，直接轉存物件儲存
 *   fileSize       沒有上限等於開放磁碟耗盡攻擊
 *   副檔名 + MIME  兩者都檢查：副檔名可以隨便改，MIME 也可以偽造，但兩者同時偽造比較難
 *
 * 檢查在 multer 的 fileFilter 做，因為那是「還沒把整個檔案讀進記憶體」的時機點。
 */
export function UploadFields(fields: UploadFieldRule[], opts: UploadOptions = {}) {
  const maxSizeMB = opts.maxSizeMB ?? 20;

  const ruleMap = new Map<string, { exts?: string[]; mimes?: string[] }>();
  for (const f of fields) {
    ruleMap.set(f.name, {
      exts: f.allowedExts?.map(normalizeExt),
      mimes: f.allowedMimes?.map((m) => m.trim().toLowerCase())
    });
  }

  const defaultExts = opts.allowedExts?.map(normalizeExt);
  const defaultMimes = opts.allowedMimes?.map((m) => m.trim().toLowerCase());

  return applyDecorators(
    UseInterceptors(
      FileFieldsInterceptor(fields, {
        storage: memoryStorage(),
        limits: { fileSize: maxSizeMB * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          const rule = ruleMap.get(file.fieldname);
          const allowedExts = rule?.exts?.length ? rule.exts : defaultExts;
          const allowedMimes = rule?.mimes?.length ? rule.mimes : defaultMimes;

          if (!allowedExts?.length && !allowedMimes?.length) return cb(null, true);

          const ext = path.extname(file.originalname).toLowerCase();
          const mime = (file.mimetype || '').toLowerCase();

          const okExt = !allowedExts?.length || allowedExts.includes(ext);
          const okMime = !allowedMimes?.length || allowedMimes.includes(mime);

          if (okExt && okMime) return cb(null, true);

          return cb(
            new BadRequestException(
              `欄位 ${file.fieldname} 的檔案不符規則：${file.originalname}（${mime}）。` +
                `允許副檔名 ${allowedExts?.join('/') ?? '不限'}，MIME ${allowedMimes?.join('/') ?? '不限'}`
            ),
            false
          );
        }
      })
    )
  );
}

/** 影像欄位的共同規則：現場用手機拍，都是 jpg/png，偶爾 heic */
export const IMAGE_RULE = {
  allowedExts: ['.jpg', '.jpeg', '.png', '.heic', '.webp'],
  allowedMimes: ['image/jpeg', 'image/png', 'image/heic', 'image/webp']
};

/** 壓縮檔欄位：一次傳整批現場照片 */
export const ZIP_RULE = {
  allowedExts: ['.zip'],
  allowedMimes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
};
