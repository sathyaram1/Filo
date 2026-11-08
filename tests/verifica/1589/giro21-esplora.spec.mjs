// Esplorazione del giro 21 (#1589): cosa parte da solo da una pagina di sanità col livello di serie, e da una pagina
// qualunque che mostra un campo password.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SANITA = 'sanita-di-prova.test';
const PUBBLICO = 'sito-pubblico.test';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function modelliFinti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async ({ messages, attempts }) => {
      globalThis.__mandato.push(JSON.stringify(messages));
      return { text: 'Risposta finta.', provider: 'openrouter', model: (attempts && attempts[0] && attempts[0].model) || 'stub', usage: {} };
    };
    P.streamCompleteWithFallback = async ({ messages, attempts, onDelta }) => {
      globalThis.__mandato.push(JSON.stringify(messages));
      try { onDelta && onDelta('Risposta finta.'); } catch (_) {}
      return { text: 'Risposta finta.', provider: 'openrouter', model: (attempts && attempts[0] && attempts[0].model) || 'stub', usage: {} };
    };
  });
}
const conTesto = (app, t) => app.evaluate((_e, t) => globalThis.__mandato.filter((m) => m.includes(t)).length, t);
const tutto = (app) => app.evaluate(() => globalThis.__mandato.map((m) => m.slice(0, 300)));

async function apriSu(openTab, testServer, host, corpo) {
  const url = testServer.html(corpo).replace('127.0.0.1', host);
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  return page;
}

test.describe('sanità di serie', () => {
  test.use({ hostInPiu: [SANITA, PUBBLICO] });

  test('selezione, correttore e tasto destro sulla pagina', async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    await modelliFinti(app);
    await app.evaluate(({}, { SANITA }) => {
      const P = globalThis.SN_PAGINE_DELICATE.PREDEFINITI;
      if (!P.sanita.includes(SANITA)) P.sanita.push(SANITA);
    }, { SANITA });
    const pagina = await apriSu(openTab, testServer, SANITA, `<!doctype html><title>Referto</title>
      <body style="padding:30px;font:18px sans-serif"><p id="p">Emoglobina glicata elevata, diagnosi di diabete mellito tipo due.</p>
      <textarea id="t" style="width:400px;height:120px"></textarea></body>`);
    // Selezione: la spiegazione preparata non deve partire.
    await pagina.locator('#p').dblclick();
    await pagina.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await pagina.mouse.up();
    await pausa(2500);
    console.log('dopo selezione', JSON.stringify(await tutto(app)));
    expect(await conTesto(app, 'diabete'), 'selezione').toBe(0);
    // Tasto destro sul testo selezionato.
    await pagina.locator('#p').click({ button: 'right' });
    await pausa(2500);
    console.log('dopo tasto destro', JSON.stringify(await tutto(app)));
    await menuDi(pagina).superficie.screenshot({ path: 'tests/.shots/1589-g21-menu-sanita.png' }).catch(() => {});
    expect(await conTesto(app, 'diabete'), 'tasto destro sulla selezione').toBe(0);
    await pagina.keyboard.press('Escape');
    // Correttore.
    await pagina.locator('#t').click();
    await pagina.keyboard.type('Domani vado dal medico per la glicemia alta. ', { delay: 20 });
    await pausa(2500);
    console.log('dopo correttore', JSON.stringify(await tutto(app)));
    expect(await conTesto(app, 'glicemia alta'), 'correttore').toBe(0);
  });

  test('pagina pubblica con un campo password: l\'immagine non parte da sola', async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await modelliFinti(app);
    const pagina = await apriSu(openTab, testServer, PUBBLICO, `<!doctype html><title>Accedi</title>
      <body style="margin:0;padding:40px"><img id="foto" src="${PNG}" style="width:160px;height:120px;display:block">
      <form><input name="u" placeholder="utente"><input type="password" name="p"></form></body>`);
    await pausa(800);
    const b = await pagina.locator('#foto').boundingBox();
    await pagina.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    const sezione = menuDi(pagina).locator('.sn-menu-inline[data-subject="image"]');
    await expect(sezione).toBeVisible({ timeout: 10_000 });
    await pausa(1500);
    const immagini = await app.evaluate(() => globalThis.__mandato.filter((m) => m.includes('image_url')).length);
    expect(immagini).toBe(0);
    await expect(sezione.locator('.sn-menu-inline-chiedi-tasto')).toHaveText('Descrivi');
  });
});
