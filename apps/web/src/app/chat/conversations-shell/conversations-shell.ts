import { UserDirectoryApi } from '../../core/users/user-directory.api';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import type { Conversation, User } from '@relay/shared/browser';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  of,
  Subject,
  switchMap,
} from 'rxjs';
import { ChatApi } from '../data-access/chat.api';
import { AuthService } from '../../core/auth/auth.service';
import { NoticesService } from '../../core/notifications/notices.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ThemeService } from '../../core/theme/theme.service';
import { chatName, partner, preview } from '../conversation-display';
import { initials, tone } from '../../shared/ui/avatar';
import { ChatStore } from '../state/chat.store';

@Component({
  imports: [FormsModule, RouterLink, RouterOutlet, DatePipe],
  templateUrl: './conversations-shell.html',
})
export class ConversationsShell {
  readonly store = inject(ChatStore);
  readonly live = inject(RealtimeService);
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  private readonly directory = inject(UserDirectoryApi);
  private readonly api = inject(ChatApi);
  private readonly notices = inject(NoticesService);
  private readonly router = inject(Router);
  readonly activePath = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects.startsWith('/chats/')),
    ),
    { initialValue: this.router.url.startsWith('/chats/') },
  );
  readonly query = signal('');
  private readonly search = new Subject<string>();
  readonly results = signal<User[]>([]);
  readonly dialog = signal<'direct' | 'group'>('direct');
  readonly modalVisible = signal(false);
  readonly selected = signal<User[]>([]);
  readonly groupName = signal('');
  readonly busy = signal(false);
  readonly filtered = computed(() => {
    const needle = this.modalVisible() ? '' : this.query().toLowerCase().trim();
    return this.store
      .conversations()
      .filter((chat) => !needle || this.name(chat).toLowerCase().includes(needle));
  });
  readonly initials = initials;
  readonly preview = preview;
  readonly tone = tone;
  constructor() {
    this.search
      .pipe(
        debounceTime(230),
        distinctUntilChanged(),
        switchMap((query) =>
          query
            ? this.directory.search(query).pipe(
                catchError((error: unknown) => {
                  this.notices.error(error);
                  return of([] as User[]);
                }),
              )
            : of([] as User[]),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((items) => this.results.set(items));
  }
  name(chat: Conversation) {
    return chatName(chat, this.auth.user()?.id);
  }
  online(chat: Conversation) {
    const other = chat.type === 'direct' ? partner(chat, this.auth.user()?.id) : undefined;
    return other ? this.store.presence()[other.id]?.online : false;
  }
  open(dialog: HTMLDialogElement, mode: 'direct' | 'group') {
    this.dialog.set(mode);
    this.selected.set([]);
    this.groupName.set('');
    this.setQuery('');
    this.modalVisible.set(true);
    dialog.showModal();
  }
  closeDialog() {
    this.modalVisible.set(false);
    this.setQuery('');
  }
  setQuery(value: string) {
    this.query.set(value);
    this.search.next(value.trim());
    if (!value.trim()) this.results.set([]);
  }
  async begin(user: User, dialog?: HTMLDialogElement) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const chat = await this.api.direct(user.id);
      this.store.upsert(chat);
      this.setQuery('');
      dialog?.close();
      await this.router.navigate(['/chats', chat.id]);
    } catch (error) {
      this.notices.error(error);
    } finally {
      this.busy.set(false);
    }
  }
  toggle(user: User) {
    this.selected.update((users) =>
      users.some((item) => item.id === user.id)
        ? users.filter((item) => item.id !== user.id)
        : [...users, user],
    );
  }
  async create(dialog: HTMLDialogElement) {
    if (!this.groupName().trim() || !this.selected().length || this.busy()) return;
    this.busy.set(true);
    try {
      const chat = await this.api.group(
        this.groupName().trim(),
        this.selected().map((user) => user.id),
      );
      this.store.upsert(chat);
      this.setQuery('');
      dialog.close();
      await this.router.navigate(['/chats', chat.id]);
    } catch (error) {
      this.notices.error(error);
    } finally {
      this.busy.set(false);
    }
  }
}
