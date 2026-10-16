// Verifica #845 giro 2: esplorazione delle strade della chat sulle pagine salvate.
import { test, expect } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const semina = (app, pagine) => app.evaluate(async (_e, p) => {
  await globalThis.chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.SAVED_PAGES]: p });
}, pagine);
const salvate = (app) => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.id));
const esito = (m) => (m || []).filter((x) => x.role === 'tool').map((x) => String(x.content || '')).join('\n');

test('elenco accorciato, titolo con HTML, ricarica della home, frase intera come ricerca', async ({ app, rete }) => {
  test.setTimeout(120_000);
  const A = rete.pagina('articolo.test', '/ricette/carbonara', '<title>a</title>');
  const B = rete.pagina('example.org', '/fai-da-te/ricetta-sapone', '<title>b</title>');
  const C = rete.pagina('sito.test', '/x', '<title>c</title>');
  await semina(app, [
    { id: 'a', url: A, title: 'Spaghetti alla carbonara: la ricetta originale | Cucina Facile', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null },
    { id: 'b', url: B, title: 'Ricetta del sapone di Marsiglia fatto in casa', favicon: '', thumbnail: '', savedAt: '2026-10-02T10:00:00.000Z', category: null },
    { id: 'c', url: C, title: '<img src=x onerror="window.__xss=1">Ricetta <b>grassa</b>', favicon: '', thumbnail: '', savedAt: '2026-10-01T10:00:00.000Z', category: null },
  ]);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'quella ricetta che avevo salvato' }) }] },
      { text: 'Ne hai tre:\n- **Carbonara** (articolo.test)\n- **Sapone di Marsiglia**\n- una ricetta grassa' },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'era quella ricetta che avevo salvato?');
    const bot = page.locator('.dash-salvata-btn');
    await expect(bot.first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const urls = await bot.evaluateAll((els) => els.map((e) => e.dataset.url));
    console.log('BOTTONI', JSON.stringify(urls));
    console.log('ESITO', esito((await chiamateAlModello(app))[1]).slice(0, 800));
    expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
    expect(await page.locator('.dash-salvata-btn img[src="x"], .dash-activity-row b').count()).toBe(0);
    await page.screenshot({ path: 'tests/.shots/verifica845-elenco.png' });

    await page.reload();
    await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const dopo = await page.locator('.dash-salvata-btn').evaluateAll((els) => els.map((e) => e.dataset.url));
    console.log('DOPO RICARICA', JSON.stringify(dopo));
    expect(dopo.length).toBe(urls.length);
  } finally {
    await ripristina(app);
  }
});

test('«aprimi le pagine salvate sul campeggio» nello stesso turno: apre, toglie, niente bottone vecchio', async ({ app, shell, rete }) => {
  test.setTimeout(90_000);
  const L = rete.pagina('sito.test', '/lazio/bolsena-campeggio', '<title>l</title>');
  const M = rete.pagina('articolo.test', '/campeggi/mare', '<title>m</title>');
  await semina(app, [
    { id: 'l', url: L, title: 'Campeggio sul lago di Bolsena', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null },
    { id: 'm', url: M, title: 'I migliori campeggi al mare', favicon: '', thumbnail: '', savedAt: '2026-10-02T10:00:00.000Z', category: 'Vacanze' },
  ]);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'campeggio' }) }] },
      { toolCalls: [{ id: 'a1', name: 'APRI_SALVATA', arguments: JSON.stringify({ id: 'l' }) }, { id: 'a2', name: 'APRI_SALVATA', arguments: JSON.stringify({ id: 'm' }) }] },
      { text: 'Ho aperto «Campeggio sul lago di Bolsena» e «I migliori campeggi al mare».' },
    ]);
    const page = await home(app);
    await chiedi(page, 'aprimi le pagine salvate sul campeggio');
    await expect.poll(() => salvate(app), { timeout: 20_000 }).toEqual([]);
    const aperte = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url));
    console.log('SCHEDE', JSON.stringify(aperte));
    expect(aperte).toEqual(expect.arrayContaining([L, M]));
    await page.bringToFront();
    await page.waitForTimeout(1000);
    expect(await page.locator('.dash-salvata-btn').count()).toBe(0);
    await page.screenshot({ path: 'tests/.shots/verifica845-campeggio.png' });
  } finally {
    await ripristina(app);
  }
});
