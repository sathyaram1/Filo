// Attrezzi delle prove della verifica #870: la home e la home incognito.
import { expect } from '../../fixtures/electron.mjs';

export async function home(app, escludi = null) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x !== escludi && x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

export const ordineDestra = (page) => page.locator('#tieni > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));
