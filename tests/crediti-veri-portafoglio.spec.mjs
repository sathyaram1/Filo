// Con un portafoglio le cifre dei crediti che Filo dice fuori dalla pagina
// Crediti sono quelle del server (#816): la chat, il messaggio d'invio di una
// segnalazione, il riquadro della risoluzione. Il vecchio conteggio locale non
// riceve più premi.
//
// Server dei crediti e identità sono un HTTP locale (come wallet-credits.spec):
// le variabili vanno nell'ambiente prima che la fixture lanci Electron.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

let server;
let serverDown = false;
let saldo = 4321.5;
let quota = 100;
let grants = [];
let tetto = 5;
// #1353 — un server dei crediti lento (avvio a freddo) e quante letture del saldo gli arrivano.
let ritardoMs = 0;
let lettureSaldo = 0;

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
      if (url === '/accounts:signUp') {
        return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-816' });
      }
      if (url === '/token') {
        return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-816' });
      }
      if (serverDown) { res.destroy(); return; }
      if ((req.headers.authorization || '') !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        lettureSaldo += 1;
        // Le cifre sono quelle di quando la domanda è arrivata, come sul server vero.
        const risposta = {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: saldo, creditsGranted: 5000, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: quota, sentRewardsPerDay: tetto, grants, invites: [],
          },
        };
        setTimeout(() => json(res, 200, risposta), ritardoMs);
        return;
      }
      if (url === '/walletRedeem') {
        return json(res, 200, {
          result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, inviteCodes: [] },
        });
      }
      json(res, 404, { error: { message: 'not found ' + url } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.beforeEach(() => {
  serverDown = false;
  saldo = 4321.5;
  quota = 100;
  tetto = 5;
  ritardoMs = 0;
  lettureSaldo = 0;
  grants = [{ at: '2026-09-20T10:00:00.000Z', credits: 5000, why: 'entry' }];
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

async function riscatta(app) {
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'wallet_redeem', code: 'ABCD-EFGH' },
    { tab: { id: 8, url: 'filo://credits/credits.html' }, url: 'filo://credits/credits.html' },
  ));
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

function saldoLocale(app) {
  return app.evaluate(async () => (await globalThis.SN_CREDITS.getPublic()).balanceExact);
}

// Il testo del «Filo State» che un turno di chat mette nel prompt.
function statoChat(app) {
  return app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble({ creditiFreschi: true })).stateText);
}

// Il tempo del main va avanti di un minuto: la chat torna a chiedere al server.
function passaUnMinuto(app) {
  return app.evaluate(() => {
    const vero = globalThis.__dateNowVero || Date.now;
    globalThis.__dateNowVero = vero;
    globalThis.__spostamento = (globalThis.__spostamento || 0) + 61_000;
    Date.now = () => vero() + globalThis.__spostamento;
  });
}

