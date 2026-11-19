// Verifica #1664 giro 1, rilievo 2: sull'Aiuto di un sito l'utente dà un'immagine e chiede di mandarla come
// segnalazione; l'immagine deve arrivare con la segnalazione. Risposta dell'Aiuto finta, deposito finto.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { neiRiquadri, paginaDellAiuto } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head>'
  + '<body style="margin:0;height:100vh;font:16px sans-serif"><p>Una pagina che i file non li vuole.</p></body></html>';

async function lascia(page, files) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 200, y: 200, data });
  await s.detach().catch(() => {});
}

test('r2 l’immagine data all’Aiuto parte con la segnalazione che l’Aiuto prepara', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const foto = join(cartellaInCasa('filo-1664-aiuto-'), 'schermata.png');
  writeFileSync(foto, PNG);
  await app.evaluate(() => {
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__submitVero = FB.submit;
    globalThis.__depositati = [];
    FB.submit = async (p) => { globalThis.__depositati.push(JSON.parse(JSON.stringify(p))); return { id: 'fb-1' }; };
  });
  const page = await testServer.openReady(openTab, SITO);
  await lascia(page, [foto]);
  await expect.poll(() => neiRiquadri(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length), { timeout: 8_000 }).toBe(1);
  const A = await paginaDellAiuto(app, page);
  await neiRiquadri(app, page, () => {
    globalThis.SN_CONFIRM_UI = { confirm: async () => true, confirmTyped: async () => true };
    const risposta = {
      action: 'filo',
      filo: { type: 'INVIA_FEEDBACK', titolo: 'Menu tagliato', testo: 'Il menu del sito esce dallo schermo.', allegati: ['1'] },
      text: 'Preparo la segnalazione con la tua immagine.',
    };
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
        return Promise.resolve({ ok: true, text: JSON.stringify(risposta) });
      }
      return orig(m, ...r);
    };
    return 1;
  });
  await A.keyboard.type('manda questa immagine come segnalazione');
  await A.keyboard.press('Enter');

  await expect.poll(async () => (await app.evaluate(() => globalThis.__depositati || [])).length, { timeout: 20_000 }).toBe(1);
  const [p] = await app.evaluate(() => globalThis.__depositati);
  expect(p.text).toContain('Il menu del sito esce dallo schermo.');
  expect(p.images || [], 'l’immagine data all’Aiuto parte con la segnalazione').toHaveLength(1);
  await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
});
