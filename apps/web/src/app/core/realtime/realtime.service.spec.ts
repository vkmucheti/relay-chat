import { TestBed } from '@angular/core/testing';
import { events } from '@relay/shared/browser';
import type { Socket } from 'socket.io-client';
import { AuthService } from '../auth/auth.service';
import { RealtimeService, SOCKET_FACTORY } from './realtime.service';

describe('RealtimeService', () => {
  it('reflects connectivity, forwards events and requires an acknowledged send', async () => {
    const handlers = new Map<string, (value?: unknown) => void>();
    const stub = {
      connected: false,
      on(name: string, listener: (value?: unknown) => void) {
        handlers.set(name, listener);
        return this;
      },
      connect() {
        this.connected = true;
        handlers.get('connect')?.();
        return this;
      },
      disconnect() {
        this.connected = false;
        return this;
      },
      removeAllListeners() {
        handlers.clear();
        return this;
      },
      timeout() {
        return this;
      },
      emitWithAck(event: string) {
        return Promise.resolve(
          event === events.send
            ? { status: 'sent' }
            : { ok: false, error: { message: 'Rejected' } },
        );
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token: () => 'test-token' } },
        {
          provide: SOCKET_FACTORY,
          useValue: (auth: (cb: (value: unknown) => void) => void) => {
            auth((payload) => expect(payload).toEqual({ token: 'test-token' }));
            return stub as unknown as Socket;
          },
        },
      ],
    });
    const service = TestBed.inject(RealtimeService);
    try {
      service.start('account');
      expect(service.status()).toBe('online');
      service.presence.subscribe((update) => expect(update.online).toBe(true));
      handlers.get(events.presence)?.({ userId: 'u', online: true });
      await expect(service.emit(events.send, {})).resolves.toEqual({ status: 'sent' });
      await expect(service.emit(events.join, {})).rejects.toThrow('Rejected');
      handlers.get('disconnect')?.('transport close');
      expect(service.status()).toBe('offline');
    } finally {
      service.stop();
    }
  });
});
