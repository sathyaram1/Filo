// Prove del giro 1 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punti 3 e 4: il rilascio del biglietto spedisce il commit finale del worker,
// e il battito porta lo stato del contenitore.
//
// Non aprono Filo. La spedizione si prova su un repo vero, costruito qui;
// il battito non si manda al server, si guarda cosa porterebbe.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { pushRamoCorrente, statoContenitore, commitRestante } from '../../../scripts/routine-channel.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function scenario(nome) {
  const base = cartellaTemporanea(`giro-routine-${nome}-`);
  const origin = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  const altro = join(base, 'altro');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, lavoro);
  git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(lavoro, 'a.txt'), 'uno\n');
  git(lavoro, 'add', '-A');
  git(lavoro, 'commit', '-q', '-m', 'primo');
  git(lavoro, 'push', '-q', '-u', 'origin', 'claude/prova');
  git(base, 'clone', '-q', '-b', 'claude/prova', origin, altro);
  return { base, origin, lavoro, altro };
}

test.describe('rilascio del biglietto — il ramo va su origin prima di parlare col server', () => {
  test('un commit fatto a mano (senza hook) viene spedito', () => {
    const s = scenario('push');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    git(s.lavoro, 'add', '-A');
    git(s.lavoro, 'commit', '-q', '-m', 'a mano');
    const p = pushRamoCorrente(s.lavoro);
    expect(p.ok).toBe(true);
    expect(p.skipped).toBe(false);
    expect(p.branch).toBe('claude/prova');
    expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(git(s.lavoro, 'rev-parse', 'HEAD'));
  });

  test('dopo un rebase spedisce con --force-with-lease e lo dice', () => {
    const s = scenario('lease');
    git(s.lavoro, 'commit', '-q', '--amend', '-m', 'primo, riscritto');
    const p = pushRamoCorrente(s.lavoro);
    expect(p.ok).toBe(true);
    expect(p.forced).toBe(true);
    expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(git(s.lavoro, 'rev-parse', 'HEAD'));
  });

  test('se qualcun altro ha spinto nel frattempo NON rilascia: torna la causa e origin resta suo', () => {
    const s = scenario('altri');
    writeFileSync(join(s.altro, 'c.txt'), 'tre\n');
    git(s.altro, 'add', '-A');
    git(s.altro, 'commit', '-q', '-m', 'di un altro');
    git(s.altro, 'push', '-q', 'origin', 'claude/prova');
    const diAltri = git(s.altro, 'rev-parse', 'HEAD');
    git(s.lavoro, 'commit', '-q', '--amend', '-m', 'primo, riscritto');
    const p = pushRamoCorrente(s.lavoro);
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/force-with-lease/);
    expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(diAltri);
  });

  test('su un ramo protetto non spedisce niente', () => {
    const s = scenario('main');
    git(s.lavoro, 'checkout', '-q', '-b', 'main');
    writeFileSync(join(s.lavoro, 'b.txt'), 'due\n');
    git(s.lavoro, 'add', '-A');
    git(s.lavoro, 'commit', '-q', '-m', 'su main');
    const p = pushRamoCorrente(s.lavoro);
    expect(p.ok).toBe(true);
    expect(p.skipped).toBe(true);
    expect(() => git(s.origin, 'rev-parse', '--verify', '-q', 'refs/heads/main')).toThrow();
  });

  test('lavoro non committato al momento del rilascio: non resta a terra in silenzio', () => {
    // L'hook committa solo su Edit/Write: un file nato da una shell (rm, mv,
    // un generatore) al rilascio non è in nessun commit. Il rilascio spedisce
    // HEAD e non dice niente di quello che lascia a terra — che muore col
    // contenitore, cioè il guasto che questo punto voleva chiudere.
    // Rilievo del giro 1, corretto nello stesso giro: il rilascio committa
    // quello che è rimasto fuori (commitRestante) e poi spedisce.
    const s = scenario('sporco');
    writeFileSync(join(s.lavoro, 'nato-da-shell.txt'), 'quattro\n');
    const c = commitRestante(s.lavoro);
    expect(c.ok).toBe(true);
    expect(c.committed).toEqual(['nato-da-shell.txt']);
    const p = pushRamoCorrente(s.lavoro);
    expect(p.ok).toBe(true);
    const arrivato = git(s.origin, 'ls-tree', '--name-only', 'claude/prova').split('\n');
    expect(arrivato).toContain('nato-da-shell.txt');
    expect(git(s.lavoro, 'status', '--porcelain')).toBe('');
  });
});

test.describe('battito — lo stato del contenitore', () => {
  test('porta uptime e memoria, come numeri', () => {
    const st = statoContenitore();
    expect(Number.isFinite(st.uptimeS)).toBe(true);
    expect(st.uptimeS).toBeGreaterThan(0);
    expect(Number.isFinite(st.freeMb)).toBe(true);
    expect(st.freeMb).toBeGreaterThan(0);
    expect(Number.isFinite(st.rssMb)).toBe(true);
    expect(st.rssMb).toBeGreaterThan(0);
    expect(Number.isFinite(st.loadAvg)).toBe(true);
  });
});
