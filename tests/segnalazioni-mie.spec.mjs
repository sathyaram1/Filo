// «Le tue segnalazioni» (#986): chi manda una segnalazione la ritrova in Bacheca, con data e stato.
// Dal punto di vista di chi la manda: compare «in partenza» e diventa «inviata» col numero sotto i suoi occhi,
// passa a «risolta» quando Filo fa l'annuncio all'avvio, resta dopo un riavvio, e una voce tolta non torna.
// L'incognito non scrive e non vede l'elenco. La sola cosa finta è la rete (la submit e le schede pubbliche).

import { test, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron, test as testSenzaFixture } from '@playwright/test';
import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { CONFIRM_HOST, clickConfirm } from './helpers/confirm.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACHECA = 'filo://board/board.html';

// La rete finta: ogni invio riesce con un numero, e la coda la svuota la prova quando vuole.
async function reteFinta(app, { seq = 986 } = {}) {
  await app.evaluate((_e, seq) => {
    globalThis.__invii = [];
    let n = seq;
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__invii.push(payload);
      const id = `fbDoc-${n}`;
      return { id, seq: n++, failed: [] };
    };
    globalThis.SN_FEEDBACK_OUTBOX._setAuto(false);
  }, seq);
}

async function paginaConContentScript(app, prefisso) {
  const scadenza = Date.now() + 10_000;
  let win = null;
  while (Date.now() < scadenza && !win) {
    win = app.windows().find((w) => w.url().startsWith(prefisso));
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, `${prefisso} non trovata`).toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

// Il gesto vero: riquadro «Invia feedback», testo, un allegato, Invia.
async function mandaDalRiquadro(page, testo, allegato) {
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill(testo);
  if (allegato) await page.locator('.sn-fb-file').setInputFiles([allegato]);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 6_000 });
}

const righe = (bacheca) => bacheca.locator('#bdMie .bd-mia');

test('mandata dal riquadro compare in Bacheca, diventa «inviata» col numero e «risolta» all\'annuncio dell\'avvio', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await reteFinta(app);
  const home = await paginaConContentScript(app, 'filo://newtab');
  const testo = 'Il tasto <b>Salva</b> non fa niente 🙃\nSeconda riga con i passi.';
  await mandaDalRiquadro(home, testo, { name: 'log-salva.txt', mimeType: 'text/plain', buffer: Buffer.from('errore') });

  const bacheca = await openTab(BACHECA);
  await expect(bacheca.locator('#bdMie')).toBeVisible();
  await expect(righe(bacheca)).toHaveCount(1);
  const riga = righe(bacheca).first();
  // Prima che la rete la porti via è «in partenza»: chi la manda vede che non è ancora arrivata.
  await expect(riga.locator('.bd-mia-stato')).toHaveText('in partenza');
  await expect(riga.locator('.bd-mia-titolo')).toHaveText('Il tasto <b>Salva</b> non fa niente 🙃');
  await expect(riga.locator('.bd-mia-sub')).toContainText('1 allegato');
  await expect(bacheca.locator('#bdMieConto')).toHaveText('1');

  // La coda la consegna: la bacheca aperta se ne accorge da sola.
  await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.flush());
  await expect(riga.locator('.bd-mia-stato')).toHaveText('inviata');
  await expect(riga.locator('.bd-mia-titolo')).toHaveText(/^#986 /);

  // Il testo intero, a capo e markup come li ha scritti, e i nomi degli allegati.
  await riga.locator('.bd-mia-testa').click();
  await expect(riga.locator('.bd-mia-testo')).toHaveText(testo);
  await expect(riga.locator('.bd-mia-testo b')).toHaveCount(0);
  await expect(riga.locator('.bd-mia-allegati')).toHaveText('Allegati: log-salva.txt');
  await bacheca.screenshot({ path: 'tests/.shots/segnalazioni-mie-inviata.png' });

  // La chiusura: la scheda pubblica di QUESTA segnalazione è risolta, e la home all'avvio lo annuncia.
  await app.evaluate(async () => {
    const r = await globalThis.chrome.storage.local.get('sn_feedback_client_id');
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const tag = await H.cardTag('fbDoc-986', await H.hashClientId(r.sn_feedback_client_id));
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    const schede = [{
      _id: 'fbDoc-986', clientIdTag: tag, status: 'done', statusPublic: 'closed',
      name: 'Salva non salvava', seq: 986, subSeq: 0, userNote: 'Adesso Salva salva davvero.',
    }];
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => schede.filter((c) => (ids || []).includes(c._id));
    globalThis.SN_FEEDBACK.listPublic = async () => schede;
  });
  await home.reload();
  await expect(home.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });

  await expect(riga.locator('.bd-mia-stato')).toHaveText('risolta');
  await expect(riga.locator('.bd-mia-titolo')).toHaveText('#986 Salva non salvava');
  await expect(riga.locator('.bd-mia-risposta')).toHaveText('Risposta: Adesso Salva salva davvero.');
  await bacheca.screenshot({ path: 'tests/.shots/segnalazioni-mie-risolta.png' });
});

