// #1563 giro 2: dopo un riavvio (nessuna richiesta ancora mandata) l'utente è fermo da ore e il tratto è grande, ma il
// primo messaggio non compatta per «fermo»: la richiesta parte col tratto intero.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const RIGA = '09:12 scritti appunti lunghi sulle api, discussi con Filo';

test('r1 riaperto Filo dopo ore di pausa, col tratto grande il primo messaggio compatta per «fermo»', async ({ app }) => {
  const page = await home(app);
  const T = 30000;
  const { b } = await app.evaluate(async (_e, T) => {
    const FC = globalThis.SN_FILO_CONTESTO;
    const b = FC.stimaToken(JSON.stringify(globalThis.SN_ACTION_TOOLS.definitions()) + globalThis.SN_CONST.PROMPTS.filoChatStatic());
    // Una soglia che la richiesta non passa, nemmeno all'80% (niente compattazione in anticipo), col tratto oltre il 30%.
    const soglia = Math.ceil((b + T + 6000) / 0.8 / 1000) * 1000;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ contestoFilo: { ...(s.contestoFilo || {}), soglia } });
    const t0 = Date.now() - 3 * 60 * 60 * 1000;
    for (let i = 0; i < 3; i++) {
      await globalThis.SN_FILO_CHATS.append('vecchia9', { role: 'user', text: `Appunti ${i}: ${'il favo è fatto di cera. '.repeat(Math.ceil((T / 3) * 3.5 / 25))}`, ts: new Date(t0 + i * 60000).toISOString() });
      await globalThis.SN_FILO_CHATS.append('vecchia9', { role: 'filo', text: 'Annotato.', ts: new Date(t0 + i * 60000 + 5000).toISOString() });
    }
    return { b, soglia };
  }, T);
  expect(T, 'il tratto è «grande»').toBeGreaterThan(0.3 * Math.ceil((b + T + 6000) / 0.8 / 1000) * 1000);
  await modelloFinto(app, [{ text: 'Bentornato.' }]);
  await app.evaluate((_e, riga) => {
    const C = globalThis.SN_COMPATTAZIONE;
    globalThis.__compattazioni = [];
    globalThis.__vera = C._dip.chiama;
    C._dip.chiama = async ({ motivo }) => { globalThis.__compattazioni.push(motivo); return JSON.stringify({ ore: [{ testo: riga }], memorie: [] }); };
  }, RIGA);
  try {
    await chiedi(page, 'eccomi, riprendiamo');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Bentornato.' })).toBeVisible({ timeout: 20000 });
    const [richiesta] = await chiamateAlModello(app);
    expect(await app.evaluate(() => globalThis.__compattazioni), 'fermo da ore col tratto grande: compatta prima di rispondere').toContain('fermo');
    expect(richiesta[0].content, 'la richiesta ha il diario al posto del tratto vecchio').toContain(RIGA);
  } finally {
    await app.evaluate(() => { if (globalThis.__vera) globalThis.SN_COMPATTAZIONE._dip.chiama = globalThis.__vera; });
    await ripristina(app);
  }
});
