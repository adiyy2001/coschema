import { PAGES_SITE_ROOT } from '../../scripts/pages-site';
import { startPagesServer } from '../../scripts/static-server';
import { PAGES_PORT } from '../playwright.pages.config';

export default async function pagesSetup(): Promise<() => Promise<void>> {
  const site = await startPagesServer(PAGES_SITE_ROOT, PAGES_PORT, '127.0.0.1');
  return async () => {
    await site.close();
  };
}
