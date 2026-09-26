// Una critica si registra solo sul codice che la verifica ha trovato all'avvio: se il salvataggio automatico
// ha committato i file rimessi a mano per provare «senza la correzione», la registrazione se ne accorge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { fuoriDalleProve, codiceCambiatoDallAvvio, testoCodiceCambiato } from '../../scripts/lib/codice-fermo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAMO = 'claude/prova-fermo';

function repo() {
  const dir = cartellaTemporanea('codice-fermo-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', RAMO);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', '.claude/\n');
  scrivi('src/x.js', 'corretto\n');
  g('add', '-A'); g('commit', '-qm', 'correzione');
  return { dir, g, scrivi, avvio: g('rev-parse', 'HEAD') };
}

test('le prove dei giri si muovono di diritto, il resto no', () => {
  assert.deepEqual(fuoriDalleProve(['tests/verifica/77/giro1-a.spec.mjs', 'src\\x.js', 'tests/boot.spec.mjs', '']),
    ['src/x.js', 'tests/boot.spec.mjs']);
});

test('il codice rimesso com\'era prima della correzione e committato si vede; le prove nuove no', () => {
  const { dir, g, scrivi, avvio } = repo();
  try {
    scrivi('tests/verifica/77/giro1-a.spec.mjs', 'prova\n');
    g('add', '-A'); g('commit', '-qm', 'auto: prova');
    assert.deepEqual(codiceCambiatoDallAvvio(avvio, dir), { cambiati: [], motivo: '' });
    scrivi('src/x.js', 'vecchio\n');
    g('commit', '-qam', 'auto: la prova, e il codice rimesso a mano');
    assert.deepEqual(codiceCambiatoDallAvvio(avvio, dir).cambiati, ['src/x.js']);
    assert.equal(codiceCambiatoDallAvvio('', dir).cambiati.length, 0, 'senza avvio registrato non si ferma niente');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('il rifiuto dice quali file e come rimetterli', () => {
  const t = testoCodiceCambiato(['src/x.js'], 'abcdef1234567890');
  assert.match(t, /critica non registrata/);
  assert.match(t, /src\/x\.js/);
  assert.match(t, /git checkout abcdef123456 -- <file>/);
});

test('in locale la critica su un codice cambiato dall\'avvio non si registra', () => {
  const { dir, g, scrivi, avvio } = repo();
  try {
    mkdirSync(resolve(dir, '.claude'), { recursive: true });
    const stato = { [RAMO]: { request: 'correggi il pulsante', requestedSha: avvio, counts: {}, derived: [], rounds: [] } };
    writeFileSync(resolve(dir, '.claude', 'verify-local.json'), JSON.stringify(stato));
    scrivi('src/x.js', 'vecchio\n');
    g('commit', '-qam', 'auto: il codice rimesso a mano');
    const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), 'critica',
      'Provato il pulsante col titolo vuoto e pieno, con la scorciatoia e dal menu: salva sempre. Nessun rilievo.'], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, FILO_REPO_ROOT: dir },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /src\/x\.js/);
    const dopo = JSON.parse(readFileSync(resolve(dir, '.claude', 'verify-local.json'), 'utf8'))[RAMO];
    assert.equal(dopo.verdict, undefined, 'nessun esito scritto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le due registrazioni, locale e routine, passano da questo controllo', () => {
  const locale = readFileSync(resolve(ROOT, 'scripts', 'verify-local.mjs'), 'utf8');
  const routine = readFileSync(resolve(ROOT, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.match(locale, /codiceCambiatoDallAvvio\(prev\.requestedSha/);
  assert.match(routine, /codiceCambiatoDallAvvio\(avvio/);
});
