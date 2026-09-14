// Sentinella sulle regole Firestore per i livelli L3/L4 del feedback
// (contratto del 2026-09-13).
//
// Il server scrive `livelli.l3` (la segnalazione di chi ha lavorato) e
// `livelli.l4` (l'esito del controllo di sicurezza) sul documento del
// feedback. Le regole devono ammettere il campo nei due rami di triage (admin
// e routine) E vincolarne la forma: una mappa con al più `l3` e `l4`, ognuna
// con `esito`, `at`, opzionali `ruolo`/`by` e un `testo` cifrato col tetto.
//
// Come le altre sentinelle sulle regole (firestoreRulesPaths.test.mjs): si
// legge il file che si deploya, non si avvia l'emulatore. Senza il fix è rosso:
// `livelli` non compariva in nessun hasOnly e il vincolo non esisteva.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(join(__dirname, '..', '..', 'firestore.rules'), 'utf8');

function bloccoUpdate(guardia) {
  const i = RULES.indexOf(`allow update: if\n        ${guardia}()`);
  assert.notEqual(i, -1, `manca il ramo di update con ${guardia}()`);
  // Fino alla regola dopo: un «;» dentro un commento chiuderebbe il blocco
  // troppo presto.
  const fine = RULES.indexOf('\n      allow ', i + 1);
  return RULES.slice(i, fine === -1 ? undefined : fine);
}

test('livelli: ammesso negli hasOnly del triage admin e della routine, con il vincolo di forma', () => {
  for (const guardia of ['isAdmin', 'isRoutine']) {
    const blocco = bloccoUpdate(guardia);
    assert.match(blocco, /'livelli'/, `${guardia}: 'livelli' deve stare nell'hasOnly`);
    assert.match(blocco, /livelliValidi\(request\.resource\.data\)/, `${guardia}: il vincolo di forma va applicato`);
  }
});

test('livelli: la forma è una mappa con al più l3/l4, ognuna con esito/at e un testo col tetto', () => {
  const i = RULES.indexOf('function livelliValidi(');
  assert.notEqual(i, -1);
  const corpo = RULES.slice(i, RULES.indexOf('}', i));
  assert.match(corpo, /d\.livelli is map/);
  assert.match(corpo, /keys\(\)\.hasOnly\(\['l3', 'l4'\]\)/);
  assert.match(corpo, /livelloValido\(d\.livelli\.l3\)/);
  assert.match(corpo, /livelloValido\(d\.livelli\.l4\)/);

  const j = RULES.indexOf('function livelloValido(');
  assert.notEqual(j, -1);
  const voce = RULES.slice(j, RULES.indexOf('}', j));
  assert.match(voce, /hasOnly\(\['esito', 'at', 'ruolo', 'by', 'testo'\]\)/);
  assert.match(voce, /get\('esito', ''\)\.size\(\) > 0/, 'esito è obbligatorio');
  assert.match(voce, /get\('at', ''\) is string/);
  assert.match(voce, /get\('testo', ''\)\.size\(\) <= 20000/, 'il tetto del testo cifrato è 20.000 (CLAUDE.md § Limiti: ampio)');
});
