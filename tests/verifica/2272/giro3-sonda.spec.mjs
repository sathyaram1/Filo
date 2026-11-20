// Sonde del giro 3 di verifica (#2272): porte dei giri passati ri-provate e strade nuove.
import { test, expect } from '../../fixtures/electron.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const NEWTAB = 'filo://newtab/';

async function prepara(app, voci, { w = 320, h = 220 } = {}) {
  await app.evaluate(({ nativeImage }, { voci, w, h }) => {
    const png = (k) => {
      const buf = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) { buf[i * 4] = (40 * k) % 255; buf[i * 4 + 1] = 120; buf[i * 4 + 2] = 200 - 20 * k; buf[i * 4 + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG();
    };
    const C = globalThis.__filoImmaginiDelleRisposte;
    C._dip.tavily = async () => [];
    C._dip.commons = async () => voci;
    globalThis.__scaricate = [];
    const orig = C._dip.__orig || C._dip.scarica;
    C._dip.__orig = orig;
    C._dip.scarica = async (url, ...r) => {
      globalThis.__scaricate.push(url);
      if (!/^https?:/.test(url)) return orig(url, ...r);
      const k = Number((/antilope-(\d+)/.exec(url) || [])[1]) || 0;
      return new Response(png(k), { status: 200 });
    };
  }, { voci, w, h });
}

const antilopi = (n) => Array.from({ length: n }, (_, k) => ({
  immagine: `https://upload.wikimedia.org/antilope-${k}.png`, titolo: `Antilope ${k + 1}`, sito: 'commons.wikimedia.org',
  pagina: `https://commons.wikimedia.org/wiki/File:Antilope_${k + 1}.png`,
}));

// turni: per ogni chiamata del modello, o una chiamata di strumento o un testo con $ID<n> (n-esimo id visto).
async function modello(app, turni) {
  await app.evaluate(async (_e, turni) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.IMAGE_GEN]: 'pittore' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = 0;
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const visto = messages.map((m) => `[${m.role}] ` + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__visti.push(visto);
      const t = turni[Math.min(n, turni.length - 1)];
      if (t.chiamata) {
        const c = { id: 'c' + n, name: 'web', arguments: JSON.stringify(t.chiamata) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      const ids = [...new Set(visto.match(/\b[ig]\d+\b(?=:|,|\))/g) || [])];
      let text = t.testo;
      ids.forEach((id, k) => { text = text.split(`$ID${k}`).join(id); });
      for (let i = 0; i < text.length; i += 9) { try { onDelta && onDelta(text.slice(i, i + 9)); } catch (_) {} }
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, turni);
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('giro1 r1: al messaggio dopo, una foto già mostrata si rimette (o il modello sa che va cercata di nuovo)', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, antilopi(3));
  await modello(app, [
    { chiamata: { azione: 'immagini', query: 'antilope' } },
    { testo: 'Ecco tre antilopi.\n\n[[immagini: $ID0, $ID1, $ID2]]' },
    { testo: 'Eccola di nuovo.\n\n[[immagine: $ID1]]' },
  ]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco tre antilopi.' }).locator('.filo-galleria-img')).toHaveCount(3, { timeout: 30_000 });
  await chiedi(page, 'rimettimi la seconda foto da sola');
  const b2 = page.locator('.dash-bubble-filo', { hasText: 'Eccola di nuovo.' });
  await expect(b2).toBeVisible({ timeout: 30_000 });
  const visto = await app.evaluate(() => globalThis.__visti[2]);
  fs.writeFileSync(path.join(cartellaTemporanea(), 'visto-turno2.txt'), visto);
  console.log('VISTO TURNO 2 (coda):', visto.slice(-2500));
  await expect(b2.locator('.filo-galleria-img')).toHaveCount(1, { timeout: 10_000 });
});

test('giro1 r2: una foto della risposta trascinata nel campo diventa un allegato con anteprima', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, antilopi(2));
  await modello(app, [{ chiamata: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1]]' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const imgs = page.locator('.dash-bubble-filo .filo-galleria-img');
  await expect.poll(() => imgs.evaluateAll((els) => els.filter((e) => e.complete && e.naturalWidth > 0).length), { timeout: 30_000 }).toBe(2);
  await imgs.first().dragTo(page.locator('#input'));
  await expect(page.locator('#imgPreviews img, #imgPreviews .dash-file-chip, #imgPreviews > *').first()).toBeVisible({ timeout: 10_000 });
  expect(await page.locator('#input').inputValue()).not.toContain('filo://');
});

test('sicurezza: titoli con HTML, pagina javascript:, immagine file:// non passano', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const dir = cartellaTemporanea();
  const locale = path.join(dir, 'segreto.png');
  await app.evaluate(({ nativeImage }, p) => {
    const buf = Buffer.alloc(16 * 16 * 4, 200);
    require('node:fs').writeFileSync(p, nativeImage.createFromBitmap(buf, { width: 16, height: 16 }).toPNG());
  }, locale).catch(async () => {
    await app.evaluate(({ nativeImage }) => nativeImage.createEmpty());
  });
  const fileUrl = 'file://' + locale.split(path.sep).join('/');
  await prepara(app, [
    { immagine: 'https://upload.wikimedia.org/antilope-0.png', titolo: '<img src=x onerror="window.__xss=1">', sito: '<b>x</b>', pagina: 'javascript:window.__xss2=1' },
    { immagine: fileUrl, titolo: 'locale', sito: 'x', pagina: 'https://commons.wikimedia.org/' },
    { immagine: 'data:image/png;base64,iVBORw0KGgo=', titolo: 'data', sito: 'x', pagina: 'https://commons.wikimedia.org/' },
  ]);
  await modello(app, [{ chiamata: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1, $ID2]]' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const scaricate = await app.evaluate(() => globalThis.__scaricate);
  console.log('SCARICATE', JSON.stringify(scaricate));
  expect(scaricate.some((u) => /^file:|^data:/.test(u))).toBe(false);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const n = await bolla.locator('.filo-galleria-img').count();
  console.log('IMMAGINI', n, await bolla.locator('.filo-galleria-img').evaluateAll((e) => e.map((x) => x.dataset.pagina || '-')));
  expect(await bolla.locator('.filo-galleria-img[data-pagina^="javascript"]').count()).toBe(0);
});

test('foto verticale da sola e foto larga in finestra stretta: stanno nella risposta', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await prepara(app, antilopi(1), { w: 300, h: 1200 });
  await modello(app, [{ chiamata: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco la torre.\n\n[[immagine: $ID0]]\n\nAlta.' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco la torre.' });
  await expect.poll(() => bolla.locator('.filo-galleria-img').evaluateAll((els) => els.filter((e) => e.complete && e.naturalWidth > 0).length), { timeout: 30_000 }).toBe(1);
  const m = await bolla.evaluate((b) => { const i = b.querySelector('.filo-galleria-img').getBoundingClientRect(); return { w: i.width, h: i.height, vh: innerHeight, br: b.getBoundingClientRect().right, ir: i.right }; });
  console.log('VERTICALE', JSON.stringify(m));
  expect(m.h).toBeLessThan(m.vh * 0.8);
  expect(Math.abs(m.w / m.h - 0.25)).toBeLessThan(0.03);
  await page.screenshot({ path: 'tests/.shots/2272-g3-verticale.png' }).catch(() => {});

  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.isVisible() || true) w.setSize(640, 760); });
  await prepara(app, antilopi(1), { w: 1600, h: 600 });
  await modello(app, [{ chiamata: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco il panorama.\n\n[[immagine: $ID0]]\n\nLargo.' }]);
  await chiedi(page, 'panorama');
  const b2 = page.locator('.dash-bubble-filo', { hasText: 'Ecco il panorama.' });
  await expect.poll(() => b2.locator('.filo-galleria-img').evaluateAll((els) => els.filter((e) => e.complete && e.naturalWidth > 0).length), { timeout: 30_000 }).toBe(1);
  const m2 = await b2.evaluate((b) => { const s = b.querySelector('.filo-galleria-scorre'); const i = b.querySelector('.filo-galleria-img').getBoundingClientRect(); return { fuori: s.scrollWidth - s.clientWidth, ir: i.right, br: b.getBoundingClientRect().right, vw: innerWidth, w: i.width, h: i.height }; });
  console.log('PANORAMA STRETTA', JSON.stringify(m2));
  await page.screenshot({ path: 'tests/.shots/2272-g3-stretta.png' }).catch(() => {});
  expect(m2.fuori).toBeLessThanOrEqual(1);
  expect(m2.ir).toBeLessThanOrEqual(m2.br + 1);
});

test('il modello sa, dal suo prompt, che le immagini si cercano con lo strumento e non aprendo Google', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await modello(app, [{ testo: 'ok' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ok' })).toBeVisible({ timeout: 30_000 });
  const visto = await app.evaluate(() => globalThis.__visti[0]);
  const righe = visto.split('\n').filter((r) => /immagin/i.test(r));
  console.log('PROMPT IMMAGINI:\n' + righe.join('\n').slice(0, 4000));
  expect(righe.length).toBeGreaterThan(0);
});
