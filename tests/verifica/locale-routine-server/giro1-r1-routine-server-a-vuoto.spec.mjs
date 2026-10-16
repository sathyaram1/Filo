// Verifica locale «routine server», giro 1, rilievo 1: la routine server si accende solo per un lavoro server che può
// prendere. Un lavoro server col ramo o il contenuto sporco resta locale: accenderla per lui è una sessione buttata.
import { test, expect } from './../../fixtures/electron.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function ramoDellApp() {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: import.meta.dirname, encoding: 'utf8' });
  return String(r.stdout || '').trim();
}

// Il worktree del server con lo stesso ramo, se c'è; altrimenti il checkout del server accanto al repo.
function funzioniDelServer() {
  if (process.env.FILO_SERVER_WORKTREE) return join(process.env.FILO_SERVER_WORKTREE, 'functions');
  const ramo = ramoDellApp().replace(/^claude\//, '');
  const segno = join('src', 'routine', 'pacemaker.js');
  let d = join(import.meta.dirname, '..', '..', '..');
  for (let i = 0; i < 8; i++) {
    for (const c of [join(d, 'filo-security', '.claude', 'worktrees', ramo, 'functions'), join(d, 'filo-security', 'functions')]) {
      if (existsSync(join(c, segno))) return c;
    }
    d = dirname(d);
  }
  return '';
}

for (const porta of ['ramo-app', 'ramo-server', 'scritto-sporco']) {
  test(`r1 lavoro server con ${porta} sporco: la routine server non si accende a vuoto`, async () => {
    const funzioni = funzioniDelServer();
    test.skip(!funzioni, 'checkout del server non trovato accanto al repo');
    const r = spawnSync(process.execPath, [join(import.meta.dirname, 'aiuti-giro1.mjs'), funzioni, porta], { encoding: 'utf8', timeout: 240000 });
    const riga = String(r.stdout || '').trim().split('\n').pop();
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const esito = JSON.parse(riga);
    // Il lavoro non lo può prendere nessuna sessione: nessuna accensione serve. Una la si tollera (il primo sguardo).
    expect(esito.biglietti.every((b) => !b.lavoro), riga).toBe(true);
    expect(esito.accensioniServer, `in sei ore: ${riga}`).toBeLessThanOrEqual(1);
  });
}
