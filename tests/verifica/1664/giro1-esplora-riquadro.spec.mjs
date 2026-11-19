// Verifica #1664 giro 1, esplorazione dell'Aiuto: si cancella prima della critica.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { neiRiquadri, paginaDellAiuto } from '../../helpers/riquadri.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SITO = '<!doctype html><html><head><meta charset="utf-8"><title>Sito</title></head><body><p>Pagina.</p></body></html>';

async function lascia(page, files) {
  const s = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 200, y: 200, data });
  await s.detach().catch(() => {});
}

for (const conAllegati of [true, false]) {
  test(`diagnosi Aiuto ${conAllegati ? 'con' : 'senza'} allegati`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const foto = join(cartellaInCasa('filo-1664-d-'), 'schermata.png');
    writeFileSync(foto, PNG);
    await app.evaluate(() => {
      globalThis.__depositati = [];
      globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__depositati.push(JSON.parse(JSON.stringify(p))); return { id: 'fb-1' }; };
    });
    const page = await testServer.openReady(openTab, SITO);
    await lascia(page, [foto]);
    await expect.poll(() => neiRiquadri(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length), { timeout: 8_000 }).toBe(1);
    const A = await paginaDellAiuto(app, page);
    await neiRiquadri(app, page, (conAllegati) => {
      globalThis.__diag = { conferme: [], msg: [] };
      globalThis.SN_CONFIRM_UI = { confirm: async (o) => { globalThis.__diag.conferme.push(String(o && o.text)); return true; }, confirmTyped: async () => true };
      const filo = { type: 'INVIA_FEEDBACK', titolo: 'Menu tagliato', testo: 'Il menu esce.' };
      if (conAllegati) filo.allegati = ['1'];
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (m, ...r) => {
        if (m && m.type === globalThis.SN_MSG.MSG.AI_REQUEST && m.action === globalThis.SN_CONST.ACTIONS.HELP) {
          globalThis.__diag.msg.push('AI');
          return { ok: true, text: JSON.stringify({ action: 'filo', filo, text: 'Ok.' }) };
        }
        const res = await orig(m, ...r);
        if (m && /FILO|filo/.test(String(m.type))) globalThis.__diag.msg.push(`${m.type} -> ${JSON.stringify(res).slice(0, 300)}`);
        return res;
      };
      return 1;
    }, conAllegati);
    await A.keyboard.type('manda questa immagine come segnalazione');
    await A.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 8000));
    const diag = await neiRiquadri(app, page, () => ({ ...globalThis.__diag, log: (document.querySelector('.sn-sidebar') || document.body).innerText.slice(-800) }));
    console.log('DIAG', conAllegati, JSON.stringify(diag));
    console.log('DEPOSITATI', JSON.stringify(await app.evaluate(() => (globalThis.__depositati || []).map((p) => ({ text: p.text, images: (p.images || []).length })))));
  });
}
