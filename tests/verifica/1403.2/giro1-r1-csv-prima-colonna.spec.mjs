// #1403.2 giro 1 — un CSV con la colonna «password» per prima, senza virgolette: nessun avviso, né a punti e virgola
// né a virgole.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

async function finti(app) {
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { ...T.models }, modelRegistry: T.registry,
    });
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: `fb-${globalThis.__invii.length}`, seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages?.[0]?.content || '');
      const text = sys.startsWith('Rileggi un feedback') || sys.startsWith('Guarda le immagini') ? '{"trovati":[]}' : 'Titolo';
      return { text, provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
    };
  });
}

for (const [nome, csv] of [
  ['punti e virgola', 'password;utente\nhunter22;mario.rossi\n'],
  ['virgole', 'password,email\nhunter22,mario@example.com\n'],
]) {
  test(`r1 CSV con la colonna password per prima, a ${nome}: il riquadro si riapre con l'avviso`, async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtab(app);
    await finti(app);
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    await page.locator('.sn-fb-text').fill('Allego l\'esportazione: il login fallisce sempre');
    await page.locator('.sn-fb-file').setInputFiles([{ name: 'utenti.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }]);
    await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
    await page.locator('.sn-fb-send').click();
    await expect(page.locator('.sn-fb-l0')).toContainText('In un file allegato c’è una password', { timeout: 12_000 });
    await expect(page.locator('.sn-fb-file-chip--l0')).toContainText('utenti.csv');
    expect(await app.evaluate(() => globalThis.__invii.length)).toBe(0);
  });
}

test('cinque log da 4 MB allegati insieme: Filo risponde mentre li rilegge e l\'avviso arriva', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  const righe = [];
  let n = 0;
  for (let i = 0; n < 4 * 1024 * 1024 - 2_000; i++) {
    const r = `2026-11-20T10:00:00.123Z INFO [net] GET https://example.com/api/v1/items?page=${i} status=200 durata=${i % 997}ms\n`;
    righe.push(r);
    n += r.length;
  }
  const corpo = righe.join('');
  const files = [0, 1, 2, 3, 4].map((k) => ({
    name: `filo-${k}.log`, mimeType: 'text/plain',
    buffer: Buffer.from(k === 4 ? `${corpo}utente = mario.rossi\npassword = hunter22\n` : corpo),
  }));
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Allego i log: il login fallisce sempre.');
  await page.locator('.sn-fb-file').setInputFiles(files);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(5, { timeout: 20_000 });
  await app.evaluate(() => {
    const l = { max: 0, ultimo: performance.now() };
    l.t = setInterval(() => { const ora = performance.now(); l.max = Math.max(l.max, ora - l.ultimo); l.ultimo = ora; }, 10);
    globalThis.__fermo = l;
  });
  const t0 = Date.now();
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0')).toContainText('In un file allegato c’è una password', { timeout: 60_000 });
  const durata = Date.now() - t0;
  const fermo = await app.evaluate(() => { clearInterval(globalThis.__fermo.t); return globalThis.__fermo.max; });
  test.info().annotations.push({ type: 'fermo', description: `${Math.round(fermo)} ms, avviso dopo ${durata} ms` });
  console.log('fermo', Math.round(fermo), 'ms; avviso dopo', durata, 'ms');
  await expect(page.locator('.sn-fb-file-chip--l0')).toContainText('filo-4.log');
  expect(fermo).toBeLessThan(250);
});
