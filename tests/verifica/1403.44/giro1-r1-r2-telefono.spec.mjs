// #1403.44 giro 1: il codice del proprio telefono scritto in chat non arriva al modello nelle forme comuni (r1), e un
// identificativo del telefono («serial code») arriva intero (r2).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

async function mandatoPer(app, testo) {
  const h = await home(app);
  const prima = (await chiamateAlModello(app)).length;
  await chiedi(h, testo);
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 20_000 }).toBeGreaterThan(prima);
  const chiamate = await chiamateAlModello(app);
  const ultimo = chiamate[chiamate.length - 1].filter((m) => m.role === 'user').pop();
  return JSON.stringify(ultimo);
}

test('r1 il codice del mio telefono scritto in chat nelle forme comuni non arriva al modello', async ({ app }) => {
  test.setTimeout(180_000);
  await modelloFinto(app, [{ text: 'Ricevuto.' }]);
  const fughe = [];
  for (const [frase, codice] of [
    ['Il codice del mio telefono è 5100', '5100'],
    ['The code to my phone is 5101', '5101'],
    ['Il codice per il mio telefono è 5102', '5102'],
    ['il codice del mio telefono è: 5103', '5103'],
    ["Le code de mon téléphone, c'est 5104", '5104'],
    ['My phone code is now 5105', '5105'],
    ['il codice del mio telefono e 5106', '5106'],
    ['Le code de mon tél est 5107', '5107'],
    ['Mein Handycode ist 5108', '5108'],
  ]) {
    const mandato = await mandatoPer(app, frase);
    expect(mandato, `la frase «${frase}» è arrivata al modello`).toContain(frase.slice(0, 12));
    if (mandato.includes(codice)) fughe.push(frase);
  }
  await ripristina(app);
  expect(fughe, 'frasi il cui codice è arrivato al modello').toEqual([]);
});

test('r2 un identificativo del mio telefono scritto in inglese arriva intero al modello', async ({ app }) => {
  test.setTimeout(120_000);
  await modelloFinto(app, [{ text: 'Ricevuto.' }]);
  const tolti = [];
  for (const frase of ['The serial code of my phone is 5200', 'The IMEI code of my phone is 5201', 'The product code of my phone is 5202']) {
    const mandato = await mandatoPer(app, frase);
    if (!mandato.includes(frase)) tolti.push(frase);
  }
  await ripristina(app);
  expect(tolti, 'identificativi tolti prima del modello').toEqual([]);
});
