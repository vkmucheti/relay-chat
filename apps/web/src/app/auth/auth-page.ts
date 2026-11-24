import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { describeError } from '../core/notifications/describe-error';
import { ThemeService } from '../core/theme/theme.service';

@Component({
  imports: [FormsModule, RouterLink],
  templateUrl: './auth-page.html',
})
export class AuthPage {
  readonly register = inject(ActivatedRoute).snapshot.data['register'] === true;
  readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  login = '';
  username = '';
  email = '';
  password = '';
  displayName = '';
  async submit() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.register)
        await this.auth.signUp({
          username: this.username,
          email: this.email,
          password: this.password,
          displayName: this.displayName,
        });
      else await this.auth.signIn(this.login, this.password);
      await this.router.navigateByUrl('/chats');
    } catch (error) {
      this.error.set(describeError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
