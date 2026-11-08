// Verifica #1563 giro 7, rilievo 1: la soglia conta anche la parte fissa della richiesta (~43.000 token), così sopra di
// lei resta poco spazio (turni pesanti: una compattazione ogni due messaggi) o nessuno (soglia sotto la parte fissa).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const compattatoreFinto = (app, riga) => app.evaluate((_e, riga) => {
  const C = globalThis.SN_COMPATTAZIONE;
  globalThis.__compattazioni = [];
  globalThis.__compattatoreVero = C._dip.chiama;
  C._dip.chiama = async ({ messages, motivo }) => {
    globalThis.__compattazioni.push({ motivo });
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

test('r1 con la soglia a 40.000 la risposta non aspetta una compattazione e lo scambio di prima arriva intero', async ({ app }) => {
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
    const seconda = (await chiamateAlModello(app))[1];
    expect(JSON.stringify(seconda.slice(1)), 'il messaggio di un attimo prima arriva al modello com\'era').toContain('Ofelia');
    const motivi = await app.evaluate(() => globalThis.__compattazioni.map((x) => x.motivo));
    expect(motivi, 'nessuna risposta aspetta la compattazione').not.toContain('soglia');
  } finally { await rimetti(app); await ripristina(app); }
});

test('r1 turni da circa 5.000 token con la soglia di serie: fra due compattazioni almeno tre messaggi', async ({ app }) => {
  test.setTimeout(300000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Letto, ecco il punto.' }]);
  await compattatoreFinto(app, '10:00 letto un capitolo della tesi');
  const dopo = [];
  try {
    for (let i = 0; i < 12; i++) {
      await chiedi(page, `Capitolo ${i}: ${'Le api tornano all\'alveare e danzano per le compagne. '.repeat(330)}`);
      await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 30000 }).toBe(i + 1);
      await page.waitForTimeout(1500);
      dopo.push(await app.evaluate(() => globalThis.__compattazioni.length));
    }
  } finally { await rimetti(app); await ripristina(app); }
  const con = dopo.map((n, i) => (n > (i ? dopo[i - 1] : 0) ? i + 1 : 0)).filter(Boolean);
  expect(con.length, 'la chat compatta').toBeGreaterThan(1);
  for (let k = 1; k < con.length; k++) {
    expect(con[k] - con[k - 1], `compattazioni dopo i messaggi ${JSON.stringify(con)}`).toBeGreaterThanOrEqual(3);
  }
});
