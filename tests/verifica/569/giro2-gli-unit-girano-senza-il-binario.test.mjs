// Prova del giro 2 sul #569 — il controllo nuovo su Windows deve poter
// diventare verde.
//
// COSA GUARDA
//   Il lavoro su Windows installa le dipendenze dicendo di SALTARE lo
//   scaricamento dell'app (263 MB che gli unit test non aprono mai). Con quello
//   scaricamento saltato, però, `require('electron')` non torna un percorso:
//   SOLLEVA un errore ("Electron failed to install correctly"). Gli unit test
//   che fanno da sentinella al supporto Mac chiedono proprio quel modulo —
//   passando dai sorgenti dell'app — e diventano rossi.
//
//   Qui si ricostruisce quella situazione senza toccare le dipendenze vere: si
//   fa finta che il binario non ci sia (copia fedele di come si comporta
//   `node_modules/electron/index.js` quando manca il file col percorso) e si
//   lancia il VERO lanciatore degli unit test su TUTTI gli unit test. Se il
//   lavoro su Windows può diventare verde, qui non c'è nessun rosso.
//
// PERCHE' TUTTI E NON SOLO I DUE CHE HO VISTO ROSSI
//   La strada che si rompe non è "quel test": è "un unit test che arriva a
//   chiedere l'app". Oggi sono due, domani ne basta uno nuovo. La prova guarda
//   la porta, non i due che ci sono passati.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QUI, '..', '..', '..');
const UNIT = join(ROOT, 'tests', 'unit');

/** Tutti gli unit test veri, a qualunque profondità. */
function unitTestVeri(cartella, dentro = []) {
  for (const voce of readdirSync(cartella, { withFileTypes: true })) {
    if (voce.name === 'node_modules' || voce.name.startsWith('.')) continue;
    const p = join(cartella, voce.name);
    if (voce.isDirectory()) unitTestVeri(p, dentro);
    else if (/\.test\.mjs$/.test(voce.name)) dentro.push(p);
  }
  return dentro;
}

/**
 * La finta assenza del binario. Copia fedele di come si comporta
 * `node_modules/electron/index.js` quando lo scaricamento è stato saltato: con
 * la variabile d'ambiente che dice dove sarebbe il binario torna un percorso,
 * senza solleva. Si carica in OGNI processo (il lanciatore e i suoi figli), così
 * anche il lanciatore vede il mondo come lo vedrebbe su quel computer.
 */
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

/**
 * Un test-ponte che importa il test vero. Il test vero resta dov'è, quindi legge
 * i suoi file con i percorsi giusti: cambia solo l'ambiente attorno.
 */
function ponte(percorsoVero) {
  return `await import(${JSON.stringify(pathToFileURL(percorsoVero).href)});\n`;
}

test('#569 giro 2: gli unit test passano anche quando il binario dell\'app non è stato scaricato', () => {
  const base = cartellaTemporanea('filo-569-senza-binario-');
  const cartellaUnit = join(base, 'unit');
  mkdirSync(cartellaUnit, { recursive: true });
  try {
    const veri = unitTestVeri(UNIT);
    assert.ok(veri.length > 50, `mi aspettavo gli unit test veri, ne ho trovati ${veri.length}`);
    for (const percorso of veri) {
      const nome = relative(UNIT, percorso).replace(/[\\/]/g, '__');
      writeFileSync(join(cartellaUnit, nome), ponte(percorso), 'utf8');
    }

    // L'ambiente di questo processo porta i segni di `node --test` (per esempio
    // NODE_TEST_CONTEXT): passati al lanciatore lo farebbero uscire subito e
    // VERDE, cioè una prova che non prova niente. Si tolgono.
    const ambiente = { ...process.env };
    delete ambiente.NODE_TEST_CONTEXT;
    delete ambiente.NODE_OPTIONS;

    const esito = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'run-unit-tests.mjs')],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 64,
        env: {
          ...ambiente,
          FILO_UNIT_DIR: cartellaUnit,
          // Le stesse condizioni del lavoro su Windows.
          ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
        },
      },
    );

    const uscita = `${esito.stdout || ''}${esito.stderr || ''}`;
    const rossi = uscita
      .split('\n')
      .filter((r) => /^not ok /.test(r))
      .map((r) => r.replace(new RegExp(cartellaUnit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<ponte>'))
      .join('\n');

    // Una corsa che non ha eseguito niente esce verde: qui il verde deve
    // valere solo se i test sono girati davvero.
    const passati = Number((/^# pass (\d+)/m.exec(uscita) || [])[1] || 0);
    assert.ok(
      passati > 1000,
      `il lanciatore ha eseguito troppo poco (${passati} test passati): la prova non ha provato niente.\n${uscita.slice(-1500)}`,
    );

    assert.equal(
      esito.status,
      0,
      'senza il binario dell\'app gli unit test non sono tutti verdi: il controllo su Windows che salta lo '
      + `scaricamento nasce rosso e non può diventare verde.\nRossi:\n${rossi || uscita.slice(-2000)}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
