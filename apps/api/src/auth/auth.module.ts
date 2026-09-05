import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Company } from './entities/company.entity';
import { CompanyGrant } from './entities/company-grant.entity';
import { CompanyTreeController } from './company-tree.controller';
import { CompanyTreeService } from './company-tree.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Company, CompanyGrant])],
  controllers: [AuthController, RoleController, CompanyTreeController],
  providers: [AuthService, RoleService, CompanyTreeService],
  exports: [AuthService]
})
export class AuthModule {}
