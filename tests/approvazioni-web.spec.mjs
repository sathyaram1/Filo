// La pagina delle approvazioni in un browser qualunque, senza Filo (#489): accesso con l'account del proprietario,
// le fusioni ferme si approvano, si scartano e compaiono da sole. Google e il server sono finti; intestazioni
// di sicurezza e file della pagina sono quelli veri (firebase.json, site/approvazioni).

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { chiudiApp } from './fixtures/electron.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIREBASE = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const CARTELLA = join(ROOT, FIREBASE.hosting.public);
const INTESTAZIONI = Object.fromEntries(FIREBASE.hosting.headers.flatMap((h) => h.headers.map((x) => [x.key, x.value])));
const FUNZIONE = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/ownerMergeApprovals';
const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Il Google finto: quello che la pagina chiede all'SDK di Firebase resta scritto in window.__finto.
const SDK_APP = `window.__finto = { chiamate: [], account: 'owner@example.com', popup: 'ok', attesa: 0 };
window.firebase = { initializeApp: function (cfg) { window.__finto.config = cfg; return {}; } };`;
const SDK_AUTH = `(function () {
  var f = window.__finto, ascolta = [], corrente = null;
  function avvisa() { ascolta.forEach(function (cb) { cb(corrente); }); }
  var a = {
    setPersistence: function (p) { f.chiamate.push('persistenza:' + p); return Promise.resolve(); },
    onAuthStateChanged: function (cb) { ascolta.push(cb); setTimeout(function () { cb(corrente); }, 0); return function () {}; },
    signInWithPopup: function (prov) {
      f.chiamate.push('popup:' + JSON.stringify(prov.params));
      return new Promise(function (ok, no) {
        setTimeout(function () {
          if (f.popup !== 'ok') { no({ code: f.popup }); return; }
          var email = f.account;
          corrente = { email: email, getIdToken: function () { return Promise.resolve('token-' + email); } };
          avvisa(); ok({ user: corrente });
        }, f.attesa);
      });
    },
    signOut: function () { corrente = null; f.chiamate.push('esci'); setTimeout(avvisa, 0); return Promise.resolve(); },
  };
  function GoogleAuthProvider() { this.params = null; }
  GoogleAuthProvider.prototype.setCustomParameters = function (p) { this.params = p; };
  var auth = function () { return a; };
  auth.GoogleAuthProvider = GoogleAuthProvider;
  auth.Auth = { Persistence: { NONE: 'none', LOCAL: 'local', SESSION: 'session' } };
  window.firebase.auth = auth;
})();`;

function richiesta(id, branch, extra = {}) {
  const ora = Date.now();
  return {
    id, branch, sha: 'abcdef1234567890abcdef1234567890abcdef12', who: 'sathyarampontillo@gmail.com', origin: 'local', num: '',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca le guardie di sicurezza', items: ['src/main/auth/config.js'] }],
    createdAtMs: ora - 3 * 60 * 1000, expiresAtMs: ora + 6 * 86400000, expired: false, used: false, discarded: false, outcome: '',
    ...extra,
  };
}

