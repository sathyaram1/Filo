// Banco di prova del quinto giro di verifica sui crediti (#598).
//
// Un server HTTP locale prende il posto di TRE cose che in produzione stanno
// su Google: l'identità anonima (accounts:signUp), il rinnovo del token
// (securetoken) e le funzioni `wallet*` di filo-security. Le funzioni non
// sono finte: è il servizio VERO di filo-security (src/wallet/service.js),
// fatto girare sopra un archivio in memoria e un OpenRouter delle chiavi
// finto. Così quello che l'app riceve è quello che riceverebbe dal server,
// e quello che il server decide è deciso dal suo codice.
//
// Dentro l'app, OpenRouter (le chiamate ai modelli) e Firestore (il registro
// d'uso) si intercettano sostituendo `fetch` nel processo principale.

import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../../helpers/percorsi.mjs';
import { argomentiScala } from '../../../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = resolve(__dirname, '..', '..', '..', '..');
const require = createRequire(import.meta.url);

export const OWNER_EMAIL = 'owner@verifica.test';
export const OWNER_UID = 'owner-uid-verifica';
export const OWNER_REFRESH = 'rt-owner-verifica';
export const RATE = 1.16871; // un cambio BCE vero (cinque decimali), non 1.1

// filo-security sta accanto al repo di Filo (o dove dice FILO_SECURITY_DIR).
export function cartellaFiloSecurity() {
  if (process.env.FILO_SECURITY_DIR) return process.env.FILO_SECURITY_DIR;
  let dir = APP_ROOT;
  for (let i = 0; i < 6; i++) {
    const cand = join(dir, 'filo-security', 'functions');
    if (existsSync(join(cand, 'src', 'wallet', 'service.js'))) return cand;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function b64url(s) { return Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function jwt(uid, extra = {}) {
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ user_id: uid, sub: uid, ...extra }))}.firma`;
}
function payloadOf(tok) {
  try { return JSON.parse(Buffer.from(String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (_) { return {}; }
}

// ── Archivio in memoria con la stessa API di store.js ──────────────────────
export function archivioInMemoria() {
  const docs = { config: {}, wallets: new Map(), invites: new Map(), usage: [], state: {} };
  let lock = Promise.resolve();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return {
    docs,
    async readConfigRaw() { return clone(docs.config); },
    async patchConfig(f) { Object.assign(docs.config, f); },
    async readWallet(uid) { const w = docs.wallets.get(uid); return w ? { uid, ...clone(w) } : null; },
    async patchWallet(uid, f) { docs.wallets.set(uid, { ...(docs.wallets.get(uid) || {}), ...clone(f) }); },
    async listAllWallets() { return [...docs.wallets].map(([uid, w]) => ({ uid, ...clone(w) })); },
    async readInvite(code) { const i = docs.invites.get(code); return i ? { code, ...clone(i) } : null; },
    async patchInvite(code, f) { docs.invites.set(code, { ...(docs.invites.get(code) || {}), ...clone(f) }); },
    async listInvitesOf(uid) {
      return [...docs.invites].filter(([, i]) => i.ownerUid === uid).map(([code, i]) => ({ code, ...clone(i) }))
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    },
    async listOwnerInvites() { return [...docs.invites].filter(([, i]) => i.fromOwner === true).map(([code, i]) => ({ code, ...clone(i) })); },
    writeInvites(codes, ownerUid, nowIso) {
      for (const code of codes) docs.invites.set(code, { ownerUid, createdAt: nowIso, usedBy: null, usedAt: null, revoked: false });
    },
    async createInvites(codes, ownerUid, nowIso, { fromOwner = false } = {}) {
      for (const code of codes) docs.invites.set(code, { ownerUid, createdAt: nowIso, usedBy: null, usedAt: null, revoked: false, fromOwner });
    },
    async sumUsageRows(pseudonym, sinceIso) {
      let usd = 0; let n = 0; let lastAt = sinceIso || '';
      for (const r of docs.usage) {
        if (r.pseudonym !== pseudonym) continue;
        if (sinceIso && !(String(r.at) > sinceIso)) continue;
        usd += Number(r.costUsd) || 0; n += 1;
        if (String(r.at || '') > lastAt) lastAt = String(r.at);
      }
      return { usd, rows: n, lastAt };
    },
    async usageBreakdown(pseudonym) {
      const byDay = {}; const byAction = {}; let rows = 0;
      for (const r of docs.usage) {
        if (r.pseudonym !== pseudonym) continue;
        rows += 1;
        const usd = Number(r.costUsd) || 0;
        const day = String(r.at || '').slice(0, 10) || '?';
        byDay[day] = (byDay[day] || 0) + usd;
        byAction[String(r.action || '?')] = (byAction[String(r.action || '?')] || 0) + usd;
      }
      return { byDay, byAction, rows };
    },
    async readState(name) { return clone(docs.state[name] || {}); },
    async patchState(name, f) { docs.state[name] = { ...(docs.state[name] || {}), ...clone(f) }; },
    async runTransaction(fn) {
      const prev = lock; let release;
      lock = new Promise((r) => { release = r; });
      await prev;
      try { return await fn({}); } finally { release(); }
    },
  };
}

// ── OpenRouter delle chiavi (API di gestione), finto ───────────────────────
export function chiaviFinte() {
  const keys = new Map(); const calls = []; let n = 0;
  const flags = { down: false, patchDown: false };
  const giu = () => Object.assign(new Error('OpenRouter keys → 503: giù'), { status: 503 });
  return {
    keys, calls, flags,
    async createKey({ name, limitUsd }) {
      calls.push({ op: 'create', name, limitUsd });
      if (flags.down) throw giu();
      const hash = `hash-${++n}`;
      const key = `sk-or-v1-finta-${n}-${Math.random().toString(36).slice(2, 10)}`;
      keys.set(hash, { key, name, limitUsd: Number(limitUsd) || 0, usageUsd: 0, disabled: false });
      return { key, hash, limitUsd: Number(limitUsd) || 0 };
    },
    async readKey(hash) {
      calls.push({ op: 'read', hash });
      if (flags.down) throw giu();
      const k = keys.get(hash);
      if (!k) throw Object.assign(new Error('OpenRouter keys → 404'), { status: 404 });
      return { limitUsd: k.limitUsd, usageUsd: k.usageUsd, remainingUsd: k.limitUsd - k.usageUsd, disabled: k.disabled, name: k.name };
    },
    async setLimit(hash, l) {
      calls.push({ op: 'limit', hash, l });
      if (flags.down || flags.patchDown) throw giu();
      keys.get(hash).limitUsd = Number(l) || 0;
    },
    async setDisabled(hash, d) {
      calls.push({ op: 'disable', hash, d });
      if (flags.down) throw giu();
      if (keys.get(hash)) keys.get(hash).disabled = Boolean(d);
    },
    // La chiave in chiaro → il suo hash (per simulare consumo e spegnimenti).
    hashOf(key) { for (const [h, k] of keys) if (k.key === key) return h; return null; },
  };
}

// ── Il server: identità + rinnovo + funzioni wallet ────────────────────────
export async function avviaServer({ salt = 'sale-di-prova', rate = RATE } = {}) {
  const dirSec = cartellaFiloSecurity();
  if (!dirSec) throw new Error('filo-security non trovato accanto al repo (o FILO_SECURITY_DIR)');
  const service = require(join(dirSec, 'src', 'wallet', 'service.js'));
  const credits = require(join(dirSec, 'src', 'wallet', 'credits.js'));

  const store = archivioInMemoria();
  const keys = chiaviFinte();
  const flags = {
    salt, rate,
    frankDown: false,
    delayMs: 0,          // le funzioni rispondono con ritardo
    walletDown: false,   // le funzioni rispondono 500
    walletHang: false,   // la connessione si chiude senza risposta
    signUpDown: false,   // l'identità non si crea (500)
    anonDisabled: false, // ADMIN_ONLY_OPERATION
  };
  const clock = { now: () => Date.now() };
  const log = { entries: [], info(...a) { log.entries.push(['info', ...a]); }, warn(...a) { log.entries.push(['warn', ...a]); }, error(...a) { log.entries.push(['error', ...a]); } };
  const frankfurter = async () => (flags.frankDown
    ? { ok: false, status: 503, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ amount: 1, base: 'EUR', date: '2026-09-09', rates: { USD: flags.rate } }) });
  const deps = { store, keys, now: () => clock.now(), salt: () => flags.salt, fetchImpl: frankfurter, log };

  // Identità: refreshToken → { uid, revoked }
  const sessions = new Map([[OWNER_REFRESH, { uid: OWNER_UID, revoked: false }]]);
  const counters = { signUps: 0, refreshes: 0, calls: [] };
  let anonN = 0;

  const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => res(b)); });
  const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;
    const body = await readBody(req);
    if (path === '/signUp') {
      counters.signUps += 1;
      if (flags.anonDisabled) return json(res, 400, { error: { code: 400, message: 'ADMIN_ONLY_OPERATION' } });
      if (flags.signUpDown) return json(res, 500, { error: { message: 'boom' } });
      const uid = `anon-${++anonN}`;
      const rt = `rt-${uid}`;
      sessions.set(rt, { uid, revoked: false });
      return json(res, 200, { idToken: jwt(uid), refreshToken: rt, expiresIn: '3600', localId: uid });
    }
    if (path === '/token') {
      counters.refreshes += 1;
      const p = new URLSearchParams(body);
      const s = sessions.get(p.get('refresh_token'));
      if (!s || s.revoked) return json(res, 400, { error: { code: 400, message: 'TOKEN_EXPIRED' } });
      return json(res, 200, { id_token: jwt(s.uid, s.uid === OWNER_UID ? { email: OWNER_EMAIL } : {}), refresh_token: p.get('refresh_token'), expires_in: '3600', user_id: s.uid });
    }
    if (path.startsWith('/wallet')) {
      const name = path.slice(1);
      const auth = String(req.headers.authorization || '');
      const tok = auth.replace(/^Bearer\s+/i, '');
      const uid = payloadOf(tok).user_id;
      let data = {};
      try { data = JSON.parse(body || '{}').data || {}; } catch (_) {}
      counters.calls.push({ name, uid, data });
      if (flags.delayMs) await new Promise((r) => setTimeout(r, flags.delayMs));
      if (flags.walletHang) { req.socket.destroy(); return; }
      if (flags.walletDown) return json(res, 500, { error: { message: 'boom', status: 'INTERNAL' } });
      if (!uid) return json(res, 401, { error: { message: 'Accesso richiesto.', status: 'UNAUTHENTICATED' } });
      const ownerOnly = ['walletGrant', 'walletCreateInvites', 'walletOverview'];
      if (ownerOnly.includes(name) && uid !== OWNER_UID) return json(res, 403, { error: { message: 'Riservato al proprietario.', status: 'PERMISSION_DENIED' } });
      try {
        let result;
        if (name === 'walletState') result = await service.state(uid, deps);
        else if (name === 'walletRedeem') {
          try { result = await service.redeem(uid, String(data.code || ''), deps); } catch (e) {
            if (e && e.code === 'no_salt') result = { status: 'not_configured' }; else throw e;
          }
        } else if (name === 'walletReissue') result = await service.reissue(uid, deps);
        else if (name === 'walletGrant') {
          const target = await service.uidOfPseudonym(String(data.pseudonym || ''), deps);
          result = target ? await service.grant(target, Math.floor(Number(data.credits) || 0), String(data.why || 'owner'), deps) : { ok: false, reason: 'no_wallet' };
        } else if (name === 'walletCreateInvites') result = { codes: await service.createOwnerInvites(data.count, uid, deps) };
        else if (name === 'walletOverview') result = await service.overview(deps);
        else return json(res, 404, { error: { message: 'not found' } });
        return json(res, 200, { result });
      } catch (e) {
        log.error('handler', String(e && e.message || e));
        return json(res, 500, { error: { message: 'internal', status: 'INTERNAL' } });
      }
    }
    json(res, 404, { error: { message: 'not found' } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  return {
    base, server, store, keys, flags, clock, log, sessions, counters, service, credits,
    env: {
      FILO_FUNCTIONS_BASE: base,
      FILO_IDENTITY_ENDPOINT: `${base}/signUp`,
      FILO_SECURE_TOKEN_ENDPOINT: `${base}/token`,
      FILO_ADMIN_EMAILS: OWNER_EMAIL,
    },
    // Codici d'invito dell'owner, come li genererebbe lui.
    async codiciOwner(n = 1) { return service.createOwnerInvites(n, OWNER_UID, deps); },
    // Le decisioni del server, per i test che le chiamano direttamente.
    deps,
    async daily(nowMs = Date.now()) { return service.daily(nowMs, deps); },
    async reconcile(nowMs = Date.now()) { return service.reconcileAll(nowMs, deps); },
    async chiudi() { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

// ── L'app ───────────────────────────────────────────────────────────────────
// Chi non ha un server (Filo offline) passa `env` con indirizzi su una porta
// chiusa: 127.0.0.1:9 rifiuta la connessione, uguale ovunque.
export const ENV_OFFLINE = {
  FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9',
  FILO_IDENTITY_ENDPOINT: 'http://127.0.0.1:9/signUp',
  FILO_SECURE_TOKEN_ENDPOINT: 'http://127.0.0.1:9/token',
  FILO_ADMIN_EMAILS: OWNER_EMAIL,
};

export async function avviaFilo({ userData = cartellaTemporanea('filo-598-'), env = {} } = {}) {
  const app = await electron.launch({
    args: [...argomentiScala, '--host-resolver-rules=MAP blocked.test 127.0.0.1, MAP 192.168.1.1 127.0.0.1:9', '.'],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
      ...env,
    },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  const openTab = async (url) => {
    const target = new URL(url).hostname;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    const deadline = Date.now() + 10_000;
    let page = null;
    while (Date.now() < deadline) {
      page = app.windows().find((w) => { try { return new URL(w.url()).hostname === target; } catch (_) { return false; } });
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!page) throw new Error(`openTab: nessuna window per ${url}`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return page;
  };
  return { app, shell, openTab, userData };
}

// Una pagina web qualunque su 127.0.0.1 (i content script di Filo, e con loro
// i toast, si montano solo su una pagina che risponde).
export async function paginaWeb(html = '<!doctype html><meta charset="utf-8"><title>Pagina di prova</title><p>Ciao</p>') {
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/prova`;
  return { url, async chiudi() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

// La pagina Crediti, con lo stato del portafoglio già letto (il modulo o il
// saldo del server compaiono solo dopo la risposta del server).
export async function apriCrediti(openTab) {
  const page = await openTab('filo://credits/credits.html');
  await page.waitForFunction(() => {
    const w = document.getElementById('wallet');
    return w && !w.hidden;
  }, null, { timeout: 15_000 });
  return page;
}

// OpenRouter (modelli) e Firestore (registro d'uso) finti DENTRO l'app:
// `fetch` del processo principale viene avvolto. `opts` si può cambiare dopo
// con `impostaOpenRouter`.
export async function fintoOpenRouter(app, opts = {}) {
  await app.evaluate(({}, o) => {
    const g = globalThis;
    if (!g.__orOrig) g.__orOrig = g.fetch;
    g.__orCalls = [];
    g.__fsCommits = [];
    g.__orOpts = { status: 200, text: 'Ciao dal modello finto.', costUsd: 0.0021, ...o };
    const headerOf = (h, name) => {
      if (!h) return '';
      if (typeof h.get === 'function') return h.get(name) || '';
      const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
      return k ? h[k] : '';
    };
    g.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (u.startsWith('https://openrouter.ai/')) {
        let body = {};
        try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) {}
        g.__orCalls.push({ url: u, auth: headerOf(init && init.headers, 'authorization'), model: body.model, stream: Boolean(body.stream), at: Date.now() });
        const o = g.__orOpts;
        const H = { 'Content-Type': 'application/json' };
        if (u.endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: H });
        if (o.status !== 200) {
          const msg = o.status === 402 ? 'Key limit exceeded' : (o.status === 429 ? 'Rate limited' : 'boom');
          return new Response(JSON.stringify({ error: { message: msg, code: o.status } }), { status: o.status, headers: H });
        }
        const usage = { prompt_tokens: 12, completion_tokens: 5, cost: o.costUsd };
        if (body.stream) {
          const lines = [
            `data: ${JSON.stringify({ id: 'x', provider: 'FintoHost', choices: [{ index: 0, delta: { content: o.text } }] })}\n\n`,
            `data: ${JSON.stringify({ id: 'x', provider: 'FintoHost', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`,
            'data: [DONE]\n\n',
          ];
          return new Response(lines.join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ id: 'x', provider: 'FintoHost', choices: [{ index: 0, message: { role: 'assistant', content: o.text }, finish_reason: 'stop' }], usage }), { status: 200, headers: H });
      }
      if (u.includes('firestore.googleapis.com') && u.includes(':commit')) {
        let b = null; try { b = JSON.parse(init.body); } catch (_) {}
        g.__fsCommits.push({ auth: headerOf(init && init.headers, 'authorization'), body: b });
        return new Response(JSON.stringify({ writeResults: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return g.__orOrig(url, init);
    };
  }, opts);
}
export async function impostaOpenRouter(app, opts) {
  await app.evaluate(({}, o) => { globalThis.__orOpts = { ...globalThis.__orOpts, ...o }; }, opts);
}
export async function chiamateOpenRouter(app) { return app.evaluate(() => globalThis.__orCalls || []); }
export async function commitFirestore(app) { return app.evaluate(() => globalThis.__fsCommits || []); }

// L'accesso Google dell'owner, simulato dentro il processo principale: la
// sessione viene scritta nel deposito cifrato dell'app e il rinnovo del token
// punta al server finto, che risponde con l'email dell'owner.
export async function simulaOwner(app, server) {
  return app.evaluate(async ({}, o) => {
    // Nel processo principale `require` non è in scope: si ricostruisce dalla
    // cache dei moduli di Node, così i moduli sono GLI STESSI che usa l'app.
    try {
      const Module = process.getBuiltinModule('module');
      const path = process.getBuiltinModule('path');
      const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
      const cfg = req('./auth/config');
      const store = req('./auth/token-store');
      const ga = req('./auth/google-auth');
      cfg.secureTokenEndpoint = o.tokenEndpoint;
      store.save({ refreshToken: o.refresh, email: o.email, name: 'Owner di prova', picture: '' });
      ga.restore();
      const tok = await ga.getIdToken();
      return { ok: Boolean(tok), isAdmin: ga.isAdmin(), email: ga.getProfile()?.email };
    } catch (e) { return { ok: false, error: String(e && e.stack || e) }; }
  }, { tokenEndpoint: `${server.base}/token`, refresh: OWNER_REFRESH, email: OWNER_EMAIL });
}

// Il testo della chat della home: manda un messaggio e aspetta la bolla di Filo.
export async function chiediInChat(dash, testo) {
  const before = await dash.locator('#bubbles .dash-bubble-filo').count().catch(() => 0);
  await dash.fill('#input', testo);
  await dash.press('#input', 'Enter');
  await dash.waitForFunction((n) => {
    const b = document.querySelectorAll('#bubbles .dash-bubble-filo');
    if (b.length < n + 1) return false;
    const last = b[b.length - 1];
    return last && !last.classList.contains('dash-bubble-pending') && (last.textContent || '').trim().length > 0;
  }, before, { timeout: 45_000 });
  return dash.locator('#bubbles .dash-bubble-filo').last();
}