test('anche quella che Filo scrive in chat e l\'utente conferma finisce nell\'elenco, già inviata', async ({ app, openTab }) => {
  await reteFinta(app, { seq: 77 });
  const home = await openTab('filo://newtab/');
  await home.evaluate(() => window.SN_SIDEBAR.open());
  await home.evaluate(() => {
    window.__filoSidebarTest.runFiloAction({ type: 'INVIA_FEEDBACK', testo: 'Lo schermo intero lascia la barra in alto', titolo: 'Schermo intero' });
  });
  await expect(home.locator(CONFIRM_HOST)).toBeVisible();
  await clickConfirm(home, 'ok');
  await expect.poll(() => app.evaluate(() => globalThis.__invii.length)).toBe(1);

  const bacheca = await openTab(BACHECA);
  await expect(righe(bacheca)).toHaveCount(1);
  await expect(righe(bacheca).first().locator('.bd-mia-titolo')).toHaveText('#77 Schermo intero');
  await expect(righe(bacheca).first().locator('.bd-mia-stato')).toHaveText('inviata');
});

test('con più di tre segnalazioni la sezione mostra le ultime e si apre su tutte; il cestino chiede conferma', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const M = globalThis.SN_SEGNALAZIONI_MIE;
    for (let i = 1; i <= 5; i++) {
      await M.registra({ id: `s${i}`, testo: `Segnalazione numero ${i}`, creataIl: new Date(Date.UTC(2026, 9, i)).toISOString() });
    }
  });
  const bacheca = await openTab(BACHECA);
  await expect(righe(bacheca)).toHaveCount(3);
  await expect(righe(bacheca).first().locator('.bd-mia-titolo')).toHaveText('Segnalazione numero 5');
  await expect(bacheca.locator('#bdMieConto')).toHaveText('5');
  await bacheca.locator('#bdMieAltre').click();
  await expect(righe(bacheca)).toHaveCount(5);

  const ultima = righe(bacheca).first();
  const cestino = ultima.locator('.bd-mia-togli');
  await cestino.click();
  await expect(cestino).toHaveText('Togli?');
  // Senza il secondo clic torna com'era e non toglie niente.
  await expect(cestino).not.toHaveText('Togli?', { timeout: 5_000 });
  await expect(righe(bacheca)).toHaveCount(5);
  await cestino.click();
  await cestino.click();
  await expect(righe(bacheca)).toHaveCount(4);
  await expect(righe(bacheca).first().locator('.bd-mia-titolo')).toHaveText('Segnalazione numero 4');
  const ids = await app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco()).map((v) => v.id));
  expect(ids).not.toContain('s5');
});

