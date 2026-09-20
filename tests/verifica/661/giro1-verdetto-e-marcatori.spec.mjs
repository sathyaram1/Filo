// Verifica locale del lavoro «#661», primo giro.
//
// Il sintomo: dopo un verdetto «si può pubblicare» con dei rilievi messi da
// parte, chi verifica segna come rosse attese le prove del giro e le committa;
// quel commit sposta la punta del ramo e la chiusura respingeva il lavoro
// («il codice è cambiato dopo la verifica»), costando un giro intero.
//
// Qui si costruisce un repo vero in una cartella temporanea, ci si mette un
// verdetto «superata» su un commit, e si guarda cosa dice il cancello dopo il
// commit successivo. Niente Filo aperto: è uno strumento da riga di comando.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(process.cwd());
const VERIFY_LOCAL = pathToFileURL(join(ROOT, 'scripts', 'verify-local.mjs')).href;

const PROVA = `import { test, expect } from '@playwright/test';

test('il bordo del riquadro è caldo', async () => {
  const colore = 'grigio';
  expect(colore).toBe('caldo');
});
`;
const SPEC = 'tests/verifica/locale-prova/giro1-bordo.spec.mjs';

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

/** Un ramo con un lavoro e una prova del giro, verificato al primo commit. */
function ramoVerificato(muta, { commit = true } = {}) {
  const dir = cartellaTemporanea('verifica-661-');
  mkdirSync(join(dir, 'tests', 'verifica', 'locale-prova'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  git(dir, ['init', '-q', '-b', 'claude/prova']);
  git(dir, ['config', 'user.email', 'prova@filo.test']);
  git(dir, ['config', 'user.name', 'prova']);
  // Lo stato della verifica non è del progetto: nel repo vero è ignorato.
  writeFileSync(join(dir, '.gitignore'), '.claude/\n');
  writeFileSync(join(dir, SPEC), PROVA);
  writeFileSync(join(dir, 'src', 'riquadro.js'), 'const bordo = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'lavoro e prove del giro']);
  const verificato = git(dir, ['rev-parse', 'HEAD']);
  muta(dir);
  if (commit) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'rossi attesi']);
  }
  return { dir, verificato };
}

/** Cosa risponde il cancello a chi sta per pubblicare. */
function verdetto(dir, sha) {
  const script = `
    process.env.FILO_REPO_ROOT = ${JSON.stringify(dir)};
    const m = await import(${JSON.stringify(VERIFY_LOCAL)});
    m.writeState({ 'claude/prova': { request: 'rendi caldo il bordo', verdict: 'pass', sha: ${JSON.stringify(sha)}, critique: 'provato tutto' } }, ${JSON.stringify(dir)});
    const r = m.verdictForCurrentBranch(${JSON.stringify(dir)});
    console.log(JSON.stringify({ ok: r.ok, tollerato: !!r.tollerato, files: r.files || [], reason: r.reason }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

function conMarcatore(testo, marcatore) {
  return testo.replace("test('il bordo del riquadro è caldo', async () => {", `test('il bordo del riquadro è caldo', async () => {\n  ${marcatore}`);
}

test('il verdetto regge sul commit che aggiunge solo i marcatori di rosso atteso', () => {
  const { dir, verificato } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), conMarcatore(PROVA, "test.fail(true, 'bordo grigio: rilievo messo da parte');"));
  });
  const r = verdetto(dir, verificato);
  expect(r.ok, r.reason).toBe(true);
  expect(r.tollerato).toBe(true);
  expect(r.files).toContain(SPEC);
  rmSync(dir, { recursive: true, force: true });
});

test('vale anche la forma con il marcatore sulla dichiarazione della prova', () => {
  const { dir, verificato } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), PROVA.replace("test('il bordo", "test.fail('il bordo"));
  });
  const r = verdetto(dir, verificato);
  expect(r.ok, r.reason).toBe(true);
  expect(r.tollerato).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test('un file fuori dalle prove del giro fa decadere il verdetto', () => {
  const { dir, verificato } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), conMarcatore(PROVA, "test.fail(true, 'rilievo messo da parte');"));
    writeFileSync(join(d, 'src', 'riquadro.js'), 'const bordo = 2;\n');
  });
  const r = verdetto(dir, verificato);
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('src/riquadro.js');
  rmSync(dir, { recursive: true, force: true });
});

test('una riga di codice cambiata dentro una prova del giro fa decadere il verdetto', () => {
  const { dir, verificato } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), conMarcatore(PROVA, "test.fail(true, 'rilievo messo da parte');").replace("expect(colore).toBe('caldo');", "expect(colore).toBe('grigio');"));
  });
  const r = verdetto(dir, verificato);
  expect(r.ok).toBe(false);
  expect(r.reason).toContain(SPEC);
  rmSync(dir, { recursive: true, force: true });
});

test('una riga di codice aggiunta accanto al marcatore fa decadere il verdetto', () => {
  // Il marcatore e una istruzione sulla STESSA riga: quello che gira cambia
  // (la prova esce prima di arrivare al controllo), quindi il verdetto non
  // può reggere. La riga è tutta dentro le prove del giro, ed è l'unica forma
  // in cui del codice nuovo passa il cancello senza essere visto da nessuno.
  const { dir, verificato } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), conMarcatore(PROVA, "test.fail(true, 'rilievo'); return;"));
  });
  const r = verdetto(dir, verificato);
  expect(r.ok, r.reason).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test('togliere la prova dal giro (test.skip) non è un rosso atteso', () => {
  const { dir, verificato } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), conMarcatore(PROVA, "test.skip(true, 'rilievo messo da parte');"));
  });
  const r = verdetto(dir, verificato);
  expect(r.ok).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test('i marcatori non coprono le modifiche non salvate', () => {
  const { dir, verificato } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), conMarcatore(PROVA, "test.fail(true, 'rilievo messo da parte');"));
  });
  // Dopo il commit dei marcatori, una modifica lasciata lì: il verdetto non
  // riguarda l'albero com'è adesso.
  writeFileSync(join(dir, 'src', 'riquadro.js'), 'const bordo = 99;\n');
  const r = verdetto(dir, verificato);
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('non salvate');
  rmSync(dir, { recursive: true, force: true });
});

test('se il commit verificato non si legge più, il verdetto decade invece di passare', () => {
  const { dir } = ramoVerificato((d) => {
    writeFileSync(join(d, SPEC), conMarcatore(PROVA, "test.fail(true, 'rilievo messo da parte');"));
  });
  const r = verdetto(dir, '0'.repeat(40));
  expect(r.ok).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});
