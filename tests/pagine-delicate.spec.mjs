// #1004 — le pagine delicate non partono verso i modelli nelle funzioni automatiche, e il riassunto delle schede
// chiuse si spegne. Modello ed embedding finti registrano tutto quello che ricevono: si guarda cosa è partito.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmText, CONFIRM_HOST } from './helpers/confirm.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';

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
      // La home si prepara da sola quando un modello c'è, e vede i titoli delle schede aperte: non è un lavoro di queste prove.
      const tipo = /Riassumi in italiano/.test(testo) ? 'riassunto' : /preparare la dashboard/.test(testo) ? 'home' : 'altro';
      globalThis.__mandato.push({ tipo, testo });
      return { text: 'Riassunto finto della pagina.', provider: 'openrouter', model: 'stub', usage: {} };
    };
  });
}

const mandato = (app) => app.evaluate(() => globalThis.__mandato.slice());
// Nel mondo dei content script della scheda (quello del preload): come lo chiama Filo dopo uno screenshot o una copia.
const nelContenutoDi = (app, titolo, codice) => app.evaluate(async ({ BrowserWindow }, { titolo, codice }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const tab = tm.tabs.find((t) => t.title === titolo);
  return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: codice }], true);
}, { titolo, codice });
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
  // «Saldo» da solo c'è anche nei crediti che il saluto della home manda al modello: si cerca il testo della pagina.
  expect(partito.some((m) => m.testo.includes('Saldo disponibile') || m.testo.includes('Il mio conto'))).toBe(false);
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
  expect(partito.some((m) => m.tipo !== 'home' && /lievito|Ricetta del pane/.test(m.testo))).toBe(false);
});

test('la pulizia automatica delle schede: di una pagina delicata al modello va solo il tipo, mai titolo, indirizzo o testo', async ({ app }) => {
  await modelliFinti(app);
  // Il modello finto non risponde col JSON delle decisioni, e il giudizio fallisce: qui conta cosa è partito.
  await app.evaluate(() => globalThis.SN_TAB_TRIAGE_DECIDE({
    trigger: 'idle',
    tabs: [
      { url: 'https://mail.google.com/mail/u/0/#inbox', title: 'Posta in arrivo (3) - mario.rossi@gmail.com', contentExtract: 'Il tuo codice di verifica è 482913', idleMin: 400 },
      { url: 'https://it.wikipedia.org/wiki/Gatto', title: 'Gatto - Wikipedia', contentExtract: 'Il gatto domestico', idleMin: 400 },
    ],
  }).catch(() => null));
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
  // La casella dei siti è figlia dell'interruttore: rientra come la sua descrizione, non sta allineata alle voci sorelle.
  const sinistra = (sel) => sicurezza.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().left));
  expect(await sinistra('#sec-delicate-sites')).toBe(await sinistra('#sec-delicate-desc'));
  expect(await sinistra('#sec-delicate-sites')).toBeGreaterThan(await sinistra('#sec-delicate'));
  // Un nome con lo spazio si ridice intero anche accanto a un sito sulla stessa riga (#718.3).
  await sicurezza.locator('#sec-delicate-sites').fill('sito-pubblico.test\nstudio rossi\nmario bianchi, altro-studio.test');
  await sicurezza.locator('#sec-delicate-sites').blur();
  await expect.poll(async () => (await impostazioni(shell)).security.pagineDelicate.siti, { timeout: 4000 })
    .toEqual(['sito-pubblico.test', 'altro-studio.test']);
  await expect(sicurezza.locator('#sec-delicate-sites-error')).toContainText('studio rossi, mario bianchi');

  const t = await apriEChiudi({ app, shell, openTab, testServer }, 'Area clienti dello studio', `<p>${SEGRETO}</p>`);
  await t.chiudi();
  await expect.poll(() => voceDi(app, 'Area clienti dello studio'), { timeout: 8_000 })
    .toEqual({ delicata: 'utente', summary: '', snippet: '', embedding: false });
  expect((await mandato(app)).some((m) => m.testo.includes('Saldo disponibile'))).toBe(false);

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
  await livelloAutonomia(app, 'conservativo'); // il popup di un costo 2 si prova a Conservativo (#530)
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
  const page = await openTab(GESTIONE);
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
  await ricaricaSu(page, 'predefiniti');
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#h-delicate')).toHaveText('Pagine delicate');
  await expect(page.locator('#delicate-banche')).toHaveValue(/intesasanpaolo\.com/);
  await expect(page.locator('label[for="delicate-sanita"]')).toHaveText('Sanità');
  await expect(page.locator('label[for="delicate-pa"]')).toHaveText('Pubblica amministrazione');
  await expect(page.locator('#delicate-pa')).toHaveValue(/agenziaentrate\.gov\.it/);

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

