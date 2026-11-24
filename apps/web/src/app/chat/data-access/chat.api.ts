import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Conversation, Message, Page } from '@relay/shared/browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly http = inject(HttpClient);
  private url(path: string) {
    return environment.api + path;
  }
  list(cursor?: string) {
    return firstValueFrom(
      this.http.get<Page<Conversation>>(this.url('/conversations'), {
        params: cursor ? { cursor } : {},
      }),
    );
  }
  conversation(id: string) {
    return firstValueFrom(this.http.get<Conversation>(this.url('/conversations/' + id)));
  }
  direct(userId: string) {
    return firstValueFrom(
      this.http.post<Conversation>(this.url('/conversations/direct'), { userId }),
    );
  }
  group(name: string, userIds: string[]) {
    return firstValueFrom(
      this.http.post<Conversation>(this.url('/conversations/group'), { name, userIds }),
    );
  }
  rename(id: string, name: string) {
    return firstValueFrom(
      this.http.patch<Conversation>(this.url('/conversations/' + id), { name }),
    );
  }
  addMembers(id: string, userIds: string[]) {
    return firstValueFrom(this.http.post(this.url(`/conversations/${id}/members`), { userIds }));
  }
  removeMembers(id: string, userIds: string[]) {
    return firstValueFrom(
      this.http.delete(this.url(`/conversations/${id}/members`), { body: { userIds } }),
    );
  }
  leave(id: string) {
    return firstValueFrom(this.http.post(this.url(`/conversations/${id}/leave`), {}));
  }
  history(id: string, position: { before?: string; after?: string } = {}) {
    const params: Record<string, string> = {};
    if (position.before) params['before'] = position.before;
    if (position.after) params['after'] = position.after;
    return firstValueFrom(
      this.http.get<Page<Message>>(this.url(`/conversations/${id}/messages`), { params }),
    );
  }
  remove(id: string, scope: 'me' | 'everyone') {
    return firstValueFrom(
      this.http.delete<void>(this.url('/messages/' + id), { params: { scope } }),
    );
  }
}