async function homeDiAvvio(app) {
  let win = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

test('la chat dice il saldo e la quota del portafoglio, e a server muto l\'ultimo saldo noto', async ({ app }) => {
  await homeDiAvvio(app);
  // Prima del riscatto vale il conteggio locale, com'era.
  const prima = await statoChat(app);
  expect(prima).toMatch(/Saldo: \d+ crediti \(si ricaricano di \d+ ogni giorno a mezzanotte\)/);

  await riscatta(app);
  const locale = await saldoLocale(app);
  let testo = await statoChat(app);
  expect(testo).toMatch(/Saldo: 4\.?321,5 crediti/);
  expect(testo).toContain('Ogni giorno ne arrivano altri 100');
  expect(testo).not.toContain('mezzanotte');
  expect(testo).not.toContain(`Saldo: ${Math.round(locale)} crediti`);

  // La quota cambia sul server: dopo un minuto il turno dice subito l'ultimo saldo noto (#1353) e lo fa rileggere.
  quota = 250;
  saldo = 4300;
  await passaUnMinuto(app);
  testo = await statoChat(app);
  expect(testo).toMatch(/Saldo: 4\.?321,5 crediti \(lo tiene il server; letto il .+\)\. È l'ultimo saldo noto/);
  await expect.poll(() => statoChat(app)).toMatch(/Saldo: 4\.?300 crediti \(lo tiene il server: è il numero della pagina Crediti\)/);
  expect(await statoChat(app)).toContain('Ogni giorno ne arrivano altri 250');

  // Server muto: il turno dopo ha l'ultimo saldo noto, e quando la lettura fallisce davvero lo dice.
  serverDown = true;
  await passaUnMinuto(app);
  testo = await statoChat(app);
  expect(testo).toMatch(/Saldo: 4\.?300 crediti \(lo tiene il server; letto il .+\)\. È l'ultimo saldo noto/);
  await expect.poll(() => statoChat(app)).toContain('il server dei crediti non risponde');
  expect(await statoChat(app)).toMatch(/Saldo: 4\.?300 crediti\. È l'ultimo saldo noto/);
});

// #1353 — un server dei crediti lento (avvio a freddo) non fa aspettare il turno e non diventa «non risponde»;
// chi scrive nella chat fa rileggere il saldo prima dell'invio.
test('server dei crediti lento: il turno parte subito con l\'ultimo saldo, e scrivere nella chat lo fa rileggere', async ({ app }) => {
  const home = await homeDiAvvio(app);
  await riscatta(app);
  ritardoMs = 4_000;
  saldo = 4000;
  await passaUnMinuto(app);

  const t0 = Date.now();
  const testo = await statoChat(app);
  expect(Date.now() - t0, 'il turno non aspetta il server dei crediti').toBeLessThan(1_000);
  expect(testo).toMatch(/Saldo: 4\.?321,5 crediti \(lo tiene il server; letto il .+\)\. È l'ultimo saldo noto/);
  expect(testo).not.toContain('non risponde');
  // Mentre il server ci pensa, un altro turno non chiede una seconda lettura e non accusa il server.
  const letture = lettureSaldo;
  expect(await statoChat(app)).not.toContain('non risponde');
  expect(lettureSaldo).toBe(letture);
  await expect.poll(() => statoChat(app), { timeout: 10_000 }).toMatch(/Saldo: 4\.?000 crediti \(lo tiene il server: è il numero/);

  // Un minuto dopo l'utente torna nella chat e scrive: la lettura parte mentre scrive, e all'invio il saldo è fresco.
  saldo = 3900;
  ritardoMs = 1_500;
  await passaUnMinuto(app);
  const prima = lettureSaldo;
  await home.reload();
  await home.waitForLoadState('domcontentloaded');
  await home.locator('#input').click();
  await home.locator('#input').pressSequentially('quanti crediti ho?', { delay: 20 });
  await expect.poll(() => lettureSaldo, { message: 'scrivere fa rileggere il saldo' }).toBeGreaterThan(prima);
  await expect.poll(() => statoChat(app), { timeout: 10_000 }).toMatch(/Saldo: 3\.?900 crediti \(lo tiene il server: è il numero/);
});

// #1353 — vale la lettura del saldo partita per ultima: una lenta partita prima (avvio a freddo, la lettura
// dell'avvio, la pagina Crediti) che finisce dopo non riporta in chat il saldo vecchio come appena letto.
test('una lettura del saldo partita prima e finita dopo non prende il posto di quella nuova', async ({ app }) => {
  await homeDiAvvio(app);
  await riscatta(app);
  // La lettura che Filo fa da solo quattro secondi dopo l'avvio è già passata.
  await new Promise((r) => setTimeout(r, 5_000));
  const prima = lettureSaldo;
  saldo = 4000;
  ritardoMs = 3_000;
  await app.evaluate(() => { globalThis.SN_WALLET_MAIN.readState().catch(() => {}); });
  await expect.poll(() => lettureSaldo).toBeGreaterThan(prima);
  saldo = 3900;
  ritardoMs = 200;
  await app.evaluate(() => globalThis.SN_WALLET_MAIN.readState());
  expect(await statoChat(app)).toMatch(/Saldo: 3\.?900 crediti \(lo tiene il server: è il numero/);
  await new Promise((r) => setTimeout(r, 3_500));
  expect(await statoChat(app), 'la lettura lenta, partita prima, non sostituisce quella nuova').toMatch(/Saldo: 3\.?900 crediti/);
  expect(await app.evaluate(() => globalThis.SN_WALLET_MAIN.ultimaLettura().state.server.balance.credits)).toBe(3900);
});

test('invio di una segnalazione col portafoglio: niente +5, il conteggio locale fermo, il premio lo mostra la pagina Crediti', async ({ app, openTab }) => {
  const page = await homeDiAvvio(app);
  await riscatta(app);
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fbNuovo', failed: [] });
    globalThis.SN_FEEDBACK_OUTBOX._setAuto(false);
  });
  const prima = await saldoLocale(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill('Il tasto indietro non torna alla pagina di prima');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });

  const toast = page.locator('.sn-toast').filter({ hasText: 'Feedback inviato' });
  await expect(toast).toContainText('Il premio arriva sul tuo saldo dopo i controlli.');
  await expect(toast).not.toContainText('+');
  await expect(page.locator('.sn-fb-credit-label')).toHaveCount(0);
  expect(await saldoLocale(app)).toBe(prima);

  // I controlli passano: il server accredita il premio vero, e la pagina
  // Crediti lo mostra fra i movimenti.
  grants = [{ at: new Date().toISOString(), credits: 10, why: 'feedback_sent:fbNuovo' }, ...grants];
  const crediti = await openTab('filo://credits/credits.html');
  const primo = crediti.locator('#moves li').first();
  await expect(primo).toContainText('+10', { timeout: 15_000 });
  await expect(primo).toContainText('Segnalazione inviata');
});

// #1077 — il server paga al più N premi d'invio al giorno per portafoglio: oltre, il messaggio d'invio non
// promette un premio che non arriverà. Contano quelli già arrivati oggi e gli invii fatti dopo la lettura.
test('invio oltre il tetto giornaliero dei premi: il messaggio dice che questo arriva senza premio', async ({ app }) => {
  const page = await homeDiAvvio(app);
  tetto = 2;
  grants = [{ at: new Date().toISOString(), credits: 10, why: 'feedback_sent:fbStamattina' }, ...grants];
  await riscatta(app);
  await app.evaluate(async () => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: `fb${Date.now()}`, failed: [] });
    globalThis.SN_FEEDBACK_OUTBOX._setAuto(false);
    await globalThis.SN_WALLET_MAIN.readState();
  });
  const invia = async (testo) => {
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    await expect(page.locator('.sn-fb-modal')).toBeVisible();
    await page.locator('.sn-fb-text').fill(testo);
    await page.locator('.sn-fb-send').click();
    await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });
    return page.locator('.sn-toast').filter({ hasText: 'Feedback inviato' }).last();
  };

  // Uno già pagato stamattina, tetto a due: questo ha ancora il premio.
  let toast = await invia('Il tasto indietro non torna alla pagina di prima');
  await expect(toast).toContainText('Il premio arriva sul tuo saldo dopo i controlli.');
  // Il premio di quello appena mandato non è ancora arrivato, ma conta: il tetto è pieno.
  toast = await invia('La barra delle schede sparisce a schermo intero');
  await expect(toast).toContainText('Il premio vale per i primi 2 feedback del giorno. Questo non ne riceve.');
  await expect(toast).not.toContainText('Il premio arriva sul tuo saldo');
  await expect(toast).not.toContainText('+');
  await page.screenshot({ path: 'tests/.shots/1077-tetto-premi-invio.png' });
});

