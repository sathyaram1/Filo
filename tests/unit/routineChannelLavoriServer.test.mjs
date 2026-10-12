// Lavori server dalla cloud (#1159): l'aiutante di credenziali di git e la registrazione del ramo di filo-security.
// L'aiutante risponde solo a https://github.com/sathyaram1/filo-security, e un no è uno stdout vuoto con uscita 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { leggiRichiestaGit, richiestaPerServer, rigaCredenziali } from '../../scripts/routine-channel.mjs';

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

const richiesta = (campi) => `${Object.entries(campi).map(([k, v]) => `${k}=${v}`).join('\n')}\n\n`;
const DEL_SERVER = { protocol: 'https', host: 'github.com', path: 'sathyaram1/filo-security.git' };

test('la richiesta di git: solo https, github.com e il percorso di filo-security', () => {
  assert.deepEqual(leggiRichiestaGit('protocol=https\r\nhost=github.com\npath=a/b\n\n'), { protocol: 'https', host: 'github.com', path: 'a/b' });
  assert.equal(richiestaPerServer(DEL_SERVER), true);
  assert.equal(richiestaPerServer({ ...DEL_SERVER, path: 'sathyaram1/filo-security' }), true);
  assert.equal(richiestaPerServer({ ...DEL_SERVER, host: 'GitHub.com' }), true);
  for (const altro of [
    { ...DEL_SERVER, protocol: 'http' },
    { ...DEL_SERVER, host: 'gitlab.com' },
    { ...DEL_SERVER, host: 'github.com.evil.example' },
    { ...DEL_SERVER, path: 'sathyaram1/Filo.git' },
    { ...DEL_SERVER, path: 'altri/filo-security.git' },
    { ...DEL_SERVER, path: 'sathyaram1/filo-security-copia.git' },
    { protocol: 'https', host: 'github.com' }, // senza useHttpPath git non dice il repo: a nessuno
    {},
  ]) assert.equal(richiestaPerServer(altro), false, JSON.stringify(altro));
  assert.equal(rigaCredenziali('t', Date.parse('2026-10-12T11:00:00Z')), 'username=x-access-token\npassword=t\npassword_expiry_utc=1792234800\n');
  assert.equal(rigaCredenziali('t', 0), 'username=x-access-token\npassword=t\n');
});

test('git-credenziali get per filo-security: il token del biglietto, nella forma di git', async () => {
  const scade = Date.parse('2026-10-12T11:00:00Z');
  const { srv, ricevuti, port } = await fintoServer(() => [200, { ok: true, token: TOKEN, scadeIl: scade }]);
  const casa = cartellaTemporanea('filo-credenziali-');
  try {
    const r = await esegui(['git-credenziali', 'get'], ambiente(port, casa), richiesta(DEL_SERVER));
    assert.equal(r.code, 0, r.se);
    assert.equal(r.so, `username=x-access-token\npassword=${TOKEN}\npassword_expiry_utc=${Math.floor(scade / 1000)}\n`);
    assert.equal(ricevuti.length, 1);
    assert.equal(ricevuti[0].url, '/routineGitToken');
    assert.deepEqual(ricevuti[0].body, { ticket: BIGLIETTO, repo: 'server' });
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

test('git-credenziali: un altro host o repo non riceve niente, e il server non è chiamato', async () => {
  const { srv, ricevuti, port } = await fintoServer(() => [200, { ok: true, token: TOKEN, scadeIl: 1 }]);
  const casa = cartellaTemporanea('filo-credenziali-');
  try {
    for (const altro of [
      { ...DEL_SERVER, host: 'gitlab.com' },
      { ...DEL_SERVER, path: 'sathyaram1/Filo.git' },
      { protocol: 'https', host: 'github.com' },
    ]) {
      const r = await esegui(['git-credenziali', 'get'], ambiente(port, casa), richiesta(altro));
      assert.equal(r.code, 0, JSON.stringify(altro));
      assert.equal(r.so, '', JSON.stringify(altro));
    }
    assert.equal(ricevuti.length, 0);
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

test('git-credenziali: un rifiuto del server è uno stdout vuoto con uscita 0, il motivo su stderr', async () => {
  const { srv, port } = await fintoServer(() => [403, { ok: false, reason: 'biglietto_sporco', detail: 'il biglietto si è sporcato' }]);
  const casa = cartellaTemporanea('filo-credenziali-');
  try {
    const r = await esegui(['git-credenziali', 'get'], ambiente(port, casa), richiesta(DEL_SERVER));
    assert.equal(r.code, 0);
    assert.equal(r.so, '');
    assert.match(r.se, /biglietto_sporco/);
    assert.ok(!r.se.includes(TOKEN));
    // Senza biglietto non si chiama nessuno.
    const senza = await esegui(['git-credenziali', 'get'], { ...ambiente(port, casa), FILO_ROUTINE_TICKET: '' }, richiesta(DEL_SERVER));
    assert.equal(senza.code, 0);
    assert.equal(senza.so, '');
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

test('git-credenziali store ed erase: muti, nessuna chiamata', async () => {
  const { srv, ricevuti, port } = await fintoServer(() => [200, { ok: true }]);
  const casa = cartellaTemporanea('filo-credenziali-');
  try {
    for (const azione of ['store', 'erase']) {
      const r = await esegui(['git-credenziali', azione], ambiente(port, casa), richiesta({ ...DEL_SERVER, username: 'x-access-token', password: TOKEN }));
      assert.equal(r.code, 0, azione);
      assert.equal(r.so, '', azione);
      assert.equal(r.se, '', azione);
    }
    assert.equal(ricevuti.length, 0);
  } finally {
    srv.close();
    togliCartella(casa);
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
