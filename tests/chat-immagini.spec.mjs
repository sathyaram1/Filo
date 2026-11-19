// Immagini nelle risposte della chat (#2272): «antilope immagine» porta le foto nella risposta, alternate al testo, con
// un carosello che scorre; «disegnami…» crea un'immagine segnata come fatta con l'AI; senza un modello che disegna lo
// si dice. Riaperta la conversazione le immagini restano. Logica pura: tests/unit/immaginiRisposta.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const NEWTAB = 'filo://newtab/';

// Foto finte ma vere (PNG che il browser disegna), di colori diversi, scaricate «dal web» dal main.
async function preparaImmagini(app, quante) {
  await app.evaluate(({ nativeImage }, quante) => {
    const png = (k) => {
      const w = 320; const h = 220;
      const buf = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) { buf[i * 4] = (40 * k) % 255; buf[i * 4 + 1] = 120; buf[i * 4 + 2] = 200 - 20 * k; buf[i * 4 + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG();
    };
    const C = globalThis.__filoImmaginiChat;
    C._dip.tavily = async () => [];
    C._dip.commons = async () => Array.from({ length: quante }, (_, k) => ({
      immagine: `https://upload.wikimedia.org/antilope-${k}.png`, titolo: `Antilope ${k + 1}`, sito: 'commons.wikimedia.org',
      pagina: `https://commons.wikimedia.org/wiki/File:Antilope_${k + 1}.png`,
    }));
    globalThis.__scaricate = [];
    C._dip.scarica = async (url) => {
      globalThis.__scaricate.push(url);
      const k = Number((/antilope-(\d+)/.exec(url) || [])[1]);
      return new Response(png(k), { status: 200 });
    };
  }, quante);
}

// Il modello finto: al primo giro chiama lo strumento dato, poi risponde col testo, dove $ID0, $ID1… sono gli id
// che l'esito gli ha dato.
async function stubModello(app, { chiamata, finale, conPittore = true }) {
  await app.evaluate(async ({ nativeImage }, { chiamata, finale, conPittore }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.IMAGE_GEN]: conPittore ? 'pittore' : '' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = 0;
    globalThis.__disegni = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, modalities, messages }) => {
      if (Array.isArray(modalities) && modalities.includes('image')) {
        globalThis.__disegni.push({ modello: attempts[0].model, testo: messages.map((m) => m.content).join('\n') });
        const w = 256; const h = 256;
        const buf = Buffer.alloc(w * h * 4, 180);
        return { text: '', images: [`data:image/png;base64,${nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG().toString('base64')}`], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
      return { text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n === 0) {
        const c = { id: 'c0', name: 'immagini', arguments: JSON.stringify(chiamata) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      const esiti = messages.filter((m) => m.role !== 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__vistoDalModello = esiti;
      const ids = [...new Set(esiti.match(/\b[ig]\d+\b(?=:|,|\))/g) || [])];
      let text = finale;
      ids.forEach((id, k) => { text = text.split(`$ID${k}`).join(id); });
      for (let i = 0; i < text.length; i += 9) { try { onDelta && onDelta(text.slice(i, i + 9)); } catch (_) {} }
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, { chiamata, finale, conPittore });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('«antilope immagine»: le foto stanno nella risposta, fra un pezzo di testo e l\'altro, e il carosello scorre', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 7);
  await stubModello(app, {
    chiamata: { azione: 'cerca', query: 'antilope' },
    finale: 'Ecco alcune antilopi.\n\n[[immagini: $ID0, $ID1, $ID2, $ID3, $ID4, $ID5]]\n\nL\'impala è la più diffusa in Africa:\n\n[[immagine: $ID6]]\n\nVive in branchi.',
  });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');

  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco alcune antilopi.' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla).not.toContainText('[[immagin');
  const gallerie = bolla.locator('.filo-galleria');
  await expect(gallerie).toHaveCount(2);
  await expect(gallerie.nth(0).locator('img')).toHaveCount(6);
  await expect(gallerie.nth(1)).toHaveClass(/filo-galleria-una/);

  // Le immagini sono disegnate davvero, da copie locali: la pagina non contatta nessun sito.
  const imgs = bolla.locator('.filo-galleria-img');
  await expect.poll(() => imgs.evaluateAll((els) => els.filter((e) => e.complete && e.naturalWidth > 0).length), { timeout: 15_000 }).toBe(7);
  for (const src of await imgs.evaluateAll((els) => els.map((e) => e.getAttribute('src')))) expect(src).toMatch(/^filo:\/\/icone\//);

  // L'ordine: testo, carosello, testo, immagine, testo.
  const ordine = await bolla.evaluate((b) => {
    const pos = (n) => { const w = document.createTreeWalker(b, NodeFilter.SHOW_ALL); let i = 0; while (w.nextNode()) { i++; if (w.currentNode === n) return i; } return -1; };
    const testo = (s) => [...b.querySelectorAll('p')].find((p) => p.textContent.includes(s));
    const g = b.querySelectorAll('.filo-galleria');
    return [pos(testo('Ecco alcune')), pos(g[0]), pos(testo('impala')), pos(g[1]), pos(testo('branchi'))];
  });
  expect([...ordine].sort((a, b) => a - b)).toEqual(ordine);

  // Didascalia col sito da cui viene.
  await expect(gallerie.nth(0).locator('figcaption').first()).toHaveText('commons.wikimedia.org');

  // Il carosello scorre di lato con la rotella, e la freccia «dopo» compare passandoci sopra.
  const scorre = gallerie.nth(0).locator('.filo-galleria-scorre');
  expect(await scorre.evaluate((s) => s.scrollWidth > s.clientWidth)).toBe(true);
  await scorre.hover();
  await expect(gallerie.nth(0).locator('.filo-galleria-dopo')).toBeVisible();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => scorre.evaluate((s) => s.scrollLeft), { timeout: 5_000 }).toBeGreaterThan(0);
  await gallerie.nth(0).locator('.filo-galleria-dopo').click();
  const dopoFreccia = await scorre.evaluate((s) => s.scrollLeft);
  await expect.poll(() => scorre.evaluate((s) => s.scrollLeft), { timeout: 5_000 }).toBeGreaterThan(dopoFreccia - 1);

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }), tema);
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', tema, { timeout: 10_000 });
    await scorre.evaluate((s) => { s.scrollLeft = 0; });
    await gallerie.nth(0).hover();
    await page.screenshot({ path: `tests/.shots/2272-immagini-${tema === 'dark' ? 'scuro' : 'chiaro'}.png` }).catch(() => {});
  }

  // Un clic ingrandisce.
  await imgs.first().click();
  await expect(page.locator('#lightbox.open img')).toHaveAttribute('src', /^filo:\/\/icone\//);
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox.open')).toHaveCount(0);

  // Tasto destro: la pagina da cui viene, oltre alle voci dell'immagine.
  await imgs.first().click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Apri la pagina dell’immagine')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

  // Riaperta (la scheda si ricarica e rilegge il filo), le immagini sono ancora al loro posto.
  await page.reload();
  const riaperta = page.locator('.dash-bubble-filo', { hasText: 'Ecco alcune antilopi.' });
  await expect(riaperta).toBeVisible({ timeout: 20_000 });
  await expect(riaperta.locator('.filo-galleria-img')).toHaveCount(7);
  await expect.poll(() => riaperta.locator('.filo-galleria-img').evaluateAll((els) => els.filter((e) => e.complete && e.naturalWidth > 0).length), { timeout: 15_000 }).toBe(7);
});

test('«disegnami un gatto astronauta»: l\'immagine creata compare segnata come fatta con l\'AI, anche senza marcatore', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await stubModello(app, { chiamata: { azione: 'crea', descrizione: 'a cat astronaut floating in space, watercolor' }, finale: 'Ecco il tuo gatto astronauta.' });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'disegnami un gatto astronauta');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco il tuo gatto astronauta.' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  const img = bolla.locator('.filo-galleria-img[data-generata="1"]');
  await expect(img).toHaveCount(1);
  await expect(bolla.locator('figcaption')).toHaveText('Creata con l’AI');
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 10_000 }).toBe(true);
  const disegni = await app.evaluate(() => globalThis.__disegni);
  expect(disegni).toHaveLength(1);
  expect(disegni[0].testo).toContain('cat astronaut');
  await page.screenshot({ path: 'tests/.shots/2272-immagine-creata.png' }).catch(() => {});
});

test('senza un modello che disegna Filo non chiama nessuno e il modello sa dove si sceglie', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await stubModello(app, { chiamata: { azione: 'crea', descrizione: 'un drago' }, finale: 'Non posso disegnarlo: manca il modello.', conPittore: false });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'disegnami un drago');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Non posso disegnarlo' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla.locator('.filo-galleria')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__disegni.length)).toBe(0);
  expect(await app.evaluate(() => globalThis.__vistoDalModello)).toContain('Immagini create in chat');
});
