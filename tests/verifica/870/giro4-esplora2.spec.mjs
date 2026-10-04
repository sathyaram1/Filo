// Verifica #870 giro 4: esplorazione (si cancella prima della critica).
import { test, expect } from '../../fixtures/electron.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(ROOT, 'tests', '.shots');

async function home(app, escludi = null) {
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
const ordineDestra = (page) => page.locator('#tieni > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));
const ordineSinistra = (page) => page.locator('#accade > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));

test('trascinamenti fra colonne e verso altro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Pasta', seconds: 600 });
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Forno', seconds: 900 });
  });
  await expect(page.locator('#accade .dash-carta[data-tipo="timer"]')).toHaveCount(2, { timeout: 10_000 });
  console.log('sx prima', await ordineSinistra(page));
  await page.locator('#accade .dash-carta[data-tipo="timer"]').first().dragTo(page.locator('#tieni .dash-carta[data-tipo="editor"]'));
  await page.waitForTimeout(500);
  console.log('dx dopo drag timer su editor', await ordineDestra(page), 'sx', await ordineSinistra(page));
  // riordino a sinistra per trascinamento
  await page.locator('#accade .dash-carta', { hasText: 'Forno' }).dragTo(page.locator('#accade .dash-carta', { hasText: 'Crediti' }), { targetPosition: { x: 20, y: 5 } });
  await page.waitForTimeout(500);
  console.log('sx dopo drag forno su crediti', await ordineSinistra(page));
  await page.locator('#tieni .dash-carta[data-tipo="rapide"]').dragTo(page.locator('#altro'));
  await page.waitForTimeout(500);
  console.log('dx dopo rapide in altro', await ordineDestra(page));
  // tolta: clic sull'icona in altro
  await page.locator('#altro .dash-altro-app[data-id="rapide"]').click();
  await page.waitForTimeout(1500);
  console.log('finestre', app.windows().map((w) => w.url()).join(' | '));
  console.log('dx dopo clic icona rapide', await ordineDestra(page));
  // Tasto destro sulla zona vuota di altro
  await page.locator('#altro .dash-altro-tit').click({ button: 'right' });
  console.log('menu altro', await page.locator('.dash-menu .dash-menu-voce').allTextContents());
  await page.keyboard.press('Escape');
});

test('timer della chat cancellata, finestra stretta, molti documenti e mazzi', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.addTimer({ label: 'Orfano', seconds: 900, chat: 'chat-che-non-esiste' });
    await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Aggiornamento pronto.' });
  });
  await expect(page.locator('#accade .dash-carta', { hasText: 'Orfano' })).toBeVisible({ timeout: 10_000 });
  await page.locator('#accade .dash-carta', { hasText: 'Orfano' }).locator('.dash-carta-tit').click();
  await page.waitForTimeout(1500);
  console.log('stato body', await page.evaluate(() => document.body.dataset.state));
  console.log('bolle', await page.locator('.dash-bubble').allTextContents());
  console.log('flash', await page.locator('#dashFlash').textContent().catch(() => null));
  await expect(page.locator('#accade .dash-carta[data-tipo="avviso"]')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: join(SHOTS, 'v870g4-orfano.png') });
  const win = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(820, 640); return w.getSize(); });
  console.log('size', win);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, 'v870g4-stretta.png') });
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  console.log('doc stretta', JSON.stringify(doc));
});