test('in incognito l\'elenco non si scrive e non si vede', async ({ app, shell }) => {
  await reteFinta(app, { seq: 500 });
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    !!BrowserWindow.getAllWindows().find((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
  const apriIn = (incognito, url) => app.evaluate(({ BrowserWindow }, { incognito, url }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !!w._filoIncognito === incognito && w._filoTabs);
    return win._filoTabs.openTab(url);
  }, { incognito, url });
  await apriIn(true, `${BACHECA}?privata`);
  const privata = await paginaConContentScript(app, `${BACHECA}?privata`);

  // Il riquadro di una finestra incognito manda la segnalazione, ma la copia non nasce.
  await mandaDalRiquadro(privata, 'TESTO-INCOGNITO-986');
  await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.flush());
  expect(await app.evaluate(() => globalThis.__invii.length)).toBe(1);
  expect(await app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco()).length)).toBe(0);
  const dati = await app.evaluate(() => process.env.FILO_USER_DATA);
  const cartella = join(dati, 'segnalazioni-mie');
  const conIlTesto = existsSync(cartella)
    ? readdirSync(cartella).filter((f) => readFileSync(join(cartella, f), 'utf8').includes('TESTO-INCOGNITO-986'))
    : [];
  expect(conIlTesto).toEqual([]);

  // Una segnalazione mandata fuori c'è, ma la bacheca dell'incognito non la mostra.
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.registra({ id: 'fuori', testo: 'Mandata fuori' }));
  const vista = await privata.evaluate(() => window.filo.message({ type: 'segnalazioni_mie_list' }));
  expect(vista).toEqual({ ok: true, voci: [], incognito: true });
  await privata.reload();
  await privata.waitForFunction(() => window.__boardTest);
  await privata.waitForTimeout(500);
  await expect(privata.locator('#bdMie')).toBeHidden();
  await expect(privata.locator('body')).not.toContainText('Mandata fuori');
});

test('i siti non leggono e non toccano l\'elenco', async ({ app }) => {
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.registra({ id: 'mia', testo: 'SEGRETO-986' }));
  const daUnSito = (msg) => app.evaluate((_e, m) => globalThis.SN_HANDLE_MESSAGE(m, {
    tab: { id: 99, url: 'http://sito-ostile.example/' }, url: 'http://sito-ostile.example/',
  }), msg);
  const lettura = await daUnSito({ type: 'segnalazioni_mie_list' });
  expect(lettura.error).toBe('forbidden');
  expect(JSON.stringify(lettura)).not.toContain('SEGRETO-986');
  expect((await daUnSito({ type: 'segnalazioni_mie_togli', id: 'mia' })).error).toBe('forbidden');
  const daFilo = await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: 'segnalazioni_mie_list' }, {
    tab: { id: 1, url: 'filo://board/board.html' }, url: 'filo://board/board.html',
  }));
  expect(daFilo.voci.map((v) => v.id)).toEqual(['mia']);
});

test('chi non gestisce i feedback, dalla loro pagina, arriva alle sue segnalazioni', async ({ openTab }) => {
  const posta = await openTab('filo://feedback/feedback.html');
  const link = posta.locator('#adminMie');
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await expect.poll(() => posta.url()).toBe(`${BACHECA}#segnalazioni`);
  await expect(posta.locator('#bdMie')).toBeVisible();
  await expect(posta.locator('#bdMieVuoto')).toBeVisible();
});

test('una segnalazione mandata prima dell\'elenco: la sezione non dice che non ce ne sono, e all\'annuncio entra «risolta»', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  // Chi aggiorna: Filo conosce il numero della segnalazione, la copia locale no.
  await app.evaluate(async () => {
    const fresh = globalThis.SN_CREDITS.freshState();
    fresh.lastAutoFeedbackBonusDate = globalThis.SN_CREDITS.dateKey();
    await globalThis.SN_CREDITS.writeState(fresh);
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: 'cid-tester-di-settembre' });
    await globalThis.SN_FEEDBACK_MINE.ricordaId('fbDoc-vecchia');
  });

  const bacheca = await openTab(`${BACHECA}#segnalazioni`);
  await expect(bacheca.locator('#bdMieVuoto')).toBeVisible();
  await expect(bacheca.locator('#bdMieVuoto')).not.toContainText('non hai ancora mandato');

  await app.evaluate(async () => {
    const r = await globalThis.chrome.storage.local.get('sn_feedback_client_id');
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const tag = await H.cardTag('fbDoc-vecchia', await H.hashClientId(r.sn_feedback_client_id));
    const schede = [{
      _id: 'fbDoc-vecchia', clientIdTag: tag, status: 'done', statusPublic: 'closed', createdAt: '2026-09-12T10:00:00.000Z',
      name: 'Il download si fermava', seq: 640, subSeq: 0, userNote: 'Adesso riprende da solo.',
    }];
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => schede.filter((c) => (ids || []).includes(c._id));
    globalThis.SN_FEEDBACK.listPublic = async () => schede;
  });
  const home = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await home.reload();
  await expect(home.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });

  const riga = righe(bacheca);
  await expect(riga).toHaveCount(1);
  await expect(riga.first().locator('.bd-mia-titolo')).toHaveText('#640 Il download si fermava');
  await expect(riga.first().locator('.bd-mia-stato')).toHaveText('risolta');
  await expect(riga.first().locator('.bd-mia-sub')).toContainText('2026');
  await riga.first().locator('.bd-mia-testa').click();
  await expect(riga.first().locator('.bd-mia-risposta')).toHaveText('Risposta: Adesso riprende da solo.');
});

