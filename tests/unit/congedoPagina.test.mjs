// Chiudere una scheda distrugge la view senza che la pagina veda `pagehide`:
// chi rimanda il salvataggio perdeva l'ultima modifica. Filo avvisa la pagina e
// aspetta la sua risposta, ma non si fa mai bloccare da una pagina che tace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Finto `electron`: il modulo vuole solo ipcMain.on/removeListener.
const ascoltatori = new Map();
const ipcMain = {
  on: (canale, fn) => {
    if (!ascoltatori.has(canale)) ascoltatori.set(canale, new Set());
    ascoltatori.get(canale).add(fn);
  },
  removeListener: (canale, fn) => { ascoltatori.get(canale)?.delete(fn); },
};
function rispondi(canale, sender) {
  for (const fn of [...(ascoltatori.get(canale) || [])]) fn({ sender });
}

const Module = require('node:module');
const caricaVero = Module._load;
Module._load = function (richiesta, ...resto) {
  if (richiesta === 'electron') return { ipcMain };
  return caricaVero.call(this, richiesta, ...resto);
};
const { congedaPagina, CANALE_AVVISO, CANALE_RISPOSTA } =
  require(join(__dirname, '..', '..', 'src', 'main', 'congedo.js'));
Module._load = caricaVero;

function fintaPagina() {
  const inviati = [];
  return { inviati, isDestroyed: () => false, send: (c) => inviati.push(c) };
}

test('la pagina viene avvisata e la sua risposta sblocca subito la chiusura', async () => {
  const wc = fintaPagina();
  const attesa = congedaPagina(wc, { tetto: 5000 });
  assert.deepEqual(wc.inviati, [CANALE_AVVISO]);
  rispondi(CANALE_RISPOSTA, wc);
  await attesa;
  assert.equal(ascoltatori.get(CANALE_RISPOSTA)?.size || 0, 0, 'ascoltatore non rimosso');
});

test('la risposta di un\'altra pagina non conta', async () => {
  const mia = fintaPagina();
  const altra = fintaPagina();
  const attesa = congedaPagina(mia, { tetto: 200 });
  rispondi(CANALE_RISPOSTA, altra);
  const esito = await Promise.race([attesa.then(() => 'chiusa'), new Promise((r) => setTimeout(() => r('ancora'), 50))]);
  assert.equal(esito, 'ancora');
  await attesa;
});

test('una pagina che tace non blocca la chiusura', async () => {
  const wc = fintaPagina();
  await congedaPagina(wc, { tetto: 30 });
});

test('una pagina già distrutta non fa aspettare nessuno', async () => {
  await congedaPagina({ isDestroyed: () => true, send: () => { throw new Error('mai'); } }, { tetto: 5000 });
  await congedaPagina(null, { tetto: 5000 });
});
