import { UserDirectoryApi } from '../core/users/user-directory.api';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Contact, User } from '@relay/shared/browser';
import { firstValueFrom } from 'rxjs';
import { ProfileApi } from './profile.api';
import { AuthService } from '../core/auth/auth.service';
import { NoticesService } from '../core/notifications/notices.service';
import { initials, tone } from '../shared/ui/avatar';
@Component({
  imports: [FormsModule, RouterLink],
  templateUrl: './profile.html',
})
export class Profile {
  readonly auth = inject(AuthService);
  private readonly directory = inject(UserDirectoryApi);
  private readonly api = inject(ProfileApi);
  private readonly notices = inject(NoticesService);
  readonly busy = signal(false);
  readonly contacts = signal<Contact[]>([]);
  readonly results = signal<User[]>([]);
  readonly initials = initials;
  readonly tone = tone;
  displayName = this.auth.user()?.displayName ?? '';
  about = this.auth.user()?.about ?? '';
  query = '';
  constructor() {
    void this.reload();
  }
  private async reload() {
    try {
      this.contacts.set(await this.api.contacts());
    } catch (error) {
      this.notices.error(error);
    }
  }
  async save() {
    this.busy.set(true);
    try {
      this.auth.update(
        await this.api.updateMe({ displayName: this.displayName, about: this.about }),
      );
      this.notices.show('Profile saved.');
    } catch (error) {
      this.notices.error(error);
    } finally {
      this.busy.set(false);
    }
  }
  async find() {
    try {
      this.results.set(await firstValueFrom(this.directory.search(this.query.trim())));
    } catch (error) {
      this.notices.error(error);
    }
  }
  async add(user: User) {
    try {
      await this.api.saveContact(user.id);
      this.results.update((items) => items.filter((item) => item.id !== user.id));
      await this.reload();
    } catch (error) {
      this.notices.error(error);
    }
  }
  async remove(contact: Contact) {
    try {
      await this.api.removeContact(contact.id);
      await this.reload();
    } catch (error) {
      this.notices.error(error);
    }
  }
  async signOut() {
    try {
      await this.auth.logout();
    } catch (error) {
      this.notices.error(error);
    }
  }
}