test('chi ha segnalazioni di prima trova la sezione anche aprendo la Bacheca dal menu, con la frase che spiega il vuoto', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: 'cid-tester-di-settembre' });
    await globalThis.SN_FEEDBACK_MINE.ricordaId('fbDoc-vecchia');
  });
  const bacheca = await openTab(BACHECA);
  await expect(bacheca.locator('#bdMie')).toBeVisible({ timeout: 8_000 });
  await expect(bacheca.locator('#bdMieVuoto')).toContainText('prima di questa versione');
  await expect(bacheca.locator('#bdMiglioramentiTitolo')).toBeVisible();
});

test('chi non ha mai segnalato non vede la sezione aprendo la Bacheca dal menu', async ({ openTab }) => {
  const bacheca = await openTab(BACHECA);
  await bacheca.waitForTimeout(800);
  await expect(bacheca.locator('#bdMie')).toBeHidden();
});

test('aperta una riga, il titolo lungo si legge per intero', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.registra({
    id: 'lunga', testo: 'Testo', stato: 'inviata', num: '990',
    titolo: 'Il colore del bordo delle schede non cambia mai, qualunque cosa scelga nelle impostazioni avanzate, nemmeno dopo il riavvio di Filo e la pulizia della cache',
  }));
  const bacheca = await openTab(`${BACHECA}#segnalazioni`);
  const titolo = righe(bacheca).first().locator('.bd-mia-titolo');
  expect(await titolo.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);
  await righe(bacheca).first().locator('.bd-mia-testa').click();
  await expect.poll(() => titolo.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false);
  await expect(titolo).toContainText('pulizia della cache');
  await bacheca.screenshot({ path: 'tests/.shots/segnalazioni-mie-titolo-intero.png' });
  await righe(bacheca).first().locator('.bd-mia-testa').click();
  await expect.poll(() => titolo.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);
});

test('«/feedback» nella home porta chi non gestisce i feedback alle sue segnalazioni', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.registra({ id: 'mia', testo: 'Il tasto Salva non salva', stato: 'inviata', num: '990' }));
  const home = await openTab('filo://newtab/');
  const box = home.locator('#dashInput, #input, textarea').first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill('/feedback');
  await box.press('Enter');
  const bacheca = () => app.windows().find((w) => { try { return w.url().startsWith(BACHECA); } catch (_) { return false; } });
  await expect.poll(() => !!bacheca(), { timeout: 8_000 }).toBe(true);
  await expect(righe(bacheca())).toHaveCount(1);
  await expect(righe(bacheca()).first().locator('.bd-mia-titolo')).toHaveText('#990 Il tasto Salva non salva');
});

