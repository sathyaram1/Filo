// Verifica #2662 giro 2, rilievo 1: nella riga del cambio il riquadro cede lo spazio alle parole di Filo che lo seguono
// (provenienza, altri cambi), che poi vengono tagliate lo stesso: del valore restano una o tre lettere, meno che sul main.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const STILE = 'Rispondi in modo breve, diretto e senza giri di parole, dammi del tu';

// Quanto del riquadro si vede davvero dentro la riga (in pixel CSS).
const visto = (riga) => riga.evaluate((r) => {
  const t = r.querySelector('.dash-cambio-testo').getBoundingClientRect();
  const q = r.querySelector('.dash-cambio-testo .dash-altrui');
  if (!q) return 0;
  const b = q.getBoundingClientRect();
  return Math.round(Math.max(0, Math.min(t.right, b.right) - b.left));
});

test('r1 il valore di una frase si legge nella riga del cambio almeno quanto prima del lavoro', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ agentStyle: v }), STILE);
  const nata = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(nata).toBeVisible({ timeout: 10_000 });
  const riga = page.locator(`.dash-cambio[data-id="${await nata.getAttribute('data-id')}"]`);
  await riga.scrollIntoViewIfNeeded();
  await riga.screenshot({ path: 'tests/.shots/v2662g2-r1-ferma.png' });
  // Sul main la stessa riga diceva «stile dell'agente: «Rispondi in …»: una decina di lettere del valore, circa 60 pixel.
  expect(await visto(riga), 'riga ferma: del valore si leggono le prime parole').toBeGreaterThanOrEqual(55);
});

test('r1 con tre valori cambiati insieme il primo si legge, e la riga non si tronca a metà parola senza puntini', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const tts = await app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.tts || {}));
  await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({
    agentStyle: 'Rispondi in modo breve e diretto, dammi del tu sempre',
    tts: { ...t, voice: 'Microsoft Elsa Online Natural Italian Italy', modelVoice: 'voce calda numero sette' },
  }), tts);
  const nata = page.locator('.dash-cambio', { hasText: 'voce naturale' }).last();
  await expect(nata).toBeVisible({ timeout: 10_000 });
  const riga = page.locator(`.dash-cambio[data-id="${await nata.getAttribute('data-id')}"]`);
  await riga.scrollIntoViewIfNeeded();
  await riga.screenshot({ path: 'tests/.shots/v2662g2-r1-tre-valori.png' });
  expect(await visto(riga), 'il primo valore si legge').toBeGreaterThanOrEqual(55);
  // Quello che non ci sta finisce coi puntini, come ogni riga tagliata di Filo: il contenitore ne è capace solo se non è
  // un contenitore flessibile, o se l'ultimo pezzo visibile li porta lui.
  const taglio = await riga.evaluate((r) => {
    const t = r.querySelector('.dash-cambio-testo');
    return { tagliata: t.scrollWidth > t.clientWidth + 1, puntini: getComputedStyle(t).display !== 'flex' };
  });
  if (taglio.tagliata) expect(taglio.puntini, 'la riga tagliata finisce coi puntini').toBe(true);
});
