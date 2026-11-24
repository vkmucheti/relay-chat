import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NoticesService } from './core/notifications/notices.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'relay-root',
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    @if (notices.notice(); as notice) {
      <div class="toast" role="status" aria-live="polite">{{ notice }}</div>
    }
  `,
})
export class App {
  protected readonly notices = inject(NoticesService);
  private readonly theme = inject(ThemeService);
}
