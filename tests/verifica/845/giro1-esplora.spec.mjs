// Verifica #845 giro 1: prove di stress sulle pagine salvate a parole (markup nei titoli, uscite, categorie, titoli accorciati).
import { test, expect } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const semina = (app, pagine, categorie = []) => app.evaluate(async (_e, { p, c }) => {
  const K = globalThis.SN_CONST.STORAGE_KEYS;
  await globalThis.chrome.storage.local.set({ [K.SAVED_PAGES]: p, [K.CATEGORIES]: c });
}, { p: pagine, c: categorie });
const salvate = (app) => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.id));
const schedaAperta = (shell, prefisso) => shell.evaluate(async (u) => (await window.filoShell.tabs.snapshot()).tabs.some((t) => t.url.startsWith(u)), prefisso);
const esito = (messaggi) => (messaggi || []).filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n');

test('titolo con markup: il bottone mostra il testo, niente elementi iniettati', async ({ app, rete }) => {
  test.setTimeout(60_000);
  const url = rete.pagina('articolo.test', '/ricette/x', '<title>x</title>');
  const titolo = 'Ricetta <img src=x onerror="window.__xss=1"><b>grassetto</b>';
  await semina(app, [{ id: 'h1', url, title: titolo, favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null }]);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ricetta' }) }] },
      { text: `Eccola: «${titolo}».` },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'era la ricetta salvata?');
    const b = page.locator('.dash-salvata-btn');
    await expect(b).toHaveCount(1, { timeout: 20_000 });
    await expect(b).toContainText('<b>grassetto</b>');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('.dash-bubble b', { hasText: 'grassetto' })).toHaveCount(0);
  } finally { await ripristina(app); }
});

test('uscite: dopo la ricerca, la pagina salvata si apre, un link che porta il suo indirizzo altrove no', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  const url = rete.pagina('negozio.test', '/ordine-482913-conferma', '<title>Ordine</title>');
  const raccolta = rete.pagina('raccolta.test', '/', '<title>r</title>');
  await semina(app, [{ id: 'o1', url, title: 'Il mio ordine 482913', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null }]);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ordine' }) }] },
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: `${raccolta}?u=${encodeURIComponent(url)}` }) }] },
      { text: 'Fatto.' },
      { toolCalls: [{ id: 'n2', name: 'NAVIGA', arguments: JSON.stringify({ url }) }] },
      { text: 'Aperta.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'cerca il mio ordine salvato');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Fatto.' })).toBeVisible({ timeout: 20_000 });
    expect(await schedaAperta(shell, raccolta)).toBe(false);
    await chiedi(page, 'aprilo');
    await expect.poll(() => schedaAperta(shell, url), { timeout: 15_000 }).toBe(true);
  } finally { await ripristina(app); }
});

test('categoria automatica: «campeggio» trova la pagina che lo ha solo come categoria', async ({ app, rete }) => {
  test.setTimeout(60_000);
  const url = rete.pagina('sito.test', '/bolsena', '<title>b</title>');
  await semina(app, [{ id: 'c1', url, title: 'Piazzole sul lago di Bolsena', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null, categoryId: 'k1' }],
    [{ id: 'k1', name: 'Campeggi', createdAt: '2026-10-01T10:00:00.000Z' }]);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'campeggio' }) }] },
      { text: 'Hai «Piazzole sul lago di Bolsena».' },
    ]);
    const page = await home(app);
    await chiedi(page, 'aprimi le pagine salvate sul campeggio');
    await expect(page.locator('.dash-salvata-btn')).toHaveCount(1, { timeout: 20_000 });
    expect(esito((await chiamateAlModello(app))[1])).toContain('categoria Campeggi');
  } finally { await ripristina(app); }
});

test('titolo accorciato prima dei due punti: la pagina nominata diventa comunque un bottone', async ({ app, rete }) => {
  test.setTimeout(60_000);
  const url = rete.pagina('cucina.test', '/ricette/carbonara', '<title>c</title>');
  await semina(app, [{ id: 'g1', url, title: 'Spaghetti alla carbonara: la ricetta originale | Cucina Facile', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null }]);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ricetta' }) }] },
      { text: 'È «Spaghetti alla carbonara», salvata il 3 ottobre.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'dov\'era quella ricetta che avevo salvato?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'salvata il 3 ottobre' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.dash-salvata-btn')).toHaveCount(1, { timeout: 5_000 });
  } finally { await ripristina(app); }
});
