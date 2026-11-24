import type { Routes } from '@angular/router';

export const chatRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./conversations-shell/conversations-shell').then(
        (module) => module.ConversationsShell,
      ),
    children: [
      {
        path: ':conversationId',
        loadComponent: () =>
          import('./conversation-pane/conversation-pane').then((module) => module.ConversationPane),
      },
    ],
  },
];
