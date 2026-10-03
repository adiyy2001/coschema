import { Title } from '@angular/platform-browser';
import {
  Injectable,
  inject,
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import type { RouterStateSnapshot } from '@angular/router';
import { TitleStrategy, provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const APP_NAME = 'coschema';

@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    this.title.setTitle(page === undefined ? APP_NAME : `${page} | ${APP_NAME}`);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: TitleStrategy, useExisting: AppTitleStrategy },
  ],
};
