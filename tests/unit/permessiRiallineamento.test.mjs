// In cloud le routine girano in modalità auto e il classificatore dei permessi ferma rebase e merge (#1454): il repo
// ammette fetch, rebase e merge da .claude/settings.json (l'unico file di impostazioni che il cloud legge), mai il push,
// e i ruoli scrivono quei comandi nudi, perché un comando composto, con cd o -C, nessuna regola lo copre.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RADICE = resolve(import.meta.dirname, '..', '..');
const FILE = join(RADICE, '.claude', 'settings.json');
const RUOLI = join(RADICE, 'routines', 'roles');
const REGOLE = ['Bash(git fetch:*)', 'Bash(git rebase:*)', 'Bash(git merge:*)'];

const allowDi = (percorso) => ((JSON.parse(readFileSync(percorso, 'utf8')).permissions || {}).allow || []);

test('.claude/settings.json ammette fetch, rebase e merge, nessuna regola tocca il push e il file è versionato (#1454)', () => {
  const allow = allowDi(FILE);
  for (const r of REGOLE) assert.ok(allow.includes(r), `manca ${r}`);
  for (const r of allow) {
    assert.match(r, /^Bash\(git (fetch|rebase|merge):\*\)$/, `${r}: in questo file stanno solo le tre regole del riallineamento`);
  }
  for (const r of [...allow, ...allowDi(join(RADICE, '.claude', 'settings.local.json'))]) {
    assert.doesNotMatch(r, /push|--force|reset|clean/, `${r}: il push forzato resta al gancio di salvataggio`);
  }
  // Un file ignorato non arriva nel clone del cloud: check-ignore esce 1 quando il file NON è ignorato.
  let stato = 0;
  try { execFileSync('git', ['check-ignore', '-q', '.claude/settings.json'], { cwd: RADICE, stdio: 'pipe' }); } catch (e) { stato = e.status; }
  assert.equal(stato, 1, '.gitignore esclude il file');
  const tracciati = execFileSync('git', ['ls-files', '.claude/settings.json'], { cwd: RADICE, encoding: 'utf8' }).trim();
  assert.equal(tracciati, '.claude/settings.json', 'il file non è tracciato da git');
});

// I comandi di un ruolo: le righe dei blocchi di codice e gli inserti fra apici inversi, anche spezzati da un ritorno a riga.
function comandiDi(testo) {
  const trovati = [];
  const fuori = testo.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, corpo) => { trovati.push(...corpo.split('\n')); return ' '; });
  trovati.push(...[...fuori.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  return trovati.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const RIALLINEA = /\bgit\s+(fetch|rebase|pull)\b/;
const NUDI = ['git fetch origin main', 'git rebase origin/main', 'git rebase --continue', 'git rebase --abort'];

test('nei ruoli ogni fetch o rebase è un comando nudo coperto da una regola: niente &&, cd, -C né git pull', () => {
  const file = readdirSync(RUOLI).filter((n) => n.endsWith('.md')).sort();
  const visti = new Set();
  for (const f of file) {
    for (const c of comandiDi(readFileSync(join(RUOLI, f), 'utf8')).filter((c) => RIALLINEA.test(c))) {
      assert.ok(NUDI.includes(c), `${f}: «${c}» non è uno dei comandi nudi che le regole coprono`);
      visti.add(c);
    }
  }
  for (const c of ['git fetch origin main', 'git rebase origin/main', 'git rebase --continue']) assert.ok(visti.has(c), `nessun ruolo scrive «${c}»`);
  const tutto = file.map((f) => readFileSync(join(RUOLI, f), 'utf8')).join('\n').replace(/\s+/g, ' ');
  assert.doesNotMatch(tutto, /git fetch origin main && git rebase/, 'il comando composto di prima non torna');
  assert.doesNotMatch(tutto, /git pull --rebase/, 'il pull con rebase nessuna regola lo copre');
});
