import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { RedisService } from '@/redis/redis.service';
import { Vehicle, type VehicleState, type VehicleType } from './entities/vehicle.entity';
import { VehicleTrack } from './entities/vehicle-track.entity';
import type { AuthUser } from '@app-types/user-auth.type';
import { AddTrackDto, TrackQueryDto, TrackStatsQueryDto, UpsertVehicleDto, VehicleQueryDto } from './fleet.dto';

/** 超過這個時間沒回報就視為離線 */
const OFFLINE_AFTER_MS = 5 * 60_000;

@Injectable()
export class FleetService {
  private readonly logger = new Logger('Fleet');

  constructor(
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(VehicleTrack) private readonly trackRepo: Repository<VehicleTrack>,
    private readonly redisService: RedisService
  ) {}

  // ─── 車隊 ──────────────────────────────────────────────────────

  /**
   * 車輛清單。
   * 「在線」不看資料庫欄位而是看最後回報時間 ——
   * 車機是被拔電斷線的，沒有人會幫它把狀態改成離線。
   */
  public async listVehicles(dto: VehicleQueryDto, companyId: number): Promise<HttpResult> {
    const qb = this.vehicleRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.driver', 'd')
      .leftJoinAndSelect('v.project', 'p')
      .where('v.company_id = :companyId', { companyId })
      .orderBy('v.plate_no', 'ASC');

    if (dto.PLATE_NO) qb.andWhere('v.plate_no ILIKE :plate', { plate: `%${dto.PLATE_NO}%` });
    if (dto.VEHICLE_TYPE?.length) qb.andWhere('v.vehicle_type IN (:...types)', { types: dto.VEHICLE_TYPE });
    if (dto.STATE?.length) qb.andWhere('v.state IN (:...states)', { states: dto.STATE });
    if (dto.PROJECT_ID) qb.andWhere('v.project_id = :projectId', { projectId: dto.PROJECT_ID });
    if (dto.ONLINE_ONLY) qb.andWhere("v.last_report_at > now() - interval '5 minutes'");

    const rows = await qb.getMany();
    const now = Date.now();

    return HttpResponse.successOrWarn({
      data: rows.map((v) => {
        const lastAt = v.lastReportAt ? new Date(v.lastReportAt).getTime() : 0;
        const online = lastAt > 0 && now - lastAt < OFFLINE_AFTER_MS;

        return {
          ID: v.id,
          PLATE_NO: v.plateNo,
          NAME: v.name ?? null,
          VEHICLE_TYPE: v.vehicleType,
          STATE: v.state === 'DISABLED' ? 'DISABLED' : online ? 'ONLINE' : 'OFFLINE',
          DEVICE_ID: v.deviceId ?? null,
          DRIVER: v.driver?.name ?? null,
          DRIVER_ID: v.driver?.id ?? null,
          PROJECT: v.project?.prjId ?? null,
          PROJECT_ID: v.project?.id ?? null,
          LNG: v.lastLng ?? null,
          LAT: v.lastLat ?? null,
          LAST_REPORT_AT: v.lastReportAt ?? null,
          SILENT_MIN: lastAt ? Math.floor((now - lastAt) / 60000) : null,
          TODAY_KM: Number(v.todayKm),
          REMARK: v.remark ?? null
        };
      })
    });
  }

