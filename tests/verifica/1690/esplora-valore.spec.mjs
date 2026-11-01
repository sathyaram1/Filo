// Esplorazione del giro 2 su #1448.12: campi alti una riga di altre forme.

import { test, expect } from '../../fixtures/electron.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';
const SCRITTO = "l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso.";

async function prepara(app) {
  await app.evaluate(async (_e, riga) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, automatica: false, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: false },
    });
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (sistema.includes('Sei il controllo rapido')) return fine('NIENTE');
      if (sistema.includes('proponi SUGGERIMENTI') && t.includes('14xx')) return fine(riga);
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, COLOMBO);
}

const pagina = (campo) => `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;font:14px sans-serif">
<a id="lnk" href="#cliccato" style="display:block;width:760px;height:30px">Rispondi a tutti</a>
${campo}</body>`;

const CAMPI = {
  input: '<input id="f" lang="it" style="display:block;width:760px;font:16px sans-serif;padding:2px;margin:0">',
  textarea1: '<textarea id="f" rows="1" lang="it" style="display:block;width:760px;font:16px sans-serif;padding:2px;margin:0;resize:none"></textarea>',
  stretto: '<div id="f" contenteditable="true" lang="it" style="width:300px;font:16px sans-serif;padding:2px;border:1px solid #999;white-space:nowrap;overflow:hidden"></div>',
  ce: '<div id="f" contenteditable="true" lang="it" style="width:760px;font:16px sans-serif;padding:2px;border:1px solid #999"></div>',
};

for (const [nome, campo] of Object.entries(CAMPI)) {
  test(`esplora ${nome}`, async ({ app, openTab, testServer }) => {
    await prepara(app);
    const page = await testServer.openReady(openTab, pagina(campo), { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await page.locator('#f').click();
    const testo = nome === 'stretto' ? 'scoperta nel 14xx' : SCRITTO;
    await page.keyboard.type(testo);
    const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
    const vis = await v.isVisible().catch(() => false) || await v.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    const f = await page.locator('#f').boundingBox();
    await page.screenshot({ path: `tests/.shots/1690-g2-${nome}.png`, clip: { x: 0, y: 40, width: 820, height: 100 } }).catch(() => {});
    console.log(nome, 'visibile', vis, 'campo', JSON.stringify(f));
    if (!vis) return;
    console.log(nome, 'classi', await v.getAttribute('class'), JSON.stringify(await v.boundingBox()));
    const x = await riquadroDelSegno(page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: '14xx' }));
    const b = await v.boundingBox();
    // Il puntatore arriva da sotto, non dalle x, e clicca sulla parola coperta dal valore.
    await page.mouse.move(b.x + b.width / 2, f.y + f.height + 40);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(300);
    const dopo = await page.locator('#f').evaluate((el) => (el.value !== undefined ? el.value : el.textContent));
    console.log(nome, 'dopo clic sulla parola coperta:', JSON.stringify(dopo));
    // Dal valore sale al collegamento.
    await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
    await page.mouse.move(x.x + x.width / 2, f.y - 6, { steps: 6 });
    await page.mouse.click(x.x + x.width / 2, f.y - 6);
    await page.waitForTimeout(300);
    console.log(nome, 'hash', await page.evaluate(() => location.hash));
    expect(dopo.replace(/ /g, ' ')).toBe(testo);
  });
}
