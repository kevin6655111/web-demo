import { describe, expect, it } from 'vitest';
import { VehicleCommPresenter } from '../presenters/VehicleCommPresenter';

const base = {
  DEVICE_ID: 'DEV-0001',
  PLATE_NO: 'DEMO-001',
  SILENT_SEC: 5,
  STREAM_STATE: 'IDLE',
  FRAMES: 0,
  ECU: null,
  CONTROLLABLE: true
};

describe('VehicleCommPresenter.session', () => {
  it('故障碼排在通訊問題前面 —— 要進廠的車比卡住的串流重要', () => {
    const s = VehicleCommPresenter.session({
      ...base,
      SILENT_SEC: 600,
      ECU: { faultCodes: ['P0301'] }
    });

    expect(s.verdict.level).toBe('error');
    expect(s.verdict.text).toContain('P0301');
  });

  it('心跳逾時才顯示靜默時間 —— 「靜默 12 秒」不是資訊', () => {
    expect(VehicleCommPresenter.session({ ...base, SILENT_SEC: 12 }).silentText).toBeNull();
    expect(VehicleCommPresenter.session({ ...base, SILENT_SEC: 300 }).silentText).toContain('5 分鐘');
  });

  it('串流中但幀數為零 = 推流其實卡住了', () => {
    const s = VehicleCommPresenter.session({ ...base, STREAM_STATE: 'STREAMING', FRAMES: 0 });
    expect(s.streamStalled).toBe(true);
  });

  it('電壓低於 12.8V 判定為熄火 —— 發動中會有發電機在充電', () => {
    expect(VehicleCommPresenter.session({ ...base, ECU: { voltageV: 13.9 } }).engineOff).toBe(false);
    expect(VehicleCommPresenter.session({ ...base, ECU: { voltageV: 12.1 } }).engineOff).toBe(true);
  });

  it('連在別的節點時要講明白下不了指令，而不是顯示正常', () => {
    const s = VehicleCommPresenter.session({ ...base, CONTROLLABLE: false });
    expect(s.verdict.level).toBe('warning');
    expect(s.verdict.text).toContain('下不了指令');
  });
});

describe('VehicleCommPresenter.commands', () => {
  it('會中斷巡查的指令排最後', () => {
    const cmds = VehicleCommPresenter.commands();
    expect(cmds.at(-1).key).toBe('REBOOT');
    expect(cmds.at(-1).danger).toBe(true);
  });

  it('每個指令都有中文與說明 —— SNAPSHOT 對督導不是可讀的字', () => {
    for (const c of VehicleCommPresenter.commands()) {
      expect(c.label).toBeTruthy();
      expect(c.hint).toBeTruthy();
    }
  });
});

describe('VehicleCommPresenter.ecuRows', () => {
  it('沒有回報的欄位不列 —— 一片空白比不列更難讀', () => {
    const rows = VehicleCommPresenter.ecuRows({ voltageV: 13.8, rpm: 1500 });
    expect(rows.map((r) => r.label)).toEqual(['電壓', '轉速']);
    expect(rows[0].text).toBe('13.8 V');
  });

  it('沒有 ECU 時回空陣列而不是炸掉', () => {
    expect(VehicleCommPresenter.ecuRows(null)).toEqual([]);
  });
});
