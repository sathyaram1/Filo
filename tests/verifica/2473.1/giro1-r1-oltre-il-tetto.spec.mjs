// Verifica #2473.1, giro 1: con la compattazione che non riesce, la richiesta intera della chat deve stare sotto i
// 100.000 token anche quando porta, oltre al tratto e alla parte fissa, i ricordi ripescati o una domanda lunga.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const tokenDi = (app, messages) => app.evaluate((_e, messages) => {
  const FC = globalThis.SN_FILO_CONTESTO;
  return Math.ceil((FC.caratteriDi(messages) + JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()).length) / FC.CARATTERI_PER_TOKEN);
}, messages);

// Una conversazione di sei ore fa da circa 90.000 token, come quella della prova del ramo.
const conversazioneLunga = (app) => app.evaluate(async () => {
  const t0 = Date.now() - 6 * 60 * 60 * 1000;
  const testo = (i) => `Messaggio ${i} sul viaggio a Lisbona. ${'Gli orari dei treni, i quartieri da vedere, dove mangiare la sera. '.repeat(30)}`;
  for (let i = 0; i < 90; i++) {
    await globalThis.SN_FILO_CHATS.append('lunga1', { role: i % 2 ? 'filo' : 'user', text: testo(i), ts: new Date(t0 + i * 60000).toISOString() });
  }
});

const compattazioneGiu = (app) => app.evaluate(() => {
  const C = globalThis.SN_COMPATTAZIONE;
  globalThis.__compattazioni = [];
  globalThis.__compattatoreVero = C._dip.chiama;
  C._dip.chiama = async ({ motivo }) => { globalThis.__compattazioni.push({ motivo }); throw new Error('rete giù'); };
});
const rimetti = (app) => app.evaluate(() => {
  if (globalThis.__compattatoreVero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__compattatoreVero;
  if (globalThis.__cercaVera) globalThis.SN_RICORDI_FILO.cerca = globalThis.__cercaVera;
});

test('r1 con chi compatta in errore e una domanda lunga, la richiesta intera resta sotto i 100.000 token', async ({ app }) => {
  const page = await home(app);
  await conversazioneLunga(app);
  await modelloFinto(app, [{ text: 'Va bene.' }]);
  await compattazioneGiu(app);
  try {
    // Un testo incollato da circa 40.000 token: da solo sta largo sotto il listino.
    const incollato = `riassumi questo diario di viaggio: ${'Il tram 28 sale verso Graça, poi a piedi fino al belvedere. '.repeat(1350)}`;
    await chiedi(page, incollato);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Va bene.' })).toBeVisible({ timeout: 30000 });
    const [richiesta] = await chiamateAlModello(app);
    expect(JSON.stringify(richiesta), 'la domanda parte intera').toContain('poi a piedi fino al belvedere. Il tram 28');
    expect(await tokenDi(app, richiesta), 'la richiesta intera sta sotto il listino').toBeLessThanOrEqual(100000);
  } finally {
    await rimetti(app);
    await ripristina(app);
  }
});

test('r1 con chi compatta in errore e tre ricordi ripescati, la richiesta intera resta sotto i 100.000 token', async ({ app }) => {
  const page = await home(app);
  // Una conversazione da circa 75.000 token: il tratto resta intero, appena sotto il suo tetto.
  await app.evaluate(async () => {
    const t0 = Date.now() - 6 * 60 * 60 * 1000;
    const testo = (i) => `Messaggio ${i} sul viaggio a Lisbona. ${'Gli orari dei treni, i quartieri da vedere, dove mangiare la sera. '.repeat(30)}`;
    for (let i = 0; i < 73; i++) {
      await globalThis.SN_FILO_CHATS.append('lunga1', { role: i % 2 ? 'filo' : 'user', text: testo(i), ts: new Date(t0 + i * 60000).toISOString() });
    }
  });
  await modelloFinto(app, [{ text: 'Va bene.' }]);
  await compattazioneGiu(app);
  await app.evaluate(() => {
    const R = globalThis.SN_RICORDI_FILO;
    globalThis.__cercaVera = R.cerca;
    const ts = new Date(Date.now() - 20 * 24 * 3600000).toISOString();
    R.cerca = async () => [0, 1, 2].map((i) => ({ tratto: { chat: `vecchia${i}`, titolo: `Porto ${i}`, ts, testo: `Ricordo ${i}. ${'Il treno per Porto parte da Santa Apolónia. '.repeat(80)}` } }));
  });
  try {
    await chiedi(page, 'quale treno prendo domattina?');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Va bene.' })).toBeVisible({ timeout: 30000 });
    const [richiesta] = await chiamateAlModello(app);
    const testo = JSON.stringify(richiesta);
    expect(testo, 'i ricordi sono arrivati').toContain('RICORDI DAL FILO');
    const t = await tokenDi(app, richiesta);
    console.log('token stimati della richiesta con i ricordi:', t, 'sistema:', JSON.stringify(richiesta[0]).length);
    expect(t, 'la richiesta intera sta sotto il listino').toBeLessThanOrEqual(100000);
  } finally {
    await rimetti(app);
    await ripristina(app);
  }
});
