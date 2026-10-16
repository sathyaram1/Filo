// Lavori server dalla cloud (#1159, #1233), dalla riga di comando: git-server e la registrazione del ramo di filo-security.
// La logica di git-server e la prova con git vero stanno in gitServer.test.mjs.
import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { URL_SERVER } from '../../scripts/lib/git-server.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIGLIETTO = 'bigliettodiprova0123';
const TOKEN = 'ghs_tokendiprova_abcdefghijklmnopqrstuvwxyz';

function fintoServer(rispondi) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      const [status, risposta] = rispondi(req.url, j);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(risposta));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function esegui(argv, env, stdin = '') {
  return new Promise((r) => {
    const figlio = execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
    figlio.stdin.end(stdin);
  });
}

const ambiente = (port, casa) => ({
  FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  FILO_REPO_ROOT: casa,
  FILO_ROUTINE_TICKET: BIGLIETTO,
  FILO_NO_BEAT: '1',
});

function clone(casa, origin) {
  const dir = join(casa, 'filo-security');
  execFileSync('git', ['init', '-q', dir]);
  if (origin) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
  return dir;
}

test('git-server dalla riga di comando: il token si chiede col biglietto del giro; un no del server esce 4 e git non parte', async () => {
  const { srv, ricevuti, port } = await fintoServer(() => [403, { ok: false, reason: 'biglietto_chiuso', detail: 'la chiave è revocata' }]);
  const casa = cartellaTemporanea('filo-git-server-');
  const fuori = cartellaTemporanea('filo-git-server-clone-');
  try {
    const dir = clone(fuori, URL_SERVER);
    const r = await esegui(['git-server', 'ls-remote', dir], ambiente(port, casa));
    assert.equal(r.code, 4, r.se);
    assert.match(r.se, /RIFIUTATO dal server: niente token per filo-security \(biglietto_chiuso: la chiave è revocata\)/);
    assert.equal(r.so, '');
    assert.equal(ricevuti.length, 1);
    assert.equal(ricevuti[0].url, '/routineGitToken');
    assert.deepEqual(ricevuti[0].body, { ticket: BIGLIETTO, repo: 'server' });
  } finally {
    srv.close();
    togliCartella(casa);
    togliCartella(fuori);
  }
});

test('git-server: uso sbagliato, clone dentro Filo, origin estraneo e main escono 1 senza chiamare il server', async () => {
  const { srv, ricevuti, port } = await fintoServer(() => [200, { ok: true, token: TOKEN, scadeIl: 1 }]);
  const casa = cartellaTemporanea('filo-git-server-');
  const fuori = cartellaTemporanea('filo-git-server-clone-');
  try {
    const estraneo = clone(fuori, 'https://x-access-token:SEGRETO@example.com/filo-security.git');
    for (const [argv, motivo] of [
      [['git-server', 'pull', fuori], /un'azione fra clone, ls-remote, fetch, push/],
      [['git-server', 'clone', join(casa, 'filo-security')], /dentro il checkout di Filo/],
      [['git-server', 'fetch', join(fuori, 'non-clonato')], /non c'è un clone/],
      [['git-server', 'push', estraneo, 'main'], /main di filo-security/],
      [['git-server', 'push', estraneo, 'worker/f1', 'altro'], /di troppo/],
      [['git-server', 'ls-remote', estraneo], /«https:\/\/\*\*\*@example\.com\/filo-security\.git»/],
    ]) {
      const r = await esegui(argv, ambiente(port, casa));
      assert.equal(r.code, 1, `${argv.join(' ')}: ${r.se}`);
      assert.match(r.se, motivo, argv.join(' '));
      assert.ok(!r.se.includes('SEGRETO') && !r.se.includes(TOKEN), argv.join(' '));
    }
    assert.equal(ricevuti.length, 0);
    // L'aiutante di credenziali non c'è più: git verso filo-security passa solo da git-server.
    const vecchio = await esegui(['git-credenziali', 'get'], ambiente(port, casa), 'protocol=https\nhost=github.com\npath=sathyaram1/filo-security.git\n\n');
    assert.equal(vecchio.code, 1);
    assert.equal(vecchio.so, '');
    assert.equal(ricevuti.length, 0);
  } finally {
    srv.close();
    togliCartella(casa);
    togliCartella(fuori);
  }
});

test('ramo-server: manda ramo e sha col biglietto; un rifiuto esce 4', async () => {
  const sha = 'a'.repeat(40);
  let risposta = [200, { ok: true, sha, ramoFidato: true, fiducia: 'fidato' }];
  const { srv, ricevuti, port } = await fintoServer(() => risposta);
  const casa = cartellaTemporanea('filo-credenziali-');
  try {
    const r = await esegui(['ramo-server', 'worker/f1-20261012T090000Z', sha], ambiente(port, casa));
    assert.equal(r.code, 0, r.se);
    assert.match(r.so, /Ramo del server registrato: worker\/f1-20261012T090000Z a aaaaaaaaaaaa/);
    assert.equal(ricevuti[0].url, '/routineRamoServer');
    assert.deepEqual(ricevuti[0].body, { ticket: BIGLIETTO, ramo: 'worker/f1-20261012T090000Z', sha });
    risposta = [409, { ok: false, reason: 'punta_diversa', detail: 'su filo-security la punta è bbbb' }];
    const no = await esegui(['ramo-server', 'worker/f1-20261012T090000Z', sha], ambiente(port, casa));
    assert.equal(no.code, 4);
    assert.match(no.se, /punta_diversa/);
    const vuoto = await esegui(['ramo-server'], ambiente(port, casa));
    assert.equal(vuoto.code, 1);
  } finally {
    srv.close();
    togliCartella(casa);
  }
});
