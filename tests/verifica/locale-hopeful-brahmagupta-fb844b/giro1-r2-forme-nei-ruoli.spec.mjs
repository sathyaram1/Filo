// Verifica locale «hopeful-brahmagupta-fb844b», giro 1, rilievo 2: ogni fetch, rebase o merge che le ricette delle
// routine fanno scrivere deve combaciare con una regola dei permessi del repo (una regola a prefisso non vede `git -C`).
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const RUOLI = join(ROOT, 'routines', 'roles');

const regole = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8')).permissions.allow;
const coperto = (cmd) => regole.some((r) => {
  const m = /^Bash\((.*)\)$/.exec(r);
  if (!m) return false;
  const p = m[1].replace(/(:\*| \*)$/, '');
  return m[1] !== p ? cmd === p || cmd.startsWith(`${p} `) : cmd === p;
});

function comandiGit(testo) {
  const pezzi = [...testo.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  for (const blocco of testo.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) pezzi.push(...blocco[1].split('\n'));
  return pezzi.map((s) => s.trim())
    .filter((s) => /^git(\s+-[Cc]\s+("[^"]*"|\S+))*\s+(fetch|rebase|merge)\b/.test(s));
}

test('r2 i fetch, rebase e merge scritti nelle ricette delle routine sono coperti dalle regole dei permessi', () => {
  const scoperti = [];
  for (const f of readdirSync(RUOLI).filter((n) => n.endsWith('.md'))) {
    for (const c of comandiGit(readFileSync(join(RUOLI, f), 'utf8'))) if (!coperto(c)) scoperti.push(`${f}: ${c}`);
  }
  expect(scoperti).toEqual([]);
});
