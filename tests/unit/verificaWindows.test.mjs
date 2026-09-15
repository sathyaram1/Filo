// Sentinella sul lavoro «Verifica unit su Windows» (#569).
//
// PERCHE' ESISTE
//   Gli unit test girano su Windows in due posti: il cancello della
//   pubblicazione e questo lavoro, che li anticipa su ogni ramo. Il secondo ha
//   senso solo finché rispecchia il primo: stesso sistema, stessa versione di
//   Node, stesso comando. Se divergono, il lavoro diventa un semaforo che dice
//   verde su una cosa diversa da quella che poi ferma la pubblicazione, ed è
//   peggio che non averlo.
//
//   Tiene insieme anche la rinuncia al binario di Electron con ciò che la rende
//   possibile: gli unit test non aprono Filo, ma alcuni caricano i sorgenti
//   dell'app, e un sorgente dell'app chiede quel modulo appena viene caricato.
//   Chi salta lo scaricamento deve quindi compensarne l'assenza, altrimenti il
//   lavoro nasce rosso e resta rosso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leggiTestoRepo } from '../helpers/testo.mjs';
import { ambienteDeiTest } from '../../scripts/run-unit-tests.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const LAVORO = leggiTestoRepo(join(ROOT, '.github', 'workflows', 'verifica-windows.yml'));
const CANCELLO = leggiTestoRepo(join(ROOT, '.github', 'workflows', 'release.yml'));

test('gira sullo stesso sistema e sulla stessa versione di Node del cancello', () => {
  assert.match(LAVORO, /runs-on:\s*windows-latest/, 'il cancello fa gli unit su Windows: qui devono girare sullo stesso sistema');
  const nodeLavoro = /node-version:\s*(\S+)/.exec(LAVORO);
  const nodeCancello = /node-version:\s*(\S+)/.exec(CANCELLO);
  assert.ok(nodeLavoro && nodeCancello, 'tutti e due devono fissare la versione di Node');
  assert.equal(
    nodeLavoro[1],
    nodeCancello[1],
    'stessa versione di Node del cancello: con una diversa questo lavoro direbbe verde su una macchina che non è quella che pubblica',
  );
});

test('lancia lo stesso comando del cancello', () => {
  assert.match(LAVORO, /npm run test:unit/, 'deve lanciare gli unit test, come il cancello');
});

test('non scarica il binario di Electron, perché gli unit test non aprono Filo', () => {
  assert.match(
    LAVORO,
    /ELECTRON_SKIP_BINARY_DOWNLOAD:\s*1/,
    'senza questa riga ogni partenza scarica l\'app (263 MB aperta) per non usarla mai',
  );

  // L'altra metà della promessa, e quella che conta davvero.
  //
  // Per un giro questa metà è stata un elenco di unit test che chiedono
  // `electron` per nome: verde, mentre il lavoro su Windows era rosso a ogni
  // partenza. I due test che morivano non nominavano `electron`: caricavano un
  // SORGENTE dell'app, ed era il sorgente a chiederlo. Due estremi verdi e il
  // pezzo in mezzo scoperto (patterns/due-estremi-verdi-non-fanno-un-filo.md).
  //
  // Adesso la promessa la mantiene il lanciatore: se il modulo non risponde,
  // gli dice dove sarebbe stato il binario, e chi voleva solo leggere il
  // sorgente gira lo stesso. Il comportamento è provato in
  // tests/unit/unitSenzaBinario.test.mjs, sui test veri; qui si tiene fermo che
  // la rinuncia allo scaricamento e la sua compensazione restino insieme.
  assert.equal(
    ambienteDeiTest({}, { scaricato: false, root: '/repo' }).ELECTRON_OVERRIDE_DIST_PATH,
    join('/repo', 'node_modules', 'electron', 'dist'),
    'il lavoro su Windows salta lo scaricamento dell\'app, ma il lanciatore degli unit test non compensa più '
    + 'la sua assenza: ogni unit test che carica un sorgente dell\'app tornerà rosso su quel computer, e solo lì',
  );
});
