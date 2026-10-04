// #1004 — le pagine delicate non partono verso i modelli nelle funzioni automatiche, e il riassunto delle schede
// chiuse si spegne. Modello ed embedding finti registrano tutto quello che ricevono: si guarda cosa è partito.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmText, CONFIRM_HOST } from './helpers/confirm.mjs';

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

test('il testo letto da una pagina delicata non parte sotto l\'indirizzo della pagina dopo, anche se quella non ha testo', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  // blocked.test risponde dal mini server: un altro sito pubblico, qui con una pagina senza testo (un'immagine, un PDF).
  const vuota = testServer.html('<!doctype html><html><head><title>Immagine</title></head><body></body></html>')
    .replace('127.0.0.1', 'blocked.test');
  const banca = await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Il mio conto</title></head><body>${CON_PASSWORD}<a id="via" href="${vuota}">vai</a></body></html>`,
    { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  await banca.waitForTimeout(800);
  await banca.click('#via');
  await expect.poll(() => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return (s.tabs.find((t) => t.id === s.activeId) || {}).url || '';
  }), { timeout: 8_000 }).toContain('blocked.test');
  await banca.waitForTimeout(800);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);

  await expect.poll(() => voceDi(app, 'Immagine'), { timeout: 8_000 }).not.toBeNull();
  await new Promise((r) => setTimeout(r, 1_500));
  expect((await mandato(app)).some((m) => m.testo.includes('Saldo disponibile'))).toBe(false);
  expect((await voceDi(app, 'Immagine')).snippet).not.toContain('Saldo');
});

test('il titolo di una pagina delicata non resta sulla scheda quando la pagina dopo non ne ha uno', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  const IBAN = 'IT60X0542811101000000123456';
  const senzaTitolo = testServer.html('<!doctype html><html><head></head><body><p>Una pagina pubblica qualunque.</p></body></html>')
    .replace('127.0.0.1', 'blocked.test');
  const banca = await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Movimenti del conto ${IBAN}</title></head><body>${CON_PASSWORD}<a id="via" href="${senzaTitolo}">vai</a></body></html>`,
    { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  await banca.click('#via');
  const davanti = () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return s.tabs.find((t) => t.id === s.activeId) || {};
  });
  await expect.poll(async () => (await davanti()).url || '', { timeout: 8_000 }).toContain('blocked.test');
  await expect.poll(async () => (await davanti()).title || '', { timeout: 8_000 }).toContain('blocked.test');

  const stato = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble({ sistema: false })).stateText);
  expect(stato).not.toContain(IBAN);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), (await davanti()).id);
  await expect.poll(async () => (await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 1_500));
  expect((await mandato(app)).some((m) => m.testo.includes(IBAN))).toBe(false);
});

test('dalla chat della home una scheda aperta diventa delicata col suo titolo, senza scriverne l\'indirizzo', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab,
    '<!doctype html><html><head><title>Studio Rossi - Area clienti</title></head><body><p>Dichiarazione dei redditi</p></body></html>',
    { pubblico: true });
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  const corsa = home.evaluate(() => window.__filoSidebarTest.runFiloAction(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'siti_delicati', valore: 'aggiungi scheda: Studio Rossi - Area clienti' }));
  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  expect(await confirmText(home)).toContain('sito-pubblico.test');
  await clickConfirm(home, 'ok');
  await corsa;
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.pagineDelicate.siti), { timeout: 5_000 })
    .toEqual(['sito-pubblico.test']);
});

