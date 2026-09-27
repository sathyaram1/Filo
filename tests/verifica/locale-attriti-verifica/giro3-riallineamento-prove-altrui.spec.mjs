// Verifica locale, giro 3 (ramo claude/attriti-verifica): dopo un riallineamento su main la consegna rilancia
// solo le prove toccate dal ramo, non quelle di altri lavori che main ha cambiato. Repo usa-e-getta, niente Electron.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RAMO = 'claude/prova-giro';
const MIA = 'tests/verifica/77/giro1-rilievi.spec.mjs';
const ALTRUI_CAMBIATA = 'tests/verifica/55/giro1-altro.spec.mjs';
const ALTRUI_TOLTA = 'tests/verifica/56/giro2-altro.spec.mjs';
const INTESTA = "import { test, expect } from '@playwright/test';\n";
const VERDE = "test('caso che resta', () => { expect(1).toBe(1); });\n";
const ROSSO = "test('la porta del rilievo', () => { expect(1).toBe(2); });\n";
const REPORT = 'Corretto il rilievo del giro: il pulsante ora salva anche col titolo vuoto, provato a mano e con la prova.';
const cartelle = [];

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
}

// Un npx finto che fa il lavoro del rilancio: rosso se il file che riceve ha un caso rosso non segnato.
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

function scrivi(dir, f, testo) {
  mkdirSync(join(dir, dirname(f)), { recursive: true });
  writeFileSync(join(dir, f), testo);
}

/**
 * main ha due prove di altri lavori rosse com'erano; il ramo registra la critica sulla sua prova rossa; poi main
 * ne cambia una e cancella l'altra, il ramo si riallinea con `allinea`, e chi corregge fa `correggi`.
 */
function consegnaDopoRiallineamento({ allinea, correggi }) {
  const dir = cartellaTemporanea('giro3-attriti-');
  cartelle.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitignore'), '.claude/\ntests/verifica/_tolte-*/\n');
  writeFileSync(join(dir, 'codice.js'), 'module.exports = 0;\n');
  scrivi(dir, ALTRUI_CAMBIATA, `${INTESTA}${VERDE}${ROSSO}`);
  scrivi(dir, ALTRUI_TOLTA, `${INTESTA}${ROSSO}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', RAMO);
  writeFileSync(join(dir, 'codice.js'), 'module.exports = 1;\n');
  git(dir, 'commit', '-q', '-am', 'lavoro');
  scrivi(dir, MIA, `${INTESTA}${VERDE}${ROSSO}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'verifica giro 1: prove');
  const sha = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', 'main');
  scrivi(dir, ALTRUI_CAMBIATA, `${INTESTA}${VERDE}`);
  rmSync(join(dir, ALTRUI_TOLTA));
  scrivi(dir, 'altro.js', 'module.exports = 5;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fusione di un altro lavoro');
  git(dir, 'checkout', '-q', RAMO);
  allinea(dir);
  writeFileSync(join(dir, 'codice.js'), 'module.exports = 2;\n');
  correggi(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'correzione');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'verify-local.json'), JSON.stringify({
    [RAMO]: {
      request: 'correggi il pulsante', verdict: 'fix-pending', rounds: [{ outcome: '' }],
      pending: {
        sha, at: new Date().toISOString(), budgets: null, derived: [], external: [],
        findings: [{ level: 2, sede: 'i', text: 'Il pulsante non salva col titolo vuoto' }],
      },
    },
  }, null, 2));
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-local.mjs'), 'corretto', REPORT], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, FILO_REPO_ROOT: dir, PATH: `${npxCheLegge(dir)}${delimiter}${process.env.PATH}` },
  });
  const verdict = JSON.parse(readFileSync(join(dir, '.claude', 'verify-local.json'), 'utf8'))[RAMO].verdict;
  return { status: r.status, testo: `${r.stdout}\n${r.stderr}`, verdict };
}

const rebase = (dir) => git(dir, 'rebase', '-q', 'main');
const merge = (dir) => git(dir, 'merge', '-q', '--no-edit', 'main');
const nulla = () => {};
const togliIlMioRosso = (dir) => scrivi(dir, MIA, `${INTESTA}${VERDE}`);

test.afterAll(() => {
  for (const d of cartelle) rmSync(d, { recursive: true, force: true });
});

test('dopo un rebase su main le prove di altri lavori cambiate o cancellate da main non fermano la consegna', () => {
  const r = consegnaDopoRiallineamento({ allinea: rebase, correggi: nulla });
  expect(r.testo).not.toContain('giro1-altro.spec.mjs');
  expect(r.testo).not.toContain('giro2-altro.spec.mjs');
  expect(r.status, r.testo).toBe(0);
  expect(r.testo).toContain('Correzione consegnata');
  expect(r.verdict).not.toBe('fix-pending');
});

test('dopo un merge di main nel ramo le prove di altri lavori non fermano la consegna', () => {
  const r = consegnaDopoRiallineamento({ allinea: merge, correggi: nulla });
  expect(r.testo).not.toContain('giro1-altro.spec.mjs');
  expect(r.status, r.testo).toBe(0);
  expect(r.verdict).not.toBe('fix-pending');
});

test('dopo un rebase togliere il caso rosso dalla propria prova ferma ancora la consegna, e solo per quella', () => {
  const r = consegnaDopoRiallineamento({ allinea: rebase, correggi: togliIlMioRosso });
  expect(r.status, r.testo).not.toBe(0);
  expect(r.testo).toContain('giro1-rilievi.spec.mjs');
  expect(r.testo).not.toContain('giro1-altro.spec.mjs');
  expect(r.verdict).toBe('fix-pending');
});

test('dopo un merge togliere il caso rosso dalla propria prova ferma ancora la consegna', () => {
  const r = consegnaDopoRiallineamento({ allinea: merge, correggi: togliIlMioRosso });
  expect(r.status, r.testo).not.toBe(0);
  expect(r.testo).toContain('giro1-rilievi.spec.mjs');
  expect(r.verdict).toBe('fix-pending');
});
