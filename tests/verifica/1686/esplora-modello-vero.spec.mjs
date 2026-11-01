// Esplorazione col modello vero (si cancella): cosa sceglie davvero la chat per le frasi della segnalazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';
import { clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const KEY = process.env.OPENROUTER_API_KEY || '';
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);

async function vero(app) {
  await app.evaluate(async (_e, k) => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } });
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__usate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      const r = await orig(o);
      globalThis.__usate.push({ text: String(r.text || '').slice(0, 300), calls: (r.toolCalls || []).map((c) => `${c.name} ${c.arguments}`) });
      return r;
    };
  }, KEY);
}
const usate = (app) => app.evaluate(() => globalThis.__usate);
async function fine(page) {
  await expect(page.locator('.dash-activity').last()).toHaveAttribute('data-phase', /done|error/, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

test('togli nas dai siti sempre aperti', async ({ app, shell }) => {
  test.setTimeout(180_000);
  const page = await home(app);
  await vero(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addKeepOpen('nas'); await globalThis.SN_FILO_MEMORY.addKeepOpen('web.whatsapp.com'); });
  await chiedi(page, 'non tenere più sempre aperto il nas');
  await page.waitForTimeout(8000);
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok').catch(() => {});
  await fine(page);
  console.log('NAS', JSON.stringify(await usate(app)), JSON.stringify(await app.evaluate(async () => Object.keys(await globalThis.SN_FILO_MEMORY.listKeepOpen()))));
  await chiedi(page, 'tienimi sempre aperto https://com');
  await page.waitForTimeout(8000);
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok').catch(() => {});
  await fine(page);
  console.log('COM', JSON.stringify(await usate(app)), JSON.stringify(await app.evaluate(async () => Object.keys(await globalThis.SN_FILO_MEMORY.listKeepOpen()))));
});
