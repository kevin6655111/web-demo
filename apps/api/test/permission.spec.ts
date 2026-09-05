import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '@/http/guards/permission.guard';
import { RequireAction, ACTION } from '@decorators/permission.decorator';

/**
 * 權限守衛的預設行為必須是「安全的那一邊」：
 * 沒標註 → 放行(但仍需登入)，標了 → 逐項比對，缺一不可。
 */
function makeContext(handler: Function, target: Function, actions: string[]): ExecutionContext {
  return {
    // getType 是必要的：守衛靠它排除微服務事件，
    // 假的 context 少了它會讓守衛以為自己在處理 RPC 而直接放行
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({ user: { actions } }) })
  } as unknown as ExecutionContext;
}

class Cases {
  @RequireAction(ACTION.CASE.CREATE)
  create() {}

  @RequireAction(ACTION.CASE.UPDATE, ACTION.DASHBOARD.READ)
  updateAndView() {}

  open() {}
}

describe('PermissionGuard', () => {
  const guard = new PermissionGuard(new Reflector());

  it('持有所需權限時放行', () => {
    const ctx = makeContext(Cases.prototype.create, Cases, [ACTION.CASE.CREATE]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('缺少權限時擋下，並指出缺哪一個', () => {
    const ctx = makeContext(Cases.prototype.create, Cases, [ACTION.CASE.READ]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow(/CASE\.CREATE/);
  });

  it('標了多個權限時必須全部持有', () => {
    const partial = makeContext(Cases.prototype.updateAndView, Cases, [ACTION.CASE.UPDATE]);
    expect(() => guard.canActivate(partial)).toThrow(ForbiddenException);

    const full = makeContext(Cases.prototype.updateAndView, Cases, [ACTION.CASE.UPDATE, ACTION.DASHBOARD.READ]);
    expect(guard.canActivate(full)).toBe(true);
  });

  it('沒標註的 API 不做權限檢查', () => {
    const ctx = makeContext(Cases.prototype.open, Cases, []);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('使用者沒有任何權限欄位時也不會爆掉', () => {
    const ctx = {
      getType: () => 'http',
      getHandler: () => Cases.prototype.create,
      getClass: () => Cases,
      switchToHttp: () => ({ getRequest: () => ({}) })
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

/**
 * 這一組是回歸測試。
 *
 * 全域守衛會被微服務(Redis transport)繼承，而事件沒有 HTTP 請求 ——
 * 沒有排除的話，每一個事件都會被守衛擋掉，而且是安靜地擋掉：
 * WebSocket 推播從此不再送出，但所有測試依然是綠的。
 */
describe('全域守衛在非 HTTP 情境', () => {
  const guard = new PermissionGuard(new Reflector());

  it('微服務事件直接放行，不去讀不存在的 request', () => {
    const rpcContext = {
      getType: () => 'rpc',
      getHandler: () => Cases.prototype.create,
      getClass: () => Cases,
      switchToHttp: () => {
        throw new Error('RPC 情境不該呼叫 switchToHttp');
      }
    } as unknown as ExecutionContext;

    expect(guard.canActivate(rpcContext)).toBe(true);
  });
});
