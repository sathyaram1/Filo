// Prove del giro 3 di verifica (#2272): istruzioni del modello sulle foto, strada di chi usa i crediti, foto stretta.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function prepara(app, { w = 320, h = 220, quante = 1 } = {}) {
  await app.evaluate(({ nativeImage }, { w, h, quante }) => {
    const png = () => {
      const buf = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) { buf[i * 4] = 200; buf[i * 4 + 1] = 120; buf[i * 4 + 2] = 0; buf[i * 4 + 3] = 255; }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG();
    };
    const C = globalThis.__filoImmaginiDelleRisposte;
    C._dip.tavily = async () => [];
    C._dip.commons = async () => Array.from({ length: quante }, (_, k) => ({
      immagine: `https://upload.wikimedia.org/foto-${k}.png`, titolo: `Foto ${k + 1}`, sito: 'commons.wikimedia.org',
      pagina: `https://commons.wikimedia.org/wiki/File:Foto_${k + 1}.png`,
    }));
    C._dip.scarica = async () => new Response(png(), { status: 200 });
  }, { w, h, quante });
}

// Il modello finto: prima chiama lo strumento dato, poi risponde col testo ($ID0… sono gli id dell'esito).
async function modello(app, { chiamata, testo, crediti = false }) {
  await app.evaluate(async (_e, { chiamata, testo, crediti }) => {
    const C = globalThis.SN_CONST;
    if (!crediti) {
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.IMAGE_GEN]: 'pittore' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
    }
    globalThis.__chiamate = 0;
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate++;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const visto = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__visti.push(visto);
      if (n === 0) {
        const c = { id: 'c0', name: 'web', arguments: JSON.stringify(chiamata) };
        try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {}
        return { ...base, text: '', toolCalls: [c], finishReason: 'tool_calls' };
      }
      const ids = [...new Set(visto.match(/\b[ig]\d+\b(?=:|,|\))/g) || [])];
      let t = testo;
      ids.forEach((id, k) => { t = t.split(`$ID${k}`).join(id); });
      for (let i = 0; i < t.length; i += 9) { try { onDelta && onDelta(t.slice(i, i + 9)); } catch (_) {} }
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
  }, { chiamata, testo, crediti });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('r1 nel turno con le foto il modello non ha anche la regola «al massimo un\'immagine nel testo»', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app, { quante: 5 });
  await modello(app, { chiamata: { azione: 'immagini', query: 'antilope' }, testo: 'Ecco.\n\n[[immagini: $ID0, $ID1, $ID2]]' });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(3, { timeout: 30_000 });
  const visto = await app.evaluate(() => globalThis.__visti[1]);
  expect(visto).toContain('[[immagini:');
  // Le due istruzioni si contraddicono: la regola di stile, se resta, deve escludere le foto dei marcatori.
  const regola = (/[^\n]*Al massimo un'immagine nel testo[^\n]*/.exec(visto) || [''])[0];
  expect(regola === '' || /marcator|\[\[immagini|carosell|fila/i.test(regola), regola).toBe(true);
});

test('r2 chi usa i crediti e chiede di disegnare viene mandato dove la scelta si vede, sapendo che serve una sua chiave', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const prima = await app.evaluate(async () => {
    const st = await globalThis.SN_STORAGE.getSettings();
    return { useDefault: st.useDefaultModels, puo: globalThis.SN_CONST.canServeAction(st, globalThis.SN_CONST.ACTIONS.IMAGE_GEN) };
  });
  expect(prima).toEqual({ useDefault: true, puo: false });
  await modello(app, { chiamata: { azione: 'disegna', descrizione: 'un drago' }, testo: 'Non posso disegnarlo.', crediti: true });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'disegnami un drago');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non posso disegnarlo' })).toBeVisible({ timeout: 30_000 });
  const visto = await app.evaluate(() => globalThis.__visti[1] || '');
  const nota = (/\[Immagine NON creata[^\]]*\]/.exec(visto) || [''])[0];
  expect(nota).not.toBe('');
  // La voce indicata, con i modelli predefiniti accesi, nelle Opzioni non si vede.
  const opzioni = await openTab('filo://options/');
  const voceVisibile = await opzioni.getByText('Immagini create in chat').first().isVisible({ timeout: 5000 }).catch(() => false);
  expect(voceVisibile || /chiave/i.test(nota), `voce visibile: ${voceVisibile}; nota: ${nota}`).toBe(true);
});

test('r3 una foto sola molto stretta e alta non ha bande grigie ai lati: la cornice è larga quanto la foto', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app, { w: 300, h: 1200 });
  await modello(app, { chiamata: { azione: 'immagini', query: 'torre' }, testo: 'Ecco la torre.\n\n[[immagine: $ID0]]\n\nAlta.' });
  const page = await openTab(NEWTAB);
  await chiedi(page, 'torre immagine');
  const img = page.locator('.dash-bubble-filo', { hasText: 'Ecco la torre.' }).locator('.filo-galleria-img');
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 30_000 }).toBe(true);
  const r = await img.evaluate((e) => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height }; });
  expect(Math.abs(r.w / r.h - 0.25), JSON.stringify(r)).toBeLessThan(0.03);
});
