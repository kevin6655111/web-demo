import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { HttpResponse, type HttpResult } from '@/http/http-response';
import { CLIENT_EVENT_BUS } from '@/queue/queue.const';
import { SupportThread, type SupportCategory, type SupportState } from './entities/support-thread.entity';
import { SupportMessage } from './entities/support-message.entity';
import type { AuthUser } from '@app-types/user-auth.type';
import { OpenThreadDto, SendMessageDto, ThreadQueryDto, UpdateThreadDto } from './support.dto';

/** 客服訊息的推播事件；與案件事件走同一條匯流排 */
export const SUPPORT_EVENT = 'support.message';

@Injectable()
export class SupportService {
  private readonly logger = new Logger('Support');

  constructor(
    @InjectRepository(SupportThread) private readonly threadRepo: Repository<SupportThread>,
    @InjectRepository(SupportMessage) private readonly messageRepo: Repository<SupportMessage>,
    @Inject(CLIENT_EVENT_BUS) private readonly eventBus: ClientProxy
  ) {}

  /**
   * 開啟或取得自己的對話。
   *
   * 一位使用者同時只有一條開啟中的對話 —— 現場人員遇到問題時要的是
   * 「有人回我」，不是「開一張新單」。已結案的會保留，
   * 再次發問時開新的一條，客服因此看得到這個人上次問過什麼。
   */
  public async openThread(dto: OpenThreadDto, user: AuthUser): Promise<HttpResult> {
    const existing = await this.threadRepo.findOne({
      where: { requester: { id: user.uid }, state: 'OPEN' },
      relations: { agent: true }
    });

    const thread =
      existing ??
      (await this.threadRepo.save(
        this.threadRepo.create({
          company: { id: user.companyId },
          requester: { id: user.uid },
          subject: dto.SUBJECT,
          category: dto.CATEGORY as SupportCategory,
          state: 'OPEN'
        })
      ));

    await this.appendMessage(thread.id, user, dto.BODY, false);

    return HttpResponse.success({
      message: existing ? '已接續既有對話' : '已建立對話',
      data: { ID: thread.id, REUSED: !!existing }
    });
  }

  /** 送出訊息 */
  public async sendMessage(dto: SendMessageDto, user: AuthUser, isAgent: boolean): Promise<HttpResult> {
    const thread = await this.threadRepo.findOne({
      where: { id: dto.THREAD_ID, company: { id: user.companyId } },
      relations: { requester: true, agent: true }
    });
    if (!thread) throw new NotFoundException(`找不到對話：${dto.THREAD_ID}`);

    // 不是發問者本人、也沒有客服權限的人不能插話
    if (!isAgent && thread.requester.id !== user.uid) throw new ForbiddenException('無權在此對話發言');

    const saved = await this.appendMessage(thread.id, user, dto.BODY, isAgent);

    // 客服回話時順手接手：讓「誰在處理」這件事不需要額外一個動作
    if (isAgent && !thread.agent) {
      await this.threadRepo.update({ id: thread.id }, { agent: { id: user.uid }, state: 'ASSIGNED' });
    }

    return HttpResponse.success({ message: '已送出', data: saved });
  }

  /** 我的對話(使用者視角) */
  public async myThreads(user: AuthUser): Promise<HttpResult> {
    const rows = await this.threadRepo.find({
      where: { requester: { id: user.uid } },
      relations: { agent: true },
      order: { id: 'DESC' },
      take: 20
    });

    return HttpResponse.successOrWarn({ data: rows.map((t) => this.toRow(t)), warnMsg: '尚無客服對話' });
  }

  /** 對話清單(客服視角) */
  public async listThreads(dto: ThreadQueryDto, user: AuthUser): Promise<HttpResult> {
    const qb = this.threadRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.requester', 'r')
      .leftJoinAndSelect('t.agent', 'a')
      .where('t.company_id = :companyId', { companyId: user.companyId })
      // 未指派的排最前面：那些是還沒有人接的，也最可能被漏掉。
      // 用 NULLS FIRST 而不是 CASE WHEN —— TypeORM 會把 CASE 運算式當成資料表別名解析
      .orderBy('t.agent', 'ASC', 'NULLS FIRST')
      .addOrderBy('t.lastMessageAt', 'DESC')
      .take(100);

    if (dto.STATE?.length) qb.andWhere('t.state IN (:...state)', { state: dto.STATE });
    if (dto.CATEGORY?.length) qb.andWhere('t.category IN (:...category)', { category: dto.CATEGORY });
    if (dto.MINE) qb.andWhere('t.agent_id = :uid', { uid: user.uid });

    const rows = await qb.getMany();

    return HttpResponse.successOrWarn({ data: rows.map((t) => this.toRow(t)), warnMsg: '目前沒有客服對話' });
  }

