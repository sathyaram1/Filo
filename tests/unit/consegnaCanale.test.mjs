// La messa in revisione dal canale porta la consegna con la prova accanto (#2505): senza, o incompleta, non parte e il
// server non viene chiamato; buona, arriva intera con l'esito della prova dei test nuovi corsa davvero sul ramo.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { consegnaBuona, fileConsegna } from '../helpers/consegnaDiProva.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo dicono gli assert */ }
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

/** Un ramo con un lavoro e la sua prova: il caso nuovo è rosso senza il lavoro e verde con. */
function ramo({ interfaccia = false } = {}) {
  const casa = cartellaTemporanea('filo-consegna-canale-');
  const g = (...a) => execFileSync('git', a, { cwd: casa, encoding: 'utf8' }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(join(casa, f)), { recursive: true }); writeFileSync(join(casa, f), t); };
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  scrivi('.gitignore', 'stato/\n');
  scrivi('src/conto.mjs', 'export const doppio = (n) => n;\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  g('update-ref', 'refs/remotes/origin/main', 'main');
  g('checkout', '-qb', 'worker/2505');
  scrivi('src/conto.mjs', 'export const doppio = (n) => n * 2;\n');
  scrivi('tests/unit/conto.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { doppio } from '../../src/conto.mjs';\ntest('il doppio di tre è sei', () => { assert.equal(doppio(3), 6); });\n");
  if (interfaccia) scrivi('src/pages/home/home.js', 'export const x = 1;\n');
  g('add', '-A'); g('commit', '-qm', 'lavoro');
  return casa;
}

function esegui(script, argv, port, casa) {
  return new Promise((r) => execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], {
    env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_TOOLS_ROOT: casa, FILO_NO_BEAT: '1', FILO_DISPATCH_STATE_DIR: join(casa, 'stato') },
  }, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') })));
}

const revisione = (extra) => ['deliver', 'biglietto-di-prova', 'status', '--status', 'revision_capability', '--notes', 'Fatto il doppio.', '--frase', 'Ora raddoppia.', '--branch', 'worker/2505', ...extra];
const consegne = (ricevuti) => ricevuti.filter((x) => String(x.url).includes('routineDeliver'));

test('senza --consegna, o con una riga senza prova, la messa in revisione non parte e il server non viene chiamato', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = ramo();
  try {
    const senza = await esegui('routine-channel.mjs', revisione([]), port, casa);
    assert.equal(senza.code, 1);
    assert.match(senza.se, /vuole --consegna <file\.json>/);
    const c = consegnaBuona();
    c.criteri[5] = { criterio: 6, esito: 'fatto' };
    const riga = await esegui('routine-channel.mjs', revisione(['--consegna', fileConsegna(c)]), port, casa);
    assert.equal(riga.code, 1);
    assert.match(riga.se, /criterio 6 \(«Completezza»\): manca la prova/);
    assert.equal(consegne(ricevuti).length, 0);
  } finally { srv.close(); togliCartella(casa); }
});

test('un ramo che tocca l\'interfaccia senza gli elementi nuovi non parte', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = ramo({ interfaccia: true });
  try {
    const r = await esegui('routine-channel.mjs', revisione(['--consegna', fileConsegna()]), port, casa);
    assert.equal(r.code, 1);
    assert.match(r.se, /lavoro sull'interfaccia \(tocca src\/pages\/home\/home\.js\): manca l'elenco degli elementi nuovi/);
    assert.equal(consegne(ricevuti).length, 0);
  } finally { srv.close(); togliCartella(casa); }
});

test('una consegna buona arriva intera, con la prova dei test nuovi corsa sul ramo (rosso senza, verde con)', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = ramo();
  try {
    const finta = consegnaBuona({ provaTest: { app: { casi: [{ file: 'x', caso: 'inventato', senza: 'rosso', con: 'verde' }] } } });
    const r = await esegui('routine-channel.mjs', revisione(['--consegna', fileConsegna(finta)]), port, casa);
    assert.equal(r.code, 0, r.se);
    assert.match(r.se, /il doppio di tre è sei: senza rosso, con verde/);
    const d = consegne(ricevuti).at(-1).body.data;
    assert.equal(d.consegna.criteri.length, 9);
    assert.deepEqual(d.consegna.classe, consegnaBuona().classe);
    assert.deepEqual(d.consegna.provaTest.app.casi, [{ file: 'tests/unit/conto.test.mjs', caso: 'il doppio di tre è sei', senza: 'rosso', con: 'verde' }],
      'la prova scritta a mano nel file non vale: la sostituisce quella vera');
    assert.equal(d.consegna.provaTest.app.punta, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: casa, encoding: 'utf8' }).trim());
  } finally { srv.close(); togliCartella(casa); }
});

test('--consegna fuori dalla messa in revisione si rifiuta; dalla ripresa (--record-fixed) arriva al server', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = ramo();
  try {
    const fuori = await esegui('routine-channel.mjs', ['deliver', 'biglietto-di-prova', 'status', '--status', 'working', '--consegna', fileConsegna()], port, casa);
    assert.equal(fuori.code, 1);
    assert.match(fuori.se, /--consegna vale solo con deliver status --status revision_capability/);
    const r = await esegui('dispatch.mjs', ['--record-fixed', 'fid-2505', 'Applicata la strada B dopo la risposta dell\'owner: il doppio ora raddoppia davvero, la prova nuova lo dice.', '--motivo', 'ripresa',
      '--consegna', fileConsegna(), '--ticket', 'biglietto-di-prova'], port, casa);
    const d = consegne(ricevuti).at(-1)?.body.data;
    assert.ok(d, `la ripresa deve arrivare al server (uscita ${r.code}): ${r.se}`);
    assert.equal(d.consegna.criteri.length, 9);
    assert.equal(d.consegna.provaTest.app.casi.length, 1);
  } finally { srv.close(); togliCartella(casa); }
});
