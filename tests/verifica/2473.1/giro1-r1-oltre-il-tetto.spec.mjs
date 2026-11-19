// Verifica #2473.1, giro 1: con la compattazione che non riesce, la richiesta intera della chat deve stare sotto i
// 100.000 token anche quando la domanda è un testo lungo incollato, che da solo sta largo sotto il listino.
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

test('r1 con chi compatta in errore e una domanda lunga, la richiesta intera resta sotto i 100.000 token', async ({ app }) => {
  const page = await home(app);
  await conversazioneLunga(app);
  await modelloFinto(app, [{ text: 'Va bene.' }]);
  await app.evaluate(() => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__compattatoreVero = C._dip.chiama;
    C._dip.chiama = async () => { throw new Error('rete giù'); };
  });
  try {
    // Un testo incollato da circa 41.000 token: da solo sta largo sotto il listino, e la conversazione deve fargli posto.
    const incollato = `riassumi questo diario di viaggio: ${'Il tram 28 sale verso Graça, poi a piedi fino al belvedere. '.repeat(1350)}`;
    await chiedi(page, incollato);
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Va bene.' })).toBeVisible({ timeout: 30000 });
    const [richiesta] = await chiamateAlModello(app);
    expect(JSON.stringify(richiesta), 'la domanda parte intera').toContain('poi a piedi fino al belvedere. Il tram 28');
    expect(await tokenDi(app, richiesta), 'la richiesta intera sta sotto il listino').toBeLessThanOrEqual(100000);
  } finally {
    await app.evaluate(() => {
      if (globalThis.__compattatoreVero) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__compattatoreVero;
    });
    await ripristina(app);
  }
});
