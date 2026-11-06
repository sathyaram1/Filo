// Esplorazione (si cancella).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

test('debug', async ({ app }) => {
  test.setTimeout(300000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto, ecco il punto.' }]);
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__comp = [];
    C._dip.chiama = async ({ motivo }) => { globalThis.__comp.push(motivo); return JSON.stringify({ ore: [{ testo: '10:00 letto un capitolo della tesi' }], memorie: [] }); };
  });
  const righe = [];
  try {
    for (let i = 0; i < 12; i++) {
      await chiedi(page, `Capitolo ${i}: ${'Le api tornano all\'alveare e danzano per le compagne. '.repeat(330)}`);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(i + 1);
      await page.waitForTimeout(1500);
      righe.push(await app.evaluate(() => {
        const FC = globalThis.SN_FILO_CONTESTO;
        const ult = globalThis.__chatFinta_calls.at(-1);
        const tok = Math.ceil((FC.caratteriDi(ult) + JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length) / FC.CARATTERI_PER_TOKEN);
        return `req ${tok} sys ${Math.ceil(FC.caratteriDi([ult[0]]) / 3.5)} msgs ${ult.length} base ${Math.round(globalThis.SN_COMPATTAZIONE.base(false))} comp ${globalThis.__comp.length}`;
      }));
    }
  } finally {
    await ripristina(app);
    console.log(righe.join('\n'));
  }
});
