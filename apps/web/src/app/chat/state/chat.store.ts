import { Injectable, computed, inject, signal } from '@angular/core';
import {
  events,
  type Conversation,
  type Message,
  type PresenceUpdate,
  type ReceiptUpdate,
  type SendAccepted,
  type SendMessage,
} from '@relay/shared/browser';
import { debounceTime } from 'rxjs';
import { ChatApi } from '../data-access/chat.api';
import { AuthService } from '../../core/auth/auth.service';
import { NoticesService } from '../../core/notifications/notices.service';
import { RealtimeService } from '../../core/realtime/realtime.service';

import { mergeMessages, receiptFor, type ChatMessage } from './chat-message';
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(ChatApi);
  private readonly live = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  private readonly notices = inject(NoticesService);
  readonly conversations = signal<Conversation[]>([]);
  readonly loadingConversations = signal(true);
  readonly nextConversationCursor = signal<string | undefined>(undefined);
  readonly messages = signal<Record<string, ChatMessage[]>>({});
  readonly active = signal<string | null>(null);
  readonly presence = signal<Record<string, PresenceUpdate>>({});
  readonly typists = signal<Record<string, string[]>>({});
  readonly older = signal<Record<string, string | undefined>>({});
  readonly loadingHistory = signal(false);
  readonly loadingOlder = signal(false);
  readonly current = computed(() =>
    this.conversations().find((conversation) => conversation.id === this.active()),
  );
  private readonly hidden = new Set<string>();
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly delivered = new Set<string>();
  private readonly read = new Set<string>();
  private readonly receiptsInFlight = new Set<string>();
  private readonly earlyReceipts = new Map<string, ReceiptUpdate[]>();
  private readonly knownHistory = new Set<string>();
  private currentAccount?: string;
  private listGeneration = 0;
  private selection = 0;

  constructor() {
    this.live.messages.subscribe((message) => {
      if (!this.currentAccount) return;
      this.ingest(message.conversationId, [message]);
      this.receiptsFor(message.conversationId, [message]);
    });
    this.live.receipts.subscribe((update) => {
      const known = (this.messages()[update.conversationId] ?? []).some(
        (message) => message.messageId === update.messageId,
      );
      if (!known) {
        if (this.earlyReceipts.size >= 200)
          this.earlyReceipts.delete(this.earlyReceipts.keys().next().value ?? '');
        this.earlyReceipts.set(update.messageId, [
          ...(this.earlyReceipts.get(update.messageId) ?? []),
          update,
        ]);
        return;
      }
      this.change(update.conversationId, (items) =>
        items.map((message) =>
          message.messageId === update.messageId ? receiptFor(message, update) : message,
        ),
      );
    });
    this.live.deletions.subscribe(({ conversationId, messageId, forEveryone }) => {
      if (forEveryone) {
        this.change(conversationId, (items) =>
          items.map((item) =>
            item.messageId === messageId
              ? { ...item, body: undefined, media: undefined, deletedForEveryone: true }
              : item,
          ),
        );
      } else {
        this.hidden.add(messageId);
        this.change(conversationId, (items) =>
          items.filter((item) => item.messageId !== messageId),
        );
      }
    });
    this.live.presence.subscribe((update) =>
      this.presence.update((value) => ({ ...value, [update.userId]: update })),
    );
    this.live.typing.subscribe(({ conversationId, userId, typing }) => {
      if (userId === this.currentAccount) return;
      const timerKey = `${conversationId}:${userId}`;
      clearTimeout(this.typingTimers.get(timerKey));
      const set = (value: boolean) =>
        this.typists.update((all) => {
          const next = new Set(all[conversationId] ?? []);
          if (value) next.add(userId);
          else next.delete(userId);
          return { ...all, [conversationId]: [...next] };
        });
      set(typing);
      if (typing)
        this.typingTimers.set(
          timerKey,
          setTimeout(() => {
            set(false);
            this.typingTimers.delete(timerKey);
          }, 5200),
        );
      else this.typingTimers.delete(timerKey);
    });
    this.live.conversations.subscribe(({ conversationId, removed }) => {
      if (removed) {
        this.conversations.update((items) => items.filter((item) => item.id !== conversationId));
        this.change(conversationId, () => []);
        this.knownHistory.delete(conversationId);
      }
    });
    this.live.conversations.pipe(debounceTime(100)).subscribe(() => void this.refreshList());
    this.live.connected.subscribe(() => {
      const ids = new Set(this.knownHistory);
      const current = this.active();
      if (current) ids.add(current);
      void this.refreshList();
      void Promise.allSettled([...ids].map((id) => this.backfill(id)));
    });
    document.addEventListener('visibilitychange', () => {
      const id = this.active();
      if (id && document.visibilityState === 'visible')
        this.receiptsFor(id, this.messages()[id] ?? []);
    });
  }
  account(id: string | undefined) {
    if (id === this.currentAccount) return;
    this.currentAccount = id;
    this.selection++;
    this.listGeneration++;
    this.conversations.set([]);
    this.loadingConversations.set(Boolean(id));
    this.nextConversationCursor.set(undefined);
    this.messages.set({});
    this.presence.set({});
    this.typists.set({});
    this.older.set({});
    this.active.set(null);
    this.loadingHistory.set(false);
    this.loadingOlder.set(false);
    this.knownHistory.clear();
    this.earlyReceipts.clear();
    this.hidden.clear();
    this.delivered.clear();
    this.read.clear();
    this.receiptsInFlight.clear();
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    if (id) void this.refreshList();
  }
  async refreshList(more = false) {
    const account = this.currentAccount;
    if (!account) return;
    const previous = this.nextConversationCursor();
    if (more && !previous) return;
    const generation = ++this.listGeneration;
    try {
      const page = await this.api.list(more ? previous : undefined);
      if (generation !== this.listGeneration || account !== this.currentAccount) return;
      const all = new Map((more ? this.conversations() : []).map((item) => [item.id, item]));
      for (const item of page.items) all.set(item.id, item);
      const id = this.active();
      if (id && !all.has(id)) {
        const item = this.conversations().find((item) => item.id === id);
        if (item) all.set(id, item);
      }
      this.conversations.set(
        [...all.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
      this.nextConversationCursor.set(page.nextCursor);
    } catch (error) {
      if (generation === this.listGeneration) this.notices.error(error);
    } finally {
      if (generation === this.listGeneration) this.loadingConversations.set(false);
    }
  }
  upsert(conversation: Conversation) {
    this.conversations.update((items) =>
      [conversation, ...items.filter((item) => item.id !== conversation.id)].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    );
  }
  private change(id: string, fn: (items: ChatMessage[]) => ChatMessage[]) {
    this.messages.update((all) => ({ ...all, [id]: fn(all[id] ?? []) }));
  }
  private ingest(id: string, items: Message[]) {
    this.change(id, (old) =>
      mergeMessages(
        old,
        items
          .filter((item) => !this.hidden.has(item.messageId))
          .map((item) => {
            const receipts = this.earlyReceipts.get(item.messageId) ?? [];
            this.earlyReceipts.delete(item.messageId);
            return receipts.reduce(receiptFor, item);
          }),
      ),
    );
  }
  async open(id: string) {
    const account = this.auth.user()?.id;
    if (!account) return false;
    this.account(account);
    const selection = ++this.selection;
    this.active.set(id);
    this.loadingOlder.set(false);
    this.loadingHistory.set(!this.knownHistory.has(id));
    try {
      const conversation = await this.api.conversation(id);
      if (this.selection !== selection) return false;
      this.upsert(conversation);
      if (this.live.status() === 'online')
        void this.live.emit(events.join, { conversationId: id }).catch(() => undefined);
      await this.backfill(id);
      return selection === this.selection;
    } catch (error) {
      if (selection === this.selection) this.notices.error(error);
      return false;
    } finally {
      if (this.selection === selection) this.loadingHistory.set(false);
    }
  }
  close(id: string) {
    if (this.active() === id) {
      this.active.set(null);
      this.selection++;
    }
  }
  async olderPage(id: string) {
    const before = this.older()[id];
    if (!before || this.loadingOlder()) return;
    const account = this.currentAccount;
    this.loadingOlder.set(true);
    try {
      const page = await this.api.history(id, { before });
      if (account !== this.currentAccount) return;
      this.ingest(id, page.items);
      this.older.update((items) => ({ ...items, [id]: page.nextCursor }));
      this.receiptsFor(id, page.items);
    } catch (error) {
      if (account === this.currentAccount) this.notices.error(error);
    } finally {
      if (account === this.currentAccount && this.active() === id) this.loadingOlder.set(false);
    }
  }
  async backfill(id: string) {
    const account = this.currentAccount;
    if (!account) return;
    const baseline = (this.messages()[id] ?? []).filter((message) => !message.localStatus).at(-1);
    const latest = baseline?.messageId;
    try {
      if (latest) {
        let after: string | undefined = latest;
        while (after) {
          const next = await this.api.history(id, { after });
          if (account !== this.currentAccount) return;
          this.ingest(id, next.items);
          this.receiptsFor(id, next.items);
          after = next.nextCursor;
        }
      }
      const page = await this.api.history(id);
      if (account !== this.currentAccount) return;
      this.knownHistory.add(id);
      const first = page.items[0];
      const end = page.items.at(-1) ?? baseline;
      const present = new Set(page.items.map((item) => item.messageId));
      const order = (message: Message) => message.sequence ?? 0;
      const cmp = (a: Message, b: Message) =>
        order(a) - order(b) || a.messageId.localeCompare(b.messageId);
      this.change(id, (old) =>
        old.filter(
          (item) =>
            item.localStatus ||
            !end ||
            cmp(item, end) > 0 ||
            (first && cmp(item, first) < 0) ||
            present.has(item.messageId),
        ),
      );
      this.ingest(id, page.items);
      this.older.update((all) => (this.older()[id] ? all : { ...all, [id]: page.nextCursor }));
      this.receiptsFor(id, this.messages()[id] ?? []);
    } catch (error) {
      if (account === this.currentAccount && id === this.active()) this.notices.error(error);
    }
  }
  private receiptsFor(id: string, items: Message[]) {
    if (this.live.status() !== 'online' || !this.currentAccount) return;
    const canRead = this.active() === id && document.visibilityState === 'visible';
    const incoming = items.filter(
      (message) => message.senderId !== this.currentAccount && !message.deletedForEveryone,
    );
    for (const message of incoming) {
      this.sendReceipt(id, message.messageId, canRead ? 'read' : 'delivered');
    }
  }
  private sendReceipt(id: string, mid: string, kind: 'delivered' | 'read') {
    const account = this.currentAccount;
    const tracking = kind === 'read' ? this.read : this.delivered;
    const key = `${kind}:${mid}`;
    if (tracking.has(mid) || this.receiptsInFlight.has(key)) return;
    this.receiptsInFlight.add(key);
    void this.live
      .emit(kind === 'read' ? events.read : events.delivered, {
        conversationId: id,
        messageId: mid,
      })
      .then(() => {
        if (account === this.currentAccount) {
          tracking.add(mid);
          this.delivered.add(mid);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (account === this.currentAccount) this.receiptsInFlight.delete(key);
      });
  }
  queue(input: SendMessage) {
    const senderId = this.currentAccount;
    if (!senderId) return;
    const optimistic: ChatMessage = {
      ...input,
      messageId: input.clientMessageId,
      senderId,
      createdAt: new Date().toISOString(),
      deliveredTo: [],
      readBy: [],
      deletedForEveryone: false,
      localStatus: 'pending',
      input,
    };
    this.change(input.conversationId, (items) => mergeMessages(items, [optimistic]));
    void this.send(input);
  }
  retry(message: ChatMessage) {
    if (message.localStatus !== 'failed' || !message.input) return;
    this.updateLocal(message.input, { localStatus: 'pending' });
    void this.send(message.input);
  }
  private updateLocal(input: SendMessage, patch: Partial<ChatMessage>) {
    this.change(input.conversationId, (items) =>
      items.map((item) =>
        item.clientMessageId === input.clientMessageId &&
        item.senderId === this.currentAccount &&
        item.localStatus
          ? { ...item, ...patch }
          : item,
      ),
    );
  }
  private async send(input: SendMessage) {
    const account = this.currentAccount;
    try {
      const ack = await this.live.emit<SendAccepted>(events.send, input);
      if (account === this.currentAccount)
        this.updateLocal(input, { messageId: ack.messageId, localStatus: 'sent' });
    } catch (error) {
      if (account !== this.currentAccount) return;
      this.updateLocal(input, { localStatus: 'failed' });
      this.notices.error(error);
    }
  }
}
