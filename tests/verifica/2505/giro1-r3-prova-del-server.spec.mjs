// Verifica #2505, giro 1, rilievo 3: in un lavoro server la prova dei test nuovi copre anche le prove del server. Chi
// lavora la lancia col clone del server, poi committa ancora (una riga di novità): la consegna rifà la prova, e la parte
// del server non deve sparire senza dirlo.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { consegnaBuona, fileConsegna } from '../../helpers/consegnaDiProva.mjs';

const REPO = resolve(process.cwd());
test.setTimeout(5 * 60_000);

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo dicono gli expect */ }
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function deposito(prefisso, file) {
  const casa = cartellaTemporanea(prefisso);
  const g = (...a) => execFileSync('git', a, { cwd: casa, encoding: 'utf8' }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(join(casa, f)), { recursive: true }); writeFileSync(join(casa, f), t); };
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  scrivi('.gitignore', 'stato/\n');
  for (const [f, t] of Object.entries(file.base)) scrivi(f, t);
  g('add', '-A'); g('commit', '-qm', 'base');
  g('update-ref', 'refs/remotes/origin/main', 'main');
  g('checkout', '-qb', 'worker/2505');
  for (const [f, t] of Object.entries(file.lavoro)) scrivi(f, t);
  g('add', '-A'); g('commit', '-qm', 'lavoro');
  return { casa, g, scrivi };
}

const esegui = (script, argv, port, casa) => new Promise((r) => execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], {
  env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_TOOLS_ROOT: casa, FILO_NO_BEAT: '1', FILO_DISPATCH_STATE_DIR: join(casa, 'stato') },
}, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') })));

const revisione = (file) => ['deliver', 'biglietto-di-prova', 'status', '--status', 'revision_capability', '--notes', 'Fatto il doppio.',
  '--frase', 'Ora raddoppia.', '--branch', 'worker/2505', '--consegna', file];

test('r3 dopo un commit in più la consegna di un lavoro server porta ancora la prova dei test nuovi del server', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const app = deposito('filo-v2505-app-', {
    base: { 'src/conto.mjs': 'export const doppio = (n) => n;\n' },
    lavoro: {
      'src/conto.mjs': 'export const doppio = (n) => n * 2;\n',
      'tests/unit/conto.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { doppio } from '../../src/conto.mjs';\ntest('il doppio di tre è sei', () => { assert.equal(doppio(3), 6); });\n",
    },
  });
  const server = deposito('filo-v2505-srv-', {
    base: { 'functions/package.json': '{ "name": "f", "private": true }\n', 'functions/src/somma.js': 'module.exports = (a, b) => a;\n' },
    lavoro: {
      'functions/src/somma.js': 'module.exports = (a, b) => a + b;\n',
      'functions/test/somma.test.js': "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst somma = require('../src/somma');\ntest('due più tre fa cinque', () => { assert.equal(somma(2, 3), 5); });\n",
    },
  });
  const consegne = () => ricevuti.filter((x) => String(x.url).includes('routineDeliver'));
  try {
    const prova = await esegui('prova-test-nuovi.mjs', ['--server', server.casa], port, app.casa);
    expect(prova.code, prova.se).toBe(0);
    expect(prova.so).toMatch(/due più tre fa cinque: senza rosso, con verde/);

    const prima = await esegui('routine-channel.mjs', revisione(fileConsegna(consegnaBuona())), port, app.casa);
    expect(prima.code, prima.se).toBe(0);
    expect(consegne().at(-1).body.data.consegna.provaTest.server.casi.length, 'stessa punta: la prova salvata col server').toBe(1);

    app.scrivi('NOVITA.txt', 'una riga di novità\n');
    app.g('add', '-A'); app.g('commit', '-qm', 'novità');
    const dopo = await esegui('routine-channel.mjs', revisione(fileConsegna(consegnaBuona())), port, app.casa);
    expect(dopo.code, dopo.se).toBe(0);
    const pt = consegne().at(-1).body.data.consegna.provaTest;
    expect(pt.server, 'la prova rifatta dalla consegna ha perso la parte del server').toBeTruthy();
    expect(pt.server.casi.length).toBe(1);
  } finally { srv.close(); togliCartella(app.casa); togliCartella(server.casa); }
});
