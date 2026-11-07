// Verifica locale «hopeful-brahmagupta-fb844b», giro 1, rilievo 2: ogni fetch, rebase o merge che le ricette delle
// routine fanno scrivere, col clone del server al suo posto, combacia con le regole che il preflight in cloud installa
// nelle impostazioni utente (una regola a prefisso non vede `git -C`).
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { installa, regoleGit } from '../../../scripts/lib/orchestratore-cieco.mjs';

const ROOT = resolve(process.cwd());
const RUOLI = join(ROOT, 'routines', 'roles');
const CLONE = '/home/prova/filo-security';

const coperto = (cmd, regole) => regole.some((r) => {
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

function comandiDeiRuoli() {
  const tutti = [];
  for (const f of readdirSync(RUOLI).filter((n) => n.endsWith('.md'))) {
    const testo = readFileSync(join(RUOLI, f), 'utf8').split('<CLONE>').join(CLONE);
    for (const c of comandiGit(testo)) tutti.push({ f, c });
  }
  return tutti;
}

test('r2 i fetch, rebase e merge scritti nelle ricette delle routine sono coperti dalle regole che il preflight installa', () => {
  const dir = cartellaTemporanea('permessi-ruoli-');
  try {
    expect(installa({ dir, sessione: 'prova', clone: CLONE }).ok).toBe(true);
    const regole = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))?.permissions?.allow || [];
    const comandi = comandiDeiRuoli();
    expect(comandi.some(({ c }) => c.includes(`-C "${CLONE}" merge`))).toBe(true);
    expect(comandi.filter(({ c }) => !coperto(c, regole)).map(({ f, c }) => `${f}: ${c}`)).toEqual([]);
    // Senza le regole col percorso del clone il merge del server resterebbe scoperto: la prova lo distingue.
    expect(comandi.filter(({ c }) => !coperto(c, regoleGit(''))).length).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
