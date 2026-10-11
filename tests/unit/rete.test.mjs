// #933: dopo minuti di test la connessione tenuta viva è morta, e il primo conio del token o la richiesta di fusione ci muoiono sopra.
// Il ritento sugli errori di socket li rimette in piedi; quello che resta (rete giù davvero) si legge come rete, non come credenziale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { codiceDiRete, erroreDiSocket, descriviErroreDiRete, fetchRitentato } from '../../scripts/lib/rete.mjs';
import { askServerMerge, messageForOwnerMerge, exitCodeForOwnerMerge } from '../../scripts/lib/owner-merge.mjs';
import { mintIdToken } from '../../scripts/lib/firestore-auth.mjs';

// La forma vera di undici: TypeError «fetch failed», il codice nella causa (a volte una causa più giù).
const guastoFetch = (code, msg = `write ${code}`) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(msg), { code }) });
const SHA = 'a'.repeat(40);

test('i guasti di socket si ritentano, la rete assente e le risposte no', () => {
  for (const c of ['ECONNABORTED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']) assert.equal(erroreDiSocket(guastoFetch(c)), true, c);
  assert.equal(erroreDiSocket(new TypeError('fetch failed', { cause: new Error('x', { cause: Object.assign(new Error('y'), { code: 'ECONNRESET' }) }) })), true, 'causa annidata');
  assert.equal(erroreDiSocket(guastoFetch('ENOTFOUND', 'getaddrinfo ENOTFOUND x')), false);
  assert.equal(erroreDiSocket(new TypeError('fetch failed')), false, 'senza codice non si indovina');
  assert.equal(erroreDiSocket(null), false);
  assert.equal(codiceDiRete(guastoFetch('EPIPE')), 'EPIPE');
  assert.equal(descriviErroreDiRete(guastoFetch('ECONNABORTED')), 'fetch failed: write ECONNABORTED');
  assert.equal(descriviErroreDiRete(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } })), 'fetch failed: UND_ERR_SOCKET');
});

test('fetchRitentato: una connessione morta costa un tentativo, non la chiamata', async () => {
  let n = 0;
  const attese = [];
  const res = await fetchRitentato('u', {}, {
    fetchImpl: async () => { if (n++ === 0) throw guastoFetch('ECONNABORTED'); return { status: 200 }; },
    sleep: async (ms) => { attese.push(ms); },
  });
  assert.equal(res.status, 200);
  assert.equal(n, 2);
  assert.deepEqual(attese, [300]);

  n = 0;
  await assert.rejects(fetchRitentato('u', {}, { fetchImpl: async () => { n++; throw guastoFetch('ECONNRESET'); }, sleep: async () => {} }),
    (e) => e.tentativi === 3 && codiceDiRete(e) === 'ECONNRESET');
  assert.equal(n, 3, 'tre tentativi, poi si arrende');

  n = 0;
  await assert.rejects(fetchRitentato('u', {}, { fetchImpl: async () => { n++; throw guastoFetch('ENOTFOUND'); }, sleep: async () => {} }));
  assert.equal(n, 1, 'la rete assente non si ritenta');

  n = 0;
  const r503 = await fetchRitentato('u', {}, { fetchImpl: async () => { n++; return { status: 503 }; }, sleep: async () => {} });
  assert.equal(r503.status, 503);
  assert.equal(n, 1, 'una risposta del server torna com’è');
});

