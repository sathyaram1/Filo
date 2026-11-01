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
      globalThis.__usate.push({ model: r.model, text: String(r.text || '').slice(0, 300), calls: (r.toolCalls || []).map((c) => `${c.name} ${c.arguments}`) });
      return r;
    };
  }, KEY);
}
const usate = (app) => app.evaluate(() => globalThis.__usate);
async function fine(page) {
  await expect(page.locator('.dash-activity').last()).toHaveAttribute('data-phase', /done|error/, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

test('chiudi la seconda scheda (ordine barra diverso dalla recenza)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await home(app);
  await vero(app);
  for (const t of ['Alfa ricette', 'Beta notizie', 'Gamma meteo', 'Delta sport']) await openTab(testServer.html(`<title>${t}</title><p>${t}`));
  const s = await schede(shell);
  for (const t of ['Delta sport', 'Gamma meteo', 'Beta notizie']) await shell.evaluate((id) => window.filoShell.tabs.activate(id), s.find((x) => x.title === t).id);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), s.find((x) => String(x.url).startsWith('filo://newtab')).id);
  await chiedi(page, 'chiudi la seconda scheda');
  await page.waitForTimeout(8000);
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok').catch(() => {});
  await fine(page);
  console.log('SECONDA', JSON.stringify(await usate(app)), JSON.stringify((await schede(shell)).map((t) => t.title)));
});

test('riordinami le tab', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await home(app);
  await vero(app);
  for (const t of ['Alfa ricette', 'Beta notizie', 'Gamma meteo']) await openTab(testServer.html(`<title>${t}</title><p>${t}`));
  const s = await schede(shell);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), s.find((x) => String(x.url).startsWith('filo://newtab')).id);
  await chiedi(page, 'riordinami le tab');
  await fine(page);
  console.log('RIORDINO', JSON.stringify(await usate(app)), await page.locator('.dash-activity').last().innerText().catch(() => ''));
});

test('chiudi tutte le schede di wikipedia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await home(app);
  await vero(app);
  await openTab(testServer.html('<title>Orche - Wikipedia</title><p>orche', { pubblico: true }));
  await openTab(testServer.html('<title>Ricetta</title><p>r'));
  const s = await schede(shell);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), s.find((x) => String(x.url).startsWith('filo://newtab')).id);
  await chiedi(page, `chiudi tutte le schede di ${new URL(s.find((x) => /Orche/.test(x.title)).url).hostname}`);
  await page.waitForTimeout(8000);
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok').catch(() => {});
  await fine(page);
  console.log('SITO', JSON.stringify(await usate(app)), JSON.stringify((await schede(shell)).map((t) => t.title)));
});

test('riaprimi la pagina sulle orche che ho chiuso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await home(app);
  await vero(app);
  await openTab(testServer.html('<title>Le orche del Mediterraneo</title><p>orche', { pubblico: true }));
  await openTab(testServer.html('<title>Ricetta del pane</title><p>pane', { pubblico: true }));
  let s = await schede(shell);
  await shell.evaluate((id) => window.filoShell.tabs.close(id), s.find((x) => /orche/.test(x.title)).id);
  s = await schede(shell);
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), s.find((x) => String(x.url).startsWith('filo://newtab')).id);
  await page.waitForTimeout(1500);
  await chiedi(page, 'riaprimi la pagina sulle orche che ho chiuso prima');
  await page.waitForTimeout(8000);
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok').catch(() => {});
  await fine(page);
  console.log('ORCHE', JSON.stringify(await usate(app)), JSON.stringify((await schede(shell)).map((t) => t.title)));
});
