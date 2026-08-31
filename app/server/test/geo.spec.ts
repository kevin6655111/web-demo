import { describe, it, expect } from 'vitest';
import { GeoService } from '@/geo/geo.service';

/**
 * 逆地理編碼的結果會被寫進案件，而佇列的工作可能被重試好幾次。
 * 只要它不是決定性的，重試就會讓同一筆案件的路名跳來跳去 —— 這條測試守的是這件事。
 */
describe('GeoService.reverseGeocode', () => {
  const geoService = new GeoService({} as any);

  it('同一座標永遠得到同一個路名', async () => {
    const a = await geoService.reverseGeocode(120.6478, 24.1636);
    const b = await geoService.reverseGeocode(120.6478, 24.1636);
    expect(a).toBe(b);
  });

  it('相距夠遠的座標會落在不同網格', async () => {
    const results = await Promise.all([
      geoService.reverseGeocode(120.6478, 24.1636),
      geoService.reverseGeocode(120.7, 24.2),
      geoService.reverseGeocode(121.5, 25.03)
    ]);
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('回傳的路名符合「路+段」的格式', async () => {
    expect(await geoService.reverseGeocode(120.6478, 24.1636)).toMatch(/^.+路[一二三四]段$/);
  });
});

/**
 * 這條是回歸測試：雜湊值超過 2^31 時，用有號位移(>>)取出的索引會是負數，
 * 陣列取值變成 undefined，路名就會長出「民生路undefined」。
 */
describe('GeoService.reverseGeocode 邊界', () => {
  const geoService = new GeoService({} as any);

  it('大量座標都不會產生 undefined 的路名', async () => {
    const results = await Promise.all(
      Array.from({ length: 500 }, (_, i) => geoService.reverseGeocode(120 + i * 0.013, 24 + i * 0.007))
    );

    expect(results.every((r) => !r.includes('undefined'))).toBe(true);
    expect(results.every((r) => /^.+路[一二三四]段$/.test(r))).toBe(true);
  });
});
