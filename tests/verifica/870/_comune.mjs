// Aiuti delle prove di verifica di #870: la home pronta e l'ordine delle colonne.
import { expect } from '../../fixtures/electron.mjs';

export async function home(app) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) {
      await w.waitForLoadState('domcontentloaded');
      await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
      return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}
export const ordine = (page, col) => page.locator(`#${col} > .dash-carta`).evaluateAll((ns) => ns.map((n) => n.dataset.tipo));

// Trascina col mouse vero la carta `da` fino a `frazione` dell'altezza della carta `su`, e la lascia lì.
export async function trascina(page, da, su, frazione) {
  const a = await da.boundingBox();
  const b = await su.boundingBox();
  await page.mouse.move(a.x + 60, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 10, { steps: 3 });
  await page.mouse.move(b.x + 60, b.y + b.height * frazione, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}
