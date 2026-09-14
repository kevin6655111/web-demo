import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseEncodeModule } from '@/case-encode/case-encode.module';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Company } from './entities/company.entity';
import { CompanyGrant } from './entities/company-grant.entity';
import { Department } from './entities/department.entity';
import { PasswordHistory } from './entities/password-history.entity';
import { UserActionOverride } from './entities/user-action-override.entity';
import { ApiKey } from './entities/api-key.entity';
import { CompanyTreeController } from './company-tree.controller';
import { CompanyTreeService } from './company-tree.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ApiKeyService } from './api-key.service';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

@Module({
  imports: [
    CaseEncodeModule,
    TypeOrmModule.forFeature([User, Role, Company, CompanyGrant, Department, PasswordHistory, UserActionOverride, ApiKey])
  ],
  controllers: [AuthController, RoleController, CompanyTreeController],
  providers: [AuthService, RoleService, CompanyTreeService, ApiKeyService],
  exports: [AuthService, ApiKeyService]
})
export class AuthModule {}
