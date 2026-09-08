// Server finto per la verifica indipendente del #598: identità anonima,
// rinnovo token e funzioni wallet* su un solo server HTTP locale. Il test
// pilota lo stato dall'esterno (oggetto `state`) e legge il registro delle
// richieste (`log`).
import http from 'node:http';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function fakeJwt(uid, ttlSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ user_id: uid, sub: uid, iat: now, exp: now + ttlSec })}.sig`;
}
function normalizeCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

export async function startFakeServer() {
  const state = {
    // identità
    signUps: 0,
    expiresIn: '3600',
    refreshes: 0,
    refreshFails: false,
    // wallet
    wallet: null,           // null = nessun portafoglio; altrimenti l'oggetto walletState.result
    redeemMode: 'ok',       // 'ok' | uno status di errore | 'http500' | 'hang'
    invitesOpen: true,
    configured: true,
    redeemDelayMs: 0,
    walletStateHttp: null,  // se impostato: codice HTTP di errore per walletState
    key: 'sk-or-v1-verifica-personale',
    pseudonym: 'abcdef0123456789',
  };
  const log = [];

  function readBody(req) {
    return new Promise((resolve) => {
      let s = '';
      req.on('data', (c) => { s += c; });
      req.on('end', () => resolve(s));
    });
  }
  function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const raw = await readBody(req);
    const entry = { path: url.pathname, method: req.method, auth: req.headers.authorization || '', body: raw, at: Date.now() };
    log.push(entry);

    if (url.pathname === '/accounts:signUp') {
      state.signUps += 1;
      const uid = `uid-anon-${state.signUps}`;
      return json(res, 200, { idToken: fakeJwt(uid), refreshToken: `rt-${state.signUps}`, expiresIn: state.expiresIn, localId: uid });
    }
    if (url.pathname === '/token') {
      state.refreshes += 1;
      if (state.refreshFails) return json(res, 400, { error: { code: 400, message: 'INVALID_REFRESH_TOKEN' } });
      const m = /refresh_token=([^&]+)/.exec(raw);
      const n = m ? m[1].replace('rt-', '') : '1';
      const uid = `uid-anon-${n}`;
      return json(res, 200, { id_token: fakeJwt(uid), refresh_token: `rt-${n}`, expires_in: state.expiresIn, user_id: uid });
    }
    if (url.pathname === '/walletState') {
      if (state.walletStateHttp) return json(res, state.walletStateHttp, { error: { message: 'boom' } });
      if (!state.wallet) return json(res, 200, { result: { hasWallet: false, invitesOpen: state.invitesOpen, configured: state.configured } });
      return json(res, 200, { result: state.wallet });
    }
    if (url.pathname === '/walletRedeem') {
      let data = {};
      try { data = JSON.parse(raw).data || {}; } catch (_) {}
      entry.code = data.code;
      if (state.redeemDelayMs) await new Promise((r) => setTimeout(r, state.redeemDelayMs));
      if (state.redeemMode === 'hang') return; // non risponde mai
      if (state.redeemMode === 'http500') return json(res, 500, { error: { message: 'internal' } });
      const code = normalizeCode(data.code);
      if (code.length !== 8) return json(res, 200, { result: { status: 'invalid_code' } });
      if (state.redeemMode !== 'ok') return json(res, 200, { result: { status: state.redeemMode } });
      const inviteCodes = ['QQQQ-2222', 'RRRR-3333', 'SSSS-4444'];
      state.wallet = {
        hasWallet: true,
        pseudonym: state.pseudonym,
        balance: { credits: 5000, creditsGranted: 5000, limitUsd: 4.1, usageUsd: 0, remainingUsd: 4.1, eurUsd: 1.17, eurPerCredit: 0.0007 },
        stale: false,
        usageReadAt: new Date().toISOString(),
        disabled: false,
        dailyCredits: 100,
        invites: inviteCodes.map((c) => ({ code: c, used: false, usedAt: null })),
      };
      return json(res, 200, { result: { status: 'ok', key: state.key, pseudonym: state.pseudonym, credits: 5000, inviteCodes } });
    }
    json(res, 404, { error: { message: `no route ${url.pathname}` } });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return {
    base, state, log, server,
    env: {
      FILO_FUNCTIONS_BASE: base,
      FILO_IDENTITY_ENDPOINT: `${base}/accounts:signUp`,
      FILO_SECURE_TOKEN_ENDPOINT: `${base}/token`,
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
