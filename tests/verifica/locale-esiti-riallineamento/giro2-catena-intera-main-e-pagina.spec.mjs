// Giro 2 (verifica locale, ramo claude/esiti-riallineamento).
//
// Il giro 1 aveva trovato il buco FRA le due metà: la pagina era giusta dato
// ciò che le arrivava, il main non le faceva arrivare niente. Le due prove del
// giro 1 restano ognuna sulla sua metà. Questa le salda: il server finto
// risponde con le forme VERE di filo-security (commit 54ff023), il gestore
// vero del main le traduce, e ciò che il main risponde viene dato PARI PARI
// alla pagina di Gestione aperta in Filo, dove l'owner preme «Approva e
// fondi» e legge. Se una delle due metà cambia forma, qui si vede.
//
// Sessione da proprietario: finzione registrata al posto del modulo di
// accesso nel processo di prova (il main di Filo non ha una manopola di test
// per l'accesso, e un accesso Google vero non si può fare in una spec).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const MANAGE = 'filo://manage/manage.html';
const SHA_A = 'a1b2c3d4'.repeat(5);
const SHA_B = 'b2c3d4e5'.repeat(5);
const SHA_M = 'c3d4e5f6'.repeat(5);
const ID_VECCHIA = 'ab12cd34ef56ab12cd34ef56';
const ID_NUOVA = 'ff00ff00ff00ff00ff00ff00';
const GIORNO = 24 * 60 * 60 * 1000;

// Le risposte del server, nella forma che filo-security dà davvero
// (functions/src/routine/mergeApprovals.js, approve → done({...})).
const SERVER = {
  stale: {
    ok: true, result: 'stale', headSha: SHA_B,
    realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M },
    newRequest: ID_NUOVA,
    newBlocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['functions/src/routine/policy.js'], more: 0 }],
  },
  merged: { ok: true, result: 'merged', sha: SHA_M, realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M } },
  conflict: {
    ok: true, result: 'conflict', reason: 'conflitto di merge: serve risoluzione manuale',
    realignReason: 'richiesta nuova per la punta riallineata non registrata: realign_request_failed',
  },
  conflictMosso: {
    ok: true, result: 'conflict', reason: 'conflitto di merge: serve risoluzione manuale',
    realignReason: 'riallineamento automatico non riuscito: realign_branch_moved (il commit di riallineamento non parte dallo sha approvato (genitori: 0123456789ab))',
  },
};

let server;
let risposta = null;
let handlers;
let MSG;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (data.op === 'approve') return res.end(JSON.stringify({ result: risposta }));
      res.end(JSON.stringify({ result: { ok: true, pending: [], failed: [], recent: [] } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FILO_FUNCTIONS_BASE = `http://127.0.0.1:${server.address().port}`;

  const authPath = require.resolve(join(ROOT, 'src', 'main', 'auth', 'google-auth.js'));
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      isSignedIn: () => true, isAdmin: () => true,
      getIdToken: async () => 'token-di-prova',
      getProfile: () => ({ email: 'owner@esempio' }),
      getUid: async () => 'uid-owner', getAccessToken: async () => '',
      onChange: () => () => {},
    },
  };
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  MSG = globalThis.SN_MSG.MSG;
  const register = require(join(ROOT, 'src', 'main', 'services', 'handlers', 'auth.js'));
  handlers = new Map();
  register((type, fn) => handlers.set(type, fn), { MSG, broadcastToTabs() {}, broadcastToFiloPages() {}, broadcastLiveUpdate() {} });
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  await new Promise((r) => server.close(r));
});

/** Ciò che il main di Filo risponde alla pagina per una data risposta del server. */
async function rispostaDelMain(delServer) {
  risposta = delServer;
  const h = handlers.get(MSG.MERGE_APPROVAL_APPROVE);
  expect(h).toBeTruthy();
  return h({ type: MSG.MERGE_APPROVAL_APPROVE, id: ID_VECCHIA }, { isShell: true }, MANAGE);
}

function richiesta(over = {}) {
  return Object.assign({
    id: ID_VECCHIA, branch: 'claude/lavoro-riallineato', sha: SHA_A, who: 'worker/routine', origin: 'routine', num: '600',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 2 * 60 * 1000, expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false, outcome: '', mergeSha: '', decidedAtMs: 0, feedbackId: '',
    preapproved: false, preapprovedBy: '', preapprovedAt: '', realigned: null, newRequestId: '', supersedes: '', realignReason: '',
  }, over);
}

// Il canale pagina → main è sostituito per due soli messaggi; la risposta
// dell'approvazione è QUELLA del gestore vero, non una scritta a mano.
async function apri(page, cfg) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__macCalls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        window.__macCalls.push({ op: 'list' });
        const dopo = window.__macCalls.some((c) => c.op === 'approve');
        return { ok: true, pending: dopo ? (cfg.pendingDopo || []) : cfg.pending, failed: dopo ? (cfg.failedDopo || []) : (cfg.failed || []), recent: dopo ? (cfg.recentDopo || []) : (cfg.recent || []), ttlMs: 7 * cfg.GIORNO };
      }
      if (t === 'merge_approval_approve') { window.__macCalls.push({ op: 'approve', id: msg.id }); return cfg.approveReply; }
      return orig(msg);
    };
  }, Object.assign({ GIORNO }, cfg));
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

