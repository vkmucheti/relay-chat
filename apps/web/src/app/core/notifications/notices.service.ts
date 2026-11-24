import { Injectable, signal } from '@angular/core';
import { describeError } from './describe-error';
@Injectable({ providedIn: 'root' })
export class NoticesService {
  readonly notice = signal('');
  private timer?: ReturnType<typeof setTimeout>;
  show(message: string) {
    clearTimeout(this.timer);
    this.notice.set(message);
    this.timer = setTimeout(() => this.notice.set(''), 5000);
  }
  error(error: unknown) {
    this.show(describeError(error));
  }
}
