// Sentinella: `--ticket <codice>` vale in qualunque posizione, in dispatch e in
// deliver. Il contratto dei worker dice «ripeti aggiungendo --ticket»: dove lo
// si aggiunge non deve decidere se il comando parte (#724.1, #545, #587).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';

import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIGLIETTO = 'bigliettodiprova0123';

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function esegui(script, argv, env) {
  return new Promise((r) => {
    execFile(process.execPath, [resolve(REPO, 'scripts', script), ...argv], { env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
  });
}

/** Deposito git usa-e-getta, pulito, sul ramo del lavoro, con lo stato del giro fuori da git. */
function depositoSulRamo() {
  const casa = cartellaTemporanea('filo-biglietto-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: casa });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: casa });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: casa });
  writeFileSync(resolve(casa, 'segnaposto.txt'), 'x', 'utf8');
  writeFileSync(resolve(casa, '.gitignore'), 'stato/\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: casa });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: casa });
  execFileSync('git', ['checkout', '-q', '-b', 'worker/900'], { cwd: casa });
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-900.json'), JSON.stringify({
    id: 'fid-900', branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail',
  }), 'utf8');
  return casa;
}

const ambiente = (port, casa) => ({
  FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  FILO_REPO_ROOT: casa,
  FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
  FILO_ROUTINES_ENABLED: '1',
  FILO_ROUTINE_TICKET: '',
  FILO_NO_BEAT: '1',
});

const REPORT = 'Report per l’owner: la causa era altrove, il pulsante non veniva mai agganciato alla lista dei modelli.';

test('dispatch: --ticket davanti a un --record-* fa quello che fa messo in coda', async () => {
  const esiti = [];
  for (const argv of [
    ['--ticket', BIGLIETTO, '--record-fixed', 'fid-900', REPORT],
    ['--record-fixed', 'fid-900', REPORT, '--ticket', BIGLIETTO],
  ]) {
    const { srv, ricevuti, port } = await fintoServer();
    const casa = depositoSulRamo();
    try {
      const r = await esegui('dispatch.mjs', argv, ambiente(port, casa));
      assert.doesNotMatch(r.se, /argomento non riconosciuto/, `ordine ${argv[0]}: ${r.se}`);
      const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
      assert.ok(consegna, `ordine ${argv[0]}: la consegna deve arrivare al server (uscita ${r.code}, stderr: ${r.se})`);
      esiti.push({ code: r.code, ticket: consegna.body.ticket });
    } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
  }
  assert.deepEqual(esiti[0], esiti[1], 'i due ordini devono dare lo stesso esito');
  assert.equal(esiti[0].ticket, BIGLIETTO);
});

test('deliver: --ticket al posto del biglietto davanti consegna con quel biglietto', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = depositoSulRamo();
  try {
    const r = await esegui('routine-channel.mjs', [
      'deliver', 'status', '--status', 'revision_capability', '--notes', 'Report.', '--ticket', BIGLIETTO,
    ], ambiente(port, casa));
    assert.equal(r.code, 0, `la consegna doveva partire (stderr: ${r.se})`);
    const consegna = ricevuti.find((x) => x.url.includes('routineDeliver'));
    assert.ok(consegna, 'la consegna deve arrivare al server');
    assert.equal(consegna.body.ticket, BIGLIETTO);
    const d = consegna.body.data || {};
    assert.equal(d.ticket, undefined, 'il biglietto non è un dato della consegna');
    assert.equal(d.biglietto, undefined, 'il biglietto non è un dato della consegna');
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
});

test('deliver senza biglietto: uscita 1 col rimedio, non 3 («canale giù»), e nessuna chiamata', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = depositoSulRamo();
  try {
    const r = await esegui('routine-channel.mjs', [
      'deliver', 'status', '--status', 'revision_capability', '--notes', 'Report.',
    ], ambiente(port, casa));
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.match(r.se, /NESSUN BIGLIETTO/);
    assert.match(r.se, /--ticket/);
    assert.equal(ricevuti.length, 0, 'il server non va chiamato');
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
});

test('deliver: due biglietti diversi si rifiutano, non se ne sceglie uno in silenzio', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = depositoSulRamo();
  try {
    const r = await esegui('routine-channel.mjs', [
      'deliver', 'altrobigliettodiprova99', 'status', '--status', 'revision_capability', '--notes', 'Report.',
      '--ticket', BIGLIETTO,
    ], ambiente(port, casa));
    assert.equal(r.code, 1, `stderr: ${r.se}`);
    assert.equal(ricevuti.length, 0);
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
});
