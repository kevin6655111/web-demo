import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvModule } from '@/env/env.module';
import { DatabaseModule, ALL_ENTITIES } from '@/database.module';
import { OrgstructModule } from '@/orgstruct/orgstruct.module';
import { StorageModule } from '@/storage/storage.module';

/**
 * 只給 seed 腳本用的最小模組。
 * forFeature 直接吃 ALL_ENTITIES：seed 幾乎每張表都會寫，逐一列出只會忘記加。
 */
@Module({
  imports: [EnvModule, DatabaseModule, OrgstructModule, StorageModule, TypeOrmModule.forFeature(ALL_ENTITIES)]
})
export class SeedModule {}
