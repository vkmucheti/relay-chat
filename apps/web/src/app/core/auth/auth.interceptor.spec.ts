import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';

const user = {
  id: '000000000000000000000001',
  username: 'river',
  displayName: 'River',
  email: 'river@relay.example',
};
describe('authInterceptor', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('refreshes simultaneous unauthorized requests once and retries both with the new token', async () => {
    const auth = TestBed.inject(AuthService);
    const http = TestBed.inject(HttpClient);
    const test = TestBed.inject(HttpTestingController);
    const login = auth.signIn('river', 'test');
    test.expectOne('/api/v1/auth/login').flush({ accessToken: 'old', user });
    await login;
    const a = firstValueFrom(http.get('/api/v1/one'));
    const b = firstValueFrom(http.get('/api/v1/two'));
    for (const path of ['/api/v1/one', '/api/v1/two']) {
      const req = test.expectOne(path);
      expect(req.request.headers.get('Authorization')).toBe('Bearer old');
      req.flush({}, { status: 401, statusText: 'Unauthorized' });
    }
    const refresh = test.expectOne('/api/v1/auth/refresh');
    expect(refresh.request.withCredentials).toBe(true);
    refresh.flush({ accessToken: 'new', user });
    await auth.refresh();
    for (const path of ['/api/v1/one', '/api/v1/two']) {
      const req = test.expectOne(path);
      expect(req.request.headers.get('Authorization')).toBe('Bearer new');
      req.flush({ ok: true });
    }
    await expect(Promise.all([a, b])).resolves.toEqual([{ ok: true }, { ok: true }]);
    const presigned = firstValueFrom(http.put('https://storage.example/object', 'content'));
    const upload = test.expectOne('https://storage.example/object');
    expect(upload.request.headers.has('Authorization')).toBe(false);
    upload.flush(null);
    await presigned;
  });
});
