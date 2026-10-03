// Verifica #866 giro 3 — esplorazione: titoli tardivi, cancellazione chat e registro grezzo, aspetto Sicurezza.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const eventi = (ud) => { const f = join(ud, 'filo', 'eventi.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []; };

test('titolo messo dalla pagina dopo il caricamento', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const senza = testServer.html('<!doctype html><p>spa</p><script>setTimeout(()=>{document.title="Titolo tardivo"},700)</script>');
  const cambia = testServer.html('<!doctype html><title>Caricamento…</title><p>spa</p><script>setTimeout(()=>{document.title="Vero titolo"},700)</script>');
  await openTab(senza);
  await openTab(cambia);
  await new Promise((r) => setTimeout(r, 3000));
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  const nav = eventi(userData).filter((e) => e.tipo === 'navigazione').map((e) => ({ url: e.url, titolo: e.titolo }));
  console.log('VISITE', JSON.stringify(nav, null, 1));
});

test('back e avanti', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const b = testServer.html('<!doctype html><title>Pagina B</title><p>b</p>');
  const a = testServer.html(`<!doctype html><title>Pagina A</title><a id="l" href="${b}">vai</a>`);
  const page = await openTab(a);
  await page.click('#l');
  await page.waitForURL(b);
  await page.goBack();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForTimeout(1500);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  console.log('BACK', JSON.stringify(eventi(userData).filter((e) => e.tipo === 'navigazione').map((e) => e.titolo)));
});

test('cancellare una chat: resta nel registro grezzo?', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const r = async ({ attempts, messages }) => {
      const j = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (j.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Segreto' }) };
      return { ...base, text: JSON.stringify({ text: 'Ok, ricevuto PRIVATO-RISP.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = r;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = r;
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'La mia diagnosi PRIVATO-77', threadHistory: [], chatId: 'c-priv' });
    await globalThis.SN_CLOSE_FILO_CHAT('c-priv');
  });
  const page = await openTab('filo://archive/archive.html');
  const riga = page.locator('.arc-chat', { hasText: 'PRIVATO-77' }).or(page.locator('.arc-chat', { hasText: 'Segreto' }));
  await expect(riga.first()).toBeVisible({ timeout: 10_000 });
  await riga.first().click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Elimina la chat' }).click();
  await page.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'));
  await expect.poll(() => JSON.stringify(eventi(userData)).includes('PRIVATO-77'), { timeout: 10_000 }).toBe(false);
  await app.evaluate(() => globalThis.SN_STORAGE_FLUSH && globalThis.SN_STORAGE_FLUSH());
  await app.evaluate(async () => { try { await require('./src/main/shim/storage').flushNow(); } catch (_) {} });
  await new Promise((r) => setTimeout(r, 2500));
  const sj = join(userData, 'storage.json');
  const disco = existsSync(sj) ? readFileSync(sj, 'utf8') : '';
  console.log('STORAGE_HAS_PRIV', disco.includes('PRIVATO-77'), disco.includes('PRIVATO-RISP'), disco.length);
  const raw = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.listRaw()).includes('PRIVATO-77'));
  console.log('RAW_HAS_PRIV', raw);
});

for (const tema of ['light', 'dark']) {
  test(`Sicurezza ${tema}`, async ({ app, openTab, shell }) => {
    test.setTimeout(60_000);
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    const page = await openTab('filo://security/security.html');
    await page.waitForTimeout(1500);
    await page.locator('#sec-visite').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/866-g3-sicurezza-${tema}.png` });
    await page.locator('#sec-visite').screenshot({ path: `tests/.shots/866-g3-sez-${tema}.png` });
    await page.locator('#sec-visite-tutto').click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `tests/.shots/866-g3-sicurezza-${tema}-dopo.png` });
  });
}
