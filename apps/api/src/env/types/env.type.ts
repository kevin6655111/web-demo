/** 資料庫連線資訊(各 vendor 共用形狀) */
export type DbCredentials = {
  host: string;
  port: number;
  name: string;
  user: string;
  pass: string;
};

/** config.{dev,prod}.yaml 展開後的型別 */
export type AppConfig = {
  client: 'DEMO' | string;

  app: {
    name: string;
    port: { http: number; ws: number };
    jwt: { secret: string; expiresInSec: number };
    password: {
      saltRounds: number;
      minLength: number;
      /** 兩次改密碼的最短間隔(小時)；防止改回舊密碌的「換兩次」把戲 */
      cooldownHours?: number;
      /** 不可與最近幾次相同 */
      historyDepth?: number;
      /** 密碼有效天數；0 或省略代表不強制定期更換 */
      maxAgeDays?: number;
    };
    /** 二篩計價；省略時用 shared 的預設值 */
    sift?: { unitPrice: number; errorPrice: number };
  };

  database: {
    vendor: 'postgres';
    postgres: DbCredentials;
  };

  redis: { host: string; port: number };

  storage: {
    backend: 'MINIO' | 'LOCAL';
    minio?: {
      endPoint: string;
      /**
       * 對外簽名用的位址。
       *
       * 後端連的是容器內部主機名(minio:9000)，但簽名網址是給**瀏覽器**用的 ——
       * 瀏覽器解不到那個名字。S3 的簽章涵蓋 Host，所以不能簽完再換網址，
       * 必須一開始就用對外位址簽。沒設定時退回 endPoint(本機開發兩者相同)。
       */
      publicEndPoint?: string;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
    };
  };

  /**
   * API 文件的存取金鑰。
   *
   * 一單位一把，可個別撤銷 —— 某一單位的連結外流時只換那一把，
   * 不必通知所有對接單位。未設定(或少於 10 字元)的文件一律回 503，
   * 而不是預設開放：文件裡有完整的欄位結構與業務規則。
   */
  apiDocs: {
    internalKey?: string;
    vendors?: Record<string, string | undefined>;
  };

  task: {
    /** 總開關：關掉就完全不註冊任何排程 */
    active: boolean;
    /** 個別排程開關；cron 與逾時寫在 task-definitions.ts，站台只決定要不要跑 */
    schedule: Record<string, boolean>;
  };
};
