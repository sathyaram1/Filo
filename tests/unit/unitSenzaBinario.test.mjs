// Gli unit test girano anche se il binario di Filo non è stato scaricato.
//
// IL CASO (#569, giro 2 di verifica)
//   Il lavoro automatico che fa girare gli unit test su Windows installa le
//   dipendenze dicendo di SALTARE lo scaricamento dell'app: 263 MB che nessun
//   unit test apre. Solo che alcuni unit test caricano i SORGENTI dell'app per
//   provarli (le scorciatoie, l'aggiornamento, il menu), e un sorgente dell'app
//   comincia chiedendo `require('electron')`. Quel modulo non è l'app: sono tre
//   righe che restituiscono il percorso del binario. Senza binario non risponde
//   «non c'è», SOLLEVA un errore, e il test muore per un motivo che col test non
//   c'entra niente.
//
//   Risultato: il controllo nuovo su Windows nasceva rosso su ogni ramo, per
//   sempre, e le due sentinelle del supporto Mac su quel computer non provavano
//   più niente. Un semaforo sempre rosso dopo due giorni non lo guarda più
//   nessuno, ed era l'unico che avrebbe visto in anticipo il rosso che ha tenuto
//   ferma la pubblicazione dall'11 al 15 settembre 2026.
//
// LA REGOLA, ADESSO
//   Il lanciatore degli unit test chiede a `require('electron')` se risponde. Se
//   solleva, dice al modulo DOVE sarebbe stato il binario: torna un percorso,
//   come sempre, e i test che volevano leggere il sorgente girano. Il percorso
//   punta a una cartella che non esiste, quindi nessuno può far partire l'app
//   per sbaglio.
//
//   La prima prova qui sotto è la garanzia completa: vale per ogni unit test,
//   anche per quelli che verranno. La seconda è la stessa cosa vista da fuori,
//   sui due test che ci erano finiti dentro davvero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { ambienteDeiTest } from '../../scripts/run-unit-tests.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// I due unit test che arrivano a chiedere il modulo dell'app passando dai
// sorgenti. Non è l'elenco della garanzia (quella vale per tutti): è la prova
// che la garanzia funziona anche fuori dalla teoria.
const CHIEDONO_L_APP = [
  join(ROOT, 'tests', 'unit', 'macSupport.test.mjs'),
  join(ROOT, 'tests', 'unit', 'updaterMac.test.mjs'),
];

// Come si comporta node_modules/electron/index.js quando lo scaricamento è
// stato saltato: con la variabile d'ambiente torna un percorso, senza solleva.
const FINTA_ASSENZA = `const Module = require('module');
const path = require('path');
const originale = Module._load;
Module._load = function (richiesta, ...resto) {
  if (richiesta === 'electron') {
    if (process.env.ELECTRON_OVERRIDE_DIST_PATH) return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, 'electron');
    throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again');
  }
  return originale.call(this, richiesta, ...resto);
};
`;

test('senza il binario il lanciatore dice al modulo dove sarebbe stato', () => {
  const senza = ambienteDeiTest({ PATH: '/bin' }, { scaricato: false, root: '/repo' });
  assert.equal(
    senza.ELECTRON_OVERRIDE_DIST_PATH,
    join('/repo', 'node_modules', 'electron', 'dist'),
    'senza questa dichiarazione `require(\'electron\')` solleva, e ogni unit test che carica un sorgente dell\'app muore',
  );
  assert.equal(senza.PATH, '/bin', 'il resto dell\'ambiente non si tocca');
});

test('col binario installato l\'ambiente resta identico', () => {
  const con = ambienteDeiTest({ PATH: '/bin' }, { scaricato: true, root: '/repo' });
  assert.deepEqual(con, { PATH: '/bin' }, 'quando non serve non si tocca niente');
});

test('una dichiarazione già fatta da chi lancia vince sulla nostra', () => {
  const mia = ambienteDeiTest(
    { ELECTRON_OVERRIDE_DIST_PATH: '/altrove' },
    { scaricato: false, root: '/repo' },
  );
  assert.equal(mia.ELECTRON_OVERRIDE_DIST_PATH, '/altrove');
});

test('i test che caricano i sorgenti dell\'app passano anche senza il binario', () => {
  const base = cartellaTemporanea('filo-senza-binario-');
  const cartellaUnit = join(base, 'unit');
  mkdirSync(cartellaUnit, { recursive: true });
  try {
    for (const percorso of CHIEDONO_L_APP) {
      const nome = percorso.split(/[\\/]/).pop();
      writeFileSync(
        join(cartellaUnit, nome),
        `await import(${JSON.stringify(pathToFileURL(percorso).href)});\n`,
        'utf8',
      );
    }
    const finta = join(base, 'finta-assenza.cjs');
    writeFileSync(finta, FINTA_ASSENZA, 'utf8');

    const ambiente = { ...process.env };
    // I segni di `node --test` passati al figlio lo farebbero uscire subito e
    // verde: una prova che non prova niente.
    delete ambiente.NODE_TEST_CONTEXT;
    delete ambiente.ELECTRON_OVERRIDE_DIST_PATH;
    // Le virgolette servono: la cartella temporanea ha uno spazio nel nome.
    ambiente.NODE_OPTIONS = `--require "${finta}"`;
    ambiente.FILO_UNIT_DIR = cartellaUnit;

    const esito = spawnSync(process.execPath, [join(ROOT, 'scripts', 'run-unit-tests.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 32,
      env: ambiente,
    });
    const uscita = `${esito.stdout || ''}${esito.stderr || ''}`;
    const rossi = uscita.split('\n').filter((r) => /^not ok /.test(r)).join('\n');

    assert.match(
      uscita,
      /il binario di Filo non è installato/,
      `la finta assenza non è arrivata al lanciatore: la prova non sta provando niente.\n${uscita.slice(-800)}`,
    );
    assert.equal(
      esito.status,
      0,
      `senza il binario questi test muoiono, e con loro il controllo automatico su Windows.\n${rossi || uscita.slice(-1500)}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
