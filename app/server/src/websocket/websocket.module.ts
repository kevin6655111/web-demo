import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseMessage } from './entities/case-message.entity';
import { CaseGateway } from './case.gateway';
import { CaseEventsController } from './case-events.controller';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [TypeOrmModule.forFeature([CaseMessage])],
  controllers: [CaseEventsController, RealtimeController],
  providers: [CaseGateway, RealtimeService],
  exports: [CaseGateway, RealtimeService]
})
export class WebsocketModule {}
