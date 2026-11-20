// Sonda temporanea: cancellazione di una chat con foto.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, preparaImmagini, stubModello, chiedi } from './aiuti.mjs';

test('sonda', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaImmagini(app, 2);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1]]' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(2, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const r = await app.evaluate(async () => {
    const out = {};
    const C = globalThis.__filoCopieIcone;
    const chats = await globalThis.SN_FILO_CHATS.list({ nascoste: true });
    const chat = chats.find((c) => (c.messages || []).some((m) => Array.isArray(m.immagini) && m.immagini.length));
    out.prima = chats.map((c) => c.id);
    out.copie = globalThis.SN_IMMAGINI_RISPOSTA.copieDi(chat.messages);
    const orig = C.togliSeOrfane;
    try {
      await globalThis.SN_FILO_CHATS.remove(chat.id);
    } catch (e) { out.err = e.message; }
    out.dopo = (await globalThis.SN_FILO_CHATS.list({ nascoste: true })).map((c) => c.id + ':' + globalThis.SN_IMMAGINI_RISPOSTA.copieDi(c.messages).length);
    out.chat = chat.id;
    return out;
  });
  console.log('SONDA', JSON.stringify(r));
  await page.waitForTimeout(3000);
  const r2 = await app.evaluate(async (_e, copie) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const C = globalThis.__filoCopieIcone;
    const esiste = () => copie.map((s) => fs.existsSync(path.join(C.cartella(), C.nomeDa(s))));
    const out = { dopoRemove: esiste() };
    C.togliSeOrfane(copie);
    await new Promise((r) => setTimeout(r, 300));
    await C.togliSeOrfane([]);
    await new Promise((r) => setTimeout(r, 1500));
    out.dopoManuale = esiste();
    return out;
  }, r.copie);
  console.log('SONDA2', JSON.stringify(r2));
});
