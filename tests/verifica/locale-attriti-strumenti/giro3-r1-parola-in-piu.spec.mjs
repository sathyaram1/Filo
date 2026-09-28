// Giro 3 (verifica locale), rilievo 1: col biglietto a mano il canale chiama «secondo biglietto» una
// parola in più, e chi ha perso il promemoria rimbalza fra «passane uno solo» e «aggiungi --ticket».
// Strumenti veri contro un server finto, su depositi git usa-e-getta: Filo non si apre.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const REPORT = 'Report: corretto il pulsante che non salvava col titolo vuoto.';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function deposito() {
  const d = cartellaTemporanea('attriti-giro3-');
  git(d, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(d, 'config', k, v);
  writeFileSync(join(d, 'a.txt'), 'x\n');
  writeFileSync(join(d, '.gitignore'), 'stato/\n');
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'init');
  git(d, 'checkout', '-q', '-b', 'worker/900');
  mkdirSync(join(d, 'stato'));
  return d;
}

async function canale(argv) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(b); } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, expiresAt: 'dopo' }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const casa = deposito();
  try {
    const r = await new Promise((ok) => execFile(process.execPath, [resolve(ROOT, 'scripts', 'routine-channel.mjs'), ...argv], {
      cwd: casa,
      env: {
        ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: casa,
        FILO_NO_BEAT: '1', FILO_DISPATCH_STATE_DIR: join(casa, 'stato'), FILO_ROUTINES_ENABLED: '1',
      },
    }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
    return { ...r, ricevuti };
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
}

// Promemoria perso: il biglietto a mano è l'unico che c'è. La risposta deve nominare la parola in più.
for (const [nome, argv, parola] of [
  ['report senza --notes', ['deliver', 'fixed', REPORT, '--branch', 'worker/900'], 'Report: corretto'],
  ['stato senza --status', ['deliver', 'status', 'revision_capability', '--notes', REPORT], 'revision_capability'],
  ['rilascio col ruolo senza --role', ['release', 'verifier', '--senza-push', '--senza-rapporto'], 'verifier'],
  ['rilascio col motivo senza --guasto', ['release', '--role', 'verifier', 'canale giù da un’ora', '--senza-push', '--senza-rapporto'], 'canale giù'],
]) {
  test(`biglietto a mano e ${nome}: la risposta nomina la parola, non un secondo biglietto`, async () => {
    const r = await canale([...argv, '--ticket', B]);
    expect(r.code).toBe(1);
    expect(r.ricevuti).toHaveLength(0);
    expect(r.out).not.toMatch(/Due biglietti/);
    expect(r.out).toContain(parola);
  });
}

test('lo stesso biglietto davanti con un a capo in fondo e a mano: è uno solo, e il rilascio parte', async () => {
  const r = await canale(['release', `${B}\n`, '--role', 'verifier', '--senza-push', '--senza-rapporto', '--ticket', B]);
  expect(r.out).not.toMatch(/Due biglietti/);
  expect(r.code).toBe(0);
  expect(r.ricevuti.some((x) => x.url.includes('routineRelease'))).toBe(true);
});
