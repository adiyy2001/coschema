import type { Provider } from '@angular/core';
import { Announcements } from './announcements';
import { KeyboardController } from './keyboard-controller';
import { RemoteChangeNarrator } from './remote-change-narrator';

export const A11Y_PROVIDERS: readonly Provider[] = [
  Announcements,
  KeyboardController,
  RemoteChangeNarrator,
];
