// La critica del verificatore vale per un commit: se nella directory ci sono
// file che il salvataggio automatico committerebbe DOPO, la registrazione
// rifiuta prima (#256: le spec temporanee tolte tredici secondi dopo il pass
// spostavano la punta, e il cancello respingeva il lavoro per due giorni).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const { dirtyTreeLines, dirtyTreeText } = await import('../../scripts/dispatch.mjs');
const { gitStatusPorcelain } = await import('../../scripts/lib/dirty-tree.mjs');

test('dirtyTreeText: il rimedio dice che dopo un rm dalla shell il salvataggio non arriva da solo, e che committare la pulizia va bene', () => {
  const t = dirtyTreeText(['tests/verify-1.spec.mjs']);
  assert.match(t, /Edit o Write/, 'dice quando parte il salvataggio automatico');
  assert.match(t, /rm dalla shell/, 'e che dopo un rm non parte');
  assert.match(t, /git add -A && git commit/, 'e come committare la pulizia');
  assert.doesNotMatch(t, /aspetta che il salvataggio automatico abbia committato/, 'niente attesa di un commit che non arriva');
});

test('gitStatusPorcelain: un nome con lettere accentate arriva com\'è, non in sequenze ottali', () => {
  const dir = cartellaTemporanea('filo-dirty-');
  try {
    const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    g(['init', '-q', '--initial-branch=main']);
    writeFileSync(resolve(dir, 'con spazio è.spec.mjs'), 'x', 'utf8');
    const righe = dirtyTreeLines(gitStatusPorcelain(dir));
    assert.deepEqual(righe, ['con spazio è.spec.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dirtyTreeLines: le righe di git status --porcelain diventano percorsi', () => {
  const out = ' M scripts/dispatch.mjs\n?? tests/verify-256-giro5.spec.mjs\n D tests/verify-256-giro5d.spec.mjs\n?? "tests/con spazio.spec.mjs"\n';
  assert.deepEqual(dirtyTreeLines(out), [
    'scripts/dispatch.mjs',
    'tests/verify-256-giro5.spec.mjs',
    'tests/verify-256-giro5d.spec.mjs',
    'tests/con spazio.spec.mjs',
  ]);
});

test('dirtyTreeLines: directory pulita = niente', () => {
  assert.deepEqual(dirtyTreeLines(''), []);
  assert.deepEqual(dirtyTreeLines('\n\r\n'), []);
  assert.deepEqual(dirtyTreeLines(undefined), []);
});

test('dirtyTreeText: dice cosa fare e elenca i file, con il conto di quelli oltre i trenta', () => {
  const uno = dirtyTreeText(['tests/verify-1.spec.mjs']);
  assert.match(uno, /critica non registrata/);
  assert.match(uno, /salvataggio automatico/);
  assert.match(uno, /riprova con la stessa critica/);
  assert.match(uno, /\n  tests\/verify-1\.spec\.mjs$/);
  const tanti = dirtyTreeText(Array.from({ length: 33 }, (_, i) => `f${i}`));
  assert.match(tanti, /… e altri 3$/);
  assert.doesNotMatch(tanti, /f32/);
});

// Verifica del 2026-09-08 (giro 2): la consegna di chi ha corretto passava con
// modifiche non salvate — il server segnava «corretto» su una correzione fuori
// da ogni commit, e la verifica dopo ritrovava gli stessi rilievi. In locale
// «corretto» la respingeva già: due strade equivalenti, una sola protetta.
test('dirtyTreeText per la consegna: dice che la correzione starebbe fuori da ogni commit, e come committare', () => {
  const t = dirtyTreeText(['a.txt'], 'consegna');
  assert.match(t, /^consegna non registrata/);
  assert.match(t, /stesso report/, 'si riprova con lo stesso report, non con una critica');
  assert.doesNotMatch(t, /critica/, 'la parola della strada sbagliata non compare');
  assert.match(t, /git add -A && git commit/);
  assert.match(t, /\n  a\.txt$/);
});

test('CLI --record-fixed: con modifiche non salvate respinge PRIMA del server, con l\'elenco; a commit fatto va al server', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
  const sandbox = cartellaTemporanea('filo-fixed-dirty-');
  try {
    const g = (args) => execFileSync('git', args, { cwd: sandbox, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    g(['init', '-q', '--initial-branch=main']);
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
    writeFileSync(resolve(sandbox, 'a.txt'), 'base\n', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'base']); g(['checkout', '-qb', 'claude/lavoro']);
    // Un server che non esiste: se lo strumento lo chiamasse, uscirebbe 3
    // (server giù), non 1. Così si vede DOVE si è fermato.
    const env = {
      ...process.env,
      FILO_REPO_ROOT: sandbox,
      FILO_TOOLS_ROOT: sandbox,
      FILO_DISPATCH_STATE_DIR: resolve(sandbox, 'stato'),
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
      FILO_ROUTINE_API: 'http://127.0.0.1:9',
    };
    const REPORT = 'Corretto il salvataggio col titolo vuoto: ora salva anche senza titolo. Lasciato stare il menu sotto i 300 pixel, fuori dal giro.';
    const lancia = () => spawnSync(process.execPath, [DISPATCH, '--record-fixed', 'ID1', REPORT], { env, encoding: 'utf8', cwd: sandbox });

    writeFileSync(resolve(sandbox, 'a.txt'), 'base\nfix\n', 'utf8');
    const sporco = lancia();
    assert.equal(sporco.status, 1, `con modifiche non salvate deve fermarsi prima del server: ${sporco.stderr}`);
    assert.match(String(sporco.stderr), /consegna non registrata/);
    assert.match(String(sporco.stderr), /\n  a\.txt/, 'elenca il file');

    g(['add', '-A']); g(['commit', '-qm', 'fix']);
    const pulito = lancia();
    assert.equal(pulito.status, 3, `a commit fatto deve arrivare al server (che qui è giù): ${pulito.stderr}`);
    assert.doesNotMatch(String(pulito.stderr), /consegna non registrata: ci sono modifiche/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