async function avviaSito() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__/firebase/10.12.2/firebase-app-compat.js') { res.writeHead(200, { 'Content-Type': TIPI['.js'] }); res.end(SDK_APP); return; }
    if (url.pathname === '/__/firebase/10.12.2/firebase-auth-compat.js') { res.writeHead(200, { 'Content-Type': TIPI['.js'] }); res.end(SDK_AUTH); return; }
    if (url.pathname === '/cornice') {
      res.writeHead(200, { 'Content-Type': TIPI['.html'] });
      res.end(`<!doctype html><title>altro sito</title><iframe src="${url.searchParams.get('src')}" style="width:900px;height:600px"></iframe>`);
      return;
    }
    // `/nuda/` serve la stessa pagina senza le intestazioni: resta la difesa della pagina stessa.
    const nuda = url.pathname.startsWith('/nuda/');
    const rel = (nuda ? url.pathname.slice('/nuda'.length) : url.pathname).replace(/\/$/, '/index.html');
    const file = normalize(join(CARTELLA, rel));
    if (!file.startsWith(CARTELLA) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': TIPI[extname(file)] || 'application/octet-stream', ...(nuda ? {} : INTESTAZIONI) });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// Il server finto delle approvazioni: risponde come ownerMergeApprovals, solo all'account del proprietario.
function serverFinto({ pending = [], failed = [], recent = [] } = {}) {
  const s = { pending, failed, recent, chiamate: [], giu: false, scadute: new Set(), proprietario: 'owner@example.com' };
  s.gestisci = async (route) => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (s.giu) { await route.abort('connectionrefused'); return; }
    const corpo = JSON.parse(req.postData() || '{}').data || {};
    const token = String(req.headers().authorization || '');
    s.chiamate.push({ op: corpo.op, id: corpo.id, token });
    const json = (status, body) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (token !== `Bearer token-${s.proprietario}`) return json(403, { error: { status: 'PERMISSION_DENIED', message: 'Riservato al proprietario.' } });
    if (corpo.op === 'list') {
      return json(200, { result: { ok: true, ttlMs: 7 * 86400000, pending: s.pending, failed: s.failed, recent: s.recent, preapproved: [], preapprovedTotal: 0 } });
    }
    const r = s.pending.find((x) => x.id === corpo.id) || s.failed.find((x) => x.id === corpo.id);
    if (!r) return json(400, { error: { status: 'FAILED_PRECONDITION', message: 'questa richiesta non esiste (o è stata ripulita)' } });
    if (corpo.op === 'approve') {
      if (s.scadute.has(r.id)) return json(400, { error: { status: 'FAILED_PRECONDITION', message: 'questa richiesta è scaduta: rilancia i controlli e rifalla' } });
      s.pending = s.pending.filter((x) => x !== r);
      s.recent = [{ ...r, used: true, outcome: 'merged', decidedAtMs: Date.now() }, ...s.recent];
      return json(200, { result: { ok: true, result: 'merged', sha: 'fedcba9876543210' } });
    }
    if (corpo.op === 'discard') {
      s.pending = s.pending.filter((x) => x !== r);
      s.failed = s.failed.filter((x) => x !== r);
      s.recent = [{ ...r, discarded: true, decidedAtMs: Date.now() }, ...s.recent];
      return json(200, { result: { ok: true, result: 'discarded' } });
    }
    return json(400, { error: { status: 'INVALID_ARGUMENT', message: 'Operazione sconosciuta.' } });
  };
  return s;
}

async function apri(url, finto) {
  const dati = cartellaTemporanea('filo-browser-nudo-');
  const app = await electron.launch({
    args: [...argomentiScala, join(ROOT, 'tests', 'helpers', 'browserNudo.cjs')],
    env: { ...process.env, NODE_ENV: 'test', BROWSER_NUDO_URL: url, BROWSER_NUDO_DATI: dati },
  });
  const page = await app.firstWindow();
  if (finto) await page.route(FUNZIONE, finto.gestisci);
  await page.waitForLoadState('domcontentloaded');
  return { app, page, chiudi: async () => { await chiudiApp(app); rmSync(dati, { recursive: true, force: true }); } };
}

let sito;
test.beforeAll(async () => { sito = await avviaSito(); });
test.afterAll(async () => { await new Promise((r) => sito.server.close(r)); });

