// Giro di verifica locale del ramo claude/link-invito — giro 6.
//
// La pista che nessuno dei cinque giri passati aveva battuto: al primo avvio
// di chi arriva da un link d'invito succedono DUE cose — i crediti arrivano da
// soli, e Filo si presenta con la conversazione di accoglienza del primo
// avvio. Qui si guarda la seconda.
//
// Le due prove vanno lette in coppia:
//   1. l'invitato riceve i crediti e aspetta: Filo non si presenta mai, né
//      sulla home aperta né su una scheda nuova, e la home resta quella col
//      messaggio fisso invece di quella costruita su misura;
//   2. sulla STESSA installazione, appena si spegne «usa i modelli
//      predefiniti», Filo si presenta all'istante. È il controllo: dice che
//      l'accoglienza qui funziona, e che a tenerla spenta è la configurazione
//      condivisa dei modelli, non l'invito.
//
// Quella configurazione dichiara ancora un fornitore che Filo non usa più, e
// la chiave che Filo ha davvero è di un altro: da lì in poi Filo si comporta
// come se non avesse nessuna chiave. Non è roba di questo ramo, e tocca
// chiunque, non solo chi entra con un invito; si vede qui perché il primo
// avvio dell'invitato è la scena che questo lavoro consegna.
//
// Scritto da chi verifica, non da chi ha fatto il lavoro. Server finto: un
// codice vero a usi contati non si brucia per una prova.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmText, clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const CODICE = 'ABCDEFGH';

let server;
const visto = { redeems: [] };
let riscattato = false;

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
      const auth = req.headers.authorization || '';
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (auth !== 'Bearer anon-id-token') return json(res, 401, { error: { message: 'no auth' } });
      if (url === '/walletState') {
        if (!riscattato) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, {
          result: {
            hasWallet: true, pseudonym: 'abcdef0123456789',
            balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0, remainingUsd: 4.2, eurUsd: 1.2, eurPerCredit: 0.0007 },
            stale: false, dailyCredits: 100, invites: [{ code: 'AAAA2222', max: 3, used: 0, uses: [] }],
          },
        });
      }
      if (url === '/walletPendingInvite') return json(res, 200, { result: { status: 'ok', code: CODICE } });
      if (url === '/walletRedeem') {
        const code = String((body.data && body.data.code) || '');
        visto.redeems.push(code);
        if (code !== CODICE) return json(res, 200, { result: { status: 'invalid_code' } });
        riscattato = true;
        return json(res, 200, { result: { status: 'ok', key: 'sk-or-v1-test-personal', pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, cutReason: null } });
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

test.afterAll(async () => {
  for (const k of ['FILO_FUNCTIONS_BASE', 'FILO_IDENTITY_ENDPOINT', 'FILO_SECURE_TOKEN_ENDPOINT']) delete process.env[k];
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => { visto.redeems.length = 0; riscattato = false; });

async function attendiHome(app, tetto = 30000) {
  const scadenza = Date.now() + tetto;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => {
      try { return new URL(x.url()).hostname === 'newtab'; } catch (_) { return false; }
    });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// Filo si è presentato? La conversazione di accoglienza non è un riquadro:
// prende il posto della home, e la prima bolla è il testo fisso di Filo.
async function siEPresentato(page) {
  try {
    const stato = await page.getAttribute('body', 'data-state');
    if (stato !== 'thread') return false;
    const t = await page.locator('.dash-bubble-filo').first().innerText({ timeout: 2000 });
    return /Ciao, sono Filo/.test(t || '');
  } catch (_) { return false; }
}

// Il giro dell'invitato fino al benvenuto chiuso: identico nelle due prove.
async function giroDellInvitato(app) {
  await expect.poll(() => visto.redeems.length, { timeout: 90000, intervals: [400] }).toBeGreaterThan(0);
  expect(visto.redeems[0]).toBe(CODICE);

  const home = await attendiHome(app);
  expect(home, 'la home non si è aperta all’avvio').toBeTruthy();

  await expect(home.locator(CONFIRM_HOST)).toBeVisible({ timeout: 90000 });
  await expect.poll(() => confirmText(home), { timeout: 30000 }).toContain('Benvenuto in Filo');
  await clickConfirm(home, 'ok');
  await expect(home.locator(CONFIRM_HOST)).toBeHidden({ timeout: 15000 });
  return home;
}

test('entrato con l’invito, Filo si presenta', async ({ app, shell }) => {
  test.setTimeout(300000);

  const home = await giroDellInvitato(app);

  // Risolto dal #663: con i modelli predefiniti la conversazione parte. Prima
  // il controllo di prontezza cercava una chiave intestata al fornitore
  // dichiarato, che non ne aveva nessuna, e l'accoglienza non arrivava mai.
  await expect.poll(() => siEPresentato(home), { timeout: 45000, intervals: [1000] }).toBe(true);

  // …né su una scheda nuova, che è l'unica strada che restava.
  const primaDi = new Set(app.windows());
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let seconda = null;
  const scadenza = Date.now() + 30000;
  while (Date.now() < scadenza && !seconda) {
    seconda = app.windows().find((w) => {
      if (primaDi.has(w)) return false;
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    }) || null;
    if (!seconda) await new Promise((r) => setTimeout(r, 150));
  }
  expect(seconda, 'la seconda scheda della home non si è aperta').toBeTruthy();
  await expect.poll(() => siEPresentato(seconda), { timeout: 45000, intervals: [1000] }).toBe(true);
});

test('controllo: spenti i modelli predefiniti, Filo si presenta subito', async ({ app }) => {
  test.setTimeout(300000);

  const home = await giroDellInvitato(app);

  // Stessa installazione, stesso invito appena riscattato. L'unica cosa che
  // cambia è che i modelli non arrivano più dalla configurazione condivisa:
  // basta questo perché Filo ritrovi la sua chiave e si presenti.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await home.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});

  await expect.poll(() => siEPresentato(home), { timeout: 60000, intervals: [1000] }).toBe(true);
});