  /** 新增或更新車輛 */
  public async upsertVehicle(dto: UpsertVehicleDto, companyId: number): Promise<HttpResult> {
    const duplicate = await this.vehicleRepo
      .createQueryBuilder('v')
      .where('v.company_id = :companyId', { companyId })
      .andWhere('v.plate_no = :plate', { plate: dto.PLATE_NO })
      .andWhere(dto.ID ? 'v.id != :id' : '1=1', dto.ID ? { id: dto.ID } : {})
      .getOne();

    if (duplicate) throw new ConflictException(`車牌已存在：${dto.PLATE_NO}`);

    const payload = {
      company: { id: companyId },
      plateNo: dto.PLATE_NO,
      name: dto.NAME,
      vehicleType: dto.VEHICLE_TYPE as VehicleType,
      deviceId: dto.DEVICE_ID,
      driver: dto.DRIVER_ID ? { id: dto.DRIVER_ID } : undefined,
      project: dto.PROJECT_ID ? { id: dto.PROJECT_ID } : undefined,
      state: (dto.STATE ?? 'OFFLINE') as VehicleState,
      remark: dto.REMARK
    };

    if (dto.ID) {
      const result = await this.vehicleRepo.update({ id: dto.ID, company: { id: companyId } }, payload);
      if (!result.affected) throw new NotFoundException(`找不到車輛：${dto.ID}`);

      return HttpResponse.success({ message: '車輛已更新', data: { ID: dto.ID } });
    }

    const saved = await this.vehicleRepo.save(this.vehicleRepo.create(payload));
    return HttpResponse.success({ message: '車輛已建立', data: { ID: saved.id } });
  }

  // ─── 軌跡 ──────────────────────────────────────────────────────

  /**
   * 車機上傳軌跡點。
   *
   * 這是全系統最高頻的寫入(每台車每 5 秒一筆)，所以刻意做得很薄：
   * 不查關聯、不算距離、不推播 —— 只寫一筆點，並更新車輛的最後位置。
   * 統計與清理都交給排程。
   */
  public async addTrack(dto: AddTrackDto, companyId: number): Promise<HttpResult> {
    const vehicle = await this.vehicleRepo.findOne({
      where: { deviceId: dto.DEVICE_ID, company: { id: companyId } },
      relations: { project: true }
    });
    if (!vehicle) throw new NotFoundException(`找不到車機：${dto.DEVICE_ID}`);

    await this.trackRepo.save(
      this.trackRepo.create({
        company: { id: companyId },
        vehicle: { id: vehicle.id },
        project: vehicle.project ? { id: vehicle.project.id } : undefined,
        geom: { type: 'Point', coordinates: [dto.LNG, dto.LAT] },
        speedKph: dto.SPEED_KPH ?? 0,
        heading: dto.HEADING,
        gpsHdop: dto.GPS_HDOP,
        altitude: dto.ALTITUDE,
        isTripStart: dto.IS_TRIP_START ?? false,
        recordedAt: new Date(dto.RECORDED_AT)
      })
    );

    await this.vehicleRepo.update(
      { id: vehicle.id },
      { lastLng: dto.LNG, lastLat: dto.LAT, lastReportAt: new Date(dto.RECORDED_AT), state: 'ONLINE' }
    );

    // 即時位置另外放 Redis：看板要的是「現在在哪」，不該為此掃描軌跡表
    await this.redisService.setJson(
      `fleet:${companyId}:v${vehicle.id}`,
      {
        uid: -vehicle.id, // 負數代表車輛而非人員，讓看板能區分
        name: vehicle.plateNo,
        lng: dto.LNG,
        lat: dto.LAT,
        speedKph: dto.SPEED_KPH ?? 0,
        heading: dto.HEADING,
        at: Date.now()
      },
      2 * 60_000
    );

    return HttpResponse.success({ message: '已接收' });
  }