test('senza Filo: l\'owner accede col suo account, vede la fusione ferma e la approva', async () => {
  const finto = serverFinto({ pending: [richiesta('r1', 'claude/fix-avvio')] });
  const { page, chiudi } = await apri(`${sito.origin}/`, finto);
  try {
    await expect(page.locator('.ap-accedi')).toBeVisible();
    await expect(page.locator('.ap-account')).toBeHidden();
    await page.screenshot({ path: 'tests/.shots/approvazioni-web-accesso.png' }).catch(() => {});
    expect(finto.chiamate, 'prima dell\'accesso il server non si chiama').toEqual([]);

    await page.locator('.ap-accedi').click();
    await expect(page.locator('.ap-email')).toHaveText('owner@example.com');
    const card = page.locator('.sn-mac-card[data-request-id="r1"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.sn-mac-branch')).toHaveText('claude/fix-avvio');
    await expect(card.locator('.sn-mac-block')).toHaveCount(1);
    await expect(page.locator('.ap-accesso')).toBeHidden();
    await page.screenshot({ path: 'tests/.shots/approvazioni-web-elenco.png' }).catch(() => {});

    // Credenziali solo in memoria, e la scelta dell'account si vede ogni volta.
    const chiamate = await page.evaluate(() => window.__finto.chiamate);
    expect(chiamate[0]).toBe('persistenza:none');
    expect(chiamate[1]).toBe('popup:{"prompt":"select_account"}');

    const approva = card.locator('.sn-mac-btn-go');
    await approva.click();
    await expect(approva).toHaveText('Confermi?');
    expect(finto.chiamate.filter((c) => c.op === 'approve'), 'un clic solo non fonde').toEqual([]);
    await approva.click();

    await expect(page.locator('.ap-stato')).toHaveText('claude/fix-avvio: Fatto: il lavoro è su main (fedcba98).');
    const sì = finto.chiamate.filter((c) => c.op === 'approve');
    expect(sì).toEqual([{ op: 'approve', id: 'r1', token: 'Bearer token-owner@example.com' }]);
    await expect(card).toHaveCount(0);
    await expect(page.locator('.ap-vuoto')).toBeVisible();
    await expect(page.locator('.sn-mac-recent-row').first()).toContainText('approvata e fusa');
    await expect(page.locator('.ap-stato'), 'l\'esito resta scritto dopo che la card se ne va').toContainText('Fatto');
    await page.screenshot({ path: 'tests/.shots/approvazioni-web-fatto.png' }).catch(() => {});
  } finally {
    await chiudi();
  }
});

test('scarta, segna sistemata una fusione mai avvenuta, e dice quando una richiesta è scaduta', async () => {
  const finto = serverFinto({
    pending: [richiesta('r2', 'claude/da-scartare'), richiesta('r3', 'claude/scaduta')],
    failed: [richiesta('f1', 'claude/in-conflitto', { used: true, outcome: 'conflict', decidedAtMs: Date.now() - 3600000 })],
  });
  finto.scadute.add('r3');
  const { page, chiudi } = await apri(`${sito.origin}/`, finto);
  try {
    await page.locator('.ap-accedi').click();
    await expect(page.locator('.sn-mac-card')).toHaveCount(3);
    await page.screenshot({ path: 'tests/.shots/approvazioni-web-tre.png', fullPage: true }).catch(() => {});

    const scaduta = page.locator('.sn-mac-card[data-request-id="r3"]');
    await scaduta.locator('.sn-mac-btn-go').click();
    await scaduta.locator('.sn-mac-btn-go').click();
    await expect(scaduta.locator('.sn-mac-status')).toHaveText('La richiesta è scaduta. Rilancia npm run finish.');
    await expect(scaduta.locator('.sn-mac-btn-go')).toBeEnabled();

    await page.locator('.sn-mac-card[data-request-id="r2"] .sn-mac-btn-quiet').click();
    await expect(page.locator('.sn-mac-card[data-request-id="r2"]')).toHaveCount(0);
    // Ridisegnare dopo lo scarto non cancella l'esito scritto sull'altra card.
    await expect(scaduta.locator('.sn-mac-status')).toHaveText('La richiesta è scaduta. Rilancia npm run finish.');

    await page.locator('.sn-mac-card[data-request-id="f1"] .sn-mac-btn-quiet').click();
    await expect(page.locator('.sn-mac-card[data-request-id="f1"]')).toHaveCount(0);
    expect(finto.chiamate.filter((c) => c.op === 'discard').map((c) => c.id)).toEqual(['r2', 'f1']);
    await expect(page.locator('.sn-mac-recent-row')).toHaveCount(2);
  } finally {
    await chiudi();
  }
});