test('tasto destro su una riga: copia il testo, rimanda quella non partita già scritta, togli', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const M = globalThis.SN_SEGNALAZIONI_MIE;
    await M.registra({ id: 'ok', testo: 'Il tasto Salva non salva', stato: 'inviata', num: '990', creataIl: '2026-10-04T10:00:00Z' });
    await M.registra({ id: 'ferma', testo: 'Il video si blocca a metà', creataIl: '2026-10-03T10:00:00Z' });
    await M.nonPartita('ferma');
  });
  const bacheca = await openTab(`${BACHECA}#segnalazioni`);
  await expect(righe(bacheca)).toHaveCount(2);
  const menu = bacheca.locator('.bd-mia-menu');

  await righe(bacheca).first().locator('.bd-mia-titolo').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-select-option')).toHaveText(['Copia il testo', 'Togli dall’elenco']);
  await menu.getByText('Copia il testo').click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Il tasto Salva non salva');

  const ferma = righe(bacheca).filter({ hasText: 'Il video si blocca' });
  await ferma.locator('.bd-mia-titolo').click({ button: 'right' });
  await expect(menu.locator('.sn-select-option')).toHaveText(['Copia il testo', 'Rimanda', 'Togli dall’elenco']);
  await bacheca.screenshot({ path: 'tests/.shots/segnalazioni-mie-tasto-destro.png' });
  await menu.getByText('Rimanda').click();
  await expect(bacheca.locator('.sn-fb-modal')).toBeVisible();
  await expect(bacheca.locator('.sn-fb-text')).toHaveValue('Il video si blocca a metà');
  await bacheca.locator('.sn-fb-cancel').click();
  await expect(bacheca.locator('.sn-fb-modal')).toHaveCount(0);

  await ferma.locator('.bd-mia-titolo').click({ button: 'right' });
  await bacheca.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await ferma.locator('.bd-mia-titolo').click({ button: 'right' });
  await menu.getByText('Togli dall’elenco').click();
  await expect(righe(bacheca)).toHaveCount(1);
  const ids = await app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco()).map((v) => v.id));
  expect(ids).toEqual(['ok']);
});

test('rimandata dal tasto destro, la segnalazione «non partita» lascia il posto a quella partita', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const M = globalThis.SN_SEGNALAZIONI_MIE;
    await M.registra({ id: 'ferma', testo: 'Il video si blocca', creataIl: '2026-10-04T07:00:00Z' });
    await M.nonPartita('ferma');
  });
  await reteFinta(app, { seq: 1000 });
  const bacheca = await openTab(`${BACHECA}#segnalazioni`);
  await expect(righe(bacheca)).toHaveCount(1);
  await righe(bacheca).first().locator('.bd-mia-titolo').click({ button: 'right' });
  await bacheca.locator('.bd-mia-menu').getByText('Rimanda').click();
  await expect(bacheca.locator('.sn-fb-modal')).toBeVisible();
  await bacheca.locator('.sn-fb-send').click();
  await expect(bacheca.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 6_000 });
  await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.flush());
  await expect(righe(bacheca).locator('.bd-mia-stato')).toHaveText(['inviata']);
  await expect(righe(bacheca).first().locator('.bd-mia-titolo')).toHaveText(/^#1000 /);
});

// ── Riavvio: la stessa cartella dati in tre avvii ──────────────────────────────
async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}
async function apriBacheca(app, shell) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), BACHECA);
  const scadenza = Date.now() + 10_000;
  let page = null;
  while (Date.now() < scadenza && !page) {
    page = app.windows().find((w) => { try { return w.url().startsWith(BACHECA); } catch (_) { return false; } });
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForLoadState('domcontentloaded');
  return page;
}

testSenzaFixture('dopo un riavvio l\'elenco c\'è ancora, e una voce tolta non torna', async () => {
  testSenzaFixture.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-segnalazioni-riavvio-');
  try {
    let { app, shell } = await avvia(userData);
    await reteFinta(app, { seq: 41 });
    const home = await paginaConContentScript(app, 'filo://newtab');
    await mandaDalRiquadro(home, 'Resta dopo il riavvio');
    await mandaDalRiquadro(home, 'Questa la tolgo');
    await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.flush());
    await chiudiApp(app);

    ({ app, shell } = await avvia(userData));
    let bacheca = await apriBacheca(app, shell);
    await expect(righe(bacheca)).toHaveCount(2);
    const daTogliere = righe(bacheca).filter({ hasText: 'Questa la tolgo' });
    await expect(daTogliere.locator('.bd-mia-stato')).toHaveText('inviata');
    await daTogliere.locator('.bd-mia-togli').click();
    await daTogliere.locator('.bd-mia-togli').click();
    await expect(righe(bacheca)).toHaveCount(1);
    await chiudiApp(app);

    ({ app, shell } = await avvia(userData));
    bacheca = await apriBacheca(app, shell);
    await expect(righe(bacheca)).toHaveCount(1);
    await expect(righe(bacheca).first().locator('.bd-mia-titolo')).toHaveText(/^#41 /);
    await expect(bacheca.locator('#bdMie')).not.toContainText('Questa la tolgo');
    await chiudiApp(app);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
