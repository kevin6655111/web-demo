import '@/env.bootstrap';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SeedModule } from './seed.module';
import { Company } from '@entities/company.entity';
import { CompanyGrant } from '@/auth/entities/company-grant.entity';
import { Role } from '@entities/role.entity';
import { User } from '@entities/user.entity';
import { PatrolCase } from '@entities/patrol-case.entity';
import { PatrolCaseAddress } from '@/case-patrol/entities/patrol-case-address.entity';
import { PatrolCaseStatus } from '@/case-patrol/entities/patrol-case-status.entity';
import { Project } from '@/project/entities/project.entity';
import { CompanyProject } from '@/project/entities/company-project.entity';
import { ProjectVehicle } from '@/project/entities/project-vehicle.entity';
import { ProjectSection } from '@/project/entities/project-section.entity';
import { Section } from '@/project/entities/section.entity';
import { SectionArea } from '@/project/entities/section-area.entity';
import { Area } from '@/project/entities/area.entity';
import { WorkOrder } from '@/work-order/entities/work-order.entity';
import { WorkOrderStatus } from '@/work-order/entities/work-order-status.entity';
import { WorkOrderImage } from '@/work-order/entities/work-order-image.entity';
import { WorkOrderImprovement } from '@/work-order/entities/work-order-improvement.entity';
import { WorkOrderUser } from '@/work-order/entities/work-order-user.entity';
import { Maintenance } from '@/maintenance/entities/maintenance.entity';
import { MaintenanceStatus } from '@/maintenance/entities/maintenance-status.entity';
import { MaintenanceRepair } from '@/maintenance/entities/maintenance-repair.entity';
import { MaintenanceImage } from '@/maintenance/entities/maintenance-image.entity';
import { CaseHistory } from '@/case-history/entities/case-history.entity';
import {
  CRACK_TYPE_DEF,
  DEGREE_DEF,
  IMAGE_TYPE_DEF,
  MAINTENANCE_REQUIRED_IMAGES,
  MATERIAL_DEF,
  REQUIRED_IMAGES,
  WORK_UNIT_DEF
} from '@road-patrol/shared';
import { Vehicle, VEHICLE_TYPE } from '@/fleet/entities/vehicle.entity';
import { VehicleTrack } from '@/fleet/entities/vehicle-track.entity';
import { RoadSegment } from '@/road-eval/entities/road-segment.entity';
import { PatrolPlan } from '@/patrol-setting/entities/patrol-plan.entity';
import { SurveyOrder } from '@/survey/entities/survey-order.entity';
import { SurveyCase } from '@/survey/entities/survey-case.entity';
import { OrgstructService } from '@/orgstruct/orgstruct.service';
import { pciToLevel } from '@/road-eval/road-eval.service';
import { ACTION, ACTION_KEYS, ROLE_PRESET } from '@constants/module.const';

/**
 * 建立示範資料。
 *
 * 整支腳本可重複執行：先查再寫，已存在就跳過。
 * 亂數用固定種子，每次跑出來的案件分布都一樣 —— 截圖與測試才有比較基準。
 *
 * 資料刻意做出「不完美」的樣子：有逾期的派工、有退回重做的案件、
 * 有還沒補到路名的新案 —— 全部都完美的示範資料看不出系統在處理什麼問題。
 */

/**
 * 資料量。
 *
 * 預設就給到「聚合與熱區看得出差異」的量級 —— 兩百筆案件在地圖上是散點，
 * 看不出這個系統為什麼需要聚合圖層。
 * 要更大的資料集(壓測、示範效能)時用 SEED_SCALE 放大。
 */
const SCALE = Number(process.env.SEED_SCALE ?? 1);
const CASE_COUNT = Math.round(1800 * SCALE);
const DAYS_BACK = 90;
const TRACK_DAYS = 5;
const SEGMENT_COUNT = Math.round(36 * SCALE);

