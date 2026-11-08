// Verifica #1563 giro 7: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const compattatoreFinto = (app, riga) => app.evaluate((_e, riga) => {
  const C = globalThis.SN_COMPATTAZIONE;
  globalThis.__compattazioni = [];
  globalThis.__compattatoreVero = C._dip.chiama;
  C._dip.chiama = async ({ messages, motivo }) => {
    globalThis.__compattazioni.push({ motivo, testo: messages.map((m) => m.content).join('\n') });
    return JSON.stringify({ ore: [{ testo: riga }], memorie: [] });
  };
}, riga);
const rimetti = (app) => app.evaluate(() => {
  if (globalThis.__compattatoreVero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__compattatoreVero;
});
const conSoglia = (app, soglia) => app.evaluate(async (_e, soglia) => {
  const s = await globalThis.SN_STORAGE.getSettings();
  await globalThis.SN_STORAGE.updateSettings({ contestoFilo: { ...(s.contestoFilo || {}), soglia } });
}, soglia);
const tokenDi = (app, messages) => app.evaluate((_e, messages) => {
  const FC = globalThis.SN_FILO_CONTESTO;
  return Math.ceil((FC.caratteriDi(messages) + JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length) / FC.CARATTERI_PER_TOKEN);
}, messages);

test('turni pesanti: cadenza', async ({ app }) => {
  test.setTimeout(300000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto, ecco il punto.' }]);
  await compattatoreFinto(app, '10:00 letto un capitolo della tesi');
  const per = [];
  try {
    for (let i = 0; i < 12; i++) {
      await chiedi(page, `Capitolo ${i}: ${'Le api tornano all\'alveare e danzano per le compagne. '.repeat(330)}`);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(i + 1);
      await page.waitForTimeout(1500);
      const c = await chiamateAlModello(app);
      per.push({
        i, tok: await tokenDi(app, c.at(-1)), comp: (await app.evaluate(() => globalThis.__compattazioni)).map((x) => x.motivo).join(','),
        base: await app.evaluate(() => globalThis.SN_COMPATTAZIONE.base(false)),
      });
    }
  } finally { await rimetti(app); await ripristina(app); }
  console.log('CADENZA', JSON.stringify(per));
});

test('soglia sotto la parte fissa: lo scambio di prima resta grezzo?', async ({ app, openTab }) => {
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Va bene.' }]);
  await compattatoreFinto(app, '10:00 parlato di animali');
  await conSoglia(app, 40000);
  try {
    await chiedi(page, 'la mia gatta si chiama Ofelia');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(1);
    await page.waitForTimeout(1500);
    await chiedi(page, 'come si chiama la mia gatta?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(2);
    const c = await chiamateAlModello(app);
    const comp = await app.evaluate(() => globalThis.__compattazioni.map((x) => x.motivo));
    const base = await app.evaluate(() => globalThis.SN_COMPATTAZIONE.base(false));
    console.log('SOTTO', JSON.stringify({ comp, base, tok: await tokenDi(app, c[1]), ofelia: JSON.stringify(c[1].slice(1)).includes('Ofelia') }));
    const stime = await app.evaluate((_e, base) => {
      const p = { prompt: 1e-6, completion: 5e-6, cacheRead: 1e-7 };
      return [20000, 40000, 50000, 70000].map((soglia) => ({ soglia, t: globalThis.SN_FILO_COMPATTAZIONE.stimaSoglia({ soglia, base, prezzoChat: p, prezzoCompattazione: p }).testo }));
    }, base);
    console.log('STIME', JSON.stringify(stime));
  } finally { await rimetti(app); await ripristina(app); }
});
