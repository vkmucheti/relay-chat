import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { AuthSession, Me } from '@relay/shared/browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly router = inject(Router);
  private readonly state = signal<AuthSession | null>(null);
  readonly user = computed(() => this.state()?.user ?? null);
  readonly token = computed(() => this.state()?.accessToken ?? null);
  private refreshFlight?: Promise<AuthSession | null>;
  private started?: Promise<AuthSession | null>;
  private generation = 0;

  restore() {
    return (this.started ??= this.refresh());
  }
  private async cookieRequest<T>(endpoint: string, body: unknown) {
    const request = () =>
      firstValueFrom(
        this.http.post<T>(`${environment.api}/auth/${endpoint}`, body, { withCredentials: true }),
      );
    // Tabs share the httpOnly cookie and must not rotate it concurrently.
    return typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('relay-session-cookie', request)
      : request();
  }
  refresh() {
    if (this.refreshFlight) return this.refreshFlight;
    const generation = this.generation;
    this.refreshFlight = this.cookieRequest<AuthSession>('refresh', {})
      .then((result) => {
        if (generation !== this.generation) return null;
        this.state.set(result);
        return result;
      })
      .catch(() => {
        if (generation === this.generation) {
          const signedIn = this.state() !== null;
          this.state.set(null);
          if (signedIn) void this.router.navigateByUrl('/login');
        }
        return null;
      })
      .finally(() => {
        this.refreshFlight = undefined;
      });
    return this.refreshFlight;
  }
  async signIn(login: string, password: string) {
    this.generation++;
    this.state.set(await this.cookieRequest<AuthSession>('login', { login, password }));
    this.started = Promise.resolve(this.state());
  }
  async signUp(input: { username: string; email: string; displayName: string; password: string }) {
    this.generation++;
    this.state.set(await this.cookieRequest<AuthSession>('register', input));
    this.started = Promise.resolve(this.state());
  }
  update(user: Me) {
    const session = this.state();
    if (session) this.state.set({ ...session, user });
  }
  async logout() {
    this.generation++;
    this.state.set(null);
    this.started = Promise.resolve(null);
    try {
      await this.cookieRequest('logout', {});
    } finally {
      await this.router.navigateByUrl('/login');
    }
  }
}
