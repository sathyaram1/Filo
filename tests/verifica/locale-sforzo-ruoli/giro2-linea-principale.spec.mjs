// Prova del giro 2 (verifica locale) sullo sforzo per ruolo: la porta del giro 1 ri-provata.
// Un worker lascia la cartella su un ramo nato prima della modifica, sporco e a metà rebase;
// dopo il passo dell'orchestratore il prossimo worker deve trovare gli agenti di main.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGENTI = ['routine-nuovo-lavoro', 'routine-worker', 'routine-secaudit'];
const sforzo = (dir, nome) => {
  const p = join(dir, '.claude', 'agents', `${nome}.md`);
  if (!existsSync(p)) return '(manca)';
  return (readFileSync(p, 'utf8').match(/^effort:\s*(\S+)/m) || [])[1] || '(senza)';
};

test('dopo un worker su un ramo vecchio il prossimo parte con gli agenti di main', () => {
  const base = cartellaTemporanea('sforzo-linea-');
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const origine = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  try {
    git(base, 'init', '-q', '--bare', origine);
    git(base, 'init', '-q', '-b', 'main', lavoro);
    mkdirSync(join(lavoro, '.claude', 'agents'), { recursive: true });
    for (const n of AGENTI) copyFileSync(join(ROOT, '.claude', 'agents', `${n}.md`), join(lavoro, '.claude', 'agents', `${n}.md`));
    git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-qm', 'main');
    git(lavoro, 'remote', 'add', 'origin', origine);
    git(lavoro, 'push', '-q', 'origin', 'main');

    // Il ramo vecchio: definizioni di prima, senza l'agente del primo lavoro.
    git(lavoro, 'checkout', '-q', '-b', 'claude/vecchio', 'main');
    rmSync(join(lavoro, '.claude', 'agents', 'routine-nuovo-lavoro.md'));
    for (const n of ['routine-worker', 'routine-secaudit']) {
      const p = join(lavoro, '.claude', 'agents', `${n}.md`);
      writeFileSync(p, readFileSync(p, 'utf8').replace(/^effort:.*$/m, 'effort: medium'));
    }
    git(lavoro, 'add', '-A'); git(lavoro, 'commit', '-qm', 'vecchio');
    // Il worker se ne va lasciando modifiche non salvate.
    writeFileSync(join(lavoro, '.claude', 'agents', 'routine-worker.md'), '---\nname: routine-worker\neffort: low\n---\n');
    expect(sforzo(lavoro, 'routine-nuovo-lavoro')).toBe('(manca)');

    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'dispatch.mjs'), '--linea-principale'], {
      cwd: base, encoding: 'utf8',
      env: { ...process.env, FILO_ROUTINE: '1', FILO_REPO_ROOT: lavoro, FILO_MAIN_BRANCH: 'main' },
    });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(git(lavoro, 'branch', '--show-current').trim()).toBe('main');
    expect(sforzo(lavoro, 'routine-nuovo-lavoro')).toBe('xhigh');
    expect(sforzo(lavoro, 'routine-worker')).toBe('high');
    expect(sforzo(lavoro, 'routine-secaudit')).toBe('high');
  } finally {
    try { rmSync(base, { recursive: true, force: true }); } catch (_) { /* Windows: file aperti */ }
  }
});
