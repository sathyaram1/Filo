// Bacheca e Deck builder dei Mazzi in pausa per chi non è owner, finché l'owner non li apre a tutti (#1592).
//
// Cosa deve essere vero
//   1. Chi non è l'owner, con gli interruttori spenti: niente voce Bacheca né Deck builder nel menu App, niente carta
//      Mazzi nella home, niente «Ancora rotto?» né voti. Le segnalazioni che ha mandato restano raggiungibili.
//   2. L'owner, con gli interruttori spenti, vede tutto come prima.
//   3. Accesa da Gestione, chi non è owner la rivede senza riavviare Filo; rimessa in pausa, la pagina aperta si chiude
//      sulle sue segnalazioni. Ogni interruttore vale per la sua funzione.
//   4. L'agente di chi non le vede non le racconta e non rimette la carta dei Mazzi.
//
// Firestore e identità sono un HTTP locale (come in redteam-pausa.spec.mjs).

import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';
import { home as homeChat, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';

test.use({ inPausaAperte: false });

const SHOTS = 'tests/.shots';
const OWNER_EMAIL = 'owner@prova.test';
const UTENTE_EMAIL = 'utente@prova.test';
const PAUSA_MAZZI = 'Il Deck builder è in pausa: tornerà più avanti';
const PAUSA_BACHECA = 'La Bacheca è in pausa: tornerà più avanti';

let server;
let base = '';
// I documenti config/bacheca e config/mazzi come su Firestore: null = non esiste.
const docs = {};
const patch = [];

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: jwt('anon-1'), refreshToken: 'rt-anon', expiresIn: '3600', localId: 'anon-1' });
      }
      if (url === '/token') {
        const rt = new URLSearchParams(raw).get('refresh_token');
        const email = rt === 'rt-owner' ? OWNER_EMAIL : UTENTE_EMAIL;
        const uid = rt === 'rt-owner' ? 'owner-1' : 'utente-1';
        return json(res, 200, { id_token: jwt(uid, { email }), refresh_token: rt, expires_in: '3600', user_id: uid });
      }
      if (url.includes('/databases/(default)/documents/')) {
        const doc = url.split('/databases/(default)/documents/')[1];
        if (doc === 'config/bacheca' || doc === 'config/mazzi') {
          if (req.method === 'PATCH') {
            const mask = new URL(req.url, 'http://x').searchParams.getAll('updateMask.fieldPaths');
            patch.push({ doc, mask, fields: body.fields, auth: req.headers.authorization || '' });
            docs[doc] = { openToAll: body.fields.openToAll.booleanValue };
            return json(res, 200, { name: doc, fields: body.fields });
          }
          if (!docs[doc]) return json(res, 404, { error: { code: 404, status: 'NOT_FOUND' } });
          return json(res, 200, { name: doc, fields: { openToAll: { booleanValue: docs[doc].openToAll } } });
        }
        return json(res, 200, { name: doc, fields: {} });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
  process.env.FILO_ADMIN_EMAILS = OWNER_EMAIL;
});

test.afterAll(async () => {
  for (const k of ['FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT', 'FILO_ADMIN_EMAILS']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  docs['config/bacheca'] = { openToAll: false };
  docs['config/mazzi'] = { openToAll: false };
  patch.length = 0;
});

// Firestore ha l'indirizzo scritto nel codice: nel main il `fetch` globale lo ridirige al finto.
async function preparaMain(app) {
  await app.evaluate((_, indirizzo) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/firestore\.googleapis\.com/, indirizzo), init);
  }, base);
}

// Rilegge gli interruttori come alla scadenza della copia: due volte, perché una lettura partita prima del finto
// risponderebbe con quello che ha trovato lei.
async function rileggi(app) {
  return app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const P = req('./services/inPausa');
    const out = {};
    for (const n of P.NOMI) { await P.cancello(n).rileggiOra(); out[n] = (await P.cancello(n).rileggiOra()).visible; }
    return out;
  });
}

