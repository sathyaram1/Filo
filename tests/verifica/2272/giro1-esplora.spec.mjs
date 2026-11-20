// Verifica #2272 giro 1: immagini nelle risposte della chat, le strade che il caso felice non prova.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function preparaImmagini(app, quante) {
  await app.evaluate(({ nativeImage }, quante) => {
    const png = (k) => {
      const w = 320; const h = 220;
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
    C._dip.scarica = async (url) => {
      const k = Number((/antilope-(\d+)/.exec(url) || [])[1]);
      return new Response(png(k), { status: 200 });
    };
  }, quante);
}

// Il modello finto: ai giri dati chiama lo strumento, poi risponde col testo; $ID0… sono gli id visti nell'ultimo esito.
async function stubModello(app, { chiamate, finali }) {
  await app.evaluate(async (_e, { chiamate, finali }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__passo = 0;
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__passo++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const esiti = messages.filter((m) => m.role !== 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__visti.push(esiti);
      const passo = chiamate[n];
      if (passo) {
        const c = { id: `c${n}`, name: 'web', arguments: JSON.stringify(passo) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      const ids = [...new Set(esiti.match(/\b[ig]\d+\b(?=:|,|\))/g) || [])];
      let text = finali.shift ? finali[Math.min(n - chiamate.filter(Boolean).length, finali.length - 1)] : finali;
      ids.forEach((id, k) => { text = text.split(`$ID${k}`).join(id); });
      for (let i = 0; i < text.length; i += 9) { try { onDelta && onDelta(text.slice(i, i + 9)); } catch (_) {} }
      return { ...base, text, toolCalls: [], finishReason: 'stop' };
    };
  }, { chiamate, finali });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('trascinata nel campo della chat, una foto della risposta diventa un allegato che Filo vede', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 3);
  await stubModello(app, { chiamate: [{ azione: 'immagini', query: 'antilope' }], finali: ['Ecco le antilopi.\n\n[[immagini: $ID0, $ID1, $ID2]]'] });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco le antilopi.' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  const img = bolla.locator('.filo-galleria-img').first();
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  await page.locator('#input').fill('');
  await img.dragTo(page.locator('#input'));
  await page.waitForTimeout(1500);
  const stato = await page.evaluate(() => ({
    campo: document.querySelector('#input').value,
    anteprime: document.querySelectorAll('#imgPreviews img, .dash-img-preview img, [class*="preview"] img').length,
  }));
  console.log('DOPO IL TRASCINO', JSON.stringify(stato));
  expect(stato.campo).not.toMatch(/filo:\/\/icone/);
  expect(stato.anteprime).toBeGreaterThan(0);
});

test('una risposta fatta di sole immagini le mostra, anche riaperta', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 2);
  await stubModello(app, { chiamate: [{ azione: 'immagini', query: 'antilope' }], finali: ['[[immagini: $ID0, $ID1]]'] });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(2, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(2, { timeout: 20_000 });
});

test('il marcatore in un elenco o a metà frase non lascia segni nel testo', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 3);
  await stubModello(app, {
    chiamate: [{ azione: 'immagini', query: 'antilope' }],
    finali: ['Tre specie:\n- Impala [[immagini: $ID0]]\n- Gnu\n  [[immagini: $ID1]]\n- Orice\n\nE questa ```[[immagini: $ID2]]``` è nel codice. Fine.'],
  });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Tre specie' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla).toContainText('Fine.');
  const testo = await bolla.evaluate((b) => b.innerText);
  console.log('TESTO', JSON.stringify(testo));
  console.log('GALLERIE', await bolla.locator('.filo-galleria').count(), await bolla.locator('.filo-galleria-img').count());
  expect(testo).not.toMatch(/[-]|\[\[immagin/);
  await expect(bolla.locator('.filo-galleria-img')).toHaveCount(3);
  await page.screenshot({ path: 'tests/.shots/2272-v-elenco.png' }).catch(() => {});
});

test('al turno dopo Filo può rimettere una foto già mostrata', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 3);
  await stubModello(app, {
    chiamate: [{ azione: 'immagini', query: 'antilope' }],
    finali: ['Ecco.\n\n[[immagini: $ID0, $ID1, $ID2]]', 'Eccola di nuovo:\n\n[[immagini: $ID1]]'],
  });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(3, { timeout: 30_000 });
  await chiedi(page, 'rimettimi la seconda foto da sola');
  const seconda = page.locator('.dash-bubble-filo', { hasText: 'Eccola di nuovo' });
  await expect(seconda).toBeVisible({ timeout: 30_000 });
  console.log('VISTO AL SECONDO TURNO', JSON.stringify((await app.evaluate(() => globalThis.__visti)).slice(-1)[0].slice(-1500)));
  await expect(seconda.locator('.filo-galleria-img')).toHaveCount(1);
});