test('un account che non è del proprietario: lo dice, e si esce per cambiarlo', async () => {
  const finto = serverFinto({ pending: [richiesta('r1', 'claude/fix-avvio')] });
  const { page, chiudi } = await apri(`${sito.origin}/`, finto);
  try {
    await page.evaluate(() => { window.__finto.account = 'altro@example.com'; });
    await page.locator('.ap-accedi').click();
    await expect(page.locator('.ap-stato')).toHaveText('Questo account non è quello del proprietario: esci e accedi con quello giusto.');
    await expect(page.locator('.sn-mac-card')).toHaveCount(0);

    await page.locator('.ap-esci').click();
    await expect(page.locator('.ap-accedi')).toBeVisible();
    await expect(page.locator('.ap-stato')).toBeHidden();
    await page.evaluate(() => { window.__finto.account = 'owner@example.com'; });
    await page.locator('.ap-accedi').click();
    await expect(page.locator('.sn-mac-card[data-request-id="r1"]')).toBeVisible();
    await expect(page.locator('.ap-stato')).toBeHidden();
  } finally {
    await chiudi();
  }
});

test('a pagina aperta una richiesta nuova compare da sola, e un server giù si dice e si riprova', async () => {
  const finto = serverFinto();
  const { page, chiudi } = await apri(`${sito.origin}/`, finto);
  try {
    await page.locator('.ap-accedi').click();
    await expect(page.locator('.ap-vuoto')).toBeVisible();

    finto.pending = [richiesta('r9', 'claude/arrivata-dopo')];
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.sn-mac-card[data-request-id="r9"]')).toBeVisible();
    await expect(page.locator('.ap-vuoto')).toBeHidden();

    finto.giu = true;
    await page.locator('.ap-aggiorna').click();
    await expect(page.locator('.ap-stato')).toHaveText('Il server non risponde: controlla la connessione e riprova.');
    finto.giu = false;
    finto.pending = [];
    await page.locator('.ap-aggiorna').click();
    await expect(page.locator('.ap-stato')).toBeHidden();
    await expect(page.locator('.ap-vuoto')).toBeVisible();
  } finally {
    await chiudi();
  }
});

test('accesso: un doppio clic apre una finestra sola, chiuderla non è un errore, bloccarla si spiega', async () => {
  const { page, chiudi } = await apri(`${sito.origin}/`, serverFinto());
  try {
    await page.evaluate(() => { window.__finto.popup = 'auth/popup-closed-by-user'; window.__finto.attesa = 300; });
    await page.locator('.ap-accedi').dblclick();
    await expect(page.locator('.ap-accedi')).toBeEnabled();
    const popup = await page.evaluate(() => window.__finto.chiamate.filter((c) => c.startsWith('popup:')).length);
    expect(popup).toBe(1);
    await expect(page.locator('.ap-stato')).toBeHidden();

    await page.evaluate(() => { window.__finto.popup = 'auth/popup-blocked'; window.__finto.attesa = 0; });
    await page.locator('.ap-accedi').click();
    await expect(page.locator('.ap-stato')).toContainText('ha bloccato la finestra dell’accesso');
  } finally {
    await chiudi();
  }
});

test('dentro il riquadro di un altro sito la pagina non si disegna', async () => {
  for (const src of ['/', '/nuda/']) {
    const { page, chiudi } = await apri(`${sito.origin}/cornice?src=${encodeURIComponent(src)}`);
    try {
      const riquadro = page.frameLocator('iframe');
      await page.waitForTimeout(800);
      await expect(riquadro.locator('.ap-accedi'), `riquadro su ${src}`).toHaveCount(0);
    } finally {
      await chiudi();
    }
  }
});

test('tema scuro del sistema: la pagina lo segue', async () => {
  const { page, chiudi } = await apri(`${sito.origin}/`, serverFinto({ pending: [richiesta('r1', 'claude/fix-avvio')] }));
  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
    const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fondo).toBe('rgb(30, 29, 27)');
    await page.locator('.ap-accedi').click();
    await expect(page.locator('.sn-mac-card')).toHaveCount(1);
    await page.screenshot({ path: 'tests/.shots/approvazioni-web-scuro.png' }).catch(() => {});
  } finally {
    await chiudi();
  }
});
