// Verifica #1563 giro 4: con turni pesanti (circa 5.000 token l'uno, un capitolo incollato a ogni messaggio) una
// compattazione lascia spazio sotto la soglia: i due messaggi dopo non ne chiedono un'altra, e al più una risposta aspetta.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

test('r2 turni da circa 5.000 token: la chat non compatta a ogni messaggio prima di rispondere', async ({ app }) => {
  test.setTimeout(300000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto, ecco il punto.' }]);
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__comp = [];
    globalThis.__compVero = C._dip.chiama;
    C._dip.chiama = async ({ motivo }) => { globalThis.__comp.push(motivo); return JSON.stringify({ ore: [{ testo: '10:00 letto un capitolo della tesi' }], memorie: [] }); };
  });
  const perMessaggio = [];
  try {
    for (let i = 0; i < 12; i++) {
      const testo = `Capitolo ${i}: ${'Le api tornano all\'alveare e danzano per le compagne. '.repeat(330)}`;
      await chiedi(page, testo);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(i + 1);
      // La compattazione in anticipo parte dopo la risposta: le si dà il tempo di finire.
      await page.waitForTimeout(1500);
      perMessaggio.push(await app.evaluate(() => globalThis.__comp.slice()));
    }
  } finally {
    await app.evaluate(() => { if (globalThis.__compVero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__compVero; });
    await ripristina(app);
  }
  const nuove = perMessaggio.map((c, i) => c.slice(i ? perMessaggio[i - 1].length : 0));
  const conCompattazione = nuove.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
  expect(conCompattazione.length, 'la chat compatta, a un certo punto').toBeGreaterThan(0);
  for (const i of conCompattazione) {
    expect(conCompattazione.includes(i + 1) || conCompattazione.includes(i + 2),
      `dopo la compattazione del messaggio ${i} ne arriva un'altra subito (per messaggio: ${JSON.stringify(nuove)})`).toBe(false);
  }
  const bloccanti = nuove.flat().filter((m) => m === 'soglia').length;
  expect(bloccanti, `risposte che aspettano una compattazione (per messaggio: ${JSON.stringify(nuove)})`).toBeLessThanOrEqual(1);
});
