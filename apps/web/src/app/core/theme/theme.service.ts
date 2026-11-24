import { Injectable, effect, signal } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(
    localStorage.getItem('relay-theme') === 'dark' ||
      (!localStorage.getItem('relay-theme') && matchMedia('(prefers-color-scheme: dark)').matches),
  );
  constructor() {
    effect(() => {
      document.documentElement.dataset['theme'] = this.dark() ? 'dark' : 'light';
      localStorage.setItem('relay-theme', this.dark() ? 'dark' : 'light');
    });
  }
  toggle() {
    this.dark.update((value) => !value);
  }
}
