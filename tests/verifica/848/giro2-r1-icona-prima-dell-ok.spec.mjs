// Verifica #848 giro 2: un suggerimento della home che chiede l'OK al clic (dato dell'utente nell'indirizzo) non deve
// far partire richieste verso quel sito prima del clic, nemmeno per l'icona.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC';
const SPIA = 'n3471234567.raccolta.test';

test('r1 il suggerimento con un dato dell\'utente nell\'indirizzo non contatta il sito prima dell\'OK', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(({ session, net }, png) => {
    globalThis.__richiesteSiti = [];
    session.defaultSession.protocol.handle('https', (req) => {
      const u = new URL(req.url);
      if (!/\.test$/.test(u.hostname)) return net.fetch(req, { bypassCustomProtocolHandlers: true });
      globalThis.__richiesteSiti.push(`${u.hostname}${u.pathname}`);
      if (u.pathname === '/favicon.ico') return new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/png' } });
      return new Response('<!doctype html><title>x</title>', { headers: { 'content-type': 'text/html' } });
    });
  }, PNG);
  await app.evaluate(async (_e, SPIA) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      const tutto = (args.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {}, toolCalls: [], finishReason: 'stop' };
      if (!tutto.includes('preparare la dashboard')) return { ...base, text: 'Segnato.' };
      return { ...base, text: JSON.stringify({ message: 'Ciao', suggestions: [
        { icon: 'link', text: 'Offerte per te', action: { type: 'NAVIGA', url: `https://${SPIA}/offerte` } },
        { icon: 'link', text: 'Meteo', action: { type: 'NAVIGA', url: 'https://meteo.test/oggi' } },
      ] }) };
    };
  }, SPIA);
  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'il mio numero di cellulare è 3471234567', threadHistory: [], chatId: 'scheda-numero' }));
  const gen = await app.evaluate(() => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.FILO_GENERATE_DASHBOARD, force: true }, { url: 'filo://newtab/' }));
  const offerte = (gen.suggestions || []).find((s) => s.text === 'Offerte per te');
  // Premessa: la porta delle uscite riconosce il dato e chiede l'OK al clic.
  expect(offerte && (offerte.chiedeOk || offerte.fermata)).toBeTruthy();
  console.log('suggerimento:', JSON.stringify(offerte));

  const home = await openTab(NEWTAB);
  await home.reload();
  const voci = home.locator('#tieni .dash-carta[data-tipo="suggerimenti"] .dash-carta-voce');
  await expect(voci.filter({ hasText: 'Meteo' }).locator('img')).toHaveAttribute('src', /^data:image\//, { timeout: 15000 });
  await expect(voci.filter({ hasText: 'Offerte per te' })).toBeVisible();
  await home.waitForTimeout(1500);
  const richieste = await app.evaluate(() => globalThis.__richiesteSiti.slice());
  console.log('richieste:', JSON.stringify(richieste));
  expect(richieste.filter((r) => r.startsWith(SPIA)), 'nessuna richiesta al sito prima dell\'OK').toEqual([]);
});
