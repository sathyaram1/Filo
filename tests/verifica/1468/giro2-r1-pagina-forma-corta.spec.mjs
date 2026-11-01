// Verifica #1468 giro 2, rilievo 1: una pagina di Filo aperta col suo indirizzo corto (filo://preferences/, che carica
// le Preferenze come l'indirizzo intero) deve contare come quella pagina, non come «altro».

import { test, expect } from '../../fixtures/electron.mjs';

const strade = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`) || !ora.strade) continue;
    for (const [m, conti] of Object.entries(ora.strade)) {
      for (const [chiave, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[chiave] = ((out[m] || {})[chiave] || 0) + n;
    }
  }
  return out;
});
const voce = async (app, misura, chiave) => ((await strade(app))[misura] || {})[chiave] || 0;

test('r1 le Preferenze e i Modelli aperti dalla chat col loro indirizzo corto contano come quelle pagine', async ({ app, openTab }) => {
  const home = await openTab('filo://newtab/');
  const r = await home.evaluate(() => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'NAVIGA', url: 'filo://preferences/', etichetta: 'Preferenze' },
  }));
  expect(r.ok).toBe(true);
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://preferences/'))).toBe(true);
  await expect.poll(() => voce(app, 'pagina_di_filo_aperta', 'preferences:chat'), { timeout: 5000 }).toBe(1);

  const r2 = await home.evaluate(() => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'NAVIGA', url: 'filo://options/', etichetta: 'Modelli' },
  }));
  expect(r2.ok).toBe(true);
  await expect.poll(() => voce(app, 'pagina_di_filo_aperta', 'options:chat'), { timeout: 5000 }).toBe(1);
  expect(await voce(app, 'via_azione', 'openOptions:chat')).toBe(1);
});
