import { Global, Module } from '@nestjs/common';
import { AuthTokenService } from './auth-token.service';
import { LogRecorderService } from './log-recorder.service';

@Global()
@Module({
  providers: [AuthTokenService, LogRecorderService],
  exports: [AuthTokenService, LogRecorderService]
})
export class UtilModule {}
