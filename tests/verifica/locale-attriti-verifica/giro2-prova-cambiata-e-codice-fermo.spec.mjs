// Verifica locale, giro 2 (ramo claude/attriti-verifica): una prova del giro a cui si toglie il solo caso rosso
// ferma la consegna; una critica su un ramo cambiato dall'avvio viene rifiutata. Repo usa-e-getta, niente Electron.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RAMO = 'claude/prova-giro';
const PROVA = 'tests/verifica/77/giro1-rilievi.spec.mjs';
const INTESTA = "import { test, expect } from '@playwright/test';\n";
const VERDE = "test('caso che resta', () => { expect(1).toBe(1); });\n";
const ROSSO = "test('la porta del rilievo', () => { expect(1).toBe(2); });\n";
const REPORT = 'Corretto il rilievo del giro: il pulsante ora salva anche col titolo vuoto, provato a mano e con la prova.';
const CRITICA = 'Provato il pulsante Salva col titolo vuoto e pieno, e la scorciatoia: salva in tutti e due i casi, nessun rilievo.';
const cartelle = [];

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
}

// Un npx finto che fa davvero il lavoro del rilancio: rosso se il file che riceve ha un caso rosso non segnato.
function npxCheLegge(dir) {
  const bin = `${dir}-bin`;
  mkdirSync(bin, { recursive: true });
  cartelle.push(bin);
  writeFileSync(join(bin, 'finto.mjs'), [
    "import { readFileSync } from 'node:fs';",
    "const f = process.argv.slice(2).find((a) => /\\.spec\\.mjs$/.test(a));",
    "const t = f ? readFileSync(f, 'utf8') : '';",
    "const rosso = t.includes('expect(1).toBe(2)') && !t.includes('test.fail');",
    "console.log(rosso ? `rosso: ${f}` : `verde: ${f}`); process.exit(rosso ? 1 : 0);",
  ].join('\n'));
  writeFileSync(join(bin, 'npx.cmd'), `@"${process.execPath}" "%~dp0finto.mjs" %*\r\n`);
  writeFileSync(join(bin, 'npx'), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/finto.mjs" "$@"\n`);
  try { chmodSync(join(bin, 'npx'), 0o755); } catch (_) {}
  return bin;
}

function repo() {
  const dir = cartellaTemporanea('giro2-attriti-');
  cartelle.push(dir);
  git(dir, 'init', '-q', '-b', RAMO);
  writeFileSync(join(dir, '.gitignore'), '.claude/\ntests/verifica/_tolte-*/\n');
  writeFileSync(join(dir, 'codice.js'), 'module.exports = 1;\n');
  return dir;
}

function stato(dir, voce) {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'verify-local.json'), JSON.stringify({ [RAMO]: voce }, null, 2));
}
const leggiStato = (dir) => JSON.parse(readFileSync(join(dir, '.claude', 'verify-local.json'), 'utf8'))[RAMO];

function lancia(dir, args, bin) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, FILO_REPO_ROOT: dir, ...(bin ? { PATH: `${bin}${delimiter}${process.env.PATH}` } : {}) },
  });
  return { status: r.status, testo: `${r.stdout}\n${r.stderr}` };
}

/** Critica registrata su una prova con `prima`; chi corregge la riscrive come `dopo` e committa. */
function consegnaDopo(prima, dopo) {
  const dir = repo();
  mkdirSync(join(dir, dirname(PROVA)), { recursive: true });
  writeFileSync(join(dir, PROVA), prima);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'critica');
  const sha = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, PROVA), dopo);
  writeFileSync(join(dir, 'codice.js'), 'module.exports = 2;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'correzione');
  stato(dir, {
    request: 'correggi il pulsante', verdict: 'fix-pending', rounds: [{ outcome: '' }],
    pending: {
      sha, at: new Date().toISOString(), budgets: null, derived: [], external: [],
      findings: [{ level: 2, sede: 'i', text: 'Il pulsante non salva col titolo vuoto' }],
    },
  });
  const r = lancia(dir, ['corretto', REPORT], npxCheLegge(dir));
  return { ...r, verdict: leggiStato(dir).verdict, dir };
}

test.afterAll(() => {
  for (const d of cartelle) rmSync(d, { recursive: true, force: true });
});

test('togliere il solo caso rosso e tenere il file ferma la consegna', () => {
  const r = consegnaDopo(`${INTESTA}${VERDE}${ROSSO}`, `${INTESTA}${VERDE}`);
  expect(r.status, r.testo).not.toBe(0);
  expect(r.testo).toContain('giro1-rilievi.spec.mjs');
  expect(r.verdict).toBe('fix-pending');
  expect(existsSync(join(r.dir, 'tests', 'verifica')) && execFileSync('git', ['status', '--porcelain'], { cwd: r.dir, encoding: 'utf8' }).trim()).toBe('');
});

test('segnare rosso atteso il caso che era rosso ferma la consegna', () => {
  const r = consegnaDopo(`${INTESTA}${ROSSO}`, `${INTESTA}${ROSSO.replace('=> {', "=> { test.fail(true, 'dopo'); ")}`);
  expect(r.status, r.testo).not.toBe(0);
  expect(r.verdict).toBe('fix-pending');
});

test('una prova toccata ma verde anche com\'era non ferma la consegna', () => {
  const r = consegnaDopo(`${INTESTA}${VERDE}`, `${INTESTA}// ripulita\n${VERDE}`);
  expect(r.status, r.testo).toBe(0);
  expect(r.testo).toContain('Correzione consegnata');
  expect(r.verdict).not.toBe('fix-pending');
});

/** Verifica avviata su un commit; poi il ramo si muove come vuole `muovi`. */
function critica(muovi) {
  const dir = repo();
  mkdirSync(join(dir, 'tests', 'verifica', '77'), { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'lavoro');
  const avvio = git(dir, 'rev-parse', 'HEAD');
  stato(dir, { request: 'correggi il pulsante', requestedSha: avvio, requestedAt: new Date().toISOString(), counts: {}, derived: [], rounds: [] });
  muovi(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'auto: salvataggio');
  const r = lancia(dir, ['critica', CRITICA]);
  return { ...r, voce: leggiStato(dir) };
}

test('il codice rimesso com\'era e committato dal salvataggio fa rifiutare la critica', () => {
  const r = critica((dir) => writeFileSync(join(dir, 'codice.js'), 'module.exports = 0; // senza la correzione\n'));
  expect(r.status, r.testo).not.toBe(0);
  expect(r.testo).toContain('codice.js');
  expect(r.voce.verdict).toBeUndefined();
  expect(r.voce.rounds).toHaveLength(0);
});

test('un file nuovo fuori dalle prove, committato durante la verifica, fa rifiutare la critica', () => {
  const r = critica((dir) => writeFileSync(join(dir, 'aiuto.js'), 'module.exports = 3;\n'));
  expect(r.status, r.testo).not.toBe(0);
  expect(r.testo).toContain('aiuto.js');
});

test('le sole prove del giro aggiunte non fanno rifiutare la critica per codice cambiato', () => {
  const r = critica((dir) => writeFileSync(join(dir, 'tests', 'verifica', '77', 'giro1-x.spec.mjs'), `${INTESTA}${VERDE}`));
  expect(r.testo).not.toContain('il ramo è cambiato fuori dalle prove');
});
