import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { Vehicle } from '@/fleet/entities/vehicle.entity';
import { VehicleCommService } from './vehicle-comm.service';
import type { EcuSnapshot } from './vehicle-comm.type';
import { SimulateDeviceDto } from './vehicle-comm.dto';

/** 模擬器每幾秒更新一次狀態 */
const TICK_MS = 3_000;

/**
 * 車機模擬器。
 *
 * Demo 沒有真的車機，但「車機通訊」這個功能沒有東西可看就等於不存在 ——
 * 一個永遠顯示「0 台連線」的看板，示範不出它解決了什麼問題。
 *
 * 模擬器**不建立真的 WebSocket 連線**，而是直接寫入車機的狀態快取：
 * 繞過連線那一層是刻意的 —— 要示範的是「看板上看得到車子的狀態變化」，
 * 而不是「WebSocket 能不能連」。後者由真的車機或整合測試負責。
 *
 * 這個取捨的代價：模擬出來的車機 `CONTROLLABLE` 是 false，下不了指令。
 * 那是誠實的 —— 沒有連線就真的下不了指令，假裝可以只會誤導。
 */
@Injectable()
export class DeviceSimulatorService {
  private readonly logger = new Logger('DeviceSim');

  /** 進行中的模擬：deviceId → timer。同一台重複啟動時先停掉舊的 */
  private readonly running = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    private readonly vehicleCommService: VehicleCommService
  ) {}

  public async start(dto: SimulateDeviceDto, companyId: number): Promise<HttpResult> {
    const vehicle = await this.vehicleRepo.findOne({ where: { deviceId: dto.DEVICE_ID, company: { id: companyId } } });
    if (!vehicle) {
      return HttpResponse.warn({ message: `找不到車機：${dto.DEVICE_ID}`, code: 404 });
    }

    this.stopTimer(dto.DEVICE_ID);

    const duration = (dto.DURATION_SEC ?? 60) * 1000;
    const endAt = Date.now() + duration;
    const startedAt = Date.now();

    // 先寫一筆，讓看板立刻有東西可看 —— 等第一個 tick 要三秒
    await this.tick(companyId, dto, vehicle.id, vehicle.plateNo, startedAt);

    const timer = setInterval(() => {
      if (Date.now() >= endAt) {
        this.stopTimer(dto.DEVICE_ID);
        void this.vehicleCommService.detach(dto.DEVICE_ID, companyId);
        this.logger.log(`🎬 ${dto.DEVICE_ID} 模擬結束`);
        return;
      }

      void this.tick(companyId, dto, vehicle.id, vehicle.plateNo, startedAt);
    }, TICK_MS);

    // unref：模擬器不該讓行程關不掉 —— 部署時 shutdown hook 等著它跑完就卡住了
    timer.unref?.();
    this.running.set(dto.DEVICE_ID, timer);

    this.logger.log(`🎬 ${dto.DEVICE_ID} 開始模擬 ${dto.DURATION_SEC ?? 60} 秒`);

    return HttpResponse.success({
      message: `已開始模擬車機 ${dto.DEVICE_ID}，將持續 ${dto.DURATION_SEC ?? 60} 秒`,
      data: { DEVICE_ID: dto.DEVICE_ID, PLATE_NO: vehicle.plateNo, DURATION_SEC: dto.DURATION_SEC ?? 60 }
    });
  }

  public stop(deviceId: string, companyId: number): HttpResult {
    const stopped = this.stopTimer(deviceId);
    void this.vehicleCommService.detach(deviceId, companyId);

    return HttpResponse.success({ message: stopped ? `已停止模擬 ${deviceId}` : `${deviceId} 沒有進行中的模擬` });
  }

  private stopTimer(deviceId: string): boolean {
    const timer = this.running.get(deviceId);
    if (!timer) return false;

    clearInterval(timer);
    this.running.delete(deviceId);
    return true;
  }

  /**
   * 一次狀態更新。
   *
   * 數值走的是**可預期的曲線**而不是純亂數：電壓隨怠速緩降、轉速在區間內擺盪、
   * 里程單調遞增。純亂數的資料看起來像壞掉的感測器，示範不出「這個數字有意義」。
   */
  private async tick(
    companyId: number,
    dto: SimulateDeviceDto,
    vehicleId: number,
    plateNo: string,
    startedAt: number
  ): Promise<void> {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const phase = Math.sin(elapsedSec / 12);

    const ecu: EcuSnapshot = {
      // 電壓隨引擎負載擺盪；低於 12V 代表熄火或電瓶老化
      voltageV: Number((13.6 + phase * 0.5).toFixed(2)),
      rpm: Math.round(900 + Math.max(0, phase) * 1600),
      odometerKm: Number((12000 + elapsedSec * 0.012).toFixed(2)),
      coolantC: Math.round(82 + phase * 6),
      fuelPercent: Math.max(5, Math.round(68 - elapsedSec / 120)),
      faultCodes: dto.FAULT_CODE ? [dto.FAULT_CODE] : []
    };

    const session = await this.vehicleCommService.getSession(companyId, dto.DEVICE_ID);

    await this.vehicleCommService.touch(dto.DEVICE_ID, companyId, { ecu });

    // 沒有既有狀態表示是第一次：把整包寫進去
    if (!session) {
      await this.vehicleCommService.attachSimulated({
        deviceId: dto.DEVICE_ID,
        vehicleId,
        plateNo,
        companyId,
        streamState: dto.STREAM ? 'STREAMING' : 'IDLE',
        ecu
      });
      return;
    }

    if (dto.STREAM) {
      // 串流中的車機會持續送幀；幀數不動代表串流卡住了
      await this.vehicleCommService.countFrame(dto.DEVICE_ID, companyId);
    }
  }
}
