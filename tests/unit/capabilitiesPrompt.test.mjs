// Unit test per F2 — esporre il manifesto delle capacità all'agente di Filo.
// Verifica i pezzi PURI (niente Electron, gira in ms):
//   1. l'indice compatto contiene ogni capacità (titolo + id) raggruppata per
//      categoria → l'agente sa SEMPRE *se* Filo fa una cosa;
//   2. il dettaglio on-demand restituisce cosa fa / come si attiva / limiti per
//      gli id richiesti, e segnala con onestà gli id sconosciuti (così l'agente
//      non finge di averli trovati);
//   3. il prompt filoChat include la sezione capacità + l'azione CAPACITA_DETTAGLIO
//      + l'istruzione di onestà quando una capacità non esiste;
//   4. l'azione CAPACITA_DETTAGLIO è registrata a livello 1 (sola lettura).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'capabilities.js'));
require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
require(join(ROOT, 'src', 'shared', 'constants.js'));

const CAP = globalThis.SN_CAPABILITIES;
const LEVELS = globalThis.SN_ACTION_LEVELS;
const C = globalThis.SN_CONST;

test('renderIndexForPrompt: una riga per capacità (titolo + id) sotto la sua categoria', () => {
  const idx = CAP.renderIndexForPrompt();
  // Ogni capacità del manifesto compare con titolo e id stabile.
  for (const c of CAP.CAPABILITIES) {
    assert.ok(idx.includes(`${c.title} [${c.id}]`), `manca dall'indice: ${c.id}`);
  }
  // Le categoria usate compaiono come intestazioni.
  const usedCats = new Set(CAP.CAPABILITIES.map((c) => c.category));
  for (const cat of usedCats) {
    assert.ok(idx.includes(`${CAP.CATEGORIES[cat]}:`), `manca l'intestazione categoria: ${cat}`);
  }
});

test('renderDetailForPrompt: dettaglio completo per id noti, segnalazione per id ignoti', () => {
  const withDoesNot = CAP.CAPABILITIES.find((c) => c.doesNot);
  const d = CAP.renderDetailForPrompt([withDoesNot.id, 'id-che-non-esiste']);
  // Per l'id noto: cosa fa + come si attiva + limiti.
  assert.ok(d.includes(withDoesNot.desc), 'manca la descrizione');
  assert.ok(d.includes('Come si attiva'), 'manca come si attiva');
  assert.ok(d.includes(withDoesNot.doesNot), 'manca i limiti (doesNot)');
  // Per l'id ignoto: detto esplicitamente che Filo non lo fa, non inventato.
  assert.match(d, /id-che-non-esiste/);
  assert.match(d, /nessuna capacità con questo id/i);
});

test('renderDetailForPrompt: nessun id richiesto → messaggio neutro, non crash', () => {
  assert.equal(typeof CAP.renderDetailForPrompt([]), 'string');
  assert.equal(typeof CAP.renderDetailForPrompt(undefined), 'string');
});

test('PROMPTS.filoChat: con capacita include la sezione, l\'azione e l\'onestà', () => {
  const idx = CAP.renderIndexForPrompt();
  const p = C.PROMPTS.filoChat({ profilo: 'a', preferenze: 'b', stato: 'c', capacita: idx });
  assert.match(p, /═══ COSA SA FARE FILO/);
  assert.ok(p.includes('[save-for-later]'), 'l\'indice non è dentro al prompt');
  assert.match(p, /CAPACITA_DETTAGLIO/);
  // Istruzione di onestà: se nulla corrisponde, dire che Filo non sa farlo.
  assert.match(p, /non sa fare/i);
});

test('PROMPTS.filoChat: senza capacita non emette la sezione (retrocompatibile)', () => {
  const p = C.PROMPTS.filoChat({ profilo: 'a', preferenze: 'b', stato: 'c' });
  assert.doesNotMatch(p, /═══ COSA SA FARE FILO/);
});

test('CAPACITA_DETTAGLIO è registrata a livello 1 (sola lettura)', () => {
  assert.equal(LEVELS.levelFor({ type: 'CAPACITA_DETTAGLIO', ids: ['save-for-later'] }), 1);
  assert.ok(LEVELS.describe({ type: 'CAPACITA_DETTAGLIO', ids: ['save-for-later'] }).length > 0);
});
