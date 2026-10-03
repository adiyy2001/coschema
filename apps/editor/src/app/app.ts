import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'cs-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <a class="skip-link" href="#main" (click)="skipToMain($event)">Skip to the main content</a>
    <router-outlet />
  `,
})
export class App {
  protected skipToMain(event: Event): void {
    event.preventDefault();
    globalThis.document.getElementById('main')?.focus();
  }
}
