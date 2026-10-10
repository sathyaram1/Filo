// Verifica locale «unit-senza-tempo», giro 5, rilievo 2: la prova degli unit sul risultato della fusione, che la
// chiusura fa quando main si è mosso, non deve tagliare una corsa che va avanti solo perché dura più del tetto.
// Il tetto qui è abbassato a 15 secondi e la corsa ne dura una ventina, avanzando ogni 400 millisecondi: è il caso della
// macchina carica, dove gli unit durano più dell'ora del tetto vero.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { provaUnitSullaFusione } from '../../../scripts/lib/unit-sulla-fusione.mjs';

const ROOT = resolve(process.cwd());
const TETTO_MS = 15_000;

test.setTimeout(10 * 60_000);

test('r2 una corsa degli unit sulla fusione che va avanti non viene tagliata dal tetto', () => {
  const casa = cartellaTemporanea('filo-g5-fusione-');
  const origin = join(casa, 'origin.git');
  const lavoro = join(casa, 'lavoro');
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(casa, 'init', '-q', '--bare', '--initial-branch=main', origin);
    for (const f of ['scripts/run-unit-tests.mjs', 'scripts/lib/riga-di-comando.mjs', 'scripts/lib/riepilogo-unit.mjs', 'scripts/lib/avanzamento-unit.mjs']) {
      mkdirSync(dirname(join(lavoro, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(lavoro, f));
    }
    mkdirSync(join(lavoro, 'tests', 'unit'), { recursive: true });
    writeFileSync(join(lavoro, '.gitignore'), 'node_modules\n');
    writeFileSync(join(lavoro, 'tests', 'unit', 'lento.test.mjs'), "import { test } from 'node:test';\n"
      + 'for (let i = 0; i < 50; i++) test(`passo ${i}`, async () => { await new Promise((r) => setTimeout(r, 400)); });\n');
    git(casa, 'init', '-q', '--initial-branch=main', lavoro);
    git(lavoro, 'add', '-A');
    git(lavoro, 'commit', '-qm', 'base');
    git(lavoro, 'remote', 'add', 'origin', origin);
    git(lavoro, 'push', '-q', 'origin', 'main');
    git(lavoro, 'checkout', '-q', '-b', 'claude/lento');
    writeFileSync(join(lavoro, 'ramo.txt'), 'ramo\n');
    git(lavoro, 'add', '-A');
    git(lavoro, 'commit', '-qm', 'ramo');
    const punta = git(lavoro, 'rev-parse', 'HEAD').trim();
    git(lavoro, 'checkout', '-q', 'main');
    writeFileSync(join(lavoro, 'main.txt'), 'main avanti\n');
    git(lavoro, 'add', '-A');
    git(lavoro, 'commit', '-qm', 'main avanti');
    git(lavoro, 'push', '-q', 'origin', 'main');
    git(lavoro, 'checkout', '-q', 'claude/lento');

    const p = provaUnitSullaFusione({ root: lavoro, punta, scrivi: () => {}, timeoutMs: TETTO_MS });
    expect(p.errore, JSON.stringify(p)).toBeUndefined();
    expect(p.esito).toBe('verde');
  } finally {
    togliCartella(casa);
  }
});
