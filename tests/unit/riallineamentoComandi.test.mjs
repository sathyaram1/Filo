// Il riallineamento delle routine passa dal controllo dei permessi della modalità auto solo con regole esatte (#1454): le
// regole restano esatte e senza push, ogni comando di riallineamento nei ruoli è scritto nella forma che una regola copre,
// e le regole le scrive il preflight nelle impostazioni utente, mai nel progetto (che il ramo vecchio del worker cambia).

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const RADICE = resolve(import.meta.dirname, '..', '..');
// Come in lavoriServer.test.mjs: dispatch legge stato e radici all'import, qui in una cartella usa-e-getta.
const TMP = cartellaTemporanea('filo-riallineamento-');
process.env.FILO_DISPATCH_STATE_DIR = TMP;
process.env.FILO_REPO_ROOT = TMP;
process.env.FILO_TOOLS_ROOT = RADICE;

const { REGOLE_GIT, regoleGit, regoleMergeServer, comandoDellaRegola } = await import('../../scripts/lib/permessi-routine.mjs');
const { testoLavoroServer } = await import('../../scripts/dispatch.mjs');

const CLONE = '/home/utente/filo-security';
const RUOLI = join(RADICE, 'routines', 'roles');
const fileRuoli = () => readdirSync(RUOLI).filter((n) => n.endsWith('.md')).sort();
// Il testo come lo riceve il worker: nel ruolo server i segnaposti sono già i percorsi veri.
const testoDi = (f) => (f === '_lavoro-server.md' ? testoLavoroServer({ clone: CLONE }) : readFileSync(join(RUOLI, f), 'utf8'));

// I comandi di un ruolo: le righe dei blocchi di codice e gli inserti fra apici inversi, anche spezzati da un ritorno a
// riga. Un comando ha almeno tre parole: `git -C` o `git merge` nominati da soli sono forme vietate, non comandi.
function comandiDi(testo) {
  const trovati = [];
  const fuori = testo.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, corpo) => { trovati.push(...corpo.split('\n')); return ' '; });
  trovati.push(...[...fuori.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  return trovati.map((c) => c.replace(/\s+/g, ' ').trim()).filter((c) => c.split(' ').length >= 3);
}
const RIALLINEA = /\bgit\s+(?:-C\s+(?:"[^"]*"|\S+)\s+)?(?:fetch|rebase|pull|merge)\b/;

test('le regole sono esatte, una per comando, senza jolly e senza git push; il percorso del clone entra solo se innocuo', () => {
  assert.deepEqual([...REGOLE_GIT], [
    'Bash(git fetch origin main)', 'Bash(git rebase origin/main)', 'Bash(git rebase --continue)', 'Bash(git rebase --abort)',
    'Bash(git pull --rebase origin main)',
  ]);
  const tutte = regoleGit({ clone: CLONE });
  assert.equal(tutte.length, REGOLE_GIT.length + 2);
  for (const r of tutte) {
    assert.match(r, /^Bash\(git /, r);
    assert.ok(!r.includes('*'), `${r}: col jolly non è esatta`);
    assert.ok(comandoDellaRegola(r), r);
    assert.doesNotMatch(r, /push|--force|reset|clean|checkout|branch/, `${r}: il push forzato resta al gancio di salvataggio`);
  }
  assert.deepEqual(regoleMergeServer(CLONE), [`Bash(git -C "${CLONE}" merge origin/main)`, `Bash(git -C ${CLONE} merge origin/main)`]);
  assert.deepEqual(regoleMergeServer('C:\\Users\\agenti AI\\filo-security'), ['Bash(git -C "C:/Users/agenti AI/filo-security" merge origin/main)'],
    'barre in avanti come nel ruolo; con uno spazio nel percorso la forma senza virgolette non è quel comando');
  for (const brutto of ['/x" merge origin/main; git push --force "', '/x$HOME', "/x'y", '/x`y', '/x\ny', '/x&&y', '']) {
    assert.deepEqual(regoleMergeServer(brutto), [], JSON.stringify(brutto));
    assert.deepEqual(regoleGit({ clone: brutto }), [...REGOLE_GIT], JSON.stringify(brutto));
  }
  assert.equal(comandoDellaRegola('Bash(git merge:*)'), null);
  assert.equal(comandoDellaRegola('Read(x)'), null);
  assert.equal(comandoDellaRegola('Bash(git rebase origin/main)'), 'git rebase origin/main');
});

test('ogni fetch, rebase, pull o merge di main nei ruoli è un comando intero, da solo nella riga, e combacia con una regola', () => {
  const ammessi = regoleGit({ clone: CLONE }).map(comandoDellaRegola);
  const visti = [];
  for (const f of fileRuoli()) {
    for (const c of comandiDi(testoDi(f)).filter((c) => RIALLINEA.test(c))) {
      visti.push(c);
      assert.ok(ammessi.includes(c), `${f}: «${c}» non combacia da solo con una regola esatta (niente &&, cd, -C fuori dal clone del server, né altre forme)`);
    }
  }
  for (const atteso of ['git fetch origin main', 'git rebase origin/main', 'git rebase --continue', 'git pull --rebase origin main', `git -C "${CLONE}" merge origin/main`]) {
    assert.ok(visti.includes(atteso), `nessun ruolo scrive «${atteso}»`);
  }
  const tutto = fileRuoli().map((f) => readFileSync(join(RUOLI, f), 'utf8')).join('\n').replace(/\s+/g, ' ');
  assert.doesNotMatch(tutto, /git fetch origin main && git rebase/, 'il comando composto di prima non torna');
});

test('le regole le scrive il preflight nelle impostazioni utente, insieme al gancio e con il clone vero; nel progetto non stanno', () => {
  const src = readFileSync(join(RADICE, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.ok(src.includes("installaCecita({ sessione: process.env.CLAUDE_CODE_SESSION_ID || '', permessi: regoleGit({ clone: cartellaCloneServer() }) })"),
    'il preflight passa a installa le regole del giro, col percorso del clone del server');
  const locale = JSON.parse(readFileSync(join(RADICE, '.claude', 'settings.local.json'), 'utf8'));
  const allow = (locale.permissions || {}).allow || [];
  for (const r of regoleGit({ clone: CLONE })) assert.ok(!allow.includes(r), `${r}: nel progetto il ramo vecchio del worker la toglierebbe`);
});