// Le schede pubbliche di QUESTA installazione, senza rete (come in
// feedback-resolved-reward.spec).
async function semina(app, schede) {
  await app.evaluate(async (_electron, { schede }) => {
    const clientId = 'client-816';
    await globalThis.chrome.storage.local.set({ sn_feedback_client_id: clientId });
    const H = globalThis.SN_FEEDBACK_CLIENT_ID_HASH;
    const mioHash = await H.hashClientId(clientId);
    const cards = [];
    for (const c of schede) cards.push({ ...c, clientIdTag: await H.cardTag(c._id, mioHash) });
    globalThis.SN_FEEDBACK.listPublic = async () => cards;
    globalThis.SN_FEEDBACK.getManyPublic = async (ids) => {
      const voluti = new Set((ids || []).map(String));
      return cards.filter((c) => voluti.has(String(c._id)));
    };
    await globalThis.SN_FEEDBACK_MINE.scrivi({ ids: schede.map((c) => c._id), checkedAt: 0 });
  }, { schede });
}

test('riquadro della risoluzione col portafoglio: la cifra del server, l\'archiviata senza cifra, e chi aspetta il movimento aspetta', async ({ app, openTab }) => {
  const page = await homeDiAvvio(app);
  await page.waitForTimeout(500);
  await riscatta(app);
  const prima = await saldoLocale(app);

  const adesso = new Date().toISOString();
  grants = [{ at: adesso, credits: 50, why: 'feedback_closed:fbFatto' }, ...grants];
  const schede = [
    { _id: 'fbFatto', status: 'done', statusPublic: 'closed', name: 'Il tasto indietro', seq: 801, subSeq: 0, userNote: 'Adesso torna alla pagina di prima.', reward: 300, createdAt: adesso, resolvedAt: adesso },
    { _id: 'fbArchiviato', status: 'archived', statusPublic: 'closed', name: 'Un doppione', seq: 802, subSeq: 0, userNote: '', reward: 50, createdAt: adesso, resolvedAt: adesso },
    { _id: 'fbInAttesa', status: 'done', statusPublic: 'closed', name: 'Il menu che sparisce', seq: 803, subSeq: 0, userNote: 'Il menu resta aperto.', reward: 100, createdAt: adesso, resolvedAt: adesso },
  ];
  await semina(app, schede);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  const overlay = page.locator('#thanksOverlay');
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  const voci = page.locator('.dash-thanks-item');
  await expect(voci).toHaveCount(2);
  const fatto = voci.filter({ hasText: 'Il tasto indietro' });
  const archiviato = voci.filter({ hasText: 'Un doppione' });
  // La cifra è quella del movimento del server (50), non quella della scheda (300).
  await expect(fatto.locator('.dash-thanks-item-credits')).toHaveText('+50');
  await expect(archiviato.locator('.dash-thanks-item-credits')).toHaveCount(0);
  await expect(archiviato.locator('.dash-thanks-item-body')).toHaveText('L’abbiamo chiuso senza modifiche.');
  await expect(page.locator('.dash-thanks-total')).toContainText('+50 crediti');
  await expect(page.locator('.dash-recap-title')).toHaveText('Grazie! I tuoi feedback sono stati chiusi');
  await page.waitForTimeout(800); // fine della comparsa, per lo scatto
  await page.screenshot({ path: 'tests/.shots/crediti-veri-riquadro.png' }).catch(() => {});
  expect(await saldoLocale(app)).toBe(prima);

  // Il movimento arriva: al controllo successivo si annuncia, con la sua cifra,
  // e le due già annunciate non tornano.
  grants = [{ at: new Date().toISOString(), credits: 50, why: 'feedback_closed:fbInAttesa' }, ...grants];
  await app.evaluate(async (_e, ids) => globalThis.SN_FEEDBACK_MINE.scrivi({ ids, checkedAt: 0 }), schede.map((c) => c._id));
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-thanks-item')).toHaveCount(1);
  await expect(page.locator('.dash-thanks-item-title')).toHaveText('#803 Il menu che sparisce');
  await expect(page.locator('.dash-thanks-item-credits')).toHaveText('+50');
  await expect(page.locator('.dash-recap-title')).toHaveText('Grazie! Il tuo feedback è stato risolto');
  expect(await saldoLocale(app)).toBe(prima);

  const crediti = await openTab('filo://credits/credits.html');
  const primo = crediti.locator('#moves li').first();
  await expect(primo).toContainText('+50', { timeout: 15_000 });
  await expect(primo).toContainText('Segnalazione risolta');
});

test('riquadro con sole segnalazioni chiuse senza modifiche: il congedo non festeggia', async ({ app }) => {
  const page = await homeDiAvvio(app);
  await page.waitForTimeout(500);
  await riscatta(app);
  const adesso = new Date().toISOString();
  await semina(app, [
    { _id: 'fbDoppione', status: 'archived', statusPublic: 'closed', name: 'Un doppione', seq: 804, subSeq: 0, userNote: '', reward: 50, createdAt: adesso, resolvedAt: adesso },
  ]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#thanksOverlay')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-recap-title')).toHaveText('Grazie! Il tuo feedback è stato chiuso');
  await expect(page.locator('.dash-thanks-total')).toHaveCount(0);
  await expect(page.locator('.dash-recap-done')).toHaveText('Va bene');
  await page.locator('.dash-recap-done').click();
  await expect(page.locator('#thanksOverlay')).toHaveCount(0);
});
