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
//   Tiene insieme anche la rinuncia al binario di Electron: gli unit test non
//   aprono Filo, quindi non serve scaricarlo. Il giorno in cui un unit test
//   avesse bisogno del binario, questa sentinella lo dice invece di lasciare un
//   rosso incomprensibile su una macchina sola.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leggiTestoRepo } from '../helpers/testo.mjs';

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

  // L'altra metà della promessa: se un unit test cominciasse davvero ad aprire
  // Filo, saltare lo scaricamento lo farebbe morire sul runner e basta.
  const colpevoli = [];
  for (const nome of readdirSync(join(ROOT, 'tests', 'unit'))) {
    if (!nome.endsWith('.mjs')) continue;
    const sorgente = leggiTestoRepo(join(ROOT, 'tests', 'unit', nome));
    if (/^\s*import[^\n]*from\s*'electron'/m.test(sorgente) || /require\(\s*'electron'\s*\)/.test(sorgente)) {
      colpevoli.push(nome);
    }
  }
  assert.deepEqual(
    colpevoli,
    [],
    'questi unit test vogliono Electron: o tornano logica pura, o il lavoro su Windows deve ricominciare a scaricare il binario',
  );
});