  /**
   * 查詢軌跡。
   *
   * 兩個限制是必要的：HDOP 過濾掉飄移的點(不然畫出來像鬼畫符)，
   * 以及等距抽樣 —— 一天的軌跡有十萬點，瀏覽器畫不動，
   * 而人眼在地圖上也分不出三千點與十萬點的差別。
   */
  public async getTrack(dto: TrackQueryDto, companyId: number): Promise<HttpResult> {
    const params = {
      companyId,
      vehicleId: dto.VEHICLE_ID,
      start: new Date(dto.DATE_START),
      end: new Date(dto.DATE_END),
      maxHdop: dto.MAX_HDOP ?? 5,
      maxPoints: dto.MAX_POINTS ?? 3000
    };

    const total = await this.trackRepo
      .createQueryBuilder('t')
      .where('t.company_id = :companyId', params)
      .andWhere('t.vehicle_id = :vehicleId', params)
      .andWhere('t.recorded_at BETWEEN :start AND :end', params)
      .andWhere('(t.gps_hdop IS NULL OR t.gps_hdop <= :maxHdop)', params)
      .getCount();

    // 等距抽樣用 row_number 取模，比 random() 穩定：同樣的查詢得到同樣的結果
    const step = Math.max(1, Math.ceil(total / params.maxPoints));

    const rows = await this.trackRepo.query(
      `
      SELECT lng, lat, speed_kph AS "speedKph", heading, recorded_at AS "recordedAt", is_trip_start AS "isTripStart"
        FROM (
          SELECT ST_X(t.geom::geometry) AS lng,
                 ST_Y(t.geom::geometry) AS lat,
                 t.speed_kph, t.heading, t.recorded_at, t.is_trip_start,
                 ROW_NUMBER() OVER (ORDER BY t.recorded_at) AS rn
            FROM vehicle_tracks t
           WHERE t.company_id = $1
             AND t.vehicle_id = $2
             AND t.recorded_at BETWEEN $3 AND $4
             AND (t.gps_hdop IS NULL OR t.gps_hdop <= $5)
        ) s
       WHERE rn %% $6 = 0 OR is_trip_start
       ORDER BY recorded_at
      `.replace('%%', '%'),
      [companyId, params.vehicleId, params.start, params.end, params.maxHdop, step]
    );

    // 距離用 PostGIS 算，不在 Node 端做 haversine
    const summary = await this.trackRepo.query(
      `
      SELECT COALESCE(ST_Length(ST_MakeLine(t.geom::geometry ORDER BY t.recorded_at)::geography) / 1000, 0) AS "distanceKm",
             COALESCE(MAX(t.speed_kph), 0) AS "maxSpeed",
             COALESCE(AVG(NULLIF(t.speed_kph, 0)), 0) AS "avgSpeed",
             MIN(t.recorded_at) AS "startAt",
             MAX(t.recorded_at) AS "endAt"
        FROM vehicle_tracks t
       WHERE t.company_id = $1 AND t.vehicle_id = $2
         AND t.recorded_at BETWEEN $3 AND $4
         AND (t.gps_hdop IS NULL OR t.gps_hdop <= $5)
      `,
      [companyId, params.vehicleId, params.start, params.end, params.maxHdop]
    );

    const s = summary?.[0] ?? {};

    return HttpResponse.successOrWarn({
      data: {
        TOTAL_POINTS: total,
        SAMPLED: rows.length,
        SAMPLE_STEP: step,
        DISTANCE_KM: Number(Number(s.distanceKm ?? 0).toFixed(2)),
        MAX_SPEED: Number(Number(s.maxSpeed ?? 0).toFixed(1)),
        AVG_SPEED: Number(Number(s.avgSpeed ?? 0).toFixed(1)),
        START_AT: s.startAt ?? null,
        END_AT: s.endAt ?? null,
        POINTS: rows
      },
      isEmpty: (v) => !v?.POINTS?.length,
      warnMsg: '此區間沒有軌跡資料'
    });
  }

  /** 軌跡統計：每台車每天跑多少 */
  public async getTrackStats(dto: TrackStatsQueryDto, companyId: number): Promise<HttpResult> {
    const rows = await this.trackRepo.query(
      `
      SELECT v.plate_no AS "plateNo",
             to_char(date_trunc('day', t.recorded_at), 'YYYY-MM-DD') AS "day",
             COUNT(*)::int AS "points",
             ROUND((ST_Length(ST_MakeLine(t.geom::geometry ORDER BY t.recorded_at)::geography) / 1000)::numeric, 2)::float8 AS "distanceKm"
        FROM vehicle_tracks t
        JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.company_id = $1
         AND t.recorded_at BETWEEN $2 AND $3
         AND ($4::int IS NULL OR t.vehicle_id = $4)
       GROUP BY v.plate_no, date_trunc('day', t.recorded_at)
       ORDER BY "day" DESC, "plateNo"
      `,
      [companyId, new Date(dto.DATE_START), new Date(`${dto.DATE_END}T23:59:59.999`), dto.VEHICLE_ID ?? null]
    );

    return HttpResponse.successOrWarn({ data: rows });
  }
}