/** 固定種子的線性同餘亂數 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

(async () => {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['warn', 'error'] });

  const companyRepo = app.get<Repository<Company>>(getRepositoryToken(Company));
  const grantRepo = app.get<Repository<CompanyGrant>>(getRepositoryToken(CompanyGrant));
  const roleRepo = app.get<Repository<Role>>(getRepositoryToken(Role));
  const userRepo = app.get<Repository<User>>(getRepositoryToken(User));
  const caseRepo = app.get<Repository<PatrolCase>>(getRepositoryToken(PatrolCase));
  const addressRepo = app.get<Repository<PatrolCaseAddress>>(getRepositoryToken(PatrolCaseAddress));
  const caseStatusRepo = app.get<Repository<PatrolCaseStatus>>(getRepositoryToken(PatrolCaseStatus));
  const projectRepo = app.get<Repository<Project>>(getRepositoryToken(Project));
  const companyProjectRepo = app.get<Repository<CompanyProject>>(getRepositoryToken(CompanyProject));
  const projectVehicleRepo = app.get<Repository<ProjectVehicle>>(getRepositoryToken(ProjectVehicle));
  const projectSectionRepo = app.get<Repository<ProjectSection>>(getRepositoryToken(ProjectSection));
  const sectionRepo = app.get<Repository<Section>>(getRepositoryToken(Section));
  const sectionAreaRepo = app.get<Repository<SectionArea>>(getRepositoryToken(SectionArea));
  const areaRepo = app.get<Repository<Area>>(getRepositoryToken(Area));
  const workOrderRepo = app.get<Repository<WorkOrder>>(getRepositoryToken(WorkOrder));
  const orderStatusRepo = app.get<Repository<WorkOrderStatus>>(getRepositoryToken(WorkOrderStatus));
  const orderImageRepo = app.get<Repository<WorkOrderImage>>(getRepositoryToken(WorkOrderImage));
  const improvementRepo = app.get<Repository<WorkOrderImprovement>>(getRepositoryToken(WorkOrderImprovement));
  const orderUserRepo = app.get<Repository<WorkOrderUser>>(getRepositoryToken(WorkOrderUser));
  const maintenanceRepo = app.get<Repository<Maintenance>>(getRepositoryToken(Maintenance));
  const maintenanceStatusRepo = app.get<Repository<MaintenanceStatus>>(getRepositoryToken(MaintenanceStatus));
  const maintenanceRepairRepo = app.get<Repository<MaintenanceRepair>>(getRepositoryToken(MaintenanceRepair));
  const maintenanceImageRepo = app.get<Repository<MaintenanceImage>>(getRepositoryToken(MaintenanceImage));
  const historyRepo = app.get<Repository<CaseHistory>>(getRepositoryToken(CaseHistory));
  const vehicleRepo = app.get<Repository<Vehicle>>(getRepositoryToken(Vehicle));
  const trackRepo = app.get<Repository<VehicleTrack>>(getRepositoryToken(VehicleTrack));
  const segmentRepo = app.get<Repository<RoadSegment>>(getRepositoryToken(RoadSegment));
  const planRepo = app.get<Repository<PatrolPlan>>(getRepositoryToken(PatrolPlan));
  const surveyOrderRepo = app.get<Repository<SurveyOrder>>(getRepositoryToken(SurveyOrder));
  const surveyCaseRepo = app.get<Repository<SurveyCase>>(getRepositoryToken(SurveyCase));

  // 導覽定義同步進資料庫；側邊欄從這裡長出來
  await app.get(OrgstructService).sync();

  const random = makeRandom(20260828);
  const now = Date.now();

  // ─── 公司三層：平台 → 廠商 → 外包 ───────────────────────────────

  /** 建或補一間公司；已存在就把層級與上層補上，讓舊環境也能升級到三層 */
  const upsertCompany = async (def: {
    code: string;
    name: string;
    tier: number;
    parent?: Company | null;
    userLimit: number;
    description: string;
  }) => {
    const existing = await companyRepo.findOneBy({ code: def.code });

    if (existing) {
      await companyRepo.update(existing.id, {
        name: def.name,
        tier: def.tier as never,
        parent: def.parent ? ({ id: def.parent.id } as never) : null,
        userLimit: def.userLimit,
        description: def.description,
        isActive: true
      });

      return await companyRepo.findOneByOrFail({ id: existing.id });
    }

    return await companyRepo.save(
      companyRepo.create({
        code: def.code,
        name: def.name,
        tier: def.tier as never,
        parent: def.parent ?? null,
        userLimit: def.userLimit,
        description: def.description,
        isActive: true
      })
    );
  };

  const platform = await upsertCompany({
    code: 'ROOT',
    name: '系統營運方',
    tier: 1,
    parent: null,
    userLimit: 5,
    description: '開通廠商單位的模組與人員額度；廠商看不到這一層'
  });

  // DEMO 是示範用的廠商單位，也是絕大多數示範資料的歸屬
  const company = await upsertCompany({
    code: 'DEMO',
    name: '示範工程公司',
    tier: 2,
    parent: platform,
    userLimit: 50,
    description: '承攬市區道路巡查標案'
  });

  const subCompany = await upsertCompany({
    code: 'SUB01',
    name: '示範外包工程行',
    tier: 3,
    parent: company,
    userLimit: 10,
    description: '負責西屯區道路修繕施工'
  });

  // ─── 授權開通 ───────────────────────────────────────────────────
  //
  // 平台開通給廠商的是完整功能；廠商再開一小部分給外包 ——
  // 外包只需要「看得到要修什麼、能回報進度」，不需要派工也不需要驗收。
  // 這也是示範重點：外包的角色就算給了 WORK_ORDER.CREATE，
  // 登入時仍會被公司開通清單擋掉。
  const CONTRACTOR_GRANTS = [...ACTION_KEYS];
  const SUB_GRANTS = [
    ACTION.CASE.READ,
    ACTION.WORK_ORDER.READ,
    ACTION.WORK_ORDER.UPDATE,
    ACTION.DASHBOARD.READ,
    ACTION.FLEET.READ,
    ACTION.TRACK.CREATE,
    ACTION.SUPPORT.AGENT
  ];

  const syncGrants = async (target: Company, grantedBy: Company, actions: string[]) => {
    for (const actionKey of actions) {
      const existing = await grantRepo.findOne({ where: { company: { id: target.id }, actionKey } });

      if (existing) await grantRepo.update(existing.id, { isActive: true, grantedByCompany: { id: grantedBy.id } as never });
      else
        await grantRepo.save(
          grantRepo.create({ company: { id: target.id }, actionKey, isActive: true, grantedByCompany: { id: grantedBy.id } as never })
        );
    }

    // 不在清單上的一律停用（而不是刪除）：seed 的意義是「把環境帶到宣告的狀態」
    await grantRepo
      .createQueryBuilder()
      .update()
      .set({ isActive: false })
      .where('company_id = :id', { id: target.id })
      .andWhere('action_key NOT IN (:...actions)', { actions })
      .execute();
  };

  await syncGrants(company, platform, CONTRACTOR_GRANTS);
  await syncGrants(subCompany, company, SUB_GRANTS);

  // ─── 角色 ───────────────────────────────────────────────────────

  for (const [key, preset] of Object.entries(ROLE_PRESET)) {
    const existing = await roleRepo.findOneBy({ key });
    if (existing) await roleRepo.update(existing.id, { name: preset.name, actions: [...preset.actions] });
    else await roleRepo.save(roleRepo.create({ key, name: preset.name, actions: [...preset.actions] }));
  }

  const roles = Object.fromEntries((await roleRepo.find()).map((r) => [r.key, r]));

  // ─── 帳號(密碼一律 Demo1234，僅示範用) ──────────────────────────

  const accounts = [
    // 平台層：只做開通，不碰案件
    { account: 'root', name: '平台管理員', role: 'ADMIN', company: platform },
    // 廠商層：示範資料的主要歸屬
    { account: 'admin', name: '示範管理員', role: 'ADMIN', company },
    { account: 'inspector', name: '示範巡查員', role: 'INSPECTOR', company },
    { account: 'worker1', name: '林師傅', role: 'WORKER', company },
    { account: 'worker2', name: '陳師傅', role: 'WORKER', company },
    { account: 'viewer', name: '示範檢視者', role: 'VIEWER', company },
    // 外包層：角色是「管理員」(全權限)，但公司只被開通七項 ——
    // 登入後拿到的是交集，示範「角色設計不出上層沒開通的功能」
    { account: 'suboffice', name: '外包負責人', role: 'ADMIN', company: subCompany },
    { account: 'subworker', name: '黃師傅', role: 'WORKER', company: subCompany }
  ];

  for (const a of accounts) {
    const password = await bcrypt.hash('Demo1234', 10);
    const existing = await userRepo.findOne({ where: { account: a.account, company: { id: a.company.id } } });

    // 已存在也要更新角色與密碼：seed 的意義是「把環境帶到宣告的狀態」，
    // 只做 insert 的話，改過預設密碼之後舊環境會停在對不上的狀態
    if (existing) {
      await userRepo.update(existing.id, { name: a.name, role: roles[a.role], password, active: true });
      continue;
    }

    await userRepo.save(
      userRepo.create({ company: a.company, role: roles[a.role], account: a.account, name: a.name, password, active: true })
    );
  }

  const inspector = await userRepo.findOneByOrFail({ account: 'inspector', company: { id: company.id } });
  const admin = await userRepo.findOneByOrFail({ account: 'admin', company: { id: company.id } });
  const workers = await userRepo.find({ where: [{ account: 'worker1' }, { account: 'worker2' }] });

  // ─── 標案與關聯 ─────────────────────────────────────────────────

  const projectDefs = [
    {
      prjId: 'DEMO01',
      prjNo: '1150101-001',
      prjName: '115 年度市區道路巡查',
      prjMain: '115 年度市區道路巡查維護暨即時通報系統委外服務案',
      prjSub: '第一標',
      state: 'ACTIVE' as const,
      budget: '12000000',
      roadKm: '320.50',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    },
    {
      prjId: 'DEMO02',
      prjNo: '1140301-007',
      prjName: '114 年度快速道路巡查',
      prjMain: '114 年度快速道路巡查維護委外服務案',
      state: 'CLOSED' as const,
      budget: '8600000',
      roadKm: '145.00',
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    }
  ];

  for (const d of projectDefs) {
    let project = await projectRepo.findOneBy({ prjId: d.prjId });

    if (!project) {
      project = await projectRepo.save(
        projectRepo.create({
          prjId: d.prjId,
          prjNo: d.prjNo,
          prjName: d.prjName,
          prjMain: d.prjMain,
          prjSub: d.prjSub,
          proprietor: '示範市政府建設局',
          proprietorLevel: 2,
          state: d.state,
          startDate: d.startDate,
          endDate: d.endDate,
          budget: d.budget,
          roadKm: d.roadKm
        })
      );
    }

    // 公司與標案是關聯表而不是標案上的欄位：一個標案常由主辦與協力廠商共同執行
    if (!(await companyProjectRepo.exists({ where: { company: { id: company.id }, project: { id: project.id } } }))) {
      await companyProjectRepo.save(companyProjectRepo.create({ company, project, role: 'MAIN', isActive: true }));
    }
  }

  const activeProject = await projectRepo.findOneByOrFail({ prjId: 'DEMO01' });

  // ─── 工務段與轄區 ───────────────────────────────────────────────

  const DISTRICTS = ['西屯區', '北屯區', '南屯區', '中區', '西區'];

  for (const district of DISTRICTS) {
    if (!(await areaRepo.exists({ where: { county: '示範市', district } }))) {
      await areaRepo.save(areaRepo.create({ county: '示範市', district }));
    }
  }

  const areas = await areaRepo.find({ where: { county: '示範市' } });

  const sectionDefs = [
    { key: 'S1', name: '第一工務段', districts: ['西屯區', '南屯區'] },
    { key: 'S2', name: '第二工務段', districts: ['北屯區', '中區', '西區'] }
  ];

  for (const d of sectionDefs) {
    let section = await sectionRepo.findOne({ where: { key: d.key, company: { id: company.id } } });
    if (!section) section = await sectionRepo.save(sectionRepo.create({ company, key: d.key, name: d.name }));

    let ps = await projectSectionRepo.findOne({ where: { project: { id: activeProject.id }, section: { id: section.id } } });
    if (!ps) ps = await projectSectionRepo.save(projectSectionRepo.create({ project: activeProject, section, isActive: true }));

    // 轄區掛在「標案-工務段」之下：同一個工務段在不同標案負責的行政區可以不同
    for (const name of d.districts) {
      const area = areas.find((a) => a.district === name);
      if (!area) continue;

      if (!(await sectionAreaRepo.exists({ where: { projectSection: { id: ps.id }, area: { id: area.id } } }))) {
        await sectionAreaRepo.save(sectionAreaRepo.create({ projectSection: ps, area, isActive: true }));
      }
    }
  }

  // ─── 案件（主表 / 地址 / 狀態）──────────────────────────────────

  const baseLng = 120.6478;
  const baseLat = 24.1636;
  const roads = ['中山路一段', '民生路二段', '建國路三段', '文心路四段', '中港路一段', '成功路二段'];
  const CAVLGES = ['何厝里', '大鵬里', '光明里', '永安里', '福安里'];

  // 五個熱區中心：真實的破壞不是均勻散佈的，而是集中在幾條主幹道與路口。
  // 均勻亂數產生的資料會讓聚合與熱區圖層看起來毫無意義。
  const hotspots = Array.from({ length: 5 }, (_, i) => ({
    lng: baseLng + (i - 2) * 0.012 + (random() - 0.5) * 0.006,
    lat: baseLat + (i % 2 === 0 ? 1 : -1) * 0.008 + (random() - 0.5) * 0.006,
    weight: 0.5 + random()
  }));

  /** 一批待寫入的案件，連同它要配的地址與狀態 */
  type PendingCase = {
    entity: PatrolCase;
    address?: { county: string; district: string; cavlge: string; road: string; houseNumber: string };
    status: { status: number; edited: number; needRepair: number };
  };

  let createdCases = 0;
  const pending: PendingCase[] = [];

  /** 把一批案件連同分表一次寫進去，並補上第一版歷程 */
  const flush = async (batch: PendingCase[]) => {
    if (!batch.length) return;

    const saved = await caseRepo.save(batch.map((b) => b.entity));

    const addresses = saved
      .map((c, i) => (batch[i].address ? addressRepo.create({ patrolCase: c, ...batch[i].address, address: `${batch[i].address!.road}${batch[i].address!.houseNumber}` , oAddress: `${batch[i].address!.county}${batch[i].address!.district}${batch[i].address!.road}${batch[i].address!.houseNumber}` }) : null))
      .filter((a): a is PatrolCaseAddress => a !== null);

    if (addresses.length) await addressRepo.save(addresses);

    await caseStatusRepo.save(
      saved.map((c, i) =>
        caseStatusRepo.create({
          patrolCase: c,
          status: batch[i].status.status,
          edited: batch[i].status.edited,
          needRepair: batch[i].status.needRepair,
          updStatusUsr: batch[i].status.status ? inspector : undefined,
          updStatusUsrAt: batch[i].status.status ? new Date(c.dtRecord.getTime() + 3600000) : undefined
        })
      )
    );

    // 歷程帶完整快照：沒有快照的歷程看得到「發生過什麼」，卻無法比較版本或還原
    await historyRepo.save(
      saved.map((c, i) =>
        historyRepo.create({
          caseType: 'CASE_PATROL',
          caseId: c.id,
          version: 1,
          action: 'CREATED',
          source: 'DEVICE',
          toState: String(batch[i].status.status),
          snapshotJson: {
            caseNum: c.caseNum ?? null,
            crackType: c.crackType,
            degree: c.degree,
            length: c.length,
            width: c.width,
            area: c.area,
            depth: c.depth ?? null,
            longitude: c.longitude,
            latitude: c.latitude,
            img: c.img ?? null,
            imgDetect: c.imgDetect ?? null,
            projectId: activeProject.id,
            county: batch[i].address?.county ?? null,
            district: batch[i].address?.district ?? null,
            cavlge: batch[i].address?.cavlge ?? null,
            road: batch[i].address?.road ?? null,
            address: batch[i].address ? `${batch[i].address!.road}${batch[i].address!.houseNumber}` : null,
            // 快照要與實際寫入的狀態一致 —— 否則還原到第一版會把案件打回未篩選，
            // 而那個版本從來沒有真的長那樣
            status: batch[i].status.status,
            edited: batch[i].status.edited,
            needRepair: batch[i].status.needRepair,
            remark: c.remark ?? null
          }
        })
      )
    );
  };

  for (let i = 0; i < CASE_COUNT; i += 1) {
    const externalId = `DEMO-2026-${String(i + 1).padStart(5, '0')}`;
    if (await caseRepo.exists({ where: { externalId } })) continue;

    // 七成落在熱區附近、三成散佈全區
    const inHotspot = random() < 0.7;
    const spot = hotspots[Math.floor(random() * hotspots.length)];
    const lng = inHotspot ? spot.lng + (random() - 0.5) * 0.008 : baseLng + (random() - 0.5) * 0.07;
    const lat = inHotspot ? spot.lat + (random() - 0.5) * 0.006 : baseLat + (random() - 0.5) * 0.055;

    // 時間分布也不平均：越近的日期案件越多(系統上線後使用率提高)
    const dayOffset = Math.floor(DAYS_BACK * random() ** 2);
    const dtRecord = new Date(now - dayOffset * 86400000 - Math.floor(random() * 86400000));

    // 舊案件多半已完修，新案件多半還沒判定 —— 這樣完修率與待辦數才合理。
    // 二篩狀態與修繕狀態是兩件事：通過二篩的案件才會進入修繕流程
    const status = dayOffset > 3 ? (random() < 0.9 ? 1 : random() < 0.5 ? 4 : 3) : random() < 0.5 ? 0 : 2;
    const needRepair = status !== 1 ? 0 : dayOffset > 30 ? (random() < 0.8 ? -1 : 2) : random() < 0.35 ? 2 : 1;

    const road = roads[Math.floor(random() * roads.length)];
    const district = DISTRICTS[Math.floor(random() * DISTRICTS.length)];
    const car = `DEMO-${String(Math.floor(random() * 4) + 1).padStart(3, '0')}`;

    const length = Number((0.3 + random() * 1.5).toFixed(2));
    const width = Number((0.2 + random() * 1.2).toFixed(2));

    pending.push({
      entity: caseRepo.create({
        company,
        project: activeProject,
        reporter: inspector,
        externalId,
        caseNum: `${activeProject.prjId}${String(i + 1).padStart(6, '0')}`,
        crackType: CRACK_TYPE_DEF[Math.floor(random() * CRACK_TYPE_DEF.length)].key,
        degree: DEGREE_DEF[Math.floor(random() * DEGREE_DEF.length)].key,
        crackId: i + 1,
        // 來源分布刻意不平均：車巡是主力，APP 巡查次之，通道案件最少
        source: random() < 0.65 ? 'VEHICLE' : random() < 0.85 ? 'APP' : 'SIDEWALK',
        car,
        dtRecord,
        length,
        width,
        area: Number((length * width).toFixed(2)),
        depth: Number((2 + random() * 12).toFixed(2)),
        img: `demo/case/${externalId}.jpg`,
        imgDetect: `demo/case/${externalId}_detect.jpg`,
        longitude: Number(lng.toFixed(6)),
        latitude: Number(lat.toFixed(6)),
        altitude: Number((80 + random() * 40).toFixed(1)),
        geom: { type: 'Point', coordinates: [lng, lat] },
        serialNo: i + 1,
        path: `demo/path/${car}/${dtRecord.toISOString().slice(0, 10)}.json`
      }),
      // 留幾筆沒有地址：讓 addressGeocoder 排程有事可做，
      // 也示範「佇列漏掉的由排程兜底」——地址是非同步補的，補不到不該讓案件進不來
      address:
        random() > 0.08
          ? {
              county: '示範市',
              district,
              cavlge: CAVLGES[Math.floor(random() * CAVLGES.length)],
              road,
              houseNumber: `${Math.floor(random() * 300) + 1}號`
            }
          : undefined,
      status: { status, edited: random() < 0.15 ? 1 : 0, needRepair }
    });

    createdCases += 1;

    // 分批寫入：一次 insert 上千筆會超過 Postgres 的參數上限，
    // 而且失敗時整批重來的代價太大
    if (pending.length >= 200) {
      await flush(pending);
      pending.length = 0;
    }
  }

  await flush(pending);

  // ─── 派工單（主表 / 狀態 / 取樣 / 照片）──────────────────────────

  const needOrder = await caseRepo
    .createQueryBuilder('c')
    .innerJoinAndSelect('c.status', 'st')
    .leftJoinAndSelect('c.address', 'ad')
    // 已派工的案件才有派工單；-1 是「已刪除」不是「已完修」
    .where('st.need_repair = 2')
    .orderBy('c.id', 'DESC')
    .take(Math.round(600 * SCALE))
    .getMany();

  let createdOrders = 0;
  for (const c of needOrder) {
    if (await workOrderRepo.exists({ where: { casePatrol: { id: c.id } } })) continue;

    const worker = workers[Math.floor(random() * workers.length)];
    const dispatchDate = new Date(c.dtRecord.getTime() + 86400000);

    // 三成的未完工單設成已逾期：儀表板的「逾期」區塊要有東西可看
    const dueDate = new Date(dispatchDate.getTime() + (random() < 0.3 ? -2 : 3) * 86400000);

    // 狀態依派工日推移：越早派的越可能已經完工，最近派的還在待處理。
    // 全部隨機的話，看板上會出現「上個月派的單還在待處理」這種不合理的分布，
    // 而那正是逾期篩選要抓的東西 —— 假資料把它變成雜訊就沒有意義了
    const ageDays = (now - dispatchDate.getTime()) / 86400000;
    const orderStatus = ageDays > 20 ? (random() < 0.85 ? 3 : 2) : ageDays > 7 ? Math.floor(random() * 3) + 1 : Math.floor(random() * 2);

    // 車巡案件轉來的一律是 PC；PD 的來源是巡查單，在下一段另外建
    const type = 'PC';

    // 兩成的單派兩個人：一個坑洞常是兩三個人一起去，示範資料要看得出多人派工
    const crew = random() < 0.2 ? [worker, workers[(workers.indexOf(worker) + 1) % workers.length]] : [worker];
    const ym = dispatchDate.toISOString().slice(2, 7).replace('-', '');

    const order = await workOrderRepo.save(
      workOrderRepo.create({
        company,
        project: activeProject,
        casePatrol: c,
        // 流水號用來源案件 id 而不是迴圈計數：seed 可以重複執行，
        // 計數每次都從 0 開始，第二次跑就會撞上第一次留下的單號
        caseNum: `${activeProject.prjId}${type}${ym}${String(c.id).padStart(4, '0')}`,
        type,
        dispatchDate: dispatchDate.toISOString().slice(0, 10),
        dueDate: dueDate.toISOString().slice(0, 10),
        workStartDate: orderStatus >= 1 ? new Date(dispatchDate.getTime() + 86400000).toISOString().slice(0, 10) : undefined,
        workEndDate: orderStatus >= 2 ? new Date(dispatchDate.getTime() + 2 * 86400000).toISOString().slice(0, 10) : undefined,
        workUnit: WORK_UNIT_DEF[Math.floor(random() * WORK_UNIT_DEF.length)].key,
        dispatcher: admin,
        county: c.address?.county ?? '示範市',
        district: c.address?.district ?? DISTRICTS[0],
        cavlge: c.address?.cavlge,
        address: c.address?.address ?? `${roads[0]}1號`,
        startAddr: c.address?.address ?? undefined,
        endAddr: c.address?.address ?? undefined,
        startGeom: { type: 'Point', coordinates: [c.longitude, c.latitude] },
        endGeom: { type: 'Point', coordinates: [c.longitude + 0.0004, c.latitude + 0.0003] },
        material: MATERIAL_DEF[Math.floor(random() * MATERIAL_DEF.length)].key,
        materialSize: 12.5,
        workLength: Number((c.length + random()).toFixed(2)),
        workWidth: Number((c.width + random() * 0.5).toFixed(2)),
        workDepthMilling: 5,
        workDepthPaving: 5,
        remark: orderStatus === 0 && random() < 0.2 ? '待現場確認交維方式' : undefined
      })
    );

    await orderUserRepo.save(crew.filter(Boolean).map((u) => orderUserRepo.create({ workOrder: order, user: u })));

    await orderStatusRepo.save(
      orderStatusRepo.create({
        workOrder: order,
        status: orderStatus,
        updStatusUsr: worker,
        rejectReason: undefined
      })
    );

    // 完工單補上必要照片：缺照片的完工單在驗收時會被退回，
    // 示範資料要能走完驗收流程，所以完工的單照片是齊的
    if (orderStatus === 3) {
      const required = REQUIRED_IMAGES[type] ?? [];

      await orderImageRepo.save(
        required.map((imgType) =>
          orderImageRepo.create({
            workOrder: order,
            imgType,
            imgTypeCh: IMAGE_TYPE_DEF.find((d) => d.type === imgType)?.name ?? imgType,
            imgName: `${order.caseNum}_${imgType}.jpg`,
            imgPath: `demo/workorder/${order.caseNum}/${imgType}.jpg`,
            sizeBytes: 180000 + Math.floor(random() * 400000),
            mimeType: 'image/jpeg',
            uploadedBy: worker
          })
        )
      );
    } else if (orderStatus === 2 && random() < 0.5) {
      // 一部分「已回報但照片不齊」的單：驗收會擋下來，示範這個檢查真的有作用
      await orderImageRepo.save(
        orderImageRepo.create({
          workOrder: order,
          imgType: 'IMG_BEFORE',
          imgTypeCh: IMAGE_TYPE_DEF.find((d) => d.type === 'IMG_BEFORE')?.name ?? '施工前',
          imgName: `${order.caseNum}_IMG_BEFORE.jpg`,
          imgPath: `demo/workorder/${order.caseNum}/IMG_BEFORE.jpg`,
          sizeBytes: 220000,
          mimeType: 'image/jpeg',
          uploadedBy: worker
        })
      );
    }

    await improvementRepo.save(improvementRepo.create({ workOrder: order, sampleTaken: false }));

    // 派工單自己的歷程；案件那邊也記一筆狀態變更，兩條時間軸各自完整
    await historyRepo.save([
      historyRepo.create({
        caseType: 'WORK_ORDER',
        caseId: order.id,
        version: 1,
        action: 'CREATED',
        toState: '0',
        source: 'USER',
        modifiedBy: admin,
        snapshotJson: {
          caseNum: order.caseNum,
          type: order.type,
          prjId: activeProject.prjId,
          dispatchDate: order.dispatchDate,
          dueDate: order.dueDate ?? null,
          workerUserIds: crew.filter(Boolean).map((u) => u.id).sort(),
          workUnit: order.workUnit ?? null,
          district: order.district,
          address: order.address,
          material: order.material ?? null,
          status: 0
        }
      }),
      ...(orderStatus > 0
        ? [
            historyRepo.create({
              caseType: 'WORK_ORDER',
              caseId: order.id,
              version: 2,
              action: 'STATUS_CHANGED',
              fromState: '0',
              toState: String(orderStatus),
              source: 'USER',
              modifiedBy: worker,
              snapshotJson: { caseNum: order.caseNum, type: order.type, status: orderStatus },
              changesJson: { status: { from: 0, to: orderStatus } }
            })
          ]
        : [])
    ]);

    const caseVersion = await historyRepo
      .createQueryBuilder('h')
      .select('COALESCE(MAX(h.version), 0)', 'max')
      .where("h.case_type = 'CASE_PATROL'")
      .andWhere('h.case_id = :id', { id: c.id })
      .getRawOne<{ max: string }>();

    await historyRepo.save(
      historyRepo.create({
        caseType: 'CASE_PATROL',
        caseId: c.id,
        version: Number(caseVersion?.max ?? 0) + 1,
        action: 'DISPATCHED',
        fromState: '1',
        toState: '2',
        source: 'USER',
        modifiedBy: admin,
        note: `派工單 ${order.caseNum}`,
        snapshotJson: {
          caseNum: c.caseNum ?? null,
          crackType: c.crackType,
          degree: c.degree,
          status: c.status?.status ?? 1,
          needRepair: c.status?.needRepair ?? 2,
          road: c.address?.road ?? null,
          address: c.address?.address ?? null
        },
        changesJson: { needRepair: { from: 1, to: c.status?.needRepair ?? 2 } }
      })
    );

    createdOrders += 1;
  }

  // ─── 巡查單／巡修單（人在現場開的單）───────────────────────────

  /**
   * 巡查單與車巡案件的差別在「誰發現的」：車巡是車機加判讀模型，
   * 巡查單是人走到現場開的。所以這裡的資料不從案件轉，是各自獨立的一批。
   *
   * 四分之一做成 RB（當場修掉），其餘 RA —— 實際比例大致如此，
   * 材料不是隨車都有，多數時候只能先記下來。
   */
  const MAINTENANCE_COUNT = Math.round(180 * SCALE);
  let createdMaintenances = 0;
  let potholeSeq = 0;

  for (let i = 0; i < MAINTENANCE_COUNT; i += 1) {
    const surveyDate = new Date(now - Math.floor(random() * 60) * 86400000);
    const ym = surveyDate.toISOString().slice(2, 7).replace('-', '');
    const isRepair = random() < 0.25;
    const type = isRepair ? 'RB' : 'RA';

    // 流水號用迴圈索引 + 類型：seed 可重複執行，單號要能穩定重現才不會每跑一次多一批
    const caseNum = `${activeProject.prjId}${type}${ym}${String(i + 1).padStart(4, '0')}`;
    if (await maintenanceRepo.exists({ where: { caseNum } })) continue;

    const crack = CRACK_TYPE_DEF[Math.floor(random() * CRACK_TYPE_DEF.length)];
    const district = DISTRICTS[Math.floor(random() * DISTRICTS.length)];
    const road = roads[Math.floor(random() * roads.length)];
    const length = Number((0.3 + random() * 2).toFixed(2));
    const width = Number((0.3 + random() * 1.5).toFixed(2));

    // 狀態依調查日推移：越早開的越可能已經派工，這兩天開的還在待確認。
    // 全隨機的話，待派工清單會混進三個月前的單，而那正是這張清單要抓的東西
    const ageDays = (now - surveyDate.getTime()) / 86400000;
    const status = isRepair ? 1 : ageDays > 30 ? 2 : ageDays > 7 ? 1 : 0;

    const maintenance = await maintenanceRepo.save(
      maintenanceRepo.create({
        company,
        project: activeProject,
        caseNum,
        type,
        surveyDate: surveyDate.toISOString().slice(0, 10),
        surveyUser: inspector,
        period: random() < 0.5 ? 'AM' : 'PM',
        weather: ['晴', '陰', '雨'][Math.floor(random() * 3)],
        dtype: crack.key,
        degree: DEGREE_DEF[Math.floor(random() * DEGREE_DEF.length)].key,
        potholeNumber: crack.key === 'Potholes' ? (potholeSeq += 1) : undefined,
        dtypeLength: length,
        dtypeWidth: width,
        dtypeArea: Number((length * width).toFixed(3)),
        county: '示範市',
        district,
        cavlge: `${district.slice(0, 1)}安里`,
        address: `${road}${Math.floor(random() * 300) + 1}號`,
        geom: { type: 'Point', coordinates: [baseLng + (random() - 0.5) * 0.06, baseLat + (random() - 0.5) * 0.05] },
        remark: random() < 0.15 ? '雨後積水，建議再複查一次' : undefined
      })
    );

    await maintenanceStatusRepo.save(
      maintenanceStatusRepo.create({ maintenance, status, updStatusUsr: status > 0 ? inspector : undefined })
    );

    if (isRepair) {
      await maintenanceRepairRepo.save(
        maintenanceRepairRepo.create({
          maintenance,
          material: 'COLD',
          refillLength: Number((length + 0.1).toFixed(2)),
          refillWidth: Number((width + 0.1).toFixed(2)),
          quantity: Math.max(1, Math.round(length * width * 4))
        })
      );

      // 巡修單一定要有修補前後：沒有照片的「當場修掉了」在驗收時說不通
      await maintenanceImageRepo.save(
        (MAINTENANCE_REQUIRED_IMAGES.RB ?? []).map((imgType) =>
          maintenanceImageRepo.create({
            maintenance,
            imgType,
            imgTypeCh: IMAGE_TYPE_DEF.find((d) => d.type === imgType)?.name ?? imgType,
            imgName: `${caseNum}_${imgType}.jpg`,
            imgPath: `demo/maintenance/${caseNum}/${imgType}.jpg`,
            sizeBytes: 160000 + Math.floor(random() * 300000),
            mimeType: 'image/jpeg',
            uploadedBy: inspector
          })
        )
      );
    }

    await historyRepo.save(
      historyRepo.create({
        caseType: 'MAINTENANCE',
        caseId: maintenance.id,
        version: 1,
        action: 'CREATED',
        toState: '0',
        source: 'USER',
        modifiedBy: inspector,
        snapshotJson: {
          caseNum,
          type,
          prjId: activeProject.prjId,
          surveyDate: maintenance.surveyDate,
          dtype: maintenance.dtype ?? null,
          degree: maintenance.degree ?? null,
          district: maintenance.district ?? null,
          address: maintenance.address ?? null,
          status: 0
        }
      })
    );

    // 已派工的巡查單要真的有一張 PD 派工單，否則「已派工」是一句沒有憑據的話
    if (status === 2) {
      const dispatchDate = new Date(surveyDate.getTime() + 86400000);
      const orderYm = dispatchDate.toISOString().slice(2, 7).replace('-', '');
      const worker = workers[Math.floor(random() * workers.length)];
      const orderStatus = ageDays > 45 ? 3 : 1;

      const order = await workOrderRepo.save(
        workOrderRepo.create({
          company,
          project: activeProject,
          maintenance,
          caseNum: `${activeProject.prjId}PD${orderYm}${String(i + 1).padStart(4, '0')}`,
          type: 'PD',
          dispatchDate: dispatchDate.toISOString().slice(0, 10),
          dueDate: new Date(dispatchDate.getTime() + 5 * 86400000).toISOString().slice(0, 10),
          workStartDate: dispatchDate.toISOString().slice(0, 10),
          workEndDate: orderStatus === 3 ? new Date(dispatchDate.getTime() + 2 * 86400000).toISOString().slice(0, 10) : undefined,
          workUnit: 'SELF',
          dispatcher: admin,
          county: maintenance.county,
          district: maintenance.district!,
          cavlge: maintenance.cavlge,
          address: maintenance.address!,
          startGeom: maintenance.geom,
          material: 'COLD',
          workLength: length,
          workWidth: width,
          remark: undefined
        })
      );

      if (worker) await orderUserRepo.save(orderUserRepo.create({ workOrder: order, user: worker }));
      await orderStatusRepo.save(orderStatusRepo.create({ workOrder: order, status: orderStatus, updStatusUsr: worker }));
      await improvementRepo.save(improvementRepo.create({ workOrder: order, sampleTaken: false }));

      if (orderStatus === 3) {
        await orderImageRepo.save(
          (REQUIRED_IMAGES.PD ?? []).map((imgType) =>
            orderImageRepo.create({
              workOrder: order,
              imgType,
              imgTypeCh: IMAGE_TYPE_DEF.find((d) => d.type === imgType)?.name ?? imgType,
              imgName: `${order.caseNum}_${imgType}.jpg`,
              imgPath: `demo/workorder/${order.caseNum}/${imgType}.jpg`,
              sizeBytes: 180000 + Math.floor(random() * 300000),
              mimeType: 'image/jpeg',
              uploadedBy: worker
            })
          )
        );
      }

      await historyRepo.save(
        historyRepo.create({
          caseType: 'WORK_ORDER',
          caseId: order.id,
          version: 1,
          action: 'CREATED',
          toState: String(orderStatus),
          source: 'USER',
          modifiedBy: admin,
          note: `巡查單 ${caseNum}`,
          snapshotJson: {
            caseNum: order.caseNum,
            type: order.type,
            prjId: activeProject.prjId,
            dispatchDate: order.dispatchDate,
            workerUserIds: worker ? [worker.id] : [],
            workUnit: order.workUnit ?? null,
            district: order.district,
            address: order.address,
            status: orderStatus
          }
        })
      );

      createdOrders += 1;
    }

    createdMaintenances += 1;
  }

  // ─── 車輛 ───────────────────────────────────────────────────────

  const vehicleDefs = [
    { plateNo: 'DEMO-001', name: '巡查一號車', type: 'PATROL', device: 'DEV-0001' },
    { plateNo: 'DEMO-002', name: '巡查二號車', type: 'PATROL', device: 'DEV-0002' },
    { plateNo: 'DEMO-003', name: '維修工程車', type: 'REPAIR', device: 'DEV-0003' },
    { plateNo: 'DEMO-004', name: '鋪面檢測車', type: 'SURVEY', device: 'DEV-0004' }
  ];

  for (const [i, v] of vehicleDefs.entries()) {
    if (await vehicleRepo.exists({ where: { plateNo: v.plateNo, company: { id: company.id } } })) continue;

    await vehicleRepo.save(
      vehicleRepo.create({
        company,
        project: activeProject,
        plateNo: v.plateNo,
        name: v.name,
        vehicleType: v.type as (typeof VEHICLE_TYPE)[number],
        deviceId: v.device,
        driver: workers[i % workers.length],
        // 前兩台做成「剛回報過」，看板才有東西可看；後兩台留成離線
        state: i < 2 ? 'ONLINE' : 'OFFLINE',
        lastLng: baseLng + (random() - 0.5) * 0.03,
        lastLat: baseLat + (random() - 0.5) * 0.03,
        lastReportAt: i < 2 ? new Date(now - i * 60_000) : new Date(now - 86400000),
        todayKm: (20 + random() * 60).toFixed(2)
      })
    );
  }

  const vehicles = await vehicleRepo.find({ where: { company: { id: company.id } }, order: { id: 'ASC' } });

  // 車輛與標案也走關聯表：車輛會在標案之間調度，但舊案件仍要查得到當時是哪台車跑的
  for (const v of vehicles) {
    if (await projectVehicleRepo.exists({ where: { project: { id: activeProject.id }, vehicle: { id: v.id } } })) continue;

    await projectVehicleRepo.save(projectVehicleRepo.create({ project: activeProject, vehicle: v, isActive: true }));
  }

  // ─── 軌跡(兩台在線車各一天份) ────────────────────────────────────

  let trackCount = await trackRepo.count({ where: { company: { id: company.id } } });
  if (trackCount === 0) {
    for (const vehicle of vehicles.slice(0, 3)) {
      for (let day = 0; day < TRACK_DAYS; day += 1) {
      // 每台車每天走一條折線，每 30 秒一點；速度與方位跟著轉向變化
      let lng = baseLng - 0.02 + (random() - 0.5) * 0.01;
      let lat = baseLat - 0.015 + (random() - 0.5) * 0.01;
      const startAt = now - day * 86400_000 - 8 * 3600_000;

      const points = Array.from({ length: 360 }, (_, i) => {
        // 每 60 點轉一次彎，做出「在路網上跑」的感覺而不是一條直線
        const leg = Math.floor(i / 60);
        lng += (leg % 2 === 0 ? 1 : 0.2) * 0.0009 + (random() - 0.5) * 0.0002;
        lat += (leg % 2 === 0 ? 0.2 : 1) * 0.0007 + (random() - 0.5) * 0.0002;

        return trackRepo.create({
          company,
          vehicle,
          project: activeProject,
          geom: { type: 'Point', coordinates: [lng, lat] },
          speedKph: Number((15 + random() * 35).toFixed(1)),
          heading: Number((random() * 360).toFixed(0)),
          gpsHdop: Number((0.6 + random() * 1.5).toFixed(2)),
          isTripStart: i === 0,
          recordedAt: new Date(startAt + i * 30_000)
        });
      });

        // 分批寫入：一次 insert 幾百筆會讓參數數量超過 Postgres 上限
        for (let i = 0; i < points.length; i += 100) await trackRepo.save(points.slice(i, i + 100));
        trackCount += points.length;
      }
    }
  }

  // ─── 路段 ───────────────────────────────────────────────────────

  let segmentCount = 0;
  for (let i = 0; i < SEGMENT_COUNT; i += 1) {
    const road = roads[i % roads.length];
    const code = `SEG-${String(i + 1).padStart(3, '0')}`;
    if (await segmentRepo.exists({ where: { code, company: { id: company.id } } })) continue;

    // 讓路段鋪滿整個示範區域，而不是全部擠在對角線上
    const col = i % 6;
    const row = Math.floor(i / 6);
    const startLng = baseLng - 0.03 + col * 0.011;
    const startLat = baseLat - 0.025 + row * 0.009;

    const coordinates: [number, number][] = Array.from({ length: 6 }, (_, k) => [
      startLng + k * 0.006 + (random() - 0.5) * 0.001,
      startLat + k * 0.004 + (random() - 0.5) * 0.001
    ]);

    const pci = 35 + random() * 60;

    await segmentRepo.save(
      segmentRepo.create({
        company,
        project: activeProject,
        code,
        roadName: road.replace(/[一二三四]段$/, ''),
        section: `${['一', '二', '三', '四'][i % 4]}段`,
        district: DISTRICTS[i % DISTRICTS.length],
        geom: { type: 'LineString', coordinates },
        laneCount: 2 + Math.floor(random() * 3),
        pci: pci.toFixed(2),
        iri: (1.5 + random() * 4).toFixed(2),
        maintainLevel: pciToLevel(pci)
      })
    );
    segmentCount += 1;
  }

  // 長度交給 PostGIS 算，不用前端或程式估
  await segmentRepo.query(`UPDATE road_segments SET length_m = ROUND(ST_Length(geom)::numeric, 2) WHERE length_m = 0`);

  // ─── 巡查計畫 ───────────────────────────────────────────────────

  // 前兩條計畫的路線沿著實際軌跡取樣，第三條刻意偏離 ——
  // 覆蓋率示範的重點是「有的達標、有的沒達標」，
  // 三條都 0% 或三條都 100% 都看不出這個數字在說什麼
  let planCount = 0;
  for (const [i, freq] of (['DAILY', 'WEEKLY', 'BIWEEKLY'] as const).entries()) {
    const code = `PLAN-${String(i + 1).padStart(3, '0')}`;
    if (await planRepo.exists({ where: { code, company: { id: company.id } } })) continue;

    const vehicle = vehicles[i % 2];

    // 從該車的軌跡等距取 12 點當作「應巡路線」
    const sampled = await trackRepo.query(
      `SELECT ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat
         FROM (
           SELECT geom, ROW_NUMBER() OVER (ORDER BY recorded_at) AS rn, COUNT(*) OVER () AS total
             FROM vehicle_tracks WHERE vehicle_id = $1
         ) s
        WHERE rn % GREATEST(1, (total / 12)::int) = 0
        ORDER BY rn
        LIMIT 12`,
      [vehicle.id]
    );

    const onRoute: [number, number][] = sampled.map((r: { lng: number; lat: number }) => [Number(r.lng), Number(r.lat)]);

    // 第三條往北偏 0.01 度(約 1.1 公里)，遠超過 30 公尺的緩衝距離
    const coordinates: [number, number][] =
      i < 2 && onRoute.length >= 2
        ? onRoute
        : (onRoute.length >= 2 ? onRoute : Array.from({ length: 8 }, (_, k) => [baseLng + k * 0.0075, baseLat + k * 0.005] as [number, number])).map(
            ([lng, lat]) => [lng, lat + 0.01] as [number, number]
          );

    await planRepo.save(
      planRepo.create({
        company,
        project: activeProject,
        vehicle,
        code,
        name: `${['每日', '每週', '雙週'][i]}巡查路線 ${i + 1}`,
        frequency: freq,
        route: { type: 'LineString', coordinates },
        bufferM: 30,
        active: true
      })
    );
    planCount += 1;
  }

  await planRepo.query(`UPDATE patrol_plans SET route_km = ROUND((ST_Length(route) / 1000)::numeric, 2) WHERE route_km = 0`);

  // ─── 鋪面調查 ───────────────────────────────────────────────────

  let surveyCount = 0;
  if ((await surveyOrderRepo.count({ where: { company: { id: company.id } } })) === 0) {
    const segments = await segmentRepo.find({ where: { company: { id: company.id } }, order: { pci: 'ASC' }, take: 8 });

    for (const [i, seg] of segments.entries()) {
      const order = await surveyOrderRepo.save(
        surveyOrderRepo.create({
          company,
          project: activeProject,
          orderNo: `SV-20260829-${String(i + 1).padStart(3, '0')}`,
          title: `${seg.roadName}${seg.section ?? ''}鋪面調查`,
          state: i === 0 ? 'CLOSED' : i === 1 ? 'SURVEYING' : 'ISSUED',
          requester: '示範市政府建設局',
          surveyor: inspector,
          dueDate: '2026-09-30'
        })
      );

      const coords = seg.geom.coordinates;
      for (let k = 0; k < 3; k += 1) {
        const done = i === 0 || (i === 1 && k === 0);
        const pci = 40 + random() * 40;

        await surveyCaseRepo.save(
          surveyCaseRepo.create({
            company,
            order,
            segment: seg,
            geom: { type: 'Point', coordinates: coords[k % coords.length] },
            roadName: `${seg.roadName}${seg.section ?? ''}`,
            method: (['VISUAL', 'CORE_DRILL', 'FWD'] as const)[k % 3],
            state: done ? 'DONE' : 'PENDING',
            thicknessCm: done ? (8 + random() * 8).toFixed(2) : undefined,
            pci: done ? pci.toFixed(2) : undefined,
            iri: done ? (2 + random() * 3).toFixed(2) : undefined,
            surveyor: done ? inspector : undefined,
            surveyedAt: done ? new Date(now - random() * 7 * 86400000) : undefined,
            finding: done ? '面層厚度偏低，建議納入年度刨鋪' : undefined
          })
        );
        surveyCount += 1;
      }
    }
  }

  logger.log(`✅ Seed 完成`);
  logger.log(`   車輛 ${vehicles.length} 台／軌跡 ${trackCount} 點／路段 ${segmentCount} 段／計畫 ${planCount} 條／調查點 ${surveyCount} 個`);
  logger.log(`   公司 ${company.code}／帳號 ${accounts.length} 個／標案 ${projectDefs.length} 個／工務段 ${sectionDefs.length} 段／行政區 ${areas.length} 區`);
  logger.log(`   新增案件 ${createdCases} 筆、巡查單 ${createdMaintenances} 張、派工單 ${createdOrders} 張`);
  logger.log(`   登入(廠商)：DEMO / admin / Demo1234`);
  logger.log(`   登入(平台)：ROOT / root / Demo1234    —— 開通廠商單位`);
  logger.log(`   登入(外包)：SUB01 / suboffice / Demo1234 —— 角色是管理員，但只拿得到被開通的七項權限`);

  await app.close();
  process.exit(0);
})();
