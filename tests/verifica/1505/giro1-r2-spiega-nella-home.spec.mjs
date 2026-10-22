// Verifica #1505 giro 1: un collegamento che un modello scrive in una pagina di Filo fuori dalla chat (qui la
// spiegazione del tasto destro nella home) non ha mai avuto un verdetto della porta: al clic deve chiedere l'OK, come
// chiede la segnalazione per ogni indirizzo web senza verdetto aperto da filo://. Il modello è finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

const RACCOLTA = 'raccolta-spiega-1505.test';
const LINK = `https://${RACCOLTA}/r?progetto=zafferano-1505`;

async function newtab(app, prefisso = 'filo://newtab') {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => { try { return w.url().startsWith(prefisso); } catch (_) { return false; } });
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

const apertoVerso = (app, url) => app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()
  .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => t.url === u)), url);

test.use({ hostInPiu: [RACCOLTA] });

test('r2 un collegamento della spiegazione del tasto destro nella home, mai giudicato, chiede l\'OK al clic', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(async (_e, link) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const rispondi = ({ attempts, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const text = Array.isArray(tools) && tools.length
        ? 'Il progetto Zafferano riguarda le ricette di casa.'
        : `Zafferano è il nome del progetto: dettagli su [la raccolta](${link}).`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => rispondi(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => rispondi(o);
  }, LINK);
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill('di cosa parla il progetto?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'progetto Zafferano' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 20_000 });

  // Seleziona «Zafferano» nella risposta e apre il tasto destro: la spiegazione scrive un collegamento.
  await bolla.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.data.indexOf('Zafferano');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 'Zafferano'.length);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        return;
      }
    }
  });
  const box = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  const link = menuDi(page).locator('.sn-menu a.filo-md-link', { hasText: 'la raccolta' });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await page.waitForTimeout(1500);
  expect(await apertoVerso(app, LINK), 'il collegamento mai giudicato si è aperto senza chiedere l\'OK').toBe(false);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
});