test('in Gestione l\'owner vede e cambia gli elenchi di posta, banche e sanità, e salva solo quello che ha toccato', async ({ app, openTab }) => {
  const [elenco, diSerie] = await app.evaluate(() => [
    globalThis.SN_PAGINE_DELICATE.elenco(null), globalThis.SN_PAGINE_DELICATE.elenco(null)]);
  const page = await openTab('filo://admin-defaults/admin-defaults.html');
  // La pagina vuole un owner loggato, che qui non c'è: le risposte del main sono finte, i messaggi si registrano.
  await page.addInitScript(({ elenco: el, diSerie: ds }) => {
    window.__sent = [];
    const config = { apiKeysPresent: {}, modelRegistry: {}, models: {}, excludedProviders: [], sitiDelicati: el, sitiDelicatiDiSerie: ds };
    const stub = async (msg) => {
      window.__sent.push(msg);
      if (msg.type === 'defaults_get') return { ok: true, config };
      if (msg.type === 'defaults_update') return { ok: true, config };
      if (msg.type === 'default_providers_list') return { ok: true, items: [] };
      return { ok: true };
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, { elenco, diSerie });
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#h-delicate')).toHaveText('Pagine delicate');
  await expect(page.locator('#delicate-banche')).toHaveValue(/intesasanpaolo\.com/);
  await expect(page.locator('label[for="delicate-sanita"]')).toHaveText('Sanità');

  await page.locator('#saveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').length)).toBe(1);
  expect(await page.evaluate(() => window.__sent.find((m) => m.type === 'defaults_update').config.sitiDelicati)).toBeUndefined();

  const banche = await page.locator('#delicate-banche').inputValue();
  await page.locator('#delicate-banche').fill(`${banche}\nhttps://www.BancaProva.it/accesso`);
  await page.locator('#delicate-banche').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/pagine-delicate-gestione.png' });
  await page.locator('#saveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').length)).toBe(2);
  const inviato = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update')[1].config.sitiDelicati);
  expect(Object.keys(inviato)).toEqual(['banche']);
  expect(inviato.banche).toContain('bancaprova.it');
  expect(inviato.banche).toContain('intesasanpaolo.com');
});

const titoloDavanti = (shell) => shell.evaluate(async () => {
  const s = await window.filoShell.tabs.snapshot();
  return (s.tabs.find((t) => t.id === s.activeId) || {}).title;
});

test('in Sicurezza si vedono i siti segnati per il campo password: uno tolto torna al riassunto, e si rimette', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  await testServer.openReady(openTab, `<!doctype html><html><head><title>Accesso</title></head><body>${CON_PASSWORD}</body></html>`, { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);

  const sicurezza = await openTab('filo://security/security.html');
  const riga = sicurezza.locator('#sec-delicate-campi-list li', { hasText: 'sito-pubblico.test' });
  await expect(sicurezza.locator('#sec-delicate-campi-title')).toHaveText('Siti dove Filo ha visto un campo password o carta', { timeout: 8000 });
  await riga.getByRole('button', { name: 'Non è delicato' }).click();
  await expect(riga).toContainText('non delicato per te');
  await expect.poll(async () => (await impostazioni(shell)).security.pagineDelicate.nonDelicati, { timeout: 4000 })
    .toEqual(['sito-pubblico.test']);

  const t = await apriEChiudi({ app, shell, openTab, testServer }, 'Documento condiviso', '<p>Verbale della riunione di giovedì</p>');
  await expect.poll(() => titoloDavanti(shell), { timeout: 8_000 }).toBe('Documento condiviso');
  await t.chiudi();
  await expect.poll(() => voceDi(app, 'Documento condiviso'), { timeout: 8_000 })
    .toEqual(expect.objectContaining({ delicata: null, summary: 'Riassunto finto della pagina.' }));

  await sicurezza.bringToFront();
  await riga.getByRole('button', { name: 'Torna delicato' }).click();
  await expect.poll(async () => (await impostazioni(shell)).security.pagineDelicate.nonDelicati, { timeout: 4000 }).toEqual([]);
  const t2 = await apriEChiudi({ app, shell, openTab, testServer }, 'Il mio conto', `<p>${SEGRETO}</p>`);
  await expect.poll(() => titoloDavanti(shell), { timeout: 8_000 }).toBe('Il mio conto');
  await t2.chiudi();
  await expect.poll(() => voceDi(app, 'Il mio conto'), { timeout: 8_000 })
    .toEqual({ delicata: 'campi', summary: '', snippet: '', embedding: false });
});

test('un campo carta nel riquadro di un servizio di pagamento rende delicata la pagina che lo contiene', async ({ app, openTab, testServer }) => {
  const riquadro = testServer.html('<!doctype html><html><body><input autocomplete="cc-number" name="cardnumber"></body></html>')
    .replace('127.0.0.1', 'blocked.test');
  const cassa = await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Cassa</title></head><body><p>Spedizione a Mario Rossi</p><iframe src="${riquadro}"></iframe></body></html>`,
    { pubblico: true });
  await cassa.frameLocator('iframe').locator('input[name=cardnumber]').click();
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  expect(await app.evaluate(() => globalThis.SN_DELICATE.haCampi('blocked.test')), 'il riquadro non segna sé stesso').toBe(false);
});
