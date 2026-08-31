import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateBucketCommand, DeleteObjectCommand, HeadBucketCommand, PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EnvService } from '@/env/env.service';

/**
 * 物件儲存(MinIO，S3 相容)。
 *
 * 案件影像不進資料庫也不落地在容器裡：容器是可拋棄的，資料不是。
 * 對外一律給短效簽名網址，bucket 本身不開公開讀取。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('Storage');
  private readonly client: S3Client;

  /**
   * 專門用來簽對外網址的 client。
   *
   * 讀寫走內部位址(快、不繞出去)，簽名走對外位址 ——
   * S3 的簽章涵蓋 Host，簽完再把網址換掉會直接驗證失敗。
   * 兩個位址相同時就是同一個 client，不會多花什麼。
   */
  private readonly signClient: S3Client;
  private readonly bucket: string;

  constructor(private readonly envService: EnvService) {
    const minio = this.envService.getMinioConfig();
    this.bucket = minio.bucket;

    const credentials = { accessKeyId: minio.accessKey, secretAccessKey: minio.secretKey };

    this.client = new S3Client({
      endpoint: minio.endPoint,
      region: minio.region,
      credentials,
      forcePathStyle: true // MinIO 不支援 virtual-host style
    });

    this.signClient = minio.publicEndPoint
      ? new S3Client({ endpoint: minio.publicEndPoint, region: minio.region, credentials, forcePathStyle: true })
      : this.client;
  }

  /** 啟動時確保 bucket 存在(重跑安全) */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`🪣 已建立 bucket: ${this.bucket}`);
      } catch (err: any) {
        this.logger.warn(`bucket 初始化略過(${this.bucket}): ${err?.message}`);
      }
    }
  }

  /**
   * 上傳案件影像。
   * key 由案件外部編號決定，同一筆案件重送會覆寫同一個物件而不是長出第二份。
   */
  public async putCasePhoto(externalId: string, body: Buffer, contentType = 'image/jpeg'): Promise<string> {
    const key = `cases/${externalId}.jpg`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  }

  /**
   * 上傳報表產出物。
   * key 用報表工作編號：同一份報表重跑會覆寫，不會在儲存空間留下孤兒檔案。
   */
  public async putReport(reportId: number, format: 'XLSX' | 'DOCX', body: Buffer): Promise<string> {
    const ext = format.toLowerCase();
    const contentType =
      format === 'XLSX'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const key = `reports/${reportId}.${ext}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  }

  /**
   * 刪除物件。
   * S3 的刪除是冪等的 —— 刪不存在的 key 不會報錯，所以重試很安全。
   */
  public async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** 通用上傳：呼叫端自己決定 key，讓不同領域有各自的命名規則 */
  public async putObject(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
    return key;
  }

  /** 產生短效讀取網址 */
  public async signGetUrl(key: string, expiresInSec = 300): Promise<string> {
    // 用對外位址簽：這個網址是要交給瀏覽器的，而瀏覽器解不到容器主機名
    return await getSignedUrl(this.signClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSec });
  }
}
