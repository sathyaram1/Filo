// #705: una consegna già registrata, rimandata con la segnalazione, il server la riconosce e ridà la risposta di
// prima senza leggerla. Chi l'ha mandata deve saperlo, con da dove mandarla: mai «consegnata» senza il fermo,
// su tutte e due le strade (dispatch --record-* e il canale deliver).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { segnalazioneNonFermata } from '../../scripts/lib/livelli.mjs';

const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
const CANALE = fileURLToPath(new URL('../../scripts/routine-channel.mjs', import.meta.url));
const CRITICA = 'Provato a salvare con il titolo vuoto e a riaprire la pagina: il file compare nella lista e resta dopo la riapertura.';
const REPORT = 'Corretto il salvataggio col titolo vuoto: ora il file compare nella lista e resta dopo la riapertura.';

test('segnalazioneNonFermata: rimandata su una consegna già registrata, si dice che non è arrivata e da dove mandarla', () => {
  const pass = segnalazioneNonFermata('verdict', { outcome: 'pass', replayed: true }, true, 'ID1');
  assert.match(pass, /SEGNALAZIONE NON CONSEGNATA/);
  assert.match(pass, /critica di questo commit era già registrata/);
  assert.match(pass, /controllo di sicurezza/);
  assert.match(pass, /deliver note/);

  // Con la fase 2 aperta la strada c'è: la consegna della correzione, che ferma.
  const fix = segnalazioneNonFermata('verdict', { outcome: 'fix', replayed: true }, true, 'ID1');
  assert.match(fix, /--record-fixed ID1 "<report>" --segnala <file\.md>/);
  assert.match(fix, /deliver fixed --report "<report>" --segnala <file\.md>/);

  const corretto = segnalazioneNonFermata('fixed', { outcome: 'fixed', replayed: true }, true, 'ID1');
  assert.match(corretto, /correzione era già consegnata/);
  assert.match(corretto, /in coda per un'altra verifica/);

  // Senza il segno della ripetizione non si inventa il perché, ma il fermo mancato si dice lo stesso.
  assert.match(segnalazioneNonFermata('fixed', {}, true), /non ha detto perché/);

  assert.equal(segnalazioneNonFermata('verdict', { outcome: 'stop', motivo: 'segnalazione' }, true), '', 'fermato: niente da dire');
  assert.equal(segnalazioneNonFermata('fixed', { outcome: 'stop' }, true), '');
  assert.equal(segnalazioneNonFermata('verdict', { outcome: 'pass', replayed: true }, false), '', 'senza segnalazione non c\'è niente di perso');
});

/** Server finto che risponde con la coda di risposte data, una per consegna. */
function fintoServer(risposte) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) { /* lo dicono gli assert */ }
      ricevuti.push({ url: String(req.url || ''), body: j });
      res.setHeader('Content-Type', 'application/json');
      const consegne = ricevuti.filter((x) => x.url.includes('routineDeliver')).length;
      res.end(JSON.stringify(req.url.includes('routineDeliver') ? risposte[Math.min(consegne, risposte.length) - 1] : { ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function deposito() {
  const dir = cartellaTemporanea('filo-705-');
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']); g(['commit', '-qm', 'base']); g(['checkout', '-qb', 'worker/705']);
  return dir;
}

async function scena(risposte, prova) {
  const { srv, ricevuti, port } = await fintoServer(risposte);
  const dir = deposito();
  const fuori = cartellaTemporanea('filo-705-fuori-');
  const SEG = resolve(fuori, 'segnala.md');
  writeFileSync(SEG, '## Problema\nDue strade.\n\n## Scelte\n- A\n- B\n\n## Cosa ho fatto nel frattempo\nA.', 'utf8');
  const env = {
    ...process.env,
    FILO_REPO_ROOT: dir, FILO_TOOLS_ROOT: dir, FILO_NO_BEAT: '1',
    FILO_DISPATCH_STATE_DIR: resolve(fuori, 'stato'),
    FILO_ROUTINE_TICKET: 'biglietto-finto',
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
  };
  // Asincrono: il server finto vive in questo processo, una spawn bloccante gli toglierebbe il ciclo degli eventi.
  const lancia = (script, args) => new Promise((r) => execFile(process.execPath, [script, ...args], { env, cwd: dir },
    (err, so, se) => r({ status: err ? (err.code ?? 1) : 0, stdout: String(so || ''), stderr: String(se || '') })));
  try {
    await prova({ lancia, SEG, consegne: () => ricevuti.filter((x) => x.url.includes('routineDeliver')) });
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fuori, { recursive: true, force: true });
  }
}

test('dispatch: la critica «passa» rimandata con la segnalazione non dà più «rilascia» e basta: esce 1 e dice che non è arrivata', async () => {
  await scena([
    { ok: true, reply: { outcome: 'pass', derived: [] } },
    { ok: true, reply: { outcome: 'pass', derived: [], replayed: true } },
  ], async ({ lancia, SEG, consegne }) => {
    const prima = await lancia(DISPATCH, ['--record-verifier', 'ID1', CRITICA]);
    assert.equal(prima.status, 0, prima.stderr);

    const dopo = await lancia(DISPATCH, ['--record-verifier', 'ID1', CRITICA, '--segnala', SEG]);
    assert.equal(consegne()[1].body.data.segnalazione.startsWith('## Problema'), true, 'la segnalazione è partita');
    assert.equal(dopo.status, 1, `una segnalazione persa non è un'uscita pulita: ${dopo.stdout}`);
    assert.match(dopo.stderr, /SEGNALAZIONE NON CONSEGNATA/);
    assert.match(dopo.stderr, /già registrata/);
    assert.match(dopo.stderr, /deliver note/);
  });
});

test('dispatch: una critica con la segnalazione che il server ferma esce 0 e lo dice', async () => {
  await scena([
    { ok: true, reply: { outcome: 'stop', motivo: 'segnalazione', blocking: [], sospesi: [], derived: [] } },
  ], async ({ lancia, SEG }) => {
    const r = await lancia(DISPATCH, ['--record-verifier', 'ID1', CRITICA, '--segnala', SEG]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /segnalazione è consegnata all'owner/);
    assert.doesNotMatch(r.stderr, /NON CONSEGNATA/);
  });
});

test('dispatch: la consegna «corretto» rimandata con la segnalazione non dice più «consegnata lo stesso»', async () => {
  await scena([
    { ok: true, reply: { outcome: 'fixed', replayed: true } },
  ], async ({ lancia, SEG }) => {
    const r = await lancia(DISPATCH, ['--record-fixed', 'ID1', REPORT, '--segnala', SEG]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /SEGNALAZIONE NON CONSEGNATA/);
    assert.match(r.stdout, /correzione era già consegnata/);
    assert.doesNotMatch(r.stdout, /consegnata lo stesso/);
  });
});

test('canale: deliver verdict e fixed rimandati con la segnalazione escono 1 con la stessa frase; il fermo vero esce 0', async () => {
  await scena([
    { ok: true, reply: { outcome: 'pass', replayed: true } },
    { ok: true, reply: { outcome: 'fixed', replayed: true } },
    { ok: true, reply: { outcome: 'stop' } },
  ], async ({ lancia, SEG }) => {
    const verdetto = await lancia(CANALE, ['deliver', 'verdict', '--critique', CRITICA, '--segnala', SEG]);
    assert.equal(verdetto.status, 1, verdetto.stdout);
    assert.match(verdetto.stderr, /SEGNALAZIONE NON CONSEGNATA/);
    assert.match(verdetto.stderr, /critica di questo commit era già registrata/);

    const corretto = await lancia(CANALE, ['deliver', 'fixed', '--report', REPORT, '--segnala', SEG]);
    assert.equal(corretto.status, 1, corretto.stdout);
    assert.match(corretto.stderr, /correzione era già consegnata/);
    assert.doesNotMatch(corretto.stdout, /server vecchio/);

    const fermo = await lancia(CANALE, ['deliver', 'fixed', '--report', REPORT, '--segnala', SEG]);
    assert.equal(fermo.status, 0, fermo.stderr);
    assert.match(fermo.stdout, /FERMO/);
  });
});
