import { useEffect, useMemo, useState } from 'react';
import { createElement } from 'react';
import { getIcon } from '../models/utils/iconModel';
import { navApi } from '../models/api/patrolApi';

/**
 * 側邊欄設定。
 *
 * 導覽來自後端(已依權限過濾)，前端只負責把圖示名稱換成元件、
 * 把元件名對應到實際的畫面。這樣新增一個功能不必改前端路由表 ——
 * 而不同站台開不同功能時，也不需要各自維護一份 build。
 */
export function useSidebarConfig() {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navApi
      .userNav()
      .then((res) => setModules(res.data ?? []))
      .catch(() => setModules([]))
      .finally(() => setLoading(false));
  }, []);

  const nav = useMemo(
    () =>
      modules.map((m) => ({
        id: m.MODULE_KEY,
        title: m.MODULE_NAME,
        path: m.MODULE_PATH,
        icon: createElement(getIcon(m.MODULE_ICON)),
        defaultSubNav: m.DEFAULT_SUB_NAV,
        subNav: (m.FEATURES ?? []).map((f) => ({
          id: f.FEATURE_KEY,
          title: f.FEATURE_NAME,
          icon: createElement(getIcon(f.FEATURE_ICON)),
          component: f.COMPONENT,
          requiredAction: f.REQUIRED_ACTION
        }))
      })),
    [modules]
  );

  return { nav, loading };
}
