// #1004 — le pagine delicate non partono verso i modelli nelle funzioni automatiche, e il riassunto delle schede
// chiuse si spegne. Modello ed embedding finti registrano tutto quello che ricevono: si guarda cosa è partito.

import { test, expect } from './fixtures/electron.mjs';

const SEGRETO = 'Saldo disponibile 12.345,67 euro bonifico a Mario Rossi';

async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      globalThis.__mandato.push({ tipo: 'indice', testo: texts.join('\n') });
      return { vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => {
      const testo = JSON.stringify(messages);
      globalThis.__mandato.push({ tipo: /Riassumi in italiano/.test(testo) ? 'riassunto' : 'altro', testo });
      return { text: 'Riassunto finto della pagina.', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}

const mandato = (app) => app.evaluate(() => globalThis.__mandato.slice());
const voceDi = (app, titolo) => app.evaluate(async ({}, t) => {
  const e = (await globalThis.SN_ARCHIVED_TABS.list()).find((x) => x.title === t);
  return e ? { delicata: e.delicata || null, summary: e.summary || '', snippet: e.snippet || '', embedding: Array.isArray(e.embedding) } : null;
}, titolo);

async function apriEChiudi({ app, shell, openTab, testServer }, titolo, corpo) {
  await testServer.openReady(openTab,
    `<!doctype html><html><head><title>${titolo}</title></head><body>${corpo}</body></html>`,
    { pubblico: true });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  return { id, chiudi: () => shell.evaluate(async (i) => window.filoShell.tabs.close(i), id) };
}

const CON_PASSWORD = `<p>${SEGRETO}</p><form><input name="utente"><input type="password" name="pw"></form>`;

test('chiusa una pagina con un campo password, al modello del riassunto e all\'indice non arriva niente', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  const t = await apriEChiudi({ app, shell, openTab, testServer }, 'Il mio conto', CON_PASSWORD);
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  await t.chiudi();

  await expect.poll(() => voceDi(app, 'Il mio conto'), { timeout: 8_000 })
    .toEqual({ delicata: 'campi', summary: '', snippet: '', embedding: false });
  // Una ricerca indicizza subito le schede che non hanno ancora un vettore: questa non ci deve andare.
  const page = await openTab('filo://newtab/');
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'conto' }));
  expect(r.results.map((x) => x.title)).toContain('Il mio conto');

  const partito = await mandato(app);
  expect(partito.filter((m) => m.tipo === 'riassunto')).toEqual([]);
  expect(partito.some((m) => m.testo.includes('Saldo') || m.testo.includes('Il mio conto'))).toBe(false);
});

test('con l\'interruttore delle pagine delicate spento, il testo della stessa pagina arriva al riassunto', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ security: { pagineDelicate: { enabled: false } } }));
  const t = await apriEChiudi({ app, shell, openTab, testServer }, 'Il mio conto', CON_PASSWORD);
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  await t.chiudi();

  await expect.poll(() => voceDi(app, 'Il mio conto'), { timeout: 8_000 })
    .toEqual(expect.objectContaining({ delicata: null, summary: 'Riassunto finto della pagina.' }));
  const riassunti = (await mandato(app)).filter((m) => m.tipo === 'riassunto');
  expect(riassunti.length).toBe(1);
  expect(riassunti[0].testo).toContain('Saldo disponibile 12.345,67');
});

test('con il riassunto delle schede chiuse spento non parte niente, e la scheda si ritrova per parole', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ riassuntoSchede: { enabled: false } }));
  const t = await apriEChiudi({ app, shell, openTab, testServer }, 'Ricetta del pane', '<p>Farina, acqua, lievito madre e sale: impasta e lascia lievitare.</p>');
  await t.chiudi();

  await expect.poll(() => voceDi(app, 'Ricetta del pane'), { timeout: 8_000 })
    .toEqual(expect.objectContaining({ delicata: null, summary: '', embedding: false, snippet: expect.stringContaining('lievito madre') }));
  const page = await openTab('filo://newtab/');
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'pane' }));
  expect(r.results.map((x) => x.title)).toContain('Ricetta del pane');

  // Riacceso il riassunto, quello che si era chiuso da spento non parte nemmeno dopo, neanche verso l'indice.
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ riassuntoSchede: { enabled: true } }));
  const r2 = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'search_archived_tabs', query: 'pane' }));
  expect(r2.results.map((x) => x.title)).toContain('Ricetta del pane');

  const partito = await mandato(app);
  expect(partito.filter((m) => m.tipo === 'riassunto')).toEqual([]);
  expect(partito.some((m) => /lievito|Ricetta del pane/.test(m.testo))).toBe(false);
});

