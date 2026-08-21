// Chiedere al server il numero della prossima versione (SPEC-RIDISEGNO-MAX.md §10).
//
// PERCHÉ QUESTI TEST
//   Da qui passa la pubblicazione agli utenti. Le cose che possono andare male
//   in modo COSTOSO sono due, e sono opposte:
//
//     · un esito qualsiasi che esce con codice zero: il lavoro proseguirebbe a
//       costruire e pubblicare con un numero di versione che nessuno ha scritto
//       (o peggio, con quello vecchio, sovrascrivendo una release esistente);
//     · un "server non c'è" scambiato per un rifiuto: il freno del server è
//       voluto e passa da solo, un guasto di rete no.
//
//   Il server è finto: tutto offline.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyBump,
  exitCodeForBump,
  messageForBump,
  askServerBump,
} from '../../scripts/release-bump.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', '..', 'scripts', 'release-bump.mjs');

describe('leggere la risposta del server', () => {
  test('fatto: l’esito porta il numero nuovo e quello da cui si è partiti', () => {
    const r = classifyBump(200, { ok: true, version: '0.2.197', previous: '0.2.196', sha: 'abc123' });
    assert.equal(r.outcome, 'done');
    assert.equal(r.version, '0.2.197');
    assert.equal(r.previous, '0.2.196');
  });

  test('un "fatto" senza un numero utilizzabile NON è un fatto', () => {
    // È il caso che costerebbe di più: la costruzione proseguirebbe con un
    // numero che non esiste, e la release finirebbe sopra una già pubblicata.
    for (const version of [undefined, '', 'v0.2.197', '0.2', '0.2.197-rc1']) {
      const r = classifyBump(200, { ok: true, version });
      assert.equal(r.outcome, 'fault', `"${version}" non deve passare per un successo`);
      assert.notEqual(exitCodeForBump(r), 0);
    }
  });

  test('il freno del server è un rifiuto, non un guasto', () => {
    const r = classifyBump(429, { ok: false, reason: 'bump_too_soon' });
    assert.equal(r.outcome, 'throttled');
    assert.equal(exitCodeForBump(r), 2);
    assert.match(messageForBump(r), /freno/);
  });

  test('parola d’ordine non riconosciuta vs manifesto che non si legge', () => {
    assert.equal(classifyBump(401, { ok: false, reason: 'bad_passphrase' }).outcome, 'denied');
    const rifiutata = classifyBump(400, { ok: false, reason: 'package_unreadable' });
    assert.equal(rifiutata.outcome, 'rejected');
    assert.match(rifiutata.reason, /package_unreadable/);
    assert.equal(exitCodeForBump(rifiutata), 2);
  });

  test('funzione non ancora deployata e server giù: si può riprovare, e si dice', () => {
    assert.equal(classifyBump(404, {}).outcome, 'not_deployed');
    assert.equal(classifyBump(503, { ok: false, reason: 'state_unreadable' }).outcome, 'unreachable');
    assert.equal(classifyBump(0, {}).outcome, 'unreachable');
    assert.equal(exitCodeForBump({ outcome: 'not_deployed' }), 3);
    assert.equal(exitCodeForBump({ outcome: 'unreachable' }), 3);
  });

  test('i tre codici d’uscita sono tre, e solo "fatto" è zero', () => {
    assert.equal(exitCodeForBump({ outcome: 'done', version: '1.0.0' }), 0);
    for (const outcome of ['throttled', 'denied', 'rejected', 'no_passphrase']) {
      assert.equal(exitCodeForBump({ outcome }), 2, `${outcome} deve essere un rifiuto`);
    }
    for (const outcome of ['not_deployed', 'unreachable', 'fault', undefined, 'boh']) {
      assert.equal(exitCodeForBump({ outcome }), 3, `${outcome} deve essere un guasto`);
    }
    assert.equal(exitCodeForBump(null), 3);
  });
});

