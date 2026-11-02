// #1661 — al primo avvio la home mostra solo quello che serve per cominciare: la carta dei Crediti, poi l'intervista.
// Le carte di destra e «altro» arrivano quando l'accoglienza si chiude, o se l'utente toglie la carta dei Crediti.
// Foto chiara e scura in tests/.shots/.

import { test, expect } from './fixtures/electron.mjs';

test.use({ accoglienzaFatta: false });

async function home(app, tranne = null) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x !== tranne && x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

const manda = (page, msg) => page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage(m, (r) => ok(r))), msg);
const crediti = (page) => page.locator('#accade .dash-carta[data-chiave="crediti"]');
const visibili = (page) => page.locator('.dash-carta:visible').evaluateAll((ns) => ns.map((n) => n.dataset.chiave));

async function stubModelli(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts, messages) => {
      const tutto = JSON.stringify(messages || []);
      const text = tutto.includes('preparare la dashboard')
        ? JSON.stringify({ message: 'Eccoci.', suggestions: [] })
        : JSON.stringify({ text: 'Dimmi pure.', actions: [] });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = risposta(attempts, messages);
      try { onDelta && onDelta(r.text); } catch (_) {}
      return r;
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
  });
}

test('al primo avvio senza crediti la home mostra solo la carta dei Crediti', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await expect(crediti(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#tieni')).toBeHidden();
  await expect(page.locator('#altro')).toBeHidden();
  expect(await visibili(page)).toEqual(['crediti']);
  // L'orologio non è una carta: resta.
  await expect(page.locator('#sistema')).toBeVisible();
  const m = await page.evaluate(() => window.SN_MSG.MSG);
  for (const tema of ['light', 'dark']) {
    await manda(page, { type: m.UPDATE_SETTINGS, settings: { theme: tema } });
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema);
    await page.screenshot({ path: `tests/.shots/1661-primo-incontro-${tema}.png` });
  }
  // Riaperta, è ancora il primo incontro.
  await page.reload();
  await expect(crediti(page)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#tieni')).toBeHidden();
});

test('tolta la carta dei Crediti torna la home intera, e da «altro» la si rimette', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await expect(crediti(page)).toBeVisible({ timeout: 15_000 });
  await crediti(page).click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli dalla home' }).click();
  await expect(crediti(page)).toHaveCount(0);
  await expect(page.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible();
  const rimetti = page.locator('#altro .dash-altro-app[data-id="crediti"][data-tolta="1"] + .dash-altro-rimetti');
  await expect(rimetti).toBeVisible();
  await rimetti.click();
  await expect(crediti(page)).toBeVisible();
  await expect(page.locator('#tieni')).toBeHidden();
  await expect(page.locator('#altro')).toBeHidden();
});

test('arrivati i crediti l’intervista resta sola, e chiusa l’accoglienza compaiono le carte', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await expect(crediti(page)).toBeVisible({ timeout: 15_000 });
  await stubModelli(app);
  // Il riscatto visto dalla home già aperta: la chiave arriva e il main avvisa le pagine.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
    globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED });
  });
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo', { timeout: 10_000 });
  await expect(crediti(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#tieni')).toBeHidden();
  await expect(page.locator('#altro')).toBeHidden();
  await page.screenshot({ path: 'tests/.shots/1661-primo-incontro-intervista.png' });

  await page.locator('#skipOnboarding').click();
  await expect(page.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#altro')).toBeVisible();
  // Una scheda nuova, dopo, è la home di sempre.
  await page.reload();
  await expect(page.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible({ timeout: 15_000 });
});

test('con la chiave ma senza un modello da chiamare la home resta intera: la strada è fra i suggerimenti', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await expect(crediti(page)).toBeVisible({ timeout: 15_000 });
  await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const origGet = Defaults.get;
    Defaults.get = () => ({ ...origGet(), provider: 'openrouter', models: {} });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
  });
  await page.reload();
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 15_000 });
  await expect(page.locator('#tieni .dash-carta-voce', { hasText: /Opzioni/ }).first()).toBeVisible({ timeout: 15_000 });
});

test.describe('chi è già stato accolto', () => {
  test.use({ accoglienzaFatta: true });

  test('vede tutte le carte anche senza crediti, e anche in incognito', async ({ app, shell }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    await expect(crediti(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible();
    await expect(page.locator('#altro')).toBeVisible();
    // In incognito il segno dell'accoglienza non si legge dal disco: la home deve saperlo lo stesso.
    await shell.evaluate(() => window.filoShell.openIncognito());
    const inc = await home(app, page);
    await expect(inc.locator('#accade .dash-carta[data-chiave="crediti"]')).toBeVisible({ timeout: 15_000 });
    await expect(inc.locator('#tieni .dash-carta[data-chiave="editor"]')).toBeVisible();
    await expect(inc.locator('#altro')).toBeVisible();
  });
});
