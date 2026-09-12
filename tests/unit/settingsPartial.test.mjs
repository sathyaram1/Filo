// #592 (giro 3) — una pagina di impostazioni deve poter dire "ho toccato
// QUESTA manopola", non "ecco tutto il blocco com'era quando mi hai aperto".
//
// Il danno che questo controllo tiene chiuso: con la pagina Preferenze aperta
// spegni la modalità terminale parlando con Filo, poi cambi la shell in quella
// pagina e il permesso della shell torna acceso. Stessa cosa con le due chiavi
// API, con velocità e tono della voce, col rilevamento dei siti pericolosi e
// con la gestione dei cookie: ogni volta il colpevole era il confronto fermo al
// GRUPPO invece che al singolo valore.
//
// Senza il confronto profondo questi test sono rossi: il gruppo intero
// risulterebbe "cambiato" e tornerebbe indietro col fratello vecchio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// storage.js si appoggia a chrome.storage solo dentro le funzioni async: per
// partialCambiato basta caricarlo.
globalThis.chrome = globalThis.chrome || { storage: { local: {} } };
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'storage.js'));

const S = globalThis.SN_STORAGE;

test('niente di cambiato, niente da mandare', () => {
  const stato = { theme: 'dark', terminal: { enabled: true, shell: 'powershell' } };
  assert.deepEqual(S.partialCambiato(stato, JSON.parse(JSON.stringify(stato))), {});
});

test('la shell cambiata non si porta dietro il permesso della shell', () => {
  const prima = { terminal: { enabled: true, shell: 'powershell' } };
  const adesso = { terminal: { enabled: true, shell: 'bash' } };
  assert.deepEqual(S.partialCambiato(prima, adesso), { terminal: { shell: 'bash' } });
});

test('la chiave Tavily cambiata non si porta dietro la chiave OpenRouter', () => {
  const prima = { apiKeys: { openrouter: 'sk-vecchia', tavily: '' } };
  const adesso = { apiKeys: { openrouter: 'sk-vecchia', tavily: 'tvly-nuova' } };
  assert.deepEqual(S.partialCambiato(prima, adesso), { apiKeys: { tavily: 'tvly-nuova' } });
});

test('il tono della voce cambiato non si porta dietro la velocità', () => {
  const prima = { tts: { voice: 'a', rate: 1, pitch: 1 } };
  const adesso = { tts: { voice: 'a', rate: 1, pitch: 1.2 } };
  assert.deepEqual(S.partialCambiato(prima, adesso), { tts: { pitch: 1.2 } });
});

test('una sotto-opzione del rilevamento non si porta dietro l’interruttore', () => {
  const prima = { security: { safeBrowse: { enabled: true, llmJudge: false, sandbox: true } } };
  const adesso = { security: { safeBrowse: { enabled: true, llmJudge: true, sandbox: true } } };
  assert.deepEqual(S.partialCambiato(prima, adesso), { security: { safeBrowse: { llmJudge: true } } });
});

test('un sito fidato aggiunto non si porta dietro la modalità cookie', () => {
  const prima = { mode: 'privacy', trustedSites: [] };
  const adesso = { mode: 'privacy', trustedSites: ['esempio.it'] };
  assert.deepEqual(S.partialCambiato(prima, adesso), { trustedSites: ['esempio.it'] });
});

test('una lista è un valore solo: cambia, e va intera', () => {
  const prima = { security: { siteBlock: { enabled: true, blacklist: ['a.it', 'b.it'] } } };
  const adesso = { security: { siteBlock: { enabled: true, blacklist: ['a.it'] } } };
  assert.deepEqual(S.partialCambiato(prima, adesso), { security: { siteBlock: { blacklist: ['a.it'] } } });
});

test('le mappe che si sostituiscono intere non si spezzettano', () => {
  // Il loro contratto è "questa è la lista completa, chi manca è stato
  // rimosso": mandarne un pezzo cancellerebbe il resto.
  for (const chiave of S.REPLACE_KEYS) {
    const prima = { [chiave]: { uno: { x: 1 }, due: { x: 2 } } };
    const adesso = { [chiave]: { uno: { x: 9 } } };
    assert.deepEqual(S.partialCambiato(prima, adesso), { [chiave]: { uno: { x: 9 } } },
      `${chiave} deve viaggiare intera`);
  }
});

test('un gruppo che prima non c’era si manda intero', () => {
  const adesso = { terminal: { enabled: false, shell: 'sh' } };
  assert.deepEqual(S.partialCambiato({}, adesso), { terminal: { enabled: false, shell: 'sh' } });
});

test('quello che il confronto produce, rimesso dentro, dà lo stato mostrato', () => {
  // Il pezzo mandato più quello che c’è già deve fare esattamente quello che la
  // pagina mostra, per la parte che l’utente ha toccato.
  const inMemoria = { terminal: { enabled: false, shell: 'powershell' }, theme: 'light' };
  const mostrato = { terminal: { enabled: false, shell: 'bash' }, theme: 'light' };
  const pezzo = S.partialCambiato(inMemoria, mostrato);
  assert.deepEqual(S.deepMerge(inMemoria, pezzo), mostrato);
});