  /** 讀取對話訊息，並清掉自己這一側的未讀 */
  public async getMessages(threadId: number, user: AuthUser, isAgent: boolean): Promise<HttpResult> {
    const thread = await this.threadRepo.findOne({
      where: { id: threadId, company: { id: user.companyId } },
      relations: { requester: true }
    });
    if (!thread) throw new NotFoundException(`找不到對話：${threadId}`);
    if (!isAgent && thread.requester.id !== user.uid) throw new ForbiddenException('無權查看此對話');

    const rows = await this.messageRepo.find({
      where: { thread: { id: threadId } },
      relations: { sender: true },
      order: { id: 'ASC' },
      take: 200
    });

    await this.threadRepo.update({ id: threadId }, isAgent ? { unreadForAgent: 0 } : { unreadForUser: 0 });

    return HttpResponse.success({
      data: rows.map((m) => ({
        ID: m.id,
        BODY: m.body,
        FROM_AGENT: m.fromAgent,
        SENDER: m.sender?.name ?? '(已刪除)',
        CREATED_AT: m.createdAt
      }))
    });
  }

  /** 接手或變更狀態(客服) */
  public async updateThread(dto: UpdateThreadDto, user: AuthUser): Promise<HttpResult> {
    const patch: Record<string, unknown> = {};
    if (dto.TAKE) {
      patch.agent = { id: user.uid };
      patch.state = 'ASSIGNED';
    }
    if (dto.STATE) patch.state = dto.STATE as SupportState;

    const result = await this.threadRepo.update({ id: dto.ID, company: { id: user.companyId } }, patch);
    if (!result.affected) throw new NotFoundException(`找不到對話：${dto.ID}`);

    return HttpResponse.success({ message: '已更新' });
  }

  // ─── 內部 ───────────────────────────────────────────────────────

  private async appendMessage(threadId: number, user: AuthUser, body: string, fromAgent: boolean) {
    const saved = await this.messageRepo.save(
      this.messageRepo.create({
        thread: { id: threadId },
        sender: { id: user.uid },
        body: body.trim().slice(0, 1000),
        fromAgent
      })
    );

    // 未讀數加在「對方」那一側，並更新排序用的時間戳
    await this.threadRepo
      .createQueryBuilder()
      .update(SupportThread)
      .set({
        lastMessageAt: saved.createdAt,
        unreadForAgent: () => (fromAgent ? 'unread_for_agent' : 'unread_for_agent + 1'),
        unreadForUser: () => (fromAgent ? 'unread_for_user + 1' : 'unread_for_user')
      })
      .where('id = :id', { id: threadId })
      .execute();

    const payload = {
      companyId: user.companyId,
      threadId,
      messageId: saved.id,
      body: saved.body,
      fromAgent,
      sender: user.name,
      createdAt: saved.createdAt
    };

    // 走事件匯流排：客服可能連在另一個 api 實例上
    this.eventBus.emit(SUPPORT_EVENT, payload);
    this.logger.log(`💬 support#${threadId} ${fromAgent ? '客服' : '使用者'} 訊息`);

    return payload;
  }

  private toRow(t: SupportThread) {
    return {
      ID: t.id,
      SUBJECT: t.subject,
      CATEGORY: t.category,
      STATE: t.state,
      REQUESTER: t.requester?.name ?? null,
      AGENT: t.agent?.name ?? null,
      UNREAD_FOR_USER: t.unreadForUser,
      UNREAD_FOR_AGENT: t.unreadForAgent,
      LAST_MESSAGE_AT: t.lastMessageAt ?? null,
      CREATED_AT: t.createdAt
    };
  }
}