// Entra come owner o come utente qualunque, poi rilegge gli interruttori.
async function entra(app, chi) {
  const admin = await app.evaluate(async ({}, o) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const cfg = req('./auth/config');
    const store = req('./auth/token-store');
    const ga = req('./auth/google-auth');
    cfg.secureTokenEndpoint = o.tokenEndpoint;
    store.save({ refreshToken: o.chi === 'owner' ? 'rt-owner' : 'rt-utente', email: o.chi === 'owner' ? o.owner : o.utente, name: 'Prova', picture: '' });
    ga.restore();
    await ga.getIdToken();
    return ga.isAdmin();
  }, { tokenEndpoint: process.env.FILO_SECURE_TOKEN_ENDPOINT, chi, owner: OWNER_EMAIL, utente: UTENTE_EMAIL });
  return { admin, ...(await rileggi(app)) };
}

const popupAperti = (app) => app.windows().filter((w) => { try { return !w.isClosed() && w.url().startsWith('data:text/html'); } catch (_) { return false; } });

async function vociDelMenuApp(app, shell) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      try { if (w.webContents.getURL().startsWith('data:text/html')) w.destroy(); } catch (_) {}
    }
  });
  await expect.poll(() => popupAperti(app).length).toBe(0);
  await shell.evaluate(() => document.getElementById('nav-apps').click());
  await expect.poll(() => popupAperti(app).length, { message: 'il menu App non si è aperto' }).toBe(1);
  const popup = popupAperti(app)[0];
  await popup.waitForSelector('.item .lbl');
  return popup.locator('.item .lbl').allInnerTexts();
}

async function home(app) {
  let win = null;
  await expect.poll(() => Boolean(win = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } })),
    { message: 'nessuna home' }).toBe(true);
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible({ timeout: 10_000 });
  return win;
}

test('#1592 — chi non è owner, in pausa: niente Bacheca né Deck builder, le sue segnalazioni restano', async ({ app, shell, openTab }) => {
  await preparaMain(app);
  expect(await entra(app, 'utente')).toEqual({ admin: false, bacheca: false, mazzi: false });

  expect(await vociDelMenuApp(app, shell)).toEqual(['Editor', 'Aperti per dopo', 'Download', 'Memorie', 'Le tue segnalazioni']);
  // La voce porta alle segnalazioni, come la cella della home e il comando /feedback.
  await popupAperti(app)[0].locator('.item', { hasText: 'Le tue segnalazioni' }).click();
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === 'filo://board/board.html#segnalazioni'; } catch (_) { return false; } }),
    { message: 'la voce non ha aperto le segnalazioni' }).toBe(true);

  const h = await home(app);
  await expect(h.locator('#altro .dash-altro-app[data-id="bacheca"]')).toHaveText('Segnalazioni');
  await expect(h.locator('#altro .dash-altro-app[data-id="bacheca"]')).toHaveAttribute('title', 'Apri Segnalazioni');
  await expect(h.locator('#tieni .dash-carta[data-chiave="mazzi"]')).toHaveCount(0);
  await expect(h.locator('#altro')).not.toContainText(/Bacheca|Mazzi/);
  mkdirSync(SHOTS, { recursive: true });
  await h.screenshot({ path: `${SHOTS}/1592-home-in-pausa.png` });

  // Il Deck builder da indirizzo dice solo la pausa, da qualunque nome della sua cartella.
  for (const url of ['filo://decks/decks.html', 'filo://decks/decks.js', 'filo://decks/decks.html#/deck/abc']) {
    const p = await openTab(url);
    await expect.poll(() => p.evaluate(() => document.body.innerText.trim()), { message: url }).toBe(PAUSA_MAZZI);
  }

  // La Bacheca si apre sulle sole segnalazioni: niente miglioramenti, voti o «Ancora rotto?».
  const b = await openTab('filo://board/board.html');
  await expect(b.locator('#bdMie')).toBeVisible();
  await expect(b.locator('#bdMieTitolo')).toContainText('Le tue segnalazioni');
  await expect(b.locator('#bdMieVuoto')).toHaveText('Da questo computer non hai ancora mandato segnalazioni.');
  await b.waitForTimeout(800);
  await expect(b.locator('body')).toHaveAttribute('data-bacheca-pausa', '1');
  for (const sel of ['.bd-head', '.bd-auth', '#bdList', '#bdLoading', '#bdMiglioramentiTitolo']) await expect(b.locator(sel), sel).toBeHidden();
  await expect(b.locator('.bd-reopen-link')).toHaveCount(0);
  await expect(b).toHaveTitle('Filo — Le tue segnalazioni');
  await expect(b.locator('body')).not.toContainText(/Ancora rotto|Bacheca|vot/i, { useInnerText: true });
  await b.screenshot({ path: `${SHOTS}/1592-segnalazioni-in-pausa.png` });
  await b.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await b.waitForTimeout(500);
  await b.screenshot({ path: `${SHOTS}/1592-segnalazioni-in-pausa-scuro.png` });

  // Un voto o un «Ancora rotto?» forzati (una pagina vecchia) si fermano nel main.
  for (const m of [{ type: 'board_cast_vote', id: 'fb-1', vote: 'works' }, { type: 'board_clear_vote', id: 'fb-1' }, { type: 'board_reopen', id: 'fb-1', text: 'ancora rotto' }]) {
    expect(await b.evaluate((x) => chrome.runtime.sendMessage(x), m), m.type).toMatchObject({ ok: false, code: 'paused', error: PAUSA_BACHECA });
  }
  // L'interruttore lo tocca solo l'owner.
  const forzato = await b.evaluate(() => chrome.runtime.sendMessage({ type: 'in_pausa_set', nome: 'bacheca', openToAll: true }));
  expect(forzato.ok).toBe(false);
  expect(patch).toEqual([]);
});

