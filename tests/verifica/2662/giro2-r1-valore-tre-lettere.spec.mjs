// Verifica #2662 giro 2, rilievo 1: nella riga del cambio il riquadro cede lo spazio alle parole di Filo che lo seguono
// (provenienza, altri cambi), che poi vengono tagliate lo stesso: del valore restano una o tre lettere, meno che sul main.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const STILE = 'Rispondi in modo breve, diretto e senza giri di parole, dammi del tu';

// Quante lettere del valore si leggono davvero nella riga, col riquadro o senza (sul main il valore era testo piatto):
// una lettera conta se sta dentro ogni antenato che taglia, con un posto in meno per i puntini.
const visto = (riga, inizio) => riga.evaluate((r, inizio) => {
  const t = r.querySelector('.dash-cambio-testo');
  const nodi = [];
  const giro = (n) => { for (const c of n.childNodes) if (c.nodeType === 3) nodi.push(c); else giro(c); };
  giro(t);
  let testo = '';
  const pos = [];
  for (const n of nodi) for (let i = 0; i < n.textContent.length; i++) { pos.push([n, i]); testo += n.textContent[i]; }
  const da = testo.indexOf(inizio);
  if (da < 0) return 0;
  let viste = 0;
  for (let k = da; k < pos.length; k++) {
    const [n, i] = pos[k];
    const range = document.createRange();
    range.setStart(n, i); range.setEnd(n, i + 1);
    const b = range.getBoundingClientRect();
    let dentro = true;
    for (let a = n.parentElement; a && a !== r.parentElement; a = a.parentElement) {
      if (getComputedStyle(a).overflowX === 'visible') continue;
      if (b.right > a.getBoundingClientRect().right + 0.5) { dentro = false; break; }
    }
    if (!dentro) break;
    viste++;
  }
  return Math.max(0, viste - 1);
}, inizio);

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

test('r1 con tre valori cambiati insieme il primo si legge', async ({ app }) => {
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
});
