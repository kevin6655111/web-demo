import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_BASEMAP } from '../config/mapConfig';

const MapContext = createContext(null);

/**
 * 圖層登錄表。
 *
 * 整個圖台只有一張地圖，各功能面板把自己的圖層「登錄」進來 ——
 * 所以破壞案件、軌跡、車輛、路段可以同時疊著看。
 *
 * 這是關鍵的設計選擇：如果每個面板各自持有一張地圖，
 * 使用者就永遠沒辦法回答「這條軌跡有沒有經過那幾個坑洞」——
 * 而那正是巡查系統最常被問的問題。
 *
 * 每個圖層有 group(分組)與 order(堆疊順序)：
 * 點位要蓋在線之上，線要蓋在面之上，否則點會被線壓住點不到。
 */
export function MapProvider({ children }) {
  const [layers, setLayers] = useState({});
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const [street, setStreet] = useState(null);
  const [fitKey, setFitKey] = useState(null);

  /** 登錄或更新一個圖層；同一個 key 重複登錄視為更新資料 */
  const registerLayer = useCallback((key, config) => {
    setLayers((prev) => ({
      ...prev,
      [key]: {
        // 第一次登錄才吃預設值，之後保留使用者調過的開關與透明度
        visible: prev[key]?.visible ?? config.defaultVisible ?? true,
        opacity: prev[key]?.opacity ?? 1,
        order: 0,
        ...config,
        key
      }
    }));
  }, []);

  const removeLayer = useCallback((key) => {
    setLayers((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const toggleLayer = useCallback((key) => {
    setLayers((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], visible: !prev[key].visible } } : prev));
  }, []);

  const setLayerOpacity = useCallback((key, opacity) => {
    setLayers((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], opacity } } : prev));
  }, []);

  const setLayerMode = useCallback((key, mode) => {
    setLayers((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], mode } } : prev));
  }, []);

  /** 要求地圖把視野帶到某個圖層的資料範圍 */
  const fitTo = useCallback((key) => setFitKey({ key, at: Date.now() }), []);

  const ordered = useMemo(() => Object.values(layers).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [layers]);

  const value = useMemo(
    () => ({
      layers: ordered,
      layerMap: layers,
      registerLayer,
      removeLayer,
      toggleLayer,
      setLayerOpacity,
      setLayerMode,
      basemap,
      setBasemap,
      street,
      setStreet,
      fitKey,
      fitTo
    }),
    [
      ordered,
      layers,
      registerLayer,
      removeLayer,
      toggleLayer,
      setLayerOpacity,
      setLayerMode,
      basemap,
      street,
      fitKey,
      fitTo
    ]
  );

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMapLayers() {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error('useMapLayers 必須在 MapProvider 內使用');
  return ctx;
}