// Un server che uccide ogni connessione riusata: è la connessione tenuta viva che l'altra parte ha già chiuso.
function serverCheUccideIRiusi() {
  const visti = new WeakSet();
  const conti = { richieste: 0, uccise: 0 };
  const srv = createServer((req, res) => {
    if (visti.has(req.socket)) { conti.uccise++; req.socket.destroy(); return; }
    visti.add(req.socket);
    conti.richieste++;
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/token')) res.end(JSON.stringify({ id_token: 'id-vero' }));
      else res.end(JSON.stringify({ result: { ok: true, result: 'merged', sha: 'c'.repeat(40) }, eco: corpo.length }));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, conti, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('finish dopo l’attesa: la connessione riusata muore, il conio e la fusione passano lo stesso', async () => {
  const { srv, conti, base } = await serverCheUccideIRiusi();
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
  const versoIlServer = (u, o) => fetch(`${base}/token`, o);
  try {
    // L'inizio di finish: un primo conio apre la connessione e la lascia nel gruppo.
    assert.equal(await mintIdToken('refresh-finto', { fetchImpl: versoIlServer }), 'id-vero');
    const r = await askServerMerge({ branch: 'claude/x', sha: SHA, url: `${base}/ownerMerge`, mintImpl: versoIlServer, attese: [0] });
    assert.deepEqual(r, { outcome: 'merged', sha: 'c'.repeat(40) });
    assert.equal(exitCodeForOwnerMerge(r), 0);
    assert.ok(conti.uccise >= 1, `il server doveva aver chiuso almeno una connessione riusata (${JSON.stringify(conti)})`);
  } finally {
    delete process.env.FILO_ADMIN_REFRESH_TOKEN;
    srv.closeAllConnections();
    srv.close();
  }
});

test('la rete che cade si legge come rete; solo un no alla credenziale manda a rigenerarla', async () => {
  process.env.FILO_ADMIN_REFRESH_TOKEN = 'refresh-finto';
  const fusione = async () => ({ status: 200, text: async () => JSON.stringify({ result: { ok: true, result: 'merged', sha: 'c'.repeat(40) } }) });
  try {
    let n = 0;
    const giu = await askServerMerge({ branch: 'claude/x', sha: SHA, url: 'https://esempio/ownerMerge', attese: [0], fetchImpl: fusione,
      mintImpl: async () => { n++; throw guastoFetch('ECONNABORTED'); } });
    assert.equal(n, 3);
    assert.equal(giu.outcome, 'unreachable');
    const msg = messageForOwnerMerge(giu, 'claude/x');
    assert.match(msg, /securetoken\.googleapis\.com/);
    assert.match(msg, /ECONNABORTED/);
    assert.match(msg, /Non è un problema di credenziali/);
    assert.doesNotMatch(msg, /riconosciuto come proprietario|Rigenera|admin-login/);

    const occupato = await askServerMerge({ branch: 'claude/x', sha: SHA, url: 'https://esempio/ownerMerge', fetchImpl: fusione,
      mintImpl: async () => ({ ok: false, status: 503, text: async () => 'Service Unavailable' }) });
    assert.equal(occupato.outcome, 'unreachable');
    assert.match(occupato.reason, /HTTP 503/);

    const rifiutata = await askServerMerge({ branch: 'claude/x', sha: SHA, url: 'https://esempio/ownerMerge', fetchImpl: fusione,
      mintImpl: async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"INVALID_REFRESH_TOKEN"}}' }) });
    assert.equal(rifiutata.outcome, 'denied');
    const no = messageForOwnerMerge(rifiutata, 'claude/x');
    assert.match(no, /INVALID_REFRESH_TOKEN/);
    assert.match(no, /admin-login/);
    assert.equal((no.match(/admin-login/g) || []).length, 1, 'il rimedio si dice una volta');

    let m = 0;
    const fusioneGiu = await askServerMerge({ branch: 'claude/x', sha: SHA, url: 'https://esempio/ownerMerge', attese: [0],
      mintImpl: async () => ({ ok: true, status: 200, json: async () => ({ id_token: 'id' }) }),
      fetchImpl: async () => { m++; throw guastoFetch('EPIPE'); } });
    assert.equal(m, 3);
    assert.equal(fusioneGiu.outcome, 'unreachable');
    assert.match(fusioneGiu.reason, /EPIPE.*3 tentativi/);
  } finally {
    delete process.env.FILO_ADMIN_REFRESH_TOKEN;
  }
});

test('il conio lanciato da solo dice rete o credenziale anche a chi legge solo il messaggio', async () => {
  await assert.rejects(mintIdToken('r', { attese: [0], fetchImpl: async () => { throw guastoFetch('ECONNRESET', 'read ECONNRESET'); } }),
    (e) => e.rete === true && /rete/.test(e.message) && /ECONNRESET/.test(e.message) && !/admin-login/.test(e.message));
  await assert.rejects(mintIdToken('r', { fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'TOKEN_EXPIRED' }) }),
    (e) => e.credenziale === true && e.status === 400 && /admin-login/.test(e.message));
});
