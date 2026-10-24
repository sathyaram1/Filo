// L'automazione di OpenSSF Scorecard (#1421): gira solo sul main vero, col minimo dei permessi, con azioni fissate per sha.
// Finché l'owner non la sposta in .github/workflows (#1140) aspetta in routines/automazioni, e il README non ne mostra
// il badge: senza risultati pubblicati il badge darebbe un errore sulla prima pagina del repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { valutaCondizione } from '../helpers/azioniGithub.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATTIVA = join(ROOT, '.github', 'workflows', 'scorecard.yml');
const IN_ATTESA = join(ROOT, 'routines', 'automazioni', 'scorecard.yml');
const BADGE = '[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/sathyaram1/Filo/badge)](https://scorecard.dev/viewer/?uri=github.com/sathyaram1/Filo)';
const attiva = existsSync(ATTIVA);
const testo = existsSync(attiva ? ATTIVA : IN_ATTESA) ? readFileSync(attiva ? ATTIVA : IN_ATTESA, 'utf8') : '';
const W = testo.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');
const blocco = (re) => (re.exec(`${W}\n`) || [])[1] || '';
const chiavi = (b, rientro) => b.split('\n').filter((r) => new RegExp(`^ {${rientro}}\\S`).test(r)).map((r) => r.trim());

test('una copia sola: in attesa in routines/automazioni, o spostata in .github/workflows', () => {
  assert.ok(testo, 'manca l\'automazione di Scorecard: né in .github/workflows né in routines/automazioni');
  assert.ok(!(attiva && existsSync(IN_ATTESA)), 'portata in .github/workflows: la copia in routines/automazioni si toglie (git mv, non una copia)');
});

test('parte solo da main: niente pull_request, niente rami, niente tag', () => {
  const on = blocco(/^on:\n((?: {2}.*\n|\n)+)/m);
  const eventi = chiavi(on, 2).map((r) => r.replace(/:.*$/, ''));
  assert.ok(eventi.length, 'manca `on:`');
  const ammessi = ['branch_protection_rule', 'schedule', 'push', 'workflow_dispatch'];
  assert.deepEqual(eventi.filter((e) => !ammessi.includes(e)), [], `eventi fuori da main: un ramo o una richiesta di fusione non pubblica il voto`);
  const push = blocco(/^ {2}push:\n((?: {4}.*\n)+)/m);
  assert.deepEqual(chiavi(push, 4), ['branches: [main]'], 'push solo su main, senza tag né percorsi');

  const se = blocco(/^ {4}if: (.+)\n/m);
  assert.ok(se, 'il lavoro dichiara la sua condizione su main');
  const su = (ref) => valutaCondizione(se, { github: { ref, event_name: 'workflow_dispatch' } });
  assert.equal(su('refs/heads/main'), true);
  for (const altro of ['refs/heads/worker/x', 'refs/heads/main-2', 'refs/pull/1/merge', 'refs/tags/v1.0.0']) {
    assert.equal(su(altro), false, `il lavoro partirebbe da ${altro}`);
  }
});

test('permessi minimi: niente in cima, nel lavoro solo lettura del codice e le due scritture che servono', () => {
  assert.match(W, /^permissions: \{\}\n/m, 'in cima `permissions: {}`: ogni lavoro dichiara i suoi');
  const delLavoro = blocco(/^ {4}permissions:\n((?: {6}.*\n)+)/m);
  // security-events: i risultati in code scanning; id-token: la firma che l'API pubblica chiede per il badge.
  assert.deepEqual(chiavi(delLavoro, 6).sort(), ['contents: read', 'id-token: write', 'security-events: write']);
  assert.equal((W.match(/permissions:/g) || []).length, 2, 'un blocco di permessi in cima e uno nel lavoro, nessun altro');
  assert.doesNotMatch(W, /write-all|read-all/);
});

test('ogni azione è fissata per sha, con la versione accanto', () => {
  const usi = [...W.matchAll(/uses: (\S+)(.*)$/gm)];
  assert.ok(usi.length >= 3, `troppo pochi passi letti (${usi.length}): la regex non li vede più?`);
  for (const [riga, azione, resto] of usi) {
    assert.match(azione, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `azione non fissata per sha: ${riga}`);
    assert.match(resto, /^ # v\d+\.\d+\.\d+$/, `manca la versione accanto allo sha: ${riga}`);
  }
});

test('il lavoro ha solo i passi che l\'API del badge accetta, e nessun segreto', () => {
  const azioni = [...W.matchAll(/uses: ([^@\s]+)@/g)].map((m) => m[1]);
  assert.deepEqual(azioni, ['actions/checkout', 'ossf/scorecard-action', 'github/codeql-action/upload-sarif']);
  assert.doesNotMatch(W, /^\s+run:|^\s*(env|defaults|container|services):/m, 'l\'API rifiuta i risultati di un lavoro con run, env, defaults, container o services');
  assert.match(W, /^ {4}runs-on: ubuntu-latest$/m);
  assert.match(W, /publish_results: true/);
  assert.doesNotMatch(W, /secrets\.|github\.token|GITHUB_TOKEN|repo_token/);
  assert.match(W, /actions\/checkout@\S+.*\n\s+with:\n\s+persist-credentials: false/);
});

test('il badge nel README c\'è quando l\'automazione gira, non prima', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  if (attiva) assert.ok(readme.includes(BADGE), `l'automazione è in .github/workflows: sotto il titolo del README va il badge\n${BADGE}`);
  else assert.ok(!readme.includes('api.scorecard.dev'), 'il badge arriva con l\'automazione: senza risultati pubblicati darebbe un errore');
});
