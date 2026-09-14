import { ACTION } from '@constants/module.const';

/**
 * 導覽定義（模組 → 子功能）。
 *
 * 這份定義是「系統有哪些功能」的單一來源：啟動時同步進資料庫，
 * 前端的側邊欄、權限勾選畫面、以及路由都從它長出來。
 * 圖示用 react-icons 的名稱，前端查表轉成元件 —— 資料庫不存元件。
 */
export const MODULE_DEF = [
  {
    key: 'DASHBOARD',
    name: '儀表板',
    icon: 'LiaChalkboardSolid',
    path: '/dashboard',
    defaultSubNav: 'DASHBOARD_OVERVIEW',
    sortOrder: 0,
    features: [
      {
        key: 'DASHBOARD_OVERVIEW',
        name: '總覽',
        icon: 'FcStatistics',
        component: 'DashboardOverview',
        requiredAction: ACTION.DASHBOARD.READ,
        sortOrder: 0
      },
      {
        key: 'DASHBOARD_WORK_ORDER',
        name: '派工單統計',
        icon: 'GiAutoRepair',
        component: 'DashboardWorkOrder',
        requiredAction: ACTION.DASHBOARD.READ,
        sortOrder: 1
      }
    ]
  },
  {
    key: 'MAP_MOD',
    name: '圖台管理',
    icon: 'SiOpenstreetmap',
    path: '/map',
    defaultSubNav: 'PATROL_CRACK',
    sortOrder: 1,
    features: [
      {
        key: 'FLEET_MONITOR',
        name: '車隊管理',
        icon: 'FaCarAlt',
        component: 'QFleetMonitor',
        requiredAction: ACTION.FLEET.READ,
        sortOrder: 0
      },
      {
        key: 'PATROL_TRACK',
        name: '軌跡查詢',
        icon: 'FaRoad',
        component: 'QVehicleTrack',
        requiredAction: ACTION.TRACK.READ,
        sortOrder: 1
      },
      {
        key: 'PATROL_CRACK',
        name: '破壞查詢',
        icon: 'GiEdgeCrack',
        component: 'QVehicleCrack',
        requiredAction: ACTION.CASE.READ,
        sortOrder: 2
      },
      {
        key: 'ROAD_EVAL',
        name: '道路評估',
        icon: 'GiMountainRoad',
        component: 'QRoadEval',
        requiredAction: ACTION.ROAD_EVAL.READ,
        sortOrder: 3
      },
      {
        key: 'ROAD_SETTING',
        name: '道路設定',
        icon: 'MdEditRoad',
        component: 'QRoadSetting',
        requiredAction: ACTION.ROAD_SETTING.READ,
        sortOrder: 4
      },
      {
        key: 'PATROL_POINT',
        name: '巡查點',
        icon: 'MdMyLocation',
        component: 'QPatrolPoint',
        requiredAction: ACTION.ROAD_SETTING.READ,
        sortOrder: 5
      },
      {
        key: 'GIS',
        name: '圖資查詢',
        icon: 'BsLayersFill',
        component: 'QGIS',
        requiredAction: ACTION.CASE.READ,
        sortOrder: 6
      }
    ]
  },
  {
    key: 'CASE_MOD',
    name: '案件管理',
    icon: 'AiFillProject',
    path: '/case',
    defaultSubNav: 'CASE_EDIT',
    sortOrder: 2,
    features: [
      {
        key: 'CASE_EDIT',
        name: 'AI車巡單',
        icon: 'FaEdit',
        component: 'CaseEdit',
        requiredAction: ACTION.CASE.READ,
        sortOrder: 0
      },
      {
        key: 'CASE_HISTORY',
        name: '案件歷程',
        icon: 'MdHistory',
        component: 'CaseHistoryPanel',
        requiredAction: ACTION.CASE.READ,
        sortOrder: 1
      }
    ]
  },
  {
    key: 'SIFT_MOD',
    name: '二篩系統',
    icon: 'MdFactCheck',
    path: '/sift',
    defaultSubNav: 'SIFT_GENERAL',
    sortOrder: 3,
    features: [
      {
        key: 'SIFT_GENERAL',
        name: '判讀作業',
        icon: 'MdFactCheck',
        component: 'SiftGeneral',
        requiredAction: ACTION.SIFT.READ,
        sortOrder: 0
      },
      {
        key: 'SIFT_MANAGE',
        name: '覆核作業',
        icon: 'MdRule',
        component: 'SiftManage',
        requiredAction: ACTION.SIFT.REVIEW,
        sortOrder: 1
      },
      {
        key: 'SIFT_STATS',
        name: '判讀統計',
        icon: 'FcStatistics',
        component: 'SiftStats',
        requiredAction: ACTION.SIFT.READ,
        sortOrder: 2
      },
      {
        key: 'SIFT_SALARY',
        name: '薪資表',
        icon: 'MdPayments',
        component: 'SiftSalary',
        requiredAction: ACTION.SIFT.MANAGE,
        sortOrder: 3
      }
    ]
  },
  {
    key: 'ORDER_MOD',
    name: '派工管理',
    icon: 'MdOutlineConstruction',
    path: '/workorder',
    defaultSubNav: 'MAINTENANCE',
    sortOrder: 4,
    features: [
      // 巡查單排在派工單前面：流程是先發現、再派工，導覽的順序照著做事的順序走
      {
        key: 'MAINTENANCE',
        name: '巡查單',
        icon: 'MdOutlineChecklist',
        component: 'MaintenanceBoard',
        requiredAction: ACTION.MAINTENANCE.READ,
        sortOrder: 0
      },
      {
        key: 'WORK_ORDER',
        name: '派工單',
        icon: 'GiAutoRepair',
        component: 'WorkOrderBoard',
        requiredAction: ACTION.WORK_ORDER.READ,
        sortOrder: 1
      }
    ]
  },
  {
    key: 'SURVEY_MOD',
    name: '鋪面調查',
    icon: 'RiSurveyFill',
    path: '/survey',
    defaultSubNav: 'SURVEY_ORDER',
    sortOrder: 5,
    features: [
      {
        key: 'SURVEY_ORDER',
        name: '委託單',
        icon: 'TbIdBadge2',
        component: 'SurveyOrderBoard',
        requiredAction: ACTION.SURVEY.READ,
        sortOrder: 0
      },
      {
        key: 'SURVEY_CASE',
        name: '調查點',
        icon: 'RiSurveyFill',
        component: 'SurveyCaseBoard',
        requiredAction: ACTION.SURVEY.READ,
        sortOrder: 1
      },
      {
        key: 'SURVEY_EXPERT',
        name: '專家系統',
        icon: 'MdRule',
        component: 'SurveyExpertBoard',
        requiredAction: ACTION.SURVEY.EXPERT,
        sortOrder: 2
      }
    ]
  },
  {
    key: 'REPORT_MOD',
    name: '報表管理',
    icon: 'HiOutlineDocumentReport',
    path: '/report',
    defaultSubNav: 'CASE_REPORT',
    sortOrder: 6,
    features: [
      {
        key: 'CASE_REPORT',
        name: '案件報表',
        icon: 'TbReportAnalytics',
        component: 'CaseReport',
        requiredAction: ACTION.REPORT.READ,
        sortOrder: 0
      }
    ]
  },
  {
    key: 'MANAGE_MOD',
    name: '系統管理',
    icon: 'FaGear',
    path: '/manage',
    defaultSubNav: 'PROJECT_MANAGE',
    sortOrder: 7,
    features: [
      {
        key: 'PROJECT_MANAGE',
        name: '標案管理',
        icon: 'TbIdBadge2',
        component: 'ProjectManage',
        requiredAction: ACTION.PROJECT.READ,
        sortOrder: 0
      },
      {
        key: 'ACCOUNT_MANAGE',
        name: '人員管理',
        icon: 'MdManageAccounts',
        component: 'AccountManage',
        requiredAction: ACTION.ACCOUNT_MANAGE.READ,
        sortOrder: 1
      },
      {
        key: 'ROLE_MANAGE',
        name: '角色權限',
        icon: 'MdSecurity',
        component: 'RoleManage',
        requiredAction: ACTION.ACCOUNT_MANAGE.READ,
        sortOrder: 2
      },
      {
        key: 'TASK_MANAGE',
        name: '排程管理',
        icon: 'MdSchedule',
        component: 'TaskManage',
        requiredAction: ACTION.TASK.READ,
        sortOrder: 3
      },
      {
        key: 'FLEET_MANAGE',
        name: '車輛管理',
        icon: 'FaCarAlt',
        component: 'FleetManage',
        requiredAction: ACTION.FLEET.UPDATE,
        sortOrder: 4
      },
      {
        key: 'PLAN_MANAGE',
        name: '巡查設定',
        icon: 'TbRouteSquare',
        component: 'PlanManage',
        requiredAction: ACTION.PROJECT.UPDATE,
        sortOrder: 5
      }
    ]
  }
] as const;
