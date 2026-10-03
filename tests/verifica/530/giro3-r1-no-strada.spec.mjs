// Verifica #530 giro 3, rilievo 1: un «no» della tabella (Conservativo, dopo una lettura) non è un «no» dell'elenco
// fisso: non deve dire che Filo non lo fa a nessun livello, e deve lasciare all'utente la strada vera.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const ricercaFatta = { type: 'CERCA_WEB', query: 'meteo', _output: { results: [{ url: 'https://meteo.example/', title: 'Meteo', snippet: 'sole' }] } };
const comando = { type: 'ESEGUI_COMANDO', comando: 'rm prova-inesistente-530.txt' };

async function conservativo(app) {
  await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' }, terminal: { enabled: true } }));
}

function nonMente(r) {
  expect(r.executed).toBe(false);
  // A Normale lo stesso comando si fa con «conferma»: dire «a nessun livello» è falso e chiude la strada.
  expect(String(r.error || '')).not.toMatch(/nessun livello|elenco fisso/);
  expect(String((r.output || {}).error || '')).not.toMatch(/fra le cose che Filo non fa/);
  expect(String(r.error || '')).toMatch(/Preferenze|autonomia/i);
}

test('chat: dopo una ricerca, a Conservativo, il no di un comando che cancella dice la strada vera', async ({ app }) => {
  await conservativo(app);
  nonMente(await execAction(app, comando, { contesto: [ricercaFatta] }));
});

