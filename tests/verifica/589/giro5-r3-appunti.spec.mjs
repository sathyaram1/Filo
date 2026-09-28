// Verifica #589 — giro 5, rilievo 3 (chiede una scelta). La cronologia degli
// appunti torna intera a un sito che la chiede, e dal sito si svuota. Leggerla
// serve al menu «Incolla» sulle pagine; svuotarla, dalle pagine, no.

import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'password-della-banca-G5-589';

test('un sito non svuota la cronologia degli appunti dell\'utente', async ({ app, shell }) => {
  void shell;
  await app.evaluate(async (_e, segreto) => {
    await globalThis.__filoStorage.set({ clipboardHistory: [{ id: 'g5', text: segreto, ts: Date.now() }] });
  }, SEGRETO);

  const daSito = (type) => app.evaluate(async (_e, t) => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG[t] },
    { tab: { url: 'http://sito.example/' }, url: 'http://sito.example/' },
  ), type);

  const letta = await daSito('GET_CLIPBOARD_HISTORY');
  // Qui si registra soltanto cosa torna: se la lettura resta aperta al menu è la scelta chiesta all'owner.
  test.info().annotations.push({ type: 'lettura-da-sito', description: JSON.stringify(letta).includes(SEGRETO) ? 'piena' : 'vuota' });

  await daSito('CLEAR_CLIPBOARD_HISTORY');
  const dopo = await app.evaluate(async () => (await globalThis.__filoStorage.get('clipboardHistory')).clipboardHistory || []);
  expect(
    JSON.stringify(dopo),
    'un sito ha svuotato la cronologia degli appunti dell\'utente',
  ).toContain(SEGRETO);
});