test('#1592 — l’owner, in pausa, vede tutto come prima', async ({ app, shell, openTab }) => {
  await preparaMain(app);
  expect(await entra(app, 'owner')).toEqual({ admin: true, bacheca: true, mazzi: true });

  const voci = await vociDelMenuApp(app, shell);
  expect(voci.slice(0, 6)).toEqual(['Editor', 'Deck builder MTG', 'Aperti per dopo', 'Download', 'Memorie', 'Bacheca']);

  const h = await home(app);
  await expect(h.locator('#tieni .dash-carta[data-chiave="mazzi"]')).toBeVisible();
  await expect(h.locator('#altro .dash-altro-app[data-id="bacheca"]')).toHaveText('Bacheca');

  const d = await openTab('filo://decks/decks.html');
  await expect(d.locator('h1').first()).toHaveText('Deck builder MTG');
  await expect(d.locator('#mzPausa')).toHaveCount(0);

  const b = await openTab('filo://board/board.html');
  await expect(b.locator('.bd-head h1')).toHaveText('Bacheca');
  await expect(b.locator('body')).not.toHaveAttribute('data-bacheca-pausa', /.*/);
  await expect(b).toHaveTitle('Filo — Bacheca');
});

test('#1592 — aperta da Gestione la rivede chi non è owner, senza riavvio; rimessa in pausa, la pagina aperta si chiude', async ({ app, shell, openTab }) => {
  await preparaMain(app);
  await entra(app, 'owner');

  const mg = await openTab('filo://manage/manage.html');
  await apriScheda(mg, 'stats');
  await expect(mg.locator('.mg-tab[data-tab="stats"]')).toHaveText('In pausa');
  const levetta = mg.locator('#mgIpSwitch-bacheca');
  await expect(levetta).not.toHaveClass(/mg-switch--disabled/);
  await expect(mg.locator('#mgIpToggle-bacheca')).not.toBeChecked();
  await expect(mg.locator('#mgIpMsg-bacheca')).toHaveText('In pausa: la vedi solo tu. Gli altri trovano solo le segnalazioni che hanno mandato.');
  await expect(mg.locator('#mgIpMsg-mazzi')).toHaveText('In pausa: lo vedi solo tu. I mazzi di chi ne aveva restano sul suo computer.');
  mkdirSync(SHOTS, { recursive: true });
  await mg.locator('#panel-stats').screenshot({ path: `${SHOTS}/1592-gestione-in-pausa.png` });
  await mg.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await mg.waitForTimeout(500);
  await mg.locator('#panel-stats').screenshot({ path: `${SHOTS}/1592-gestione-in-pausa-scuro.png` });

  await levetta.click();
  await expect(mg.locator('#mgIpToggle-bacheca')).toBeChecked();
  await expect(mg.locator('#mgIpState-bacheca')).toHaveText('On');
  await expect(mg.locator('#mgIpMsg-bacheca')).toContainText('Aperta: la vede chiunque usi Filo.');
  expect(patch).toHaveLength(1);
  expect(patch[0].doc).toBe('config/bacheca');
  expect(patch[0].mask.sort()).toEqual(['openToAll', 'updatedAt']);
  expect(patch[0].fields.openToAll).toEqual({ booleanValue: true });
  expect(patch[0].auth).toMatch(/^Bearer /);
  // L'altra resta com'era.
  await expect(mg.locator('#mgIpToggle-mazzi')).not.toBeChecked();

  // Stessa installazione, chi la usa adesso non è owner: la Bacheca sì, il Deck builder no, senza riavvio.
  expect(await entra(app, 'utente')).toEqual({ admin: false, bacheca: true, mazzi: false });
  const voci = await vociDelMenuApp(app, shell);
  expect(voci).toContain('Bacheca');
  expect(voci).not.toContain('Le tue segnalazioni');
  expect(voci).not.toContain('Deck builder MTG');
  const b = await openTab('filo://board/board.html');
  await expect(b.locator('.bd-head h1')).toHaveText('Bacheca');

  // Rimessa in pausa da un'altra installazione dell'owner: alla rilettura la pagina aperta torna alle segnalazioni.
  docs['config/bacheca'] = { openToAll: false };
  expect(await rileggi(app)).toEqual({ bacheca: false, mazzi: false });
  await expect(b.locator('body')).toHaveAttribute('data-bacheca-pausa', '1', { timeout: 10_000 });
  await expect(b.locator('#bdMie')).toBeVisible();
  await expect(b.locator('.bd-head')).toBeHidden();
  expect(await vociDelMenuApp(app, shell)).toContain('Le tue segnalazioni');

  // Lo stesso per il Deck builder: aperto lo usa, rimesso in pausa la pagina aperta lascia la sola frase.
  docs['config/mazzi'] = { openToAll: true };
  expect(await rileggi(app)).toEqual({ bacheca: false, mazzi: true });
  const d = await openTab('filo://decks/decks.html');
  await expect(d.locator('h1').first()).toHaveText('Deck builder MTG');
  docs['config/mazzi'] = { openToAll: false };
  expect(await rileggi(app)).toEqual({ bacheca: false, mazzi: false });
  await expect.poll(() => d.evaluate(() => document.body.innerText.trim()).catch(() => ''), { timeout: 10_000 }).toBe(PAUSA_MAZZI);
});

