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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leggiTestoRepo } from '../helpers/testo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = leggiTestoRepo(join(__dirname, '..', '..', 'firestore.rules'));

// Il ritaglio del ramo di update, dato il TESTO delle regole. Il testo entra
// come parametro — e non si legge qui dentro — perché la prova qui sotto glielo
// passa coi fini riga di Windows.
//
// Niente «a capo» dentro una stringa da cercare: `indexOf('…if\n        isAdmin()')`
// era il difetto del #569. Su un checkout di Windows quel file arriva con CRLF,
// la stringa non si trova più e la sentinella diceva «manca il ramo di update
// con isAdmin()» su un file che quel ramo ce l'aveva. `\s+` copre tutti e due i
// fini riga e anche un rientro cambiato.
function bloccoUpdate(testo, guardia) {
  const inizio = new RegExp(`allow update: if\\s+${guardia}\\(\\)`).exec(testo);
  assert.notEqual(inizio, null, `manca il ramo di update con ${guardia}()`);
  // Fino alla regola dopo: un «;» dentro un commento chiuderebbe il blocco
  // troppo presto.
  const resto = testo.slice(inizio.index);
  const dopo = /\n\s*allow /.exec(resto.slice(1));
  return dopo ? resto.slice(0, dopo.index + 1) : resto;
}

test('livelli: ammesso negli hasOnly del triage admin e della routine, con il vincolo di forma', () => {
  for (const guardia of ['isAdmin', 'isRoutine']) {
    const blocco = bloccoUpdate(RULES, guardia);
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

test('la sentinella legge le stesse regole anche da un checkout con i fini riga di Windows (#569)', () => {
  // Il file è lo stesso: cambia solo come lo consegna la macchina. Su Windows
  // il checkout scrive CRLF, e fino al #569 questa sentinella rispondeva «manca
  // il ramo di update con isAdmin()» — su regole in cui quel ramo c'era. Rosso
  // solo sul runner della pubblicazione, cioè dove un rosso vuol dire che agli
  // utenti non arriva nessuna versione: dall'11 al 15 settembre 2026 non ne è
  // uscita nessuna. Senza il fix questa prova è rossa.
  const comeSuWindows = RULES.replace(/\n/g, '\r\n');
  for (const guardia of ['isAdmin', 'isRoutine']) {
    const blocco = bloccoUpdate(comeSuWindows, guardia);
    assert.match(blocco, /'livelli'/, `${guardia}: 'livelli' deve stare nell'hasOnly anche con CRLF`);
    assert.match(blocco, /livelliValidi\(request\.resource\.data\)/, `${guardia}: il vincolo di forma va visto anche con CRLF`);
  }
});
