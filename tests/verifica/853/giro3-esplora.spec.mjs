// #853 giro 3: esplorazione del verificatore (pagine interne, streaming, ripiego, temi).

import { test, expect } from '../../fixtures/electron.mjs';

const PIXEL = 'https://pixel-853.example/spia.png';
const FORM = 'https://form-853.example/invia';

async function preparaProvider(app, { testo, deltas = null, gate = false }) {
  await app.evaluate(async (_e, { testo, deltas, gate }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
        [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash',
        [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__g3orig = globalThis.__g3orig || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__g3gate = gate ? new Promise((r) => { globalThis.__g3apri = r; }) : null;
    const pezzi = deltas || [testo];
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__g3orig,
      complete: async () => ({ text: testo, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => {
        for (let i = 0; i < pezzi.length; i++) {
          onDelta(pezzi[i]);
          await new Promise((r) => setTimeout(r, 30));
          if (i === Math.floor(pezzi.length / 2) && globalThis.__g3gate) await globalThis.__g3gate;
        }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  }, { testo, deltas, gate });
}

async function selezionaTesto(page, frase) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 });
  await page.evaluate((frase) => {
    let p = document.getElementById('t853');
    if (!p) {
      p = document.createElement('p');
      p.id = 't853';
      p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:99999;font-size:18px;background:transparent;margin:0';
      document.body.appendChild(p);
    }
    p.textContent = frase;
    const r = document.createRange(); r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }, frase);
}

const PAGINE = [
  'filo://manage/manage.html',
  'filo://feedback/feedback.html',
  'filo://decks/decks.html',
  'filo://history/history.html',
  'filo://archive/archive.html',
  'filo://options/options.html',
  'filo://preferences/preferences.html',
];

for (const url of PAGINE) {
  test(`spiegazione nel menu su ${url}: grassetto, link, tag come testo`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const testo = `Una **parola importante**, vedi [la guida](https://example.com/guida) e https://example.com/due.\n\nCodice: <img src="${PIXEL}"> <form action="${FORM}"><input name=a></form>`;
    await preparaProvider(app, { testo });
    const page = await openTab(url);
    const richieste = [];
    page.on('request', (r) => richieste.push(r.url()));
    await selezionaTesto(page, 'Una frase qualunque da spiegare adesso.');
    await page.locator('#t853').click({ button: 'right' });
    const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
    await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });
    await expect(corpo.locator('strong')).toHaveText('parola importante');
    await expect(corpo.locator('a.filo-md-link')).toHaveCount(4);
    await expect(corpo.locator('img, form, input')).toHaveCount(0);
    await expect(corpo).toContainText('<img src=');
    await page.waitForTimeout(500);
    expect(richieste.filter((u) => /853\.example/.test(u))).toEqual([]);
  });
}

test('riquadro in streaming sull\'Editor: a metà e alla fine niente elementi dal testo, poi grassetto e link', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dest = testServer.html('<title>arrivo</title><p>ok</p>');
  const deltas = ['Ecco **un gras', 'setto** e <img src="', PIXEL, '"> poi <b>bold</b> e ', `[apri](${dest}) `, 'fine.'];
  await preparaProvider(app, { testo: deltas.join(''), deltas, gate: true });
  const page = await openTab('filo://editor/editor.html');
  const richieste = [];
  page.on('request', (r) => richieste.push(r.url()));
  await selezionaTesto(page, 'Una frase da approfondire.');
  await page.evaluate(() => {
    const p = document.getElementById('t853');
    const b = p.getBoundingClientRect();
    window.SN_ACTIONS.triggerExplainOrTranslate(window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      { selection: p.textContent, sentence: p.textContent }, { clientX: b.left + 10, clientY: b.bottom });
  });
  const testo = page.locator('.sn-popup .sn-msg-text').last();
  await expect(testo).toContainText('img src', { timeout: 20_000 });
  await expect(page.locator('.sn-popup img, .sn-popup form, .sn-popup b')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/853-g3-streaming-meta.png' });
  await app.evaluate(() => globalThis.__g3apri && globalThis.__g3apri());
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await expect(testo.locator('strong')).toHaveText('un grassetto');
  await expect(page.locator('.sn-popup .sn-msg-text img, .sn-popup .sn-msg-text b')).toHaveCount(0);
  const link = testo.locator('a.filo-md-link', { hasText: 'apri' });
  await expect(link).toHaveAttribute('href', dest);
  await page.screenshot({ path: 'tests/.shots/853-g3-streaming-fine.png' });
  await link.click();
  await expect.poll(() => app.windows().some((w) => w.url() === dest), { timeout: 10_000 }).toBe(true);
  expect(richieste.filter((u) => /853\.example/.test(u))).toEqual([]);
});

