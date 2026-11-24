import { Component, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { Conversation, User } from '@relay/shared/browser';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { NoticesService } from '../../core/notifications/notices.service';
import { UserDirectoryApi } from '../../core/users/user-directory.api';
import { initials, tone } from '../../shared/ui/avatar';
import { ChatApi } from '../data-access/chat.api';
import { ChatStore } from '../state/chat.store';

@Component({
  selector: 'relay-group-details',
  imports: [FormsModule],
  templateUrl: './group-details.html',
  styles: ':host { display: contents; }',
})
export class GroupDetails {
  readonly conversation = input.required<Conversation>();
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ChatApi);
  private readonly store = inject(ChatStore);
  private readonly directory = inject(UserDirectoryApi);
  private readonly notices = inject(NoticesService);
  private readonly router = inject(Router);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('groupDialog');
  protected readonly initials = initials;
  protected readonly tone = tone;
  readonly memberSearch = signal('');
  readonly memberResults = signal<User[]>([]);
  readonly groupName = signal('');
  readonly groupBusy = signal(false);
  readonly isAdmin = computed(() =>
    this.conversation().members.some(
      ({ user, role }) => user.id === this.auth.user()?.id && role === 'admin',
    ),
  );
  open() {
    this.groupName.set(this.conversation().name ?? '');
    this.memberSearch.set('');
    this.memberResults.set([]);
    this.dialog().nativeElement.showModal();
  }
  async findMembers(value: string) {
    this.memberSearch.set(value);
    if (value.trim().length < 2) {
      this.memberResults.set([]);
      return;
    }
    const query = value.trim();
    try {
      const items = await firstValueFrom(this.directory.search(query));
      if (this.memberSearch().trim() === query) {
        const users = new Set(this.conversation().members.map(({ user }) => user.id));
        this.memberResults.set(items.filter((item) => !users.has(item.id)));
      }
    } catch (error) {
      this.notices.error(error);
    }
  }
  async groupAction(action: 'rename' | 'add' | 'remove' | 'leave', userId?: string) {
    if (this.groupBusy()) return;
    const id = this.conversation().id;
    this.groupBusy.set(true);
    try {
      switch (action) {
        case 'rename':
          this.store.upsert(await this.api.rename(id, this.groupName().trim()));
          break;
        case 'add':
          if (userId) await this.api.addMembers(id, [userId]);
          this.memberResults.set([]);
          break;
        case 'remove':
          if (userId) await this.api.removeMembers(id, [userId]);
          break;
        case 'leave':
          await this.api.leave(id);
          await this.router.navigateByUrl('/chats');
          return;
      }
      this.store.upsert(await this.api.conversation(id));
    } catch (error) {
      this.notices.error(error);
    } finally {
      this.groupBusy.set(false);
    }
  }
}