async function approva(page) {
  const btn = page.locator('.sn-mac-card:not(.sn-mac-card-failed) .sn-mac-btn-go').first();
  await btn.click();
  await expect(btn).toHaveText('Confermi?');
  await btn.click();
}

test('stale riallineata, dal server alla frase: la scheda nuova con la sola differenza compare da sola', async ({ openTab }) => {
  const dalMain = await rispostaDelMain(SERVER.stale);
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [richiesta()],
    approveReply: dalMain,
    // Quello che il server elenca DOPO: la vecchia consumata `stale` fra le
    // decise, la nuova in attesa con `supersedes` e i soli blocchi nuovi.
    pendingDopo: [richiesta({ id: ID_NUOVA, sha: SHA_B, supersedes: ID_VECCHIA, realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M }, blocks: SERVER.stale.newBlocks })],
    recentDopo: [richiesta({ used: true, outcome: 'stale', decidedAtMs: Date.now(), realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M }, newRequestId: ID_NUOVA, realignReason: 'blocchi nuovi dopo il riallineamento' })],
  });
  await approva(page);
  const status = page.locator('.sn-mac-card .sn-mac-status').first();
  await expect(status).toBeVisible();
  const testo = await status.textContent();
  expect(testo).toMatch(/riallineato il ramo/);
  expect(testo).toMatch(/richiesta nuova/);
  expect(testo).not.toMatch(/decade|rilancia|torna alla routine/i);

  // Senza toccare niente, entro pochi secondi l'elenco si ricarica: la scheda
  // nuova dice da dove viene e mostra SOLO il blocco nuovo.
  const nuova = page.locator('.sn-mac-card', { hasText: 'b2c3d4e5' });
  await expect(nuova).toBeVisible({ timeout: 8000 });
  await expect(nuova.locator('.sn-mac-realigned')).toHaveText('Punta riallineata su main dal server (era a1b2c3d4): qui solo ciò che non avevi ancora visto.');
  await expect(nuova.locator('.sn-mac-why')).toHaveText('Bloccata perché (solo il nuovo):');
  await expect(nuova.locator('.sn-mac-block-items')).toHaveText('functions/src/routine/policy.js');
  // La vecchia non c'è più: il suo sha non è più in testa a nessuna scheda.
  await expect(page.locator('.sn-mac-card .sn-mac-sha', { hasText: 'a1b2c3d4' })).toHaveCount(0);
  await expect(page.locator('.sn-mac-recent-row').first().locator('.sn-mac-recent-what')).toHaveText('riallineata, chiede di nuovo');
});

test('merged riallineata, dal server alla frase: main era andato avanti e lo sha è quello della fusione', async ({ openTab }) => {
  const dalMain = await rispostaDelMain(SERVER.merged);
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [richiesta()],
    approveReply: dalMain,
    recentDopo: [richiesta({ used: true, outcome: 'merged', mergeSha: SHA_M, decidedAtMs: Date.now(), realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M } })],
  });
  await approva(page);
  const status = page.locator('.sn-mac-card .sn-mac-status').first();
  await expect(status).toHaveText('Fatto: main era andato avanti, il server ha riallineato il ramo, rifatto i controlli e fuso (c3d4e5f6).');
  await expect(page.locator('.sn-mac-recent-row').first().locator('.sn-mac-recent-what')).toHaveText('approvata, riallineata e fusa', { timeout: 8000 });
});

test('conflict col tentativo del server, dal server alla frase: motivo in italiano, e la scheda «non avvenuta» lo ripete', async ({ openTab }) => {
  const dalMain = await rispostaDelMain(SERVER.conflict);
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [richiesta()],
    approveReply: dalMain,
    failedDopo: [richiesta({ used: true, outcome: 'conflict', decidedAtMs: Date.now(), realignReason: SERVER.conflictMosso.realignReason })],
    recentDopo: [richiesta({ used: true, outcome: 'conflict', decidedAtMs: Date.now(), realignReason: SERVER.conflict.realignReason })],
  });
  await approva(page);
  const status = page.locator('.sn-mac-card .sn-mac-status').first();
  await expect(status).toHaveText(
    'Main è andato avanti e le modifiche non si incastrano da sole: serve un giro nuovo dell’automazione. '
    + 'Il server ha provato a riallineare da sé, senza riuscirci: richiesta nuova per la punta riallineata non registrata: la richiesta nuova per la punta riallineata non si è registrata.');
  // Con conflict la scheda non si ricarica da sola (niente da mostrare di
  // nuovo): il prossimo giro dell'elenco mostra la scheda «non avvenuta».
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  const failed = page.locator('.sn-mac-card-failed').first();
  await expect(failed).toBeVisible();
  await expect(failed.locator('.sn-mac-why')).toContainText('il ramo si era mosso dopo l’approvazione, e il commit di riallineamento non parte da quello approvato (il commit di riallineamento non parte dallo sha approvato (genitori: 0123456789ab))');
  await expect(failed.locator('.sn-mac-why')).not.toContainText('realign_branch_moved');
  await expect(page.locator('.sn-mac-recent-row').first().locator('.sn-mac-recent-what')).toHaveText('approvata, ma in conflitto');
});
