// Esplorazione: «dimentica» semplice a Conservativo dopo una lettura, con l'OK dato, nasconde davvero la riga.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const ricercaFatta = { type: 'CERCA_WEB', query: 'meteo', _output: { results: [{ url: 'https://meteo.example/', title: 'Meteo', snippet: 'sole' }] } };
const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('Conservativo: dimentica dopo una ricerca, confermato, nasconde la riga e si rimette', async ({ app }) => {
  await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Bologna.\nHa un gatto.', PREFERENZE: '' }));
  const r = await execAction(app, { type: 'DIMENTICA', testo: 'Bologna' }, { contesto: [ricercaFatta], confirmed: true });
  expect(r.executed).toBe(true);
  const nascoste = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.quaderno()).nascoste.map((n) => n.testo));
  expect(nascoste).toEqual(['Vive a Bologna.']);
  const mem = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()));
  expect(mem).not.toContain('Bologna');
  expect(mem).toContain('gatto');
  // Vuoto: niente da dimenticare, non esegue nulla di strano.
  const vuoto = await execAction(app, { type: 'DIMENTICA', testo: '   ' }, { contesto: [ricercaFatta], confirmed: true });
  expect(vuoto.executed === true && vuoto.output && vuoto.output.error).toBeFalsy();
});
