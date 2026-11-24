import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  events,
  type Ack,
  isAckError,
  type ConversationUpdate,
  type DeletedMessage,
  type Message,
  type PresenceUpdate,
  type ReceiptUpdate,
  type TypingUpdate,
} from '@relay/shared/browser';
import { Subject } from 'rxjs';
import { io, type Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';

export const makeSocket = (auth: (callback: (payload: Record<string, unknown>) => void) => void) =>
  io({
    path: environment.socketPath,
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    auth,
  });
export const SOCKET_FACTORY = new InjectionToken<typeof makeSocket>('Relay socket factory', {
  providedIn: 'root',
  factory: () => makeSocket,
});
type Status = 'offline' | 'connecting' | 'online';
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly socketFactory = inject(SOCKET_FACTORY);
  readonly status = signal<Status>('offline');
  readonly connected = new Subject<void>();
  readonly messages = new Subject<Message>();
  readonly receipts = new Subject<ReceiptUpdate>();
  readonly deletions = new Subject<DeletedMessage>();
  readonly typing = new Subject<TypingUpdate>();
  readonly presence = new Subject<PresenceUpdate>();
  readonly conversations = new Subject<ConversationUpdate>();
  private socket?: Socket;
  private heartbeat?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private account?: string;

  start(account: string) {
    if (this.account === account && this.socket) return;
    this.stop();
    this.account = account;
    const socket = this.socketFactory((done) => done({ token: this.auth.token() }));
    this.socket = socket;
    this.status.set('connecting');
    socket.on('connect', () => {
      this.status.set('online');
      this.connected.next();
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(
        () => void this.emit(events.ping, {}).catch(() => undefined),
        20000,
      );
    });
    socket.on('disconnect', (reason) => {
      clearInterval(this.heartbeat);
      this.status.set('offline');
      if (reason === 'io server disconnect') this.retryConnection(socket, true);
    });
    socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
      this.status.set('offline');
      if (!socket.active) this.retryConnection(socket, error.data?.code === 'UNAUTHORIZED');
    });
    socket.on(events.newMessage, (value: Message) => this.messages.next(value));
    socket.on(events.receipt, (value: ReceiptUpdate) => this.receipts.next(value));
    socket.on(events.deleted, (value: DeletedMessage) => this.deletions.next(value));
    socket.on(events.presence, (value: PresenceUpdate) => this.presence.next(value));
    socket.on(events.typing, (value: TypingUpdate) => this.typing.next(value));
    socket.on(events.conversation, (value: ConversationUpdate) => this.conversations.next(value));
    socket.connect();
  }
  private retryConnection(socket: Socket, refresh: boolean) {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      void (async () => {
        if (refresh && !(await this.auth.refresh())) return;
        if (this.socket === socket && this.auth.token()) {
          this.status.set('connecting');
          socket.connect();
        }
      })();
    }, 800);
  }
  async emit<T>(event: string, value: unknown): Promise<T> {
    if (!this.socket?.connected) throw new Error('Reconnecting. Try again when you are online.');
    const result = (await this.socket.timeout(15000).emitWithAck(event, value)) as Ack<T>;
    if (isAckError(result)) throw new Error(result.error.message);
    return result;
  }
  stop() {
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.account = undefined;
    this.status.set('offline');
  }
}
