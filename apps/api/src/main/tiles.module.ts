import { Module } from '@nestjs/common';
import { EnvModule } from '@/env/env.module';
import { UtilModule } from '@/util/util.module';
import { RedisModule } from '@/redis/redis.module';
import { SecurityModule } from '@/security/security.module';
import { DatabaseModule } from '@/database.module';
import { HttpModule } from '@/http/http.module';
import { TilesModule as TilesFeatureModule } from '@/tiles/tiles.module';

/**
 * tiles 行程：只服務圖層。
 *
 * 為什麼值得自己一個容器：一次全市圖層是幾 MB 的 JSON，
 * 序列化時會把 event loop 佔住 —— 混在 api 行程裡，登入請求會跟著卡。
 * 拆開之後圖層再慢也只慢它自己，而且可以獨立擴充或限流。
 */
@Module({
  imports: [EnvModule, UtilModule, RedisModule, SecurityModule, DatabaseModule, HttpModule, TilesFeatureModule]
})
export class TilesAppModule {}
