// Prova del giro 3 sul #569 — la compensazione parla col modulo VERO.
//
// COSA GUARDA, E PERCHE' NON BASTAVA QUELLA DEL GIRO 2
//   Il controllo automatico su Windows installa le dipendenze saltando lo
//   scaricamento dell'app. Senza quel binario il modulo `electron` non risponde
//   «non c'è»: solleva, e ogni unit test che carica un sorgente dell'app muore.
//   La cura è nel lanciatore degli unit test: quando il modulo non risponde gli
//   si dice DOVE sarebbe stato il binario.
//
//   Quella cura poggia su un dettaglio che non è nostro: come si comporta il
//   modulo `electron` quando gli si dice dove sarebbe il binario. Le prove del
//   giro 2 quel comportamento se lo SCRIVONO in casa (una imitazione di tre
//   righe): se il modulo vero cambiasse — un aggiornamento che, per dire,
//   controlla anche che la cartella esista — quelle prove resterebbero verdi e
//   il controllo su Windows tornerebbe rosso a ogni partenza, che è
//   precisamente il danno del giro 2.
//
//   Qui il comportamento si CHIEDE al modulo vero, quello dentro le dipendenze,
//   messo nella condizione esatta in cui lo trova quel computer: nessun file col
//   percorso, nessuna cartella del binario. Nessuna imitazione.
//
// PERCHE' UNA COPIA E NON LE DIPENDENZE VERE
//   Il binario qui c'è, e toglierlo per una prova lascerebbe la macchina senza
//   l'app se la prova morisse a metà. Si copia il modulo (due file, nessuna
//   dipendenza) in una cartella usa-e-getta e si lascia fuori quello che
//   l'installazione saltata non avrebbe scritto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { ambienteDeiTest } from '../../../scripts/run-unit-tests.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');
const MODULO_VERO = join(ROOT, 'node_modules', 'electron');

/**
 * Una copia del modulo `electron` vero nella condizione in cui lo lascia
 * un'installazione che ha saltato lo scaricamento: c'è il codice, non c'è né il
 * file col percorso né la cartella del binario.
 */
function moduloSenzaBinario(base) {
  const dentro = join(base, 'node_modules', 'electron');
  mkdirSync(dentro, { recursive: true });
  for (const nome of ['index.js', 'package.json']) {
    copyFileSync(join(MODULO_VERO, nome), join(dentro, nome));
  }
  return dentro;
}

/** Chiede il modulo in un processo a parte e riporta cosa ha risposto. */
function chiediIlModulo(base, ambiente) {
  const sonda = join(base, 'sonda.cjs');
  writeFileSync(
    sonda,
    'try { console.log("PERCORSO:" + require("electron")); }\n'
    + 'catch (e) { console.log("SOLLEVA:" + e.message); }\n',
    'utf8',
  );
  const esito = spawnSync(process.execPath, [sonda], {
    cwd: base,
    encoding: 'utf8',
    env: { ...ambiente, NODE_TEST_CONTEXT: undefined },
  });
  return `${esito.stdout || ''}${esito.stderr || ''}`.trim();
}

test('#569 giro 3: il modulo VERO, senza binario, solleva — ed è da lì che nasceva il rosso', (t) => {
  if (!existsSync(join(MODULO_VERO, 'index.js'))) {
    t.skip('le dipendenze non sono installate: non c\'è nessun modulo vero da interrogare');
    return;
  }
  const base = cartellaTemporanea('filo-569-modulo-vero-');
  try {
    moduloSenzaBinario(base);
    const ambiente = { ...process.env };
    delete ambiente.ELECTRON_OVERRIDE_DIST_PATH;
    delete ambiente.NODE_OPTIONS;
    const detto = chiediIlModulo(base, ambiente);
    assert.match(
      detto,
      /^SOLLEVA:/,
      `senza binario il modulo vero dovrebbe sollevare: se non lo fa più, la compensazione del lanciatore non serve a niente e va ripensata.\nHa risposto: ${detto}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('#569 giro 3: con la dichiarazione del lanciatore il modulo VERO torna un percorso, e non solleva più', (t) => {
  if (!existsSync(join(MODULO_VERO, 'index.js'))) {
    t.skip('le dipendenze non sono installate: non c\'è nessun modulo vero da interrogare');
    return;
  }
  const base = cartellaTemporanea('filo-569-modulo-vero-ok-');
  try {
    moduloSenzaBinario(base);

    // Esattamente l'ambiente che prepara il lanciatore degli unit test quando
    // si accorge che il binario non c'è. Non una copia scritta a mano: la
    // funzione vera.
    const ambiente = ambienteDeiTest(
      { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: undefined, NODE_OPTIONS: undefined },
      { scaricato: false, root: base },
    );

    const detto = chiediIlModulo(base, ambiente);
    assert.match(
      detto,
      /^PERCORSO:/,
      'con la dichiarazione del lanciatore il modulo vero deve tornare un percorso: se solleva lo stesso, il '
      + `controllo automatico su Windows nasce rosso e non può diventare verde su nessun ramo.\nHa risposto: ${detto}`,
    );
    assert.ok(
      detto.includes(join(base, 'node_modules', 'electron', 'dist')),
      `il percorso tornato non è quello dichiarato dal lanciatore: ${detto}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
