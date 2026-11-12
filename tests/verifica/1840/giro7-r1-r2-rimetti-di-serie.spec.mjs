// Verifica #1840 giro 7. r1: «rimetti tutte le impostazioni di serie» che riaccende soltanto una protezione spenta conta
// come togliere un freno, e dopo una lettura riceve il no. r2: il no dopo una lettura a un «rimetti com'era» che allenta,
// o al ripristino di serie, non dice dove farlo a mano, come promette la frase sotto i livelli.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const exec = (app, action, opts = {}) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const ricerca = { type: 'CERCA_WEB', query: 'frigoriferi', _output: { results: [{ url: 'https://negozio.example/', title: 'Frigo', snippet: 'testo' }] } };
const STRADA = /Preferenze|Sicurezza|filo:\/\//i;

// Tutto di serie, tranne il blocco dei popup che l'utente ha spento: rimettere di serie lo riaccende e basta.
async function diSerieConPopupSpenti(app) {
  await app.evaluate(async () => {
    const correnti = await globalThis.SN_STORAGE.getSettings();
    const serie = globalThis.SN_PULSANTI_PREFERENZE.impostazioniDiSerie(correnti);
    await globalThis.SN_STORAGE.updateSettings({ ...serie, autonomia: { livello: 'default' } });
    const s = (await globalThis.SN_STORAGE.getSettings()).security || {};
    await globalThis.SN_STORAGE.updateSettings({ security: { ...s, blockPopups: false } });
  });
}

test('r1 dopo una ricerca, rimettere di serie quando riaccende solo il blocco dei popup non è un no', async ({ app }) => {
  await home(app);
  await diSerieConPopupSpenti(app);
  const r = await exec(app, { type: 'PULSANTE_PREFERENZE', pulsante: 'ripristina_tutto' }, { contesto: [ricerca], richiesta: 'rimetti tutte le impostazioni di serie' });
  expect(r.no, `riaccendere una protezione stringe un freno: ${JSON.stringify(r).slice(0, 400)}`).toBeFalsy();
  expect(r.needsConfirm, 'chiede come gli altri cambi di sicurezza dopo una lettura').toBeTruthy();
});

test('r2 il no dopo una lettura a «rimetti com\'era» che spegne una protezione dice dove farlo a mano', async ({ app }) => {
  await home(app);
  await diSerieConPopupSpenti(app);
  expect((await exec(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'blocco_popup', valore: 'sì' })).executed).toBe(true);
  const r = await exec(app, { type: 'ANNULLA_CAMBIO' }, { contesto: [ricerca], richiesta: 'annulla' });
  expect(r.no, JSON.stringify(r).slice(0, 300)).toBe(true);
  expect(String(r.error || ''), 'la strada a mano, come per le altre impostazioni').toMatch(STRADA);
});
