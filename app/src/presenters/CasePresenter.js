import {
  CASE_STATUS_COLOR,
  CASE_STATUS_LABEL,
  CRACK_LABEL,
  DEGREE_LABEL,
  EDITED_LABEL,
  MATERIAL_LABEL,
  NEED_REPAIR_COLOR,
  NEED_REPAIR_LABEL,
  SOURCE_LABEL,
  WORK_ORDER_LABEL,
  WORK_ORDER_TYPE_LABEL
} from '../styles/theme';

/** 案件與派工的顯示規則 */
export const CasePresenter = {
  crackLabel: (type) => CRACK_LABEL[type] ?? type,
  degreeLabel: (degree) => DEGREE_LABEL[degree] ?? degree,
  sourceLabel: (source) => SOURCE_LABEL[source] ?? source,

  /** 二篩狀態(0-4) */
  statusLabel: (status) => CASE_STATUS_LABEL[status] ?? status,
  statusColor: (status) => CASE_STATUS_COLOR[status] ?? 'var(--c-neutral)',

  /** 修繕狀態(-1..2)：地圖與看板的顏色主要看這個 */
  needRepairLabel: (value) => NEED_REPAIR_LABEL[value] ?? value,
  needRepairColor: (value) => NEED_REPAIR_COLOR[value] ?? 'var(--c-neutral)',

  workOrderLabel: (state) => WORK_ORDER_LABEL[state] ?? state,
  workOrderTypeLabel: (type) => WORK_ORDER_TYPE_LABEL[type] ?? type,

  /** 時間顯示：今天的只給時分，其餘給月日 —— 看板上的欄位很窄 */
  time(value) {
    if (!value) return '';
    const d = new Date(value);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();

    return sameDay
      ? d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) +
          ' ' +
          d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  },

  /**
   * 快照欄位名稱轉中文。
   *
   * 共用給時間軸、欄位表與版本比較 —— 三處各寫一份的話，
   * 同一個欄位在比較畫面叫「面積」、在時間軸叫 areaM2，使用者得自己對照。
   */
  fieldLabel(field) {
    const FIELD_LABEL = {
      // 案件
      caseNum: '案件編號',
      crackType: '破壞類型',
      degree: '破壞程度',
      length: '長度(m)',
      width: '寬度(m)',
      area: '面積(m²)',
      depth: '深度(cm)',
      longitude: '經度',
      latitude: '緯度',
      img: '原始照片',
      imgDetect: '判讀照片',
      projectId: '標案',
      county: '縣市',
      district: '行政區',
      cavlge: '里',
      road: '路名',
      address: '地址',
      status: '二篩狀態',
      edited: '人工編輯',
      needRepair: '案件狀態',
      remark: '備註',
      // 派工單
      type: '派工類型',
      prjId: '標案號',
      dispatchDate: '派工日',
      dueDate: '限期完工日',
      workStartDate: '開工日',
      workEndDate: '完工日',
      workerUserId: '施工人員',
      startAddr: '起點地址',
      endAddr: '訖點地址',
      material: '施工材料',
      materialSize: '材料粒徑(mm)',
      workLength: '施工長度(m)',
      workWidth: '施工寬度(m)',
      workDepthMilling: '刨除深度(cm)',
      workDepthPaving: '鋪築深度(cm)',
      sampleTaken: '是否取樣',
      sampleDate: '取樣日期',
      testItem: '試驗項目',
      images: '已上傳照片',
      // 標案
      prjName: '標案簡稱',
      prjMain: '標案全名',
      prjSub: '標案子項',
      prjNo: '標案編號',
      proprietor: '業主',
      proprietorLevel: '業主等級',
      startDate: '開始日',
      endDate: '結束日',
      budget: '預算',
      roadKm: '巡查里程(km)',
      state: '狀態'
    };

    return FIELD_LABEL[field] ?? field;
  },

  /** 欄位值轉成看得懂的字；空值一律顯示「（空）」讓「原本沒有」看得出來 */
  fieldValue(field, value) {
    if (value === null || value === undefined || value === '') return '（空）';
    if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
    if (typeof value === 'boolean') return value ? '是' : '否';

    if (field === 'status') return CASE_STATUS_LABEL[value] ?? value;
    if (field === 'needRepair') return NEED_REPAIR_LABEL[value] ?? value;
    if (field === 'edited') return EDITED_LABEL[value] ?? value;
    if (field === 'crackType') return CRACK_LABEL[value] ?? value;
    if (field === 'degree') return DEGREE_LABEL[value] ?? value;
    if (field === 'material') return MATERIAL_LABEL[value] ?? value;
    if (field === 'type') return WORK_ORDER_TYPE_LABEL[value] ?? value;
    if (field === 'longitude' || field === 'latitude') return Number(value).toFixed(5);

    return String(value);
  },

  /**
   * 歷程差異轉成人話。
   * 直接把 { from, to } 丟到畫面上，使用者要自己翻譯欄位名與代碼 —— 那是設計上的偷懶。
   */
  changeText(field, change) {
    return `${this.fieldLabel(field)}：${this.fieldValue(field, change.from)} → ${this.fieldValue(field, change.to)}`;
  },

  /** 歷程動作的中文與圖示色 */
  actionMeta(action) {
    const MAP = {
      CREATED: { label: '建立', color: 'var(--c-info)' },
      UPDATED: { label: '內容修改', color: 'var(--c-info)' },
      GEOCODED: { label: '補上地址', color: 'var(--c-neutral)' },
      STATUS_CHANGED: { label: '狀態變更', color: 'var(--c-info)' },
      DISPATCHED: { label: '派工', color: 'var(--c-warning)' },
      WORKING: { label: '開始施工', color: 'var(--c-warning)' },
      REPORTED: { label: '回報完工', color: 'var(--c-purple)' },
      FINISHED: { label: '完工', color: 'var(--c-success)' },
      ACCEPTED: { label: '驗收合格', color: 'var(--c-success)' },
      RETURNED: { label: '退回重做', color: 'var(--c-error)' },
      IMAGE_UPLOADED: { label: '上傳照片', color: 'var(--c-info)' },
      IMAGE_DELETED: { label: '刪除照片', color: 'var(--c-error)' },
      RESTORED: { label: '還原版本', color: 'var(--c-purple)' },
      DELETED: { label: '刪除', color: 'var(--c-error)' }
    };

    return MAP[action] ?? { label: action, color: 'var(--c-neutral)' };
  },

  /** 歷程來源：人改的、排程改的、車機送的，追查問題時差別很大 */
  sourceMeta(source) {
    const MAP = {
      USER: { label: '人工操作', color: 'var(--c-info)' },
      TASK: { label: '排程', color: 'var(--c-purple)' },
      WORKER: { label: '背景工作', color: 'var(--c-neutral)' },
      DEVICE: { label: '車機上傳', color: 'var(--c-warning)' }
    };

    return MAP[source] ?? { label: source ?? '—', color: 'var(--c-neutral)' };
  }
};
