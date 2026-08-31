import { useEffect, useState } from 'react';
import { fleetApi, projectApi } from '../models/api/patrolApi';

/**
 * 查詢條件的選項來源（標案／行政區／工務段／車輛）。
 *
 * 這四組選項在圖台的四個面板與兩個列表頁都要用，而且幾乎不會變。
 *
 * **跨元件共用一份快取**：不快取的話，使用者在圖台切一輪分頁就打了十幾個請求 ——
 * 每個面板各抓一次，切回去再抓一次。那既是浪費，也真的會撞到每秒 20 次的節流上限，
 * 而撞到的時候壞掉的是查詢面板，不是這些選項本身。
 *
 * 連「正在飛的請求」也一起共用：兩個面板同時掛載時只會發一次。
 */
const cache = new Map();
const inflight = new Map();

/** 讓測試與「資料真的變了」的情境能把快取清掉 */
export function clearQueryOptionsCache() {
  cache.clear();
  inflight.clear();
}

function load(key, fetcher) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);

  const promise = fetcher()
    .then((res) => {
      const data = res?.data ?? [];
      cache.set(key, data);
      return data;
    })
    // 失敗不寫進快取：下次再試一次，而不是把「抓失敗」記住一整個 session
    .catch(() => [])
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export function useQueryOptions({ withCars = false } = {}) {
  const [options, setOptions] = useState(() => ({
    projects: cache.get('projects') ?? [],
    districts: cache.get('districts') ?? [],
    sections: cache.get('sections') ?? [],
    cars: cache.get('cars') ?? []
  }));

  useEffect(() => {
    let active = true;

    const apply = (key) => (data) => {
      if (active) setOptions((prev) => (prev[key] === data ? prev : { ...prev, [key]: data }));
    };

    load('projects', () => projectApi.list()).then(apply('projects'));
    load('districts', () => projectApi.areas()).then(apply('districts'));
    load('sections', () => projectApi.sections()).then(apply('sections'));

    if (withCars) load('cars', () => fleetApi.vehicles()).then(apply('cars'));

    return () => {
      active = false;
    };
  }, [withCars]);

  return options;
}

export default useQueryOptions;
