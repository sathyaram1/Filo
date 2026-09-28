// Giro 4, rilievo 1: nelle registrazioni un'opzione scritta prima dell'identificativo. Strumenti veri
// contro un server finto, su depositi git usa-e-getta: Filo non si apre.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const REP = 'Report: corretto il pulsante che non salvava, lasciato stare il resto perché fuori dalla richiesta.';
const FRASE = 'Ora il pulsante salva anche col titolo vuoto.';
const CR = 'Provato tutto: funziona come chiesto, niente da segnalare in nessuna parte del lavoro consegnato.';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function deposito() {
  const d = cartellaTemporanea('attriti-giro4-r1-');
  git(d, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(d, 'config', k, v);
  writeFileSync(join(d, 'a.txt'), 'x\n');
  writeFileSync(join(d, '.gitignore'), 'stato/\nfile/\n');
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'init');
  git(d, 'checkout', '-q', '-b', 'worker/900');
  mkdirSync(join(d, 'stato'));
  writeFileSync(join(d, 'stato', 'fid-900.json'), JSON.stringify({ id: 'fid-900', branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail' }));
  mkdirSync(join(d, 'file'));
  writeFileSync(join(d, 'file', 'seg.md'), '## Problema\nDue strade con costi diversi.\n\n## Scelte\n- **A.** poco\n- **B.** tanto\n\n## Cosa ho fatto nel frattempo\nHo preso A.\n');
  writeFileSync(join(d, 'file', 'nota.md'), 'Controllato il canale e le registrazioni: nessuna porta nuova, nessun dato portato fuori.\n');
  return d;
}

async function lancia(script, argvDi) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(b); } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, outcome: 'fix', expiresAt: 'dopo' }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const casa = deposito();
  try {
    const r = await new Promise((ok) => execFile(process.execPath, [resolve(ROOT, 'scripts', script), ...argvDi(casa)], {
      cwd: casa,
      env: {
        ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: casa,
        FILO_NO_BEAT: '1', FILO_DISPATCH_STATE_DIR: join(casa, 'stato'), FILO_ROUTINES_ENABLED: '1',
      },
    }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
    return { ...r, consegna: ricevuti.find((x) => x.url.includes('routineDeliver'))?.body };
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
}

test('la frase scritta subito dopo il comando della correzione arriva a chi ha segnalato, non dentro il report', async () => {
  const r = await lancia('dispatch.mjs', () => ['--record-fixed', '--frase', FRASE, 'fid-900', REP, '--ticket', B]);
  // Successo: la consegna porta i due testi al loro posto, oppure non parte niente e si dice perché.
  if (r.consegna) {
    expect(r.consegna.data?.userNote).toBe(FRASE);
    expect(r.consegna.data?.report).toBe(REP);
    expect(r.out).not.toMatch(/stato --frase/);
  } else {
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/--frase/);
  }
});

test('frase, segnalazione e nota scritte prima del comando valgono come il biglietto', async () => {
  const frase = await lancia('dispatch.mjs', () => ['--frase', FRASE, '--record-fixed', 'fid-900', REP, '--ticket', B]);
  expect(frase.out).not.toMatch(/argomento non riconosciuto/);
  expect(frase.consegna?.data?.userNote).toBe(FRASE);
  expect(frase.consegna?.data?.report).toBe(REP);

  const seg = await lancia('dispatch.mjs', (casa) => ['--segnala', join(casa, 'file', 'seg.md'), '--record-verifier', 'fid-900', CR, '--ticket', B]);
  expect(seg.out).not.toMatch(/argomento non riconosciuto/);
  expect(seg.consegna?.intent).toBe('verdict');
  expect(String(seg.consegna?.data?.segnalazione || '')).toMatch(/Due strade/);

  const nota = await lancia('dispatch.mjs', (casa) => ['--nota', join(casa, 'file', 'nota.md'), '--record-secaudit', 'fid-900', 'pass', '--ticket', B]);
  expect(nota.out).not.toMatch(/argomento non riconosciuto/);
  expect(nota.consegna?.intent).toBe('secaudit');
  expect(nota.consegna?.data?.verdict).toBe('pass');
});
