import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { User } from '@relay/shared/browser';
import { environment } from '../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class UserDirectoryApi {
  private readonly http = inject(HttpClient);
  private url(path: string) {
    return environment.api + path;
  }
  search(q: string) {
    return this.http.get<User[]>(this.url('/users/search'), { params: { q } });
  }
}