test('#1592 — all’agente di chi non è owner, in pausa, non arrivano né la Bacheca né il Deck builder', async ({ app, shell }) => {
  void shell; // Filo avviato del tutto: il fetch del main si ridirige dopo che l'avvio ha messo il suo
  await preparaMain(app);
  await entra(app, 'utente');
  const page = await homeChat(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"rimetti","carta":"mazzi"}' }] },
    { text: 'Fatto.' },
  ]);
  try {
    await chiedi(page, 'rimetti la carta dei mazzi');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    const [prima, seconda] = await chiamateAlModello(app);
    const sistema = prima.filter((m) => m.role === 'system').map((m) => JSON.stringify(m.content)).join('\n');
    expect(sistema, 'il prompt non porta l’indice delle capacità').toContain('[segnalazioni-mie]');
    expect(sistema, 'l’indice delle capacità nomina le funzioni in pausa').not.toMatch(/\[board\]|\[deck-builder\]|Bacheca dei miglioramenti|Deck builder/);
    const esito = seconda.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
    // L'esito dice che la carta non c'è e descrive la home senza i Mazzi (l'utente li ha nominati, l'agente no).
    const dati = JSON.parse(esito.match(/\{"error"[^]*?\}/)[0]);
    expect(dati.error).toBe('carta sconosciuta');
    expect([...dati.destra, ...dati.altro]).toEqual(['Editor', 'Filo ti suggerisce', 'Impostazioni rapide']);
    await page.reload();
    await expect(page.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#tieni .dash-carta[data-chiave="mazzi"]')).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});
