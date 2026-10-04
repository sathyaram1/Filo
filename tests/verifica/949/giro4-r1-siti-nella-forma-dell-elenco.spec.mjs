// #949 giro 4, rilievo 1 — un sito cambiato a parole in un elenco deve finire nella forma che quell'elenco usa
// davvero: togliere un dominio escluso scritto a mano con «www.», e mostrare i banner su un sottodominio.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  });
}
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__v_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '',
        toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__v_restore?.(); } catch (_) {} });
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const imposta = (chiave, valore) => ({ toolCalls: [{ id: 'v1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }] });
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('un dominio escluso scritto a mano nella pagina Altro come www.youtube.com si toglie chiedendolo a Filo', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const altro = await openTab('filo://options/altro.html');
  await altro.locator('#blocklist').fill('www.youtube.com');
  await altro.locator('#blocklist').dispatchEvent('change');
  await expect.poll(async () => (await impostazioni(app)).blocklist, { timeout: 5_000 }).toEqual(['www.youtube.com']);

  await modelloFinto(app, [imposta('domini_esclusi', 'togli www.youtube.com'), { text: 'Fatto.' }]);
  await scrivi(chat, 'togli www.youtube.com dai domini esclusi');
  await clickConfirm(chat, 'ok', { timeout: 10_000 }).catch(() => {});
  await expect.poll(async () => (await impostazioni(app)).blocklist, { timeout: 5_000 }).toEqual([]);
  await ripristina(app);
});

test('«mostra i banner dei cookie su mail.google.com» chiesto a Filo fa davvero tornare i banner su quel sito', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [imposta('siti_con_banner', 'aggiungi mail.google.com'), { text: 'Fatto.' }]);
  await scrivi(chat, 'mostrami i banner dei cookie su mail.google.com');
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(async () => (await impostazioni(app)).security.cookies.bannerSites.length, { timeout: 5_000 }).toBe(1);
  // Lo stesso confronto di cookies.js (isBannerSiteIn): il sito registrabile dell'indirizzo deve stare nell'elenco.
  const mostra = await app.evaluate(async () => {
    const reg = globalThis.SN_SAFEBROWSE.normalize('https://mail.google.com/mail/u/0/', { soloPsl: true }).registrable;
    const s = await globalThis.SN_STORAGE.getSettings();
    return s.security.cookies.bannerSites.map((d) => String(d).toLowerCase()).includes(reg);
  });
  expect(mostra).toBe(true);
  await ripristina(app);
});
