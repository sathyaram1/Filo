// Esplorazione (si cancella): quante compattazioni fa una chat di turni pesanti, uno dopo l'altro.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

test('turni da circa 5.000 token: compattazioni per messaggio', async ({ app }) => {
  test.setTimeout(300000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto, ecco il punto.' }]);
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__comp = [];
    C._dip.chiama = async ({ motivo }) => { globalThis.__comp.push(motivo); return JSON.stringify({ ore: [{ testo: '10:00 letto un capitolo' }], memorie: [] }); };
  });
  const righe = [];
  try {
    for (let i = 0; i < 12; i++) {
      const testo = `Capitolo ${i}: ${'Le api tornano all\'alveare e danzano per le compagne. '.repeat(330)}`;
      await chiedi(page, testo);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(i + 1);
      // La compattazione in anticipo parte dopo la risposta: le si dà il tempo di finire.
      await page.waitForTimeout(1500);
      const r = await app.evaluate(() => {
        const FC = globalThis.SN_FILO_CONTESTO;
        const calls = globalThis.__chatFinta_calls;
        const ult = calls[calls.length - 1];
        return { comp: globalThis.__comp.slice(), token: Math.ceil((FC.caratteriDi(ult) + JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length) / FC.CARATTERI_PER_TOKEN) };
      });
      righe.push(`${i}: richiesta ${r.token} token, compattazioni ${r.comp.length} (${r.comp.join(',')})`);
    }
  } finally {
    await ripristina(app);
    console.log(righe.join('\n'));
  }
});