test('un modulo di accesso nascosto non rende delicato il sito; aperto e usato, sì', async ({ app, shell, openTab, testServer }) => {
  await modelliFinti(app);
  const page = await testServer.openReady(openTab,
    '<!doctype html><html><head><title>Ricetta del pane</title></head><body><p>Farina, acqua e lievito madre.</p>'
    + '<button id="apri" onclick="document.getElementById(\'accesso\').style.display=\'block\'">Accedi</button>'
    + '<div id="accesso" style="display:none"><input type="password" name="pw"></div></body></html>',
    { pubblico: true });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await page.locator('#apri').waitFor();
  // Il nascosto si guarda a pagina caricata e di nuovo dopo un attimo: oltre quell'attimo nessuno l'ha segnato.
  await page.waitForTimeout(2500);
  expect(await app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test'))).toBe(false);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await expect.poll(() => voceDi(app, 'Ricetta del pane'), { timeout: 8_000 })
    .toEqual(expect.objectContaining({ delicata: null, summary: 'Riassunto finto della pagina.' }));

  const di = await testServer.openReady(openTab,
    '<!doctype html><html><head><title>Accesso</title></head><body>'
    + '<button id="apri" onclick="document.getElementById(\'accesso\').style.display=\'block\'">Accedi</button>'
    + '<div id="accesso" style="display:none"><input type="password" name="pw"></div></body></html>',
    { pubblico: true });
  await di.locator('#apri').click();
  await di.locator('input[name=pw]').click();
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
});

test('in incognito la selezione non parte da sola verso un modello; in una finestra normale la spiegazione si prepara', async ({ app, shell, testServer }) => {
  await modelliFinti(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const IBAN = 'IT60X0542811101000000123456';
  const url = testServer.html(`<!doctype html><title>Bonifico</title><body><p id="p">Il mio IBAN è ${IBAN} per il bonifico.</p></body>`, { pubblico: true });
  // Un doppio clic vero sull'IBAN: una selezione fatta da script non prepara niente in nessuna finestra (#1070).
  const seleziona = (incognito) => app.evaluate(async ({ BrowserWindow }, { url, incognito, IBAN }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !!w._filoIncognito === incognito && w._filoTabs);
    const tm = win._filoTabs;
    const id = tm.openTab(url);
    const t0 = Date.now();
    let tab = null;
    while (Date.now() - t0 < 10_000) {
      tab = tm.tabs.find((t) => t.id === id);
      const pronta = tab && tab.view && await tab.view.webContents.executeJavaScript(
        'document.documentElement.dataset.filoContentReady === "1"').catch(() => false);
      if (pronta) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const wc = tab.view.webContents;
    const q = await wc.executeJavaScript(`(function(){const t=document.getElementById('p').firstChild;
      const da=t.textContent.indexOf(${JSON.stringify(IBAN)});const r=document.createRange();r.setStart(t,da);r.setEnd(t,da+${IBAN.length});
      const b=r.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
    for (const clickCount of [1, 2]) {
      wc.sendInputEvent({ type: 'mouseDown', x: q.x, y: q.y, button: 'left', clickCount });
      wc.sendInputEvent({ type: 'mouseUp', x: q.x, y: q.y, button: 'left', clickCount });
    }
    const t1 = Date.now();
    let scelta = '';
    while (Date.now() - t1 < 3000 && scelta !== IBAN) {
      scelta = await wc.executeJavaScript('getSelection().toString()');
      if (scelta !== IBAN) await new Promise((r) => setTimeout(r, 50));
    }
    return scelta;
  }, { url, incognito, IBAN });
  const spiegazioni = async () => (await mandato(app)).filter((m) => m.testo.includes(IBAN));

  // Lo stesso gesto nelle due finestre: in incognito a fermarlo è solo l'incognito.
  expect(await seleziona(true)).toBe(IBAN);
  // La preparazione parte dopo 400 ms dalla selezione: oltre il secondo e mezzo non è partita.
  await new Promise((r) => setTimeout(r, 1500));
  expect(await spiegazioni()).toEqual([]);

  expect(await seleziona(false)).toBe(IBAN);
  await expect.poll(async () => (await spiegazioni()).length, { timeout: 8_000 }).toBe(1);
});

test('screenshot e immagini copiate da una pagina delicata non vanno al modello delle immagini; chiesta col tasto destro sì', async ({ app, openTab, testServer }) => {
  await modelliFinti(app);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const nelContenuto = (titolo, codice) => nelContenutoDi(app, titolo, codice);
  // La voce entra negli appunti prima della descrizione; un sito non legge né scrive gli appunti, lo fa il main.
  const voce = (u) => app.evaluate(async ({}, { u }) => {
    const l = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []);
    const v = l.find((x) => x.dataUrl === u);
    return v ? v.description : null;
  }, { u });
  const descrivi = async (titolo, u) => {
    await app.evaluate(({}, { u }) => globalThis.SN_STORAGE.setRaw(globalThis.SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY,
      [{ type: 'image', dataUrl: u, description: 'Descrizione…', ts: Date.now() }]), { u });
    return nelContenuto(titolo, `SN_ACTIONS.requestImageDescription(${JSON.stringify(u)})`);
  };
  const immagini = async () => (await mandato(app)).filter((m) => m.testo.includes('image_url'));

  await testServer.openReady(openTab, '<!doctype html><title>Ricetta</title><body><p>Pane</p></body>');
  expect(await descrivi('Ricetta', `${PNG}#a`)).toBe('Riassunto finto della pagina.');
  expect((await immagini()).length).toBe(1);

  await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Il mio conto</title></head><body>${CON_PASSWORD}</body></html>`, { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  expect(await descrivi('Il mio conto', `${PNG}#b`)).toBe(null);
  await expect.poll(() => voce(`${PNG}#b`), { timeout: 4_000 }).toBe('Immagine da una pagina delicata');
  expect((await immagini()).length, 'nessuna immagine nuova al modello').toBe(1);

  // La descrizione chiesta aprendo il tasto destro su un'immagine resta com'è.
  const chiesta = await nelContenuto('Il mio conto', `chrome.runtime.sendMessage({ type: SN_MSG.MSG.AI_REQUEST,
    action: SN_CONST.ACTIONS.DESCRIBE_IMAGE, payload: { dataUrl: ${JSON.stringify(`${PNG}#c`)} } })`);
  expect(chiesta.ok).toBe(true);
  expect((await immagini()).length).toBe(2);
});

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const cronologiaAppunti = (app) => app.evaluate(() => globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY, []));
// Lo screenshot del tasto destro, senza il file nella cartella Download: il nome che gli darebbe resta nella pagina.
// Il clic è il gesto che la voce del menu darebbe; la foto di una scheda appena aperta può tornare vuota, e si riprova.
async function screenshotDi(app, page, titolo) {
  const primaImmagine = async () => (await cronologiaAppunti(app)).find((v) => v.type === 'image') || null;
  await app.evaluate(({ clipboard }) => clipboard.clear());
  const prima = await primaImmagine();
  let nome = null;
  await expect.poll(async () => {
    await page.mouse.click(5, 5);
    nome = await nelContenutoDi(app, titolo, `(async () => {
      HTMLAnchorElement.prototype.click = function () { window.__nomeFile = this.download; };
      window.__nomeFile = null;
      await SN_ACTIONS.takeScreenshot();
      return window.__nomeFile;
    })()`);
    return Boolean(nome);
  }, { timeout: 20_000 }).toBe(true);
  // La voce entra negli appunti di Filo subito dopo, senza che lo screenshot l'aspetti.
  let voce = null;
  await expect.poll(async () => {
    voce = await primaImmagine();
    return Boolean(voce && (!prima || voce.dataUrl !== prima.dataUrl));
  }, { timeout: 8_000 }).toBe(true);
  return { nome, dataUrl: voce.dataUrl, descrizione: voce.description };
}
// Il centro di un pezzo di testo nella pagina, per un doppio clic e un tasto destro veri.
const puntoDi = (page, id, pezzo) => page.evaluate(([i, w]) => {
  const nodo = document.getElementById(i).firstChild;
  const da = nodo.textContent.indexOf(w);
  const r = document.createRange();
  r.setStart(nodo, da);
  r.setEnd(nodo, da + w.length);
  const b = r.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}, [id, pezzo]);

// #1274 — copiare un IBAN è il gesto più comune su una banca: la spiegazione non si prepara, quella chiesta resta.
test('su una pagina delicata la selezione non prepara la spiegazione; il tasto destro la chiede una volta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelliFinti(app);
  const IBAN = 'IT60X0542811101000000123456';
  const spiegazioni = async () => (await mandato(app)).filter((m) => m.testo.includes(IBAN));
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Il mio conto</title></head>
    <body style="font:20px sans-serif;padding:30px"><p id="p">Il mio IBAN è ${IBAN} per il bonifico.</p>${CON_PASSWORD}</body></html>`,
  { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8_000 });
  const p = await puntoDi(page, 'p', IBAN);
  await page.mouse.dblclick(p.x, p.y);
  expect(await page.evaluate(() => getSelection().toString().trim())).toBe(IBAN);
  // La preparazione parte 400 ms dopo la selezione: oltre il secondo e mezzo non è partita.
  await pausa(1500);
  expect(await spiegazioni()).toEqual([]);

  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menuDi(page).locator('.sn-menu .sn-menu-inline-explain')).toContainText('Riassunto finto della pagina', { timeout: 10_000 });
  expect((await spiegazioni()).length).toBe(1);

  // La stessa selezione su una pagina qualunque la prepara: è la pagina delicata a fermarla.
  const altra = await testServer.openReady(openTab, `<!doctype html><title>Appunti</title>
    <body style="font:20px sans-serif;padding:30px"><p id="p">Il codice di prova è ${IBAN.replace('IT', 'XX')} per il modulo.</p></body>`);
  await altra.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8_000 });
  const q = await puntoDi(altra, 'p', IBAN.replace('IT', 'XX'));
  await altra.mouse.dblclick(q.x, q.y);
  await expect.poll(async () => (await mandato(app)).filter((m) => m.testo.includes(IBAN.replace('IT', 'XX'))).length, { timeout: 8_000 }).toBe(1);
});

// #1274 — conta la pagina da cui viene l'immagine, non quella dove la incolli.
test('uno screenshot della banca incollato col menu su un altro sito non va al modello delle immagini; uno di una pagina qualunque sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  const immagini = async () => (await mandato(app)).filter((m) => m.testo.includes('image_url'));
  const cronologia = () => cronologiaAppunti(app);

  const ricetta = await testServer.openReady(openTab, '<!doctype html><title>Ricetta</title><body style="background:#2a7;font:30px sans-serif"><p>Pane</p></body>');
  const normale = await screenshotDi(app, ricetta, 'Ricetta');
  expect((await immagini()).length).toBe(1);
  expect(normale.nome).not.toMatch(/^screenshot-/);

  const conto = await testServer.openReady(openTab,
    `<!doctype html><html><head><title>Il mio conto</title></head><body style="background:#c33">${CON_PASSWORD}</body></html>`, { pubblico: true });
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  const banca = await screenshotDi(app, conto, 'Il mio conto');
  expect(banca.nome).toMatch(/^screenshot-/);
  expect(banca.descrizione).toBe('Immagine da una pagina delicata');
  expect((await immagini()).length, 'lo screenshot della banca non va al modello').toBe(1);

  // Un altro sito con un campo dove si scrive; negli appunti di sistema c'è lo screenshot della banca, ricodificato.
  const chat = await testServer.openReady(openTab, `<!doctype html><title>Chat</title><body style="font:16px sans-serif">
    <style>#ce img { width: 40px; height: 30px; }</style>
    <div id="ce" contenteditable="true" style="position:absolute;left:40px;top:40px;width:400px;height:200px;border:1px solid #888"></div></body>`);
  await chat.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8_000 });
  const incolla = async (dataUrl) => {
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }, u) => {
      const png = nativeImage.createFromDataURL(u).toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    }, dataUrl);
    // Sotto le immagini già incollate: il tasto destro su un'immagine apre il suo menu, senza Incolla.
    await chat.locator('#ce').click({ button: 'right', position: { x: 300, y: 170 } });
    // Lo strato del menu nasce al primo tasto destro: si cerca di nuovo finché c'è.
    await expect.poll(() => menuDi(chat).locator('.sn-menu-paste-main').count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await menuDi(chat).locator('.sn-menu-paste-main').click();
  };
  await incolla(banca.dataUrl);
  await expect(chat.locator('#ce img')).toHaveCount(1, { timeout: 10_000 });
  await expect.poll(async () => (await cronologia())[0].description, { timeout: 8_000 }).toBe('Immagine da una pagina delicata');
  await pausa(1000);
  expect((await immagini()).length, 'incollato altrove, lo screenshot della banca resta fuori').toBe(1);

  // Lo screenshot della pagina qualunque, incollato allo stesso modo, va al modello: una richiesta.
  await app.evaluate(() => globalThis.SN_AI_CACHE.clear());
  await incolla(normale.dataUrl);
  await expect(chat.locator('#ce img')).toHaveCount(2, { timeout: 10_000 });
  await expect.poll(async () => (await immagini()).length, { timeout: 8_000 }).toBe(2);
});

// #1274 — la descrizione che parte da sola per ogni screenshot si spegne come la spiegazione preparata.
test('spenta in Preferenze la descrizione di screenshot e immagini, lo screenshot resta qui e si chiama con data e ora', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelliFinti(app);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#descriviImmagini')).toBeChecked({ timeout: 8000 });
  await pref.locator('#descriviImmagini').uncheck();
  await expect.poll(async () => (await impostazioni(shell)).descriviImmagini.enabled, { timeout: 4000 }).toBe(false);
  await pref.locator('#sec-nomi-file').screenshot({ path: 'tests/.shots/pagine-delicate-preferenze-immagini.png' });

  const ricetta = await testServer.openReady(openTab, '<!doctype html><title>Ricetta</title><body style="background:#27a;font:30px sans-serif"><p>Pane</p></body>');
  const spento = await screenshotDi(app, ricetta, 'Ricetta');
  expect(spento.nome).toMatch(/^screenshot-/);
  expect(spento.descrizione).toBe('Immagine');
  expect((await mandato(app)).filter((m) => m.testo.includes('image_url'))).toEqual([]);

  // Dalla chat si riaccende con le stesse parole delle Preferenze, e lo screenshot dopo torna ad avere un nome.
  const r = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('descrizione automatica delle immagini', 'sì'));
  expect(r.partial).toEqual({ descriviImmagini: { enabled: true } });
  await app.evaluate(async ({}, p) => globalThis.SN_STORAGE.updateSettings(p), r.partial);
  await ricetta.evaluate(() => { document.body.style.background = '#a72'; });
  const acceso = await screenshotDi(app, ricetta, 'Ricetta');
  expect(acceso.nome).not.toMatch(/^screenshot-/);
  expect((await mandato(app)).filter((m) => m.testo.includes('image_url')).length).toBe(1);
});
