// Verifica locale «hopeful-brahmagupta-fb844b», giro 1, rilievo 1: in cloud le regole dei permessi devono valere anche
// dopo che il giro apre il ramo di un feedback nato prima della correzione (Claude Code ricarica le impostazioni quando
// il file cambia; in cloud legge solo .claude/settings.json del progetto e le impostazioni utente del contenitore).
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { installa } from '../../../scripts/lib/orchestratore-cieco.mjs';

const ROOT = resolve(process.cwd());
// origin/main al 24/10/2026: un ramo nato qui non ha il file dei permessi della correzione.
const PRIMA_DELLA_CORREZIONE = 'd1175f8cc20d0f7b9b89369f226ea3915e6bd9f6';
const COMANDI = ['git fetch origin main', 'git rebase origin/main', 'git rebase --continue', 'git merge origin/main'];

function regoleDelProgetto(sha) {
  const r = spawnSync('git', ['show', `${sha}:.claude/settings.json`], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return [];
  try { return JSON.parse(r.stdout)?.permissions?.allow || []; } catch (_) { return []; }
}

function regoleUtente(dir) {
  const f = join(dir, 'settings.json');
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8'))?.permissions?.allow || []; } catch (_) { return []; }
}

const coperto = (cmd, regole) => regole.some((r) => {
  const m = /^Bash\((.*)\)$/.exec(r);
  if (!m) return false;
  const p = m[1].replace(/(:\*| \*)$/, '');
  return m[1] !== p ? cmd === p || cmd.startsWith(`${p} `) : cmd === p;
});

test('r1 dopo il preflight in cloud, su un ramo nato prima della correzione fetch, rebase e merge restano permessi', () => {
  const dir = cartellaTemporanea('permessi-ramo-vecchio-');
  try {
    // Quello che il preflight del giro scrive nelle impostazioni utente del contenitore cloud.
    const esito = installa({ dir, sessione: 'prova' });
    expect(esito.ok).toBe(true);
    const regole = [...regoleDelProgetto(PRIMA_DELLA_CORREZIONE), ...regoleUtente(dir)];
    const scoperti = COMANDI.filter((c) => !coperto(c, regole));
    expect(scoperti).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
