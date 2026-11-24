import { GroupDetails } from '../group-details/group-details';
import { AttachmentApi } from '../attachments/attachment.api';
import { UserDirectoryApi } from '../../core/users/user-directory.api';
import { DatePipe } from '@angular/common';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { events, uploadLimit, uploadTypes, type Message } from '@relay/shared/browser';
import { ChatApi } from '../data-access/chat.api';
import { AuthService } from '../../core/auth/auth.service';
import { NoticesService } from '../../core/notifications/notices.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { chatName, partner, preview } from '../conversation-display';
import { initials, tone } from '../../shared/ui/avatar';
import { ChatStore } from '../state/chat.store';
import { type ChatMessage } from '../state/chat-message';

const rowSize = 103;
const blank: ChatMessage[] = [];
type Row =
  | { key: string; date: string; message?: undefined }
  | { key: string; message: ChatMessage; date?: undefined };
@Component({
  selector: 'relay-pane',
  imports: [RouterLink, DatePipe, FormsModule, ScrollingModule, GroupDetails],
  templateUrl: './conversation-pane.html',
})
export class ConversationPane {
  readonly store = inject(ChatStore);
  readonly auth = inject(AuthService);
  readonly live = inject(RealtimeService);
  private readonly directory = inject(UserDirectoryApi);
  private readonly attachments = inject(AttachmentApi);
  private readonly api = inject(ChatApi);
  private readonly notices = inject(NoticesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly id = signal('');
  readonly draft = signal('');
  readonly reply = signal<ChatMessage | undefined>(undefined);
  readonly emoji = signal(false);
  readonly uploadProgress = signal<number | undefined>(undefined);
  readonly signedImages = signal<Record<string, string>>({});
  readonly activeImage = signal<string | undefined>(undefined);
  readonly actionMessage = signal<ChatMessage | undefined>(undefined);
  readonly current = computed(() =>
    this.store.conversations().find((item) => item.id === this.id()),
  );
  readonly name = computed(() => {
    const chat = this.current();
    return chat ? chatName(chat, this.auth.user()?.id) : 'Conversation';
  });
  readonly history = computed(() => this.store.messages()[this.id()] ?? blank);
  readonly viewport = viewChild(CdkVirtualScrollViewport);
  readonly selectedMessages = computed(
    () => new Map(this.history().map((item) => [item.messageId, item])),
  );
  readonly rows = computed(() => {
    const rows: Row[] = [];
    let day = '';
    for (const message of this.history()) {
      const date = new Date(message.createdAt).toLocaleDateString();
      if (date !== day) {
        rows.push({ key: 'day:' + date, date: message.createdAt });
        day = date;
      }
      rows.push({ key: message.senderId + ':' + message.clientMessageId, message });
    }
    return rows;
  });
  readonly activity = computed(() => {
    const chat = this.current();
    if (!chat) return '';
    const typists = this.store.typists()[chat.id] ?? [];
    if (typists.length) {
      if (chat.type === 'direct') return 'Typing…';
      const user = chat.members.find((item) => item.user.id === typists[0])?.user.displayName;
      return typists.length === 1
        ? `${user ?? 'Someone'} is typing…`
        : 'Several people are typing…';
    }
    if (chat.type === 'group') return chat.members.length + ' members';
    const user = partner(chat, this.auth.user()?.id);
    if (!user) return '';
    const state = this.store.presence()[user.id];
    if (state?.online) return 'Online';
    const seen = state?.lastSeenAt ?? user.lastSeenAt;
    return seen
      ? `Last seen ${new Date(seen).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Offline';
  });
  readonly emojis = ['🙂', '😀', '😂', '❤️', '👍', '🎉', '🙌', '✨', '😅', '👀', '🤝', '🚀'];
  readonly accept = uploadTypes.join(',');
  readonly initials = initials;
  readonly preview = preview;
  readonly tone = tone;
  readonly rowSize = rowSize;
  readonly trackRow = (_index: number, row: Row) => row.key;
  private typingTimer?: ReturnType<typeof setTimeout>;
  private lastTyping = 0;
  private nextImageRequest = new Map<string, number>();
  private renderedId = '';
  private renderedCount = 0;
  private adjusting = false;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('conversationId');
      if (!id) return;
      const previous = this.id();
      if (previous) {
        this.stopTyping(previous);
        this.store.close(previous);
      }
      this.id.set(id);
      this.draft.set('');
      this.reply.set(undefined);
      this.emoji.set(false);
      this.signedImages.set({});
      this.nextImageRequest.clear();
      this.olderScrollReset();
      void this.store.open(id).then((opened) => {
        if (!opened && this.id() === id) void this.router.navigateByUrl('/chats');
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.stopTyping(this.id());
      this.store.close(this.id());
    });
    this.live.conversations.pipe(takeUntilDestroyed()).subscribe((change) => {
      if (change.conversationId !== this.id()) return;
      if (change.removed) void this.router.navigateByUrl('/chats');
    });
    effect(() => {
      const viewport = this.viewport();
      const rows = this.rows();
      const id = this.id();
      const isOlder = this.store.loadingOlder();
      if (!viewport || !rows.length || isOlder) return;
      if (
        id !== this.renderedId ||
        !this.renderedCount ||
        (rows.length > this.renderedCount && viewport.measureScrollOffset('bottom') < rowSize * 2)
      ) {
        this.scrollToEnd();
      }
      this.renderedCount = rows.length;
      this.renderedId = id;
    });
  }
  private olderScrollReset() {
    this.renderedCount = 0;
    this.adjusting = false;
  }
  private scrollToEnd() {
    requestAnimationFrame(() => this.viewport()?.scrollTo({ bottom: 0, behavior: 'instant' }));
  }
  async scrolled(index: number) {
    const viewport = this.viewport();
    const id = this.id();
    if (
      !viewport ||
      index > 2 ||
      this.adjusting ||
      !this.store.older()[id] ||
      this.store.loadingOlder() ||
      !this.renderedCount ||
      viewport.measureScrollOffset('bottom') < rowSize
    )
      return;
    this.adjusting = true;
    const previousOffset = viewport.measureScrollOffset();
    const anchor = this.rows()[index]?.key;
    await this.store.olderPage(id);
    if (this.id() !== id) return;
    const updated = this.rows().findIndex((row) => row.key === anchor);
    requestAnimationFrame(() => {
      if (updated >= index) viewport.scrollToOffset(previousOffset + (updated - index) * rowSize);
      this.adjusting = false;
    });
  }
  sender(message: ChatMessage) {
    return (
      this.current()?.members.find(({ user }) => user.id === message.senderId)?.user.displayName ??
      'Former member'
    );
  }
  status(message: ChatMessage) {
    if (message.localStatus === 'failed') return 'Failed';
    if (message.localStatus === 'pending') return 'Pending';
    if (message.readBy.length) return 'Read';
    if (message.deliveredTo.length) return 'Delivered';
    return 'Sent';
  }
  isMine(message: Message) {
    return message.senderId === this.auth.user()?.id;
  }
  selectReply(message: ChatMessage, dialog: HTMLDialogElement, composer: HTMLTextAreaElement) {
    this.reply.set(message);
    dialog.close();
    composer.focus();
  }
  @HostListener('window:pagehide')
  stopTyping(id = this.id()) {
    clearTimeout(this.typingTimer);
    if (id && this.lastTyping) {
      this.lastTyping = 0;
      void this.live.emit(events.typingStop, { conversationId: id }).catch(() => undefined);
    }
  }
  changeDraft(value: string) {
    this.draft.set(value);
    if (!value.trim()) {
      this.stopTyping();
      return;
    }
    const now = Date.now();
    const conversationId = this.id();
    if (!this.lastTyping || now - this.lastTyping > 2200) {
      this.lastTyping = now;
      void this.live.emit(events.typingStart, { conversationId }).catch(() => undefined);
    }
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.stopTyping(conversationId), 3000);
  }
  keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }
  send() {
    const body = this.draft().trim();
    if (!body || this.live.status() !== 'online') return;
    this.store.queue({
      conversationId: this.id(),
      clientMessageId: crypto.randomUUID(),
      type: 'text',
      body,
      replyTo: this.reply()?.messageId,
    });
    this.draft.set('');
    this.reply.set(undefined);
    this.emoji.set(false);
    this.stopTyping();
    this.scrollToEnd();
  }
  appendEmoji(emoji: string, composer: HTMLTextAreaElement) {
    const draft = this.draft();
    const start = composer.selectionStart,
      end = composer.selectionEnd;
    const value = draft.slice(0, start) + emoji + draft.slice(end);
    if (value.length <= 4000) this.changeDraft(value);
    this.emoji.set(false);
    requestAnimationFrame(() => {
      composer.focus();
      composer.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }
  async attachment(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploadProgress() !== undefined) return;
    if (
      !uploadTypes.some((mime) => mime === file.type) ||
      file.size < 1 ||
      file.size > uploadLimit
    ) {
      this.notices.show('Choose a supported attachment smaller than 10 MB.');
      return;
    }
    const id = this.id();
    const replyTo = this.reply()?.messageId;
    this.uploadProgress.set(0);
    try {
      const ticket = await this.attachments.upload({
        conversationId: id,
        mimeType: file.type,
        size: file.size,
        fileName: file.name,
      });
      await this.attachments.put(ticket, file, (progress) => this.uploadProgress.set(progress));
      this.store.queue({
        conversationId: id,
        clientMessageId: crypto.randomUUID(),
        type: file.type.startsWith('image/') ? 'image' : 'file',
        mediaKey: ticket.key,
        replyTo,
      });
      if (id === this.id()) {
        this.reply.set(undefined);
        this.stopTyping();
        this.scrollToEnd();
      }
    } catch (error) {
      this.notices.error(error);
    } finally {
      this.uploadProgress.set(undefined);
    }
  }
  imagePreview(key: string | undefined) {
    if (!key) return undefined;
    if ((this.nextImageRequest.get(key) ?? 0) < Date.now()) {
      this.nextImageRequest.set(key, Date.now() + 100000);
      void this.attachments
        .download(key)
        .then(({ url }) => {
          this.signedImages.update((value) => ({ ...value, [key]: url }));
        })
        .catch(() => this.nextImageRequest.set(key, Date.now() + 5000));
    }
    return this.signedImages()[key];
  }
  async showImage(key: string | undefined, dialog: HTMLDialogElement) {
    if (!key) return;
    try {
      const { url } = await this.attachments.download(key);
      this.activeImage.set(url);
      dialog.showModal();
    } catch (error) {
      this.notices.error(error);
    }
  }
  async download(key: string | undefined) {
    if (!key) return;
    try {
      const { url } = await this.attachments.download(key);
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.click();
    } catch (error) {
      this.notices.error(error);
    }
  }
  showActions(message: ChatMessage, dialog: HTMLDialogElement) {
    this.actionMessage.set(message);
    dialog.showModal();
  }
  async delete(message: ChatMessage, scope: 'me' | 'everyone', dialog: HTMLDialogElement) {
    try {
      await this.api.remove(message.messageId, scope);
      dialog.close();
    } catch (error) {
      this.notices.error(error);
    }
  }
}