test('la pulizia automatica delle schede: di una pagina delicata al modello va solo il tipo, mai titolo, indirizzo o testo', async ({ app }) => {
  await modelliFinti(app);
  await app.evaluate(() => globalThis.SN_TAB_TRIAGE_DECIDE({
    trigger: 'idle',
    tabs: [
      { url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Posta in arrivo (3) - mario.rossi@gmail.com', contentExtract: 'Il tuo codice di verifica è 482913', idleMin: 400 },
      { url: 'https://it.wikipedia.org/wiki/Gatto', title: 'Gatto - Wikipedia', contentExtract: 'Il gatto domestico', idleMin: 400 },
    ],
  }));
  const [chiamata] = (await mandato(app)).filter((m) => m.tipo === 'altro');
  expect(chiamata.testo).toContain('[pagina delicata: posta]');
  expect(chiamata.testo).not.toContain('mario.rossi');
  expect(chiamata.testo).not.toContain('482913');
  expect(chiamata.testo).not.toContain('mail.google.com');
  expect(chiamata.testo).toContain('Gatto - Wikipedia');
});

test('nella chat una scheda delicata aperta entra solo col nome del sito', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Movimenti di Mario Rossi</title></head><body>${CON_PASSWORD}</body></html>`,
    { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  const testo = await app.evaluate(async () => {
    const S = globalThis.SN_FILO_STATE;
    return (await S.assemble({ sistema: false })).stateText;
  });
  expect(testo).toContain('[pagina delicata] sito-pubblico.test');
  expect(testo).not.toContain('Movimenti di Mario Rossi');
});

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;

test('in Sicurezza un sito aggiunto all\'elenco diventa delicato, e l\'interruttore si spegne da lì', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  const sicurezza = await openTab('filo://security/security.html');
  await expect(sicurezza.locator('#sec-delicate')).toBeChecked({ timeout: 8000 });
  await expect(sicurezza.locator('#sec-delicate-label')).toHaveText('Non mandare ai modelli le pagine delicate');
  await sicurezza.locator('#sec-delicate-sites').fill('sito-pubblico.test\nstudio rossi');
  await sicurezza.locator('#sec-delicate-sites').blur();
  await expect.poll(async () => (await impostazioni(shell)).security.pagineDelicate.siti, { timeout: 4000 })
    .toEqual(['sito-pubblico.test']);
  await expect(sicurezza.locator('#sec-delicate-sites-error')).toContainText('studio rossi');

  const t = await apriEChiudi({ app, shell, openTab, testServer }, 'Area clienti dello studio', `<p>${SEGRETO}</p>`);
  await t.chiudi();
  await expect.poll(() => voceDi(app, 'Area clienti dello studio'), { timeout: 8_000 })
    .toEqual({ delicata: 'utente', summary: '', snippet: '', embedding: false });
  expect((await mandato(app)).some((m) => m.testo.includes('Saldo'))).toBe(false);

  await sicurezza.bringToFront();
  await sicurezza.locator('#sec-delicate').uncheck();
  await expect.poll(async () => (await impostazioni(shell)).security.pagineDelicate.enabled, { timeout: 4000 }).toBe(false);
  await expect(sicurezza.locator('#sec-delicate-sites')).toBeDisabled();
});

test('in Preferenze il riassunto delle schede chiuse si spegne e si riaccende', async ({ shell, openTab }) => {
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#riassuntoSchede')).toBeChecked({ timeout: 8000 });
  await pref.locator('#riassuntoSchede').uncheck();
  await expect.poll(async () => (await impostazioni(shell)).riassuntoSchede.enabled, { timeout: 4000 }).toBe(false);
  await pref.locator('#riassuntoSchede').check();
  await expect.poll(async () => (await impostazioni(shell)).riassuntoSchede.enabled, { timeout: 4000 }).toBe(true);
});
