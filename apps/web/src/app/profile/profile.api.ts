import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Contact, Me } from '@relay/shared/browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
@Injectable({ providedIn: 'root' })
export class ProfileApi {
  private readonly http = inject(HttpClient);
  private url(path: string) {
    return environment.api + path;
  }
  updateMe(input: { displayName: string; about: string }) {
    return firstValueFrom(this.http.patch<Me>(this.url('/users/me'), input));
  }
  contacts() {
    return firstValueFrom(this.http.get<Contact[]>(this.url('/contacts')));
  }
  saveContact(userId: string) {
    return firstValueFrom(this.http.post<Contact>(this.url('/contacts'), { userId }));
  }
  removeContact(id: string) {
    return firstValueFrom(this.http.delete<void>(this.url('/contacts/' + id)));
  }
}