test('Traduci dal menu su Gestione: il riquadro mostra grassetto e link', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const testo = 'Traduzione: **ciao** mondo, vedi https://example.com/trad';
  await preparaProvider(app, { testo, deltas: ['Traduzione: **ci', 'ao** mondo, vedi https://exa', 'mple.com/trad'] });
  const page = await openTab('filo://manage/manage.html');
  await selezionaTesto(page, 'Hello world, a sentence to translate.');
  await page.locator('#t853').click({ button: 'right' });
  const voci = await page.locator('.sn-menu [data-id], .sn-menu .sn-menu-item').evaluateAll((els) => els.map((e) => (e.dataset.id || '') + '|' + e.textContent.trim().slice(0, 30)));
  console.log('VOCI', JSON.stringify(voci));
  const traduci = page.locator('.sn-menu').getByText(/^Traduci/).first();
  await traduci.click();
  const t = page.locator('.sn-popup .sn-msg-text').last();
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await expect(t.locator('strong')).toHaveText('ciao');
  await expect(t.locator('a.filo-md-link')).toHaveAttribute('href', 'https://example.com/trad');
});

test('senza SN_MARKDOWN i tre punti mostrano il testo come testo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const deltas = ['Prima <img src="', PIXEL, '"> e <b>x</b>', ' **g**'];
  await preparaProvider(app, { testo: deltas.join(''), deltas, gate: true });
  const page = await openTab('filo://editor/editor.html');
  const richieste = [];
  page.on('request', (r) => richieste.push(r.url()));
  await selezionaTesto(page, 'Una frase senza renderer.');
  await page.evaluate(() => { delete window.SN_MARKDOWN; globalThis.SN_MARKDOWN = undefined; });
  await page.locator('#t853').click({ button: 'right' });
  const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo).toContainText('<img src=', { timeout: 30_000 });
  await expect(corpo.locator('img, b')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const p = document.getElementById('t853');
    const b = p.getBoundingClientRect();
    window.SN_ACTIONS.triggerExplainOrTranslate(window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      { selection: p.textContent, sentence: p.textContent }, { clientX: b.left + 10, clientY: b.bottom });
  });
  const t = page.locator('.sn-popup .sn-msg-text').last();
  await expect(t).toContainText('img src', { timeout: 20_000 });
  await expect(page.locator('.sn-popup img, .sn-popup b')).toHaveCount(0);
  await app.evaluate(() => globalThis.__g3apri && globalThis.__g3apri());
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await expect(t).toContainText('<b>x</b>');
  await expect(page.locator('.sn-popup img, .sn-popup b')).toHaveCount(0);
  expect(richieste.filter((u) => /853\.example/.test(u))).toEqual([]);
});

for (const tema of ['light', 'dark']) {
  test(`aspetto nel tema ${tema}: menu e riquadro su Gestione`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const testo = 'Una **parola importante** con [un link](https://example.com/guida).\n\n- primo punto\n- secondo con `codice`\n\nFine con https://it.wikipedia.org/wiki/Valle_d\'Aosta.';
    await preparaProvider(app, { testo });
    await app.evaluate(async (_e, tema) => { await globalThis.SN_STORAGE.updateSettings({ theme: tema }); }, tema);
    const page = await openTab('filo://manage/manage.html');
    await page.emulateMedia({ colorScheme: tema });
    await selezionaTesto(page, 'Una frase qualunque da spiegare.');
    await page.locator('#t853').click({ button: 'right' });
    const corpo = page.locator('.sn-menu .sn-menu-inline-explain .sn-menu-inline-body');
    await expect(corpo.locator('strong')).toHaveCount(1, { timeout: 30_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/853-g3-menu-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const p = document.getElementById('t853');
      const b = p.getBoundingClientRect();
      window.SN_ACTIONS.triggerExplainOrTranslate(window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        { selection: p.textContent, sentence: p.textContent }, { clientX: b.left + 10, clientY: b.bottom });
    });
    await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/853-g3-riquadro-${tema}.png` });
  });
}