describe('la domanda al server', () => {
  test('senza parola d’ordine non si chiama nessuno', async () => {
    let chiamato = false;
    const r = await askServerBump({
      passphrase: '',
      fetchImpl: async () => { chiamato = true; throw new Error('non si deve arrivare qui'); },
    });
    assert.equal(r.outcome, 'no_passphrase');
    assert.equal(chiamato, false);
  });

  test('nel corpo viaggia SOLO la credenziale: nessun numero, nessun contenuto', async () => {
    let corpo = null;
    await askServerBump({
      passphrase: 'segreto',
      fetchImpl: async (_url, opts) => {
        corpo = JSON.parse(opts.body);
        return { status: 200, text: async () => JSON.stringify({ ok: true, version: '1.0.1' }) };
      },
    });
    // Se un giorno qualcuno ci infilasse la versione da scrivere, il numero
    // smetterebbe di essere una cosa che decide il server.
    assert.deepEqual(Object.keys(corpo), ['passphrase']);
  });

  test('rete che cade: guasto, mai un successo silenzioso', async () => {
    const r = await askServerBump({
      passphrase: 'segreto',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.equal(r.outcome, 'unreachable');
    assert.equal(exitCodeForBump(r), 3);
  });
});

// ─── il CLI vero contro un server finto ──────────────────────────────────────

/** Server finto: risponde a /releaseBump e cattura cosa gli arriva. */
function fintoServer(risposta, status = 200) {
  const richieste = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      richieste.push({ url: req.url, body: body ? JSON.parse(body) : {} });
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = status;
      res.end(JSON.stringify(risposta));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, richieste, port: srv.address().port })));
}

/**
 * Lancia il CLI vero contro il server finto.
 *
 * ⚠️ spawn ASINCRONO, mai spawnSync: il server finto vive in QUESTO processo,
 * e spawnSync bloccherebbe l'event loop.
 */
function cli(port, { passphrase = 'segreto-di-prova' } = {}) {
  const env = { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}` };
  if (passphrase) env.FILO_BUILD_PASSPHRASE = passphrase;
  else delete env.FILO_BUILD_PASSPHRASE;
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [CLI], { env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (status) => risolvi({ status, stdout, stderr }));
  });
}

describe('il CLI', () => {
  test('fatto → uscita 0, e su stdout SOLO il numero (è quello che si cattura)', async () => {
    const { srv, richieste, port } = await fintoServer({ ok: true, version: '0.2.197', previous: '0.2.196', sha: 'abc123' });
    try {
      const r = await cli(port);
      assert.equal(r.status, 0, `uscita 0 attesa (stderr: ${r.stderr})`);
      assert.equal(r.stdout.trim(), '0.2.197');
      assert.equal(richieste.length, 1);
      assert.ok(richieste[0].url.endsWith('/releaseBump'));
      assert.deepEqual(Object.keys(richieste[0].body), ['passphrase']);
    } finally { srv.close(); }
  });

  test('frenato → uscita 2, e stdout VUOTO (niente da costruire)', async () => {
    const { srv, port } = await fintoServer({ ok: false, reason: 'bump_too_soon' }, 429);
    try {
      const r = await cli(port);
      assert.equal(r.status, 2);
      assert.equal(r.stdout.trim(), '');
      assert.match(r.stderr, /RIFIUTATO/);
    } finally { srv.close(); }
  });

  test('parola d’ordine rifiutata → uscita 2', async () => {
    const { srv, port } = await fintoServer({ ok: false, reason: 'bad_passphrase' }, 401);
    try {
      const r = await cli(port);
      assert.equal(r.status, 2);
      assert.equal(r.stdout.trim(), '');
    } finally { srv.close(); }
  });

  test('funzione assente → uscita 3, distinta dal rifiuto', async () => {
    const { srv, port } = await fintoServer({ error: 'Not Found' }, 404);
    try {
      const r = await cli(port);
      assert.equal(r.status, 3);
      assert.match(r.stderr, /rideployate/);
    } finally { srv.close(); }
  });

  test('server che non risponde → uscita 3, e nessun numero stampato', async () => {
    // Porta chiusa: la connessione viene rifiutata.
    const { srv, port } = await fintoServer({});
    await new Promise((r) => srv.close(r));
    const r = await cli(port);
    assert.equal(r.status, 3);
    assert.equal(r.stdout.trim(), '');
  });

  test('senza la credenziale non si chiede niente → uscita 2', async () => {
    const { srv, richieste, port } = await fintoServer({ ok: true, version: '0.2.197' });
    try {
      const r = await cli(port, { passphrase: '' });
      assert.equal(r.status, 2);
      assert.equal(richieste.length, 0, 'senza credenziale non si bussa nemmeno');
    } finally { srv.close(); }
  });
});

describe('il lavoro di pubblicazione non scrive su main', () => {
  test('nel workflow non è rimasto nessun comando che scriva su git', () => {
    const yml = readFileSync(resolve(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8');
    // I commenti raccontano com'era prima: si guardano solo i comandi.
    const comandi = yml.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');
    for (const vietato of [/git\s+push/, /git\s+commit/, /npm\s+version/]) {
      assert.ok(!vietato.test(comandi),
        `il workflow è tornato a scrivere su git (${vietato}): su main scrive solo il server.`);
    }
    // E chiede il numero a chi lo può scrivere.
    assert.match(comandi, /release-bump\.mjs/);
  });
});
