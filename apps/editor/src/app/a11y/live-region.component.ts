import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Announcements } from './announcements';
import { RemoteChangeNarrator } from './remote-change-narrator';

@Component({
  selector: 'cs-live-region',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
  `,
  template: `<div role="status" aria-live="polite" aria-atomic="true" data-live-region>
    {{ announcements.message() }}
  </div>`,
})
export class LiveRegionComponent {
  protected readonly announcements = inject(Announcements);

  constructor() {
    inject(RemoteChangeNarrator);
  }
}
