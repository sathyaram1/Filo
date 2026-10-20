// Verifica #1329, rilievo 1: il salto dal browser di un lavoro che tocca anche il server (esiti di #1230)
// deve chiudere la card come gli altri esiti definitivi: esito scritto in cima, card che se ne va, niente secondo salto.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIREBASE = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const CARTELLA = join(ROOT, FIREBASE.hosting.public);
const INTESTAZIONI = Object.fromEntries(FIREBASE.hosting.headers.flatMap((h) => h.headers.map((x) => [x.key, x.value])));
const FUNZIONE = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/ownerMergeApprovals';
const FUNZIONE_SALTA = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/ownerSkipSecaudit';
const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const SDK_APP = `window.firebase = { initializeApp: function () { return {}; } };`;
const SDK_AUTH = `(function () {
  var ascolta = [], corrente = null;
  var a = {
    setPersistence: function () { return Promise.resolve(); },
    onAuthStateChanged: function (cb) { ascolta.push(cb); setTimeout(function () { cb(corrente); }, 0); return function () {}; },
    signInWithPopup: function () {
      corrente = { email: 'owner@example.com', getIdToken: function () { return Promise.resolve('token-owner'); } };
      ascolta.forEach(function (cb) { cb(corrente); });
      return Promise.resolve({ user: corrente });
    },
    signOut: function () { corrente = null; return Promise.resolve(); },
  };
  function GoogleAuthProvider() {}
  GoogleAuthProvider.prototype.setCustomParameters = function () {};
  var auth = function () { return a; };
  auth.GoogleAuthProvider = GoogleAuthProvider;
  auth.Auth = { Persistence: { NONE: 'none', LOCAL: 'local', SESSION: 'session' } };
  window.firebase.auth = auth;
})();`;

async function avviaSito() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__/firebase/10.12.2/firebase-app-compat.js') { res.writeHead(200, { 'Content-Type': TIPI['.js'] }); res.end(SDK_APP); return; }
    if (url.pathname === '/__/firebase/10.12.2/firebase-auth-compat.js') { res.writeHead(200, { 'Content-Type': TIPI['.js'] }); res.end(SDK_AUTH); return; }
    const file = normalize(join(CARTELLA, url.pathname.replace(/\/$/, '/index.html')));
    if (!file.startsWith(CARTELLA) || !existsSync(file)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Type': TIPI[extname(file)] || 'application/octet-stream', ...INTESTAZIONI });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

let sito;
test.beforeAll(async () => { sito = await avviaSito(); });
test.afterAll(async () => { await new Promise((r) => sito.server.close(r)); });

test('r1 salto dal browser di un lavoro anche server: esito in cima, card chiusa, niente secondo salto', async () => {
  // Come il server vero: dopo il salto la pratica torna in revisione, non è più fra le bocciature.
  let bocciature = [{
    feedbackId: 'fid-8', num: '#8', branch: 'worker/fid-8', titolo: 'Un lavoro anche sul server',
    motivo: 'Il diff tocca le regole.', motivoTagliato: false, motivoIlleggibile: false, atMs: Date.now() - 60000,
  }];
  const salti = [];
  const dati = cartellaTemporanea('filo-verifica-1329-');
  const app = await electron.launch({
    args: [...argomentiScala, join(ROOT, 'tests', 'helpers', 'browserNudo.cjs')],
    env: { ...process.env, NODE_ENV: 'test', BROWSER_NUDO_URL: `${sito.origin}/`, BROWSER_NUDO_DATI: dati },
  });
  try {
    const page = await primaFinestra(app);
    const json = (route, body) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route(FUNZIONE, (route) => json(route, { result: { ok: true, ttlMs: 7 * 86400000, pending: [], failed: [], recent: [], preapproved: [], preapprovedTotal: 0 } }));
    await page.route(FUNZIONE_SALTA, (route) => {
      const corpo = JSON.parse(route.request().postData() || '{}').data || {};
      if (corpo.op === 'list') return json(route, { result: { ok: true, bocciature, oltre: false, illeggibili: 0 } });
      salti.push(corpo.feedbackId);
      if (!bocciature.some((b) => b.feedbackId === corpo.feedbackId)) {
        return route.fulfill({ status: 400, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'questo feedback non ha un controllo di sicurezza bocciato da saltare' } }) });
      }
      bocciature = [];
      return json(route, { result: { ok: true, esito: 'attesa_server', sha: 'a'.repeat(40) } });
    });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.ap-accedi').click();
    const card = page.locator('.sn-mac-card-skip[data-feedback-id="fid-8"]');
    await expect(card).toBeVisible();
    const btn = card.locator('.sn-mac-btn-go');
    await btn.click();
    await btn.click();
    await expect(card.locator('.sn-mac-status[role="status"]')).toContainText('Il lavoro tocca anche il server');
    // Come per «bloccato»: l'esito resta scritto in cima e la card se ne va alla rilettura, senza aspettare il minuto.
    await expect(page.locator('.ap-stato')).toContainText('feedback #8: Saltato. Il lavoro tocca anche il server', { timeout: 5000 });
    await expect(card).toHaveCount(0, { timeout: 5000 });
    expect(salti).toEqual(['fid-8']);
  } finally {
    await chiudiApp(app);
    rmSync(dati, { recursive: true, force: true });
  }
});
