// #880 giro 1, rilievo 1: dopo un «pass», un commit che toglie solo prove fatto da chi riallinea e sigillato dal suo
// rilascio diventa la base del confronto, e la prova che ha tolto non si rilancia più (la porta di #679).
// Logica pura su un repo git temporaneo: niente Electron.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { puliziaDelPass, baseDelConfronto } from '../../../scripts/lib/prove-tolte.mjs';

test('una prova tolta da chi riallinea prima del rebase, sigillata dal suo rilascio, si rilancia ancora', () => {
  const dir = cartellaTemporanea('verifica-880-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  try {
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    w('src/a.js', '1\n'); g('add', '-A'); g('commit', '-qm', 'main');
    g('checkout', '-q', '-b', 'lavoro');
    w('src/x.js', 'lavoro\n');
    w('tests/verifica/9/giro1-r1-diventato-feedback.spec.mjs', 'rossa per costruzione\n');
    w('tests/verifica/9/giro1-porta-chiusa.spec.mjs', 'rossa dopo il rebase\n');
    g('add', '-A'); g('commit', '-qm', 'critica: verifica superata');
    const critica = g('rev-parse', 'HEAD');
    g('rm', '-q', 'tests/verifica/9/giro1-r1-diventato-feedback.spec.mjs'); g('commit', '-qm', 'pulizia del verificatore');
    const pulizia = g('rev-parse', 'HEAD');
    // Chi riallinea toglie una prova del giro, poi rilascia (anche con un guasto): il rilascio sigilla la punta.
    g('rm', '-q', 'tests/verifica/9/giro1-porta-chiusa.spec.mjs'); g('commit', '-qm', 'riallineamento: via una prova');
    const diChiRiallinea = g('rev-parse', 'HEAD');
    g('checkout', '-q', 'main'); w('src/a.js', '2\n'); g('commit', '-qam', 'main va avanti');
    g('checkout', '-q', 'lavoro'); g('rebase', '-q', 'main');
    const punti = [
      { sha: critica, by: 'verifier:pass' },
      { sha: pulizia, by: 'release' },
      { sha: diChiRiallinea, by: 'release' },
    ];
    const base = baseDelConfronto(critica, puliziaDelPass(critica, punti, dir), dir);
    const tolte = g('diff', '--name-only', '--diff-filter=D', base, 'HEAD', '--', 'tests/verifica/').split('\n').filter(Boolean);
    expect(tolte, 'la prova tolta da chi riallinea resta fra quelle da rilanciare').toContain('tests/verifica/9/giro1-porta-chiusa.spec.mjs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
