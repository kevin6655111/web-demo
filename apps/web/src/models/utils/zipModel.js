import { unzip } from 'fflate';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|svg)$/i;

/**
 * 解出壓縮檔裡的圖片。
 *
 * ZIP 類型是給「一次拍幾十張」用的 —— 現場一張一張傳在工地的網路下不切實際。
 * 但存進去之後總要看得到，否則等於丟進黑洞。
 *
 * **在前端解**：檔案本來就要下載到瀏覽器才看得到，
 * 在後端解等於同一份資料傳兩次（原檔進後端、解完再傳出來），
 * 而且要為此多一個暫存目錄與清理排程。
 *
 * 回傳的是 blob URL，用完要自己 revoke，不然換幾張圖記憶體就上去了。
 */
export async function extractZipImages(url, { limit = 60 } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載壓縮檔失敗(${res.status})`);

  const buf = new Uint8Array(await res.arrayBuffer());

  const files = await new Promise((resolve, reject) => {
    // 只解圖片：壓縮檔裡常夾著 Thumbs.db 或 __MACOSX 這類垃圾，
    // 解出來也只是產生一堆載入失敗的破圖
    unzip(buf, { filter: (f) => IMAGE_EXT.test(f.name) && !f.name.startsWith('__MACOSX/') }, (err, out) =>
      err ? reject(err) : resolve(out)
    );
  });

  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b, 'zh-Hant', { numeric: true }))
    .slice(0, limit)
    .map(([name, data]) => ({
      title: name.split('/').pop(),
      url: URL.createObjectURL(new Blob([data], { type: mimeOf(name) }))
    }));
}

/** 釋放 blob URL；元件卸載時務必呼叫 */
export function revokeImages(images = []) {
  for (const img of images) {
    if (img?.url?.startsWith('blob:')) URL.revokeObjectURL(img.url);
  }
}

function mimeOf(name) {
  const ext = name.split('.').pop().toLowerCase();

  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml'
    }[ext] ?? 'application/octet-stream'
  );
}
