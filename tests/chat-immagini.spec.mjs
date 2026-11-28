// Immagini nelle risposte della chat (#2272): «antilope immagine» porta le foto nella risposta, alternate al testo, con
// un carosello che scorre; «disegnami…» crea un'immagine segnata come fatta con l'AI; senza un modello che disegna lo
// si dice. Riaperta la conversazione le immagini restano. Logica pura: tests/unit/immaginiRisposta.test.mjs e
// tests/unit/immaginiDelleRisposte.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const NEWTAB = 'filo://newtab/';

// Foto finte ma vere (PNG che il browser disegna), di colori diversi, scaricate «dal web» dal main.
async function preparaImmagini(app, quante, { w = 320, h = 220 } = {}) {
  await app.evaluate(({ nativeImage }, { quante, w, h }) => {
    const png = (k) => {
      const buf = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) { buf[i * 4] = (40 * k) % 255; buf[i * 4 + 1] = 120; buf[i * 4 + 2] = 200 - 20 * k; buf[i * 4 + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG();
    };
    const C = globalThis.__filoImmaginiDelleRisposte;
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
  }, { quante, w, h });
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
        const c = { id: 'c0', name: 'web', arguments: JSON.stringify(chiamata) };
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
    chiamata: { azione: 'immagini', query: 'antilope' },
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
  await expect(menu.locator('[data-tip="Copia immagine"], [title="Copia immagine"], :text-is("Copia immagine")').first()).toBeAttached();
  await expect(menu.locator('[data-tip="Salva immagine"], [title="Salva immagine"], :text-is("Salva immagine come…"), :text-is("Salva immagine")').first()).toBeAttached();
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
  await stubModello(app, { chiamata: { azione: 'disegna', descrizione: 'a cat astronaut floating in space, watercolor' }, finale: 'Ecco il tuo gatto astronauta.' });
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
  await stubModello(app, { chiamata: { azione: 'disegna', descrizione: 'un drago' }, finale: 'Non posso disegnarlo: manca il modello.', conPittore: false });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'disegnami un drago');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Non posso disegnarlo' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla.locator('.filo-galleria')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__disegni.length)).toBe(0);
  const visto = await app.evaluate(() => globalThis.__vistoDalModello);
  expect(visto).toContain('Immagine NON creata');
  expect(visto).toContain('alla voce «Immagini create in chat»');
});

async function fotoInRisposta(app, openTab, { quante = 2, finale = 'Ecco.\n\n[[immagini: $ID0, $ID1]]\n\nFine.', w, h } = {}) {
  await preparaImmagini(app, quante, { w, h });
  await stubModello(app, { chiamata: { azione: 'immagini', query: 'antilope' }, finale });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const imgs = page.locator('.dash-bubble-filo .filo-galleria-img');
  await expect(imgs.first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => imgs.evaluateAll((els) => els.every((e) => e.complete && e.naturalWidth > 0)), { timeout: 15_000 }).toBe(true);
  return { page, imgs };
}

test('una foto sola e larga (16:9) sta tutta dentro la risposta, senza parti fuori dal bordo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const { page } = await fotoInRisposta(app, openTab, { quante: 1, w: 800, h: 450, finale: 'Ecco la savana.\n\n[[immagine: $ID0]]\n\nBella.' });
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco la savana.' });
  const m = await bolla.evaluate((b) => {
    const s = b.querySelector('.filo-galleria-scorre');
    const i = b.querySelector('.filo-galleria-img').getBoundingClientRect();
    return { foto: i.right, bolla: b.getBoundingClientRect().right, fuori: s.scrollWidth - s.clientWidth, larga: i.width, alta: i.height };
  });
  expect(m.fuori, JSON.stringify(m)).toBeLessThanOrEqual(1);
  expect(m.foto, JSON.stringify(m)).toBeLessThanOrEqual(m.bolla);
  expect(Math.abs(m.larga / m.alta - 16 / 9), 'non deformata').toBeLessThan(0.05);
});

test('tasto destro su una foto trovata: salva il file, copia e cerca l\'indirizzo del web, mai quello della copia', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const fs = await import('node:fs');
  const { page, imgs } = await fotoInRisposta(app, openTab);
  const menu = menuDi(page);
  const originale = await app.evaluate(() => globalThis.__scaricate[0]);
  expect(originale).toMatch(/^https:\/\/upload\.wikimedia\.org\//);

  await app.evaluate(({ clipboard }) => clipboard.clear());
  await imgs.first().click({ button: 'right' });
  // A icone (#2555): un'icona, o una variante nel menu dell'icona dello stesso verbo.
  await menu.scegli('Copia URL immagine');
  await expect.poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toBe(originale);

  // Si registra la scheda che Filo apre, senza andare in rete: con la rete Google porta Lens altrove e l'indirizzo
  // della scheda non dice più cosa si è chiesto (#2615).
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    globalThis.__aperte = [];
    const vera = tm.openTab.bind(tm);
    tm.openTab = (url, opts) => {
      if (/^https:\/\/lens\.google\.com\//.test(String(url))) { globalThis.__aperte.push(String(url)); return 'scheda-lens'; }
      return vera(url, opts);
    };
  });
  await imgs.first().click({ button: 'right' });
  await menu.scegli('Cerca immagine');
  await expect.poll(() => app.evaluate(() => globalThis.__aperte), { timeout: 10_000, message: 'Google Lens non si è aperto' })
    .toEqual([`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(originale)}`]);

  const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR || '');
  expect(dir).not.toBe('');
  await imgs.first().click({ button: 'right' });
  await menu.scegli('Salva immagine come');
  const salvate = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)) : []);
  await expect.poll(() => salvate().length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(fs.statSync(`${dir}/${salvate()[0]}`).size).toBeGreaterThan(100);
});

