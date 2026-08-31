import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { VehicleTrack } from './entities/vehicle-track.entity';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle, VehicleTrack])],
  controllers: [FleetController],
  providers: [FleetService],
  exports: [FleetService]
})
export class FleetModule {}
