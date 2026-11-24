import { Component, DestroyRef, effect, inject, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatStore } from '../chat/state/chat.store';
import { AuthService } from '../core/auth/auth.service';
import { RealtimeService } from '../core/realtime/realtime.service';

@Component({
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AuthenticatedLayout {
  constructor() {
    const auth = inject(AuthService);
    const chat = inject(ChatStore);
    const realtime = inject(RealtimeService);
    inject(DestroyRef).onDestroy(() => {
      realtime.stop();
      chat.account(undefined);
    });

    effect(() => {
      const id = auth.user()?.id;
      untracked(() => {
        chat.account(id);
        if (id) realtime.start(id);
        else realtime.stop();
      });
    });
  }
}
