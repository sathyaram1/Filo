// Sentinella: il PUNTO DI PASSAGGIO UNICO degli avvisi (#536).
//
// Il guardiano vale quanto vale la porta: se una superficie qualunque può
// scrivere una notifica per conto suo, il controllo è decorativo. Questo test
// legge il codice VERO e diventa rosso se:
//
//   1. qualcuno chiama `addNotification` fuori da textGuardian.js — cioè apre
//      una seconda porta verso la colonna degli avvisi;
//   2. il guardiano perde il suo posto nella risposta della chat (un turno che
//      ha letto roba scritta da altri deve passare da `controllaTesto`);
//   3. la funzione «guardiano» sparisce dal censimento dei modelli, dalle
//      etichette o dal raggruppamento dei crediti — cioè diventa un modello
//      scelto dal codice, invisibile e non cambiabile;
//   4. il consumo del guardiano non finisce più sotto la voce crediti
//      «Controlli di sicurezza».
//
// È una sentinella di codice, non di comportamento: il comportamento lo provano
// textGuard.test.mjs, textGuardian.test.mjs e lo spec Playwright del guardiano.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

// I soli file autorizzati a scrivere una notifica: chi la definisce, e il
// guardiano. Aggiungerne uno qui è una decisione, non una svista.
const PORTE_AMMESSE = new Set([
  join('shared', 'filoMemory.js'),           // la definizione
  join('main', 'services', 'textGuardian.js'), // il punto di passaggio
]);

function fileSotto(dir, ext = ['.js', '.mjs']) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...fileSotto(p, ext));
    else if (ext.some((e) => nome.endsWith(e))) out.push(p);
  }
  return out;
}

test('nessuna superficie scrive una notifica saltando il guardiano', () => {
  const colpevoli = [];
  for (const p of fileSotto(SRC)) {
    const rel = relative(SRC, p);
    if (PORTE_AMMESSE.has(rel)) continue;
    const testo = readFileSync(p, 'utf8');
    // Le righe di commento non contano: la regola si spiega, e spiegarla non è
    // aprirla.
    for (const [i, riga] of testo.split('\n').entries()) {
      const senzaCommento = riga.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      if (/\baddNotification\s*\(/.test(senzaCommento)) {
        colpevoli.push(`${rel.split(sep).join('/')}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(colpevoli, [],
    'questi punti scrivono una notifica senza passare dal guardiano (#536): '
    + colpevoli.join(', '));
});

test('la risposta della chat passa dal guardiano quando il turno è contaminato', () => {
  const h = readFileSync(join(SRC, 'main', 'services', 'handlers.js'), 'utf8');
  assert.match(h, /vaControllato\(fiduciaTurno\)/,
    'la chat non controlla più la fiducia del turno prima di rispondere');
  assert.match(h, /controllaTesto\(/,
    'la risposta della chat non passa più dal guardiano');
  assert.match(h, /fiduciaDellAzione\(/,
    'nessuno segna più il turno come contaminato quando un’azione legge roba di altri');
});

test('il guardiano gira su un modello impostabile, mai scelto dal codice', () => {
  require(join(ROOT, 'src', 'shared', 'constants.js'));
  require(join(ROOT, 'src', 'shared', 'modelUsage.js'));
  const C = globalThis.SN_CONST;
  const U = globalThis.SN_MODEL_USAGE;
  const azione = C.ACTIONS.GUARD_TEXT;
  assert.ok(azione, 'ACTIONS.GUARD_TEXT non esiste');

  const voce = U.ENTRIES.find((e) => e.ref === azione);
  assert.ok(voce, 'il guardiano non è nel censimento dei punti in cui Filo usa un modello');
  assert.notEqual(voce.from, 'code', 'il modello del guardiano non deve essere deciso dal codice');

  assert.ok(C.ACTION_LABELS[azione], 'il guardiano non ha un’etichetta leggibile');
  assert.equal(C.creditUsageGroup(azione), 'Controlli di sicurezza',
    'il consumo del guardiano deve comparire sotto «Controlli di sicurezza»');
  assert.ok(azione in C.DEFAULT_SETTINGS.models,
    'il guardiano non ha una casella fra i modelli impostabili');
});

test('il registro dei blocchi ha i suoi messaggi, e non sono aperti alle pagine web', () => {
  require(join(ROOT, 'src', 'shared', 'messages.js'));
  const { MSG } = globalThis.SN_MSG;
  assert.ok(MSG.FILO_GET_GUARD_BLOCKS && MSG.FILO_CLEAR_GUARD_BLOCKS);
  const h = readFileSync(join(SRC, 'main', 'services', 'handlers', 'filo.js'), 'utf8');
  // Il testo fermato è quello che qualcuno ha scritto per ingannare: non torna
  // a una pagina web che lo chiede.
  const blocco = h.slice(h.indexOf('FILO_GET_GUARD_BLOCKS'));
  assert.match(blocco.slice(0, 400), /isFilo\(origin\)/,
    'il registro dei blocchi è leggibile da una pagina web');
});
