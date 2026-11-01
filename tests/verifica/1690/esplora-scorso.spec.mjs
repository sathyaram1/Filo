// Esplorazione del giro 2 su #1448.12: la riga delle x è la prima visibile di un campo scorso.

import { test, expect } from '../../fixtures/electron.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';

test('esplora campo scorso', async ({ app, openTab, testServer }) => {
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
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;font:14px sans-serif">
<a id="lnk" href="#cliccato" style="display:block;width:760px;height:30px">Rispondi a tutti</a>
<textarea id="f" lang="it" style="display:block;width:760px;height:62px;font:16px/20px sans-serif;padding:0;margin:0;resize:none"></textarea></body>`;
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#f').click();
  await page.keyboard.type("Riga uno.\nRiga due.\nRiga tre.\nl'America l'hanno scoperta nel 14xx, e allora.\nRiga cinque.\nRiga sei.\nRiga sette. ");
  const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
  await page.waitForTimeout(4000);
  await page.locator('#f').evaluate((el) => { el.scrollTop = 60; el.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(800);
  const f = await page.locator('#f').boundingBox();
  await page.screenshot({ path: 'tests/.shots/1690-g2-scorso.png', clip: { x: 0, y: 40, width: 820, height: 120 } }).catch(() => {});
  const vis = await v.isVisible();
  console.log('visibile', vis, 'campo', JSON.stringify(f));
  if (!vis) return;
  const b = await v.boundingBox();
  console.log('classi', await v.getAttribute('class'), JSON.stringify(b));
  const x = await riquadroDelSegno(page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: '14xx' }));
  console.log('x', JSON.stringify(x));
  await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
  await page.mouse.move(x.x + x.width / 2, f.y - 6, { steps: 6 });
  await page.mouse.click(x.x + x.width / 2, f.y - 6);
  await page.waitForTimeout(300);
  console.log('hash', await page.evaluate(() => location.hash), 'valore', JSON.stringify(await page.locator('#f').inputValue()));
});