test('tasto destro su un\'immagine creata: niente indirizzo da copiare o cercare, perché non ne ha uno', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await stubModello(app, { chiamata: { azione: 'disegna', descrizione: 'un drago' }, finale: 'Ecco il drago.' });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'disegnami un drago');
  const img = page.locator('.dash-bubble-filo .filo-galleria-img[data-generata="1"]');
  await expect(img).toHaveCount(1, { timeout: 30_000 });
  await img.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Copia immagine')).toBeVisible({ timeout: 10_000 });
  await expect(menu.voce('Copia URL immagine')).toHaveCount(0);
  await expect(menu.voce('Cerca immagine')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('ingrandita una foto del carosello, le frecce della tastiera passano alle altre', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const { page, imgs } = await fotoInRisposta(app, openTab, { quante: 3, finale: 'Ecco.\n\n[[immagini: $ID0, $ID1, $ID2]]' });
  const srcs = await imgs.evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  await imgs.first().click();
  const grande = page.locator('#lightbox.open img');
  await expect(grande).toHaveAttribute('src', srcs[0]);
  await page.keyboard.press('ArrowRight');
  await expect(grande).toHaveAttribute('src', srcs[1]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(grande).toHaveAttribute('src', srcs[0]);
  await page.keyboard.press('ArrowLeft');
  await expect(grande).toHaveAttribute('src', srcs[2]);
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox.open')).toHaveCount(0);
});

test('fermata a metà, la risposta tiene a schermo le foto della parte già scritta', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaImmagini(app, 2);
  await stubModello(app, { chiamata: { azione: 'immagini', query: 'antilope' }, finale: 'x' });
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      if (globalThis.__chiamate === 0) return prima(o);
      globalThis.__chiamate++;
      const visto = o.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const ids = [...new Set(visto.match(/\b[ig]\d+\b(?=:|,|\))/g) || [])];
      const text = `Ecco le antilopi che ho trovato.\n\n[[immagini: ${ids[0]}, ${ids[1]}]]\n\n` + 'Un testo lungo che arriva piano. '.repeat(80);
      for (let i = 0; i < text.length; i += 4) {
        if (o.signal && o.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        if (o.onDelta) o.onDelta(text.slice(i, i + 4));
        await new Promise((r) => setTimeout(r, 25));
      }
      return { model: o.attempts[0].model, provider: o.attempts[0].provider, usage: {}, reasoningDetails: [], text, toolCalls: [], finishReason: 'stop' };
    };
  });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco le antilopi' });
  await expect(bolla).toContainText('Un testo lungo', { timeout: 30_000 });
  await page.locator('#stopBtn, [aria-label="Ferma"], [data-tip="Ferma"]').first().click();
  await expect(page.getByText('Fermato a metà della risposta')).toBeVisible({ timeout: 10_000 });
  await expect(bolla.locator('.filo-galleria-img')).toHaveCount(2, { timeout: 10_000 });
  await expect(bolla).not.toContainText('[[immagin');
});

test('le copie delle foto restano finché una chat le nomina, e se ne vanno con la chat cancellata', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const fs = await import('node:fs');
  const path = await import('node:path');
  await fotoInRisposta(app, openTab);
  const file = await app.evaluate(async () => {
    const C = globalThis.__filoCopieIcone;
    const chats = await globalThis.SN_FILO_CHATS.list({ nascoste: true });
    const chat = chats.find((c) => (c.messages || []).some((m) => Array.isArray(m.immagini) && m.immagini.length));
    const srcs = globalThis.SN_IMMAGINI_RISPOSTA.copieDi(chat.messages);
    return { chat: chat.id, cartella: C.cartella(), nomi: srcs.map((s) => C.nomeDa(s)) };
  });
  expect(file.nomi.length).toBe(2);
  const percorsi = file.nomi.map((n) => path.join(file.cartella, n));
  for (const p of percorsi) expect(fs.existsSync(p), p).toBe(true);
  // La pulizia dell'avvio, passata la grazia delle copie appena scritte: quelle di una chat viva restano.
  await new Promise((r) => setTimeout(r, 1500));
  await app.evaluate(() => globalThis.__filoCopieIcone.pulisci());
  for (const p of percorsi) expect(fs.existsSync(p), `dopo la pulizia: ${p}`).toBe(true);
  // Cancellata la conversazione, le sue copie se ne vanno.
  await app.evaluate((_e, id) => globalThis.SN_FILO_CHATS.remove(id), file.chat);
  await expect.poll(() => percorsi.filter((p) => fs.existsSync(p)).length, { timeout: 10_000 }).toBe(0);
});

test('«cancella tutte le conversazioni» porta via anche le copie delle foto', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const fs = await import('node:fs');
  const path = await import('node:path');
  await fotoInRisposta(app, openTab);
  const percorsi = await app.evaluate(async () => {
    const C = globalThis.__filoCopieIcone;
    const chats = await globalThis.SN_FILO_CHATS.list({ nascoste: true });
    return chats.flatMap((c) => globalThis.SN_IMMAGINI_RISPOSTA.copieDi(c.messages)).map((s) => C.cartella() + '\u0000' + C.nomeDa(s));
  });
  const veri = percorsi.map((x) => path.join(...x.split('\u0000')));
  expect(veri.length).toBe(2);
  for (const p of veri) expect(fs.existsSync(p), p).toBe(true);
  await new Promise((r) => setTimeout(r, 1200));
  await app.evaluate(() => globalThis.SN_FILO_CHATS.clear());
  await expect.poll(() => veri.filter((p) => fs.existsSync(p)).length, { timeout: 10_000 }).toBe(0);
});
