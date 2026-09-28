// Giro locale «ruoli-attriti», giro 1 — il riallineamento dopo un conflitto
// tiene i titoli dei commit che cominciano con #<numero>.
//
// Si segue la ricetta del correttore così come dispatch la consegna: il primo
// comando del passo 1 si esegue alla lettera, poi si risolve il conflitto e si
// chiude il rebase nei due modi non interattivi che usa un agente.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DISPATCH = fileURLToPath(new URL('../../../scripts/dispatch.mjs', import.meta.url));

function ricettaDelCorrettore() {
  const out = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});`
    + 'process.stdout.write(m.readRoleInstructions("fixer", { caso: "riallineamento" }));'],
  { encoding: 'utf8', env: { ...process.env, FILO_NO_BEAT: '1' } });
  expect(out.status, out.stderr).toBe(0);
  return out.stdout;
}

// Il comando del passo 1, preso dal testo: il pezzo fra apici inversi che fa il rebase.
function comandoDelPasso1(testo) {
  const pezzi = [...testo.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const c = pezzi.find((p) => /git rebase origin\/main/.test(p));
  expect(c, 'la ricetta del correttore deve dire con quale comando si fa il rebase').toBeTruthy();
  return c;
}

// `a && b && c` → tre invocazioni di git, con gli apici della shell tolti.
function comeInvocazioni(comando) {
  return comando.split('&&').map((s) => s.trim()).filter(Boolean).map((s) => {
    const parole = (s.match(/'[^']*'|"[^"]*"|\S+/g) || []).map((w) => w.replace(/^(['"])(.*)\1$/, '$2'));
    expect(parole[0], `ogni pezzo del passo 1 è un comando git: «${s}»`).toBe('git');
    return parole.slice(1);
  });
}

function preparaRamoInConflitto() {
  const base = cartellaTemporanea('filo-ruoli-attriti-rebase-');
  const remoto = resolve(base, 'remoto.git');
  const dir = resolve(base, 'w');
  const g = (args, cwd = dir, env = process.env) => execFileSync('git', args,
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', remoto], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--initial-branch=main', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  g(['config', 'core.autocrlf', 'false']);
  writeFileSync(resolve(dir, 'a.txt'), 'base\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', '#700: base']);
  g(['remote', 'add', 'origin', remoto]);
  g(['push', '-q', 'origin', 'main']);
  g(['checkout', '-qb', 'claude/lavoro']);
  // Il primo commit ha solo il titolo: è il caso in cui il messaggio resta
  // vuoto e il rebase si pianta. Il secondo ha un corpo normale: lì il titolo
  // sparirebbe e il corpo prenderebbe il suo posto.
  writeFileSync(resolve(dir, 'a.txt'), 'lavoro\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', '#724 giro 1: il lavoro']);
  writeFileSync(resolve(dir, 'a.txt'), 'lavoro corretto\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', '#724.1: la correzione', '-m', 'corpo del commit, senza cancelletto']);
  g(['checkout', '-q', 'main']);
  writeFileSync(resolve(dir, 'a.txt'), 'main andata avanti\n', 'utf8');
  g(['add', '-A']);
  g(['commit', '-qm', '#730: main va avanti']);
  g(['push', '-q', 'origin', 'main']);
  g(['checkout', '-q', 'claude/lavoro']);
  g(['branch', '-q', '-D', 'main']);
  return { dir, g };
}

const TITOLI_ATTESI = ['#724.1: la correzione', '#724 giro 1: il lavoro'];

for (const [nome, chiudi] of [
  ['GIT_EDITOR=true git rebase --continue', (g) => g(['rebase', '--continue'], undefined, { ...process.env, GIT_EDITOR: 'true' })],
  ['git -c core.editor=true rebase --continue', (g) => g(['-c', 'core.editor=true', 'rebase', '--continue'])],
]) {
  test(`ricetta del correttore + conflitti risolti + ${nome}: i titoli #<numero> restano`, async () => {
    const passo1 = comeInvocazioni(comandoDelPasso1(ricettaDelCorrettore()));
    const { dir, g } = preparaRamoInConflitto();

    for (const args of passo1) {
      try { g(args); } catch (_) { /* il rebase si ferma sul conflitto: è previsto */ }
    }
    // Ogni commit del ramo va in conflitto con main: si risolve e si prosegue
    // finché il rebase non finisce, come fa chi riallinea.
    for (let giro = 0; giro < 4 && existsSync(resolve(dir, '.git', 'rebase-merge')); giro++) {
      writeFileSync(resolve(dir, 'a.txt'), `risolto ${giro}\n`, 'utf8');
      g(['add', 'a.txt']);
      try { chiudi(g); } catch (_) { /* un nuovo conflitto: il giro dopo lo risolve */ }
    }

    expect(existsSync(resolve(dir, '.git', 'rebase-merge')), 'il rebase deve arrivare in fondo').toBe(false);
    const titoli = g(['log', '--format=%s', 'origin/main..HEAD']).trim().split('\n');
    expect(titoli).toEqual(TITOLI_ATTESI);
    expect(g(['log', '-1', '--format=%b', 'HEAD']).trim()).toBe('corpo del commit, senza cancelletto');
  });
}
