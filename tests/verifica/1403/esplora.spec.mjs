// Esplorazione #1403: anticipo sui siti, evidenze su testo lungo, immagine segnata con la schermata.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato, nelMondoDiFilo, statoDi, clicca } from '../../helpers/riquadri.mjs';

const SHOTS = 'tests/.shots';

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
    globalThis.__l0 = { testo: '{"trovati":[]}', immagini: '{"trovati":[]}', chiamate: [] };
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: `fb-${globalThis.__invii.length}`, seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const S = globalThis.__l0;
      const sys = String(messages?.[0]?.content || '');
      const cosa = sys.startsWith('Rileggi un feedback') ? 'testo' : sys.startsWith('Guarda le immagini') ? 'immagini' : 'altro';
      S.chiamate.push(cosa);
      if (cosa === 'altro') return { text: 'Titolo', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
      return { text: S[cosa], provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
    };
  });
}
const imposta = (app, v) => app.evaluate((_e, v) => Object.assign(globalThis.__l0, v), v);
const chiamate = (app) => app.evaluate(() => globalThis.__l0.chiamate.slice());
const invii = (app) => app.evaluate(() => globalThis.__invii.map((p) => p.text));

test('sito: scrivendo con la tastiera la rilettura parte prima dell\'invio', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><body style="padding:40px"><h1>Un sito</h1></body>');
  await finti(app);
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  const strato = await clicca(app, p, '.sn-fb-text');
  await strato.keyboard.type('Il tasto Salva non risponde', { delay: 20 });
  await expect.poll(() => chiamate(app), { timeout: 6_000 }).toEqual(['testo']);
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(() => invii(app), { timeout: 15_000 }).toEqual(['Il tasto Salva non risponde']);
  expect((await chiamate(app)).filter((c) => c === 'testo').length).toBe(1);
});

test('testo lungo con emoji: le evidenze stanno sotto le parole giuste, chiaro e scuro', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  const righe = [];
  for (let i = 0; i < 30; i++) righe.push(`Riga ${i} 😀 del racconto, con parole abbastanza lunghe da andare a capo nella casella del feedback.`);
  righe.push('La mia password è Gatto!2024 e il mio IBAN IT60X0542811101000000123456.');
  const TESTO = righe.join('\n');
  await imposta(app, { testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: 'Gatto!2024' }, { tipo: 'documento', pezzo: 'IT60X0542811101000000123456' }, { tipo: 'incollato', pezzo: '<b>non esiste</b>' }] }) });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill(TESTO);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.sn-fb-evidenze mark')).toHaveText(['Gatto!2024', 'IT60X0542811101000000123456']);
  await page.locator('.sn-fb-text').evaluate((t) => { t.scrollTop = t.scrollHeight; t.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/v1403-lungo-chiaro.png` });
  const pos = await page.evaluate(() => {
    const ta = document.querySelector('.sn-fb-text');
    const ev = document.querySelector('.sn-fb-evidenze');
    const a = ta.getBoundingClientRect(); const b = ev.getBoundingClientRect();
    const cs = getComputedStyle(ta); const ce = getComputedStyle(ev);
    return { ta: [a.x, a.y, a.width, a.height], ev: [b.x, b.y, b.width, b.height], st: [ta.scrollTop, ev.scrollTop], font: [cs.font, ce.font], pad: [cs.padding, ce.padding], lh: [cs.lineHeight, ce.lineHeight], ws: [cs.whiteSpace, ce.whiteSpace], sbw: [ta.offsetWidth - ta.clientWidth, ev.offsetWidth - ev.clientWidth] };
  });
  console.log(JSON.stringify(pos));
  await page.evaluate(() => { for (const el of document.querySelectorAll('[data-sn-theme], .sn-fb-overlay')) el.dataset.snTheme = 'dark'; document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: `${SHOTS}/v1403-lungo-scuro.png` });
});

test('schermata annotata più un\'immagine: l\'immagine segnata è quella giusta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { immagini: JSON.stringify({ trovati: [{ tipo: 'schede', immagine: 2 }] }) });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('La pagina si vede male');
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }]);
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(1);
  await page.locator('.sn-fb-clear').click();
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0')).toBeVisible({ timeout: 12_000 });
  const thumbs = await page.locator('.sn-fb-thumb').evaluateAll((els) => els.map((e) => ({ l0: e.classList.contains('sn-fb-thumb--l0'), t: e.textContent, title: e.getAttribute('title') || '', img: e.querySelector('img')?.naturalWidth })));
  console.log(JSON.stringify(thumbs), JSON.stringify(await chiamate(app)));
  await page.screenshot({ path: `${SHOTS}/v1403-immagini.png` });
  expect(thumbs.length).toBe(2);
  expect(thumbs.map((t) => t.l0)).toEqual([false, true]);
});
