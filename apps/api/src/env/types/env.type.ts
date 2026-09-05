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
    password: { saltRounds: number; minLength: number };
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

  task: {
    /** 總開關：關掉就完全不註冊任何排程 */
    active: boolean;
    /** 個別排程開關；cron 與逾時寫在 task-definitions.ts，站台只決定要不要跑 */
    schedule: Record<string, boolean>;
  };
};
