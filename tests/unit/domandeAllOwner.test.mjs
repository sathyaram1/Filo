// Sentinella di CLAUDE.md § Domande all'owner e § Switch di ruolo (#1226): il comando citato esiste, i rimandi
// portano a qualcosa, i ruoli che chiedono all'owner aprono una domanda, e nessun punto manda a lavorare in locale.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLAUDE = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
const { leggiArgomenti } = await import('../../scripts/domanda.mjs');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');

const piatto = (s) => String(s).replace(/\s+/g, ' ');

function sezione(testo, titolo) {
  const i = testo.indexOf(`\n## ${titolo}`);
  if (i < 0) return '';
  const j = testo.indexOf('\n## ', i + 1);
  return testo.slice(i, j < 0 ? undefined : j);
}

test("CLAUDE.md dice come si chiede all'owner, e quello che cita esiste", () => {
  const s = piatto(sezione(CLAUDE, "Domande all'owner"));
  assert.ok(s, "manca la sezione «## Domande all'owner»");
  const m = /`node scripts\/domanda\.mjs (\S+) <file\.json \| ->`/.exec(s);
  assert.ok(m, 'la sezione deve dare il comando che apre una domanda');
  assert.ok(existsSync(join(ROOT, 'scripts', 'domanda.mjs')));
  for (const sorgente of ['-', '../domanda.json']) {
    assert.equal(leggiArgomenti([m[1], sorgente]).cmd, 'chiedi', `«${m[1]} ${sorgente}» deve essere un comando vero`);
  }
  assert.match(s, /`SPEC-DOMANDE\.md` §3/);
  assert.match(readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8'), /^## 3\. Domande$/m);
  assert.match(s, /`src\/shared\/domande\.js`/);
  assert.ok(existsSync(join(ROOT, 'src', 'shared', 'domande.js')));
  assert.match(s, /`notePerAgenti`/, 'le note per gli agenti hanno un campo loro');
  assert.match(s, /FUORI dal repo/, 'un JSON dentro il repo lo pubblica il salvataggio automatico');
  assert.match(s, /non ferma il resto del lavoro/);
});

test("i ruoli che chiedono all'owner aprono una domanda e rimandano a CLAUDE.md", () => {
  for (const ruolo of ['new-work', 'fixer', 'verifier']) {
    const t = piatto(readRoleInstructions(ruolo));
    assert.match(t, /node "?[^\s"]*scripts\/domanda\.mjs"? chiedi/, `${ruolo}: manca il comando della domanda`);
    assert.ok(t.includes("CLAUDE.md § Domande all'owner"), `${ruolo}: manca il rimando a CLAUDE.md`);
  }
  const resolver = piatto(readRoleInstructions('new-work'));
  assert.match(resolver, /domanda `bloccante`[^]*--reason clarify/, 'chi si ferma prima di cominciare apre la domanda');
  assert.doesNotMatch(resolver, /--notes "\[le tue domande\]"/, 'le domande non viaggiano più solo nelle note');
});

test('CLAUDE.md: la sessione locale discute, il lavoro e le prove sono delle routine', () => {
  assert.match(piatto(sezione(CLAUDE, 'Switch di ruolo')), /Sessione locale.*non scrive codice e non lancia prove/);
  assert.doesNotMatch(CLAUDE, /finish:check[^\n]*in locale/);
  assert.doesNotMatch(CLAUDE, /`npm run finish` \(locale\)/);
  assert.doesNotMatch(CLAUDE, /git worktree add/, 'creare un ramo a mano è lavoro locale');
  assert.doesNotMatch(CLAUDE, /rideploya/i, 'una routine non pubblica il server');
  assert.doesNotMatch(CLAUDE, /PowerShell/, 'prove e commit col PowerShell del PC non li fa più nessuno');
  assert.match(CLAUDE, /`INCORPORATI_DAL_SERVER` \(`scripts\/lib\/orchestratore\.mjs`\)/);
  assert.match(readFileSync(join(ROOT, 'scripts', 'lib', 'orchestratore.mjs'), 'utf8'), /export const INCORPORATI_DAL_SERVER\b/);
});
