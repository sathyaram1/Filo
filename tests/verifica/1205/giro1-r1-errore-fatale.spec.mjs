// #1205 giro 1 — una sessione in cui dispatch muore per un errore imprevisto (non un guasto dichiarato)
// non riceve nessun testo: niente domanda di fine sessione, proprio nella sessione andata peggio.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 dispatch che muore per un errore imprevisto chiede comunque la domanda di fine sessione', () => {
  const dir = join(cartellaTemporanea(), `filo-1205-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  try {
    cpSync(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'routines'), join(dir, 'routines'), { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    // L'errore imprevisto più semplice da provocare: un pezzo condiviso che manca rompe la stampa del ruolo.
    rmSync(join(dir, 'routines', 'roles', '_dopo-un-guasto.md'));
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'dispatch.mjs')], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, FILO_ROUTINE: '1' }, timeout: 60_000,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toMatch(/errore fatale|GUASTO/);
    expect(out).toContain('domanda --biglietto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
