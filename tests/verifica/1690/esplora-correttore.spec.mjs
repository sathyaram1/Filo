// Esplorazione della verifica #1690: valore del segnaposto in un campo alto una riga (#1448.12), «Filo» dal controllo
// ragionato e dal dizionario (#1655).

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

async function apri(app, openTab, testServer, html, opz = {}) {
  await app.evaluate(async (_e, opz) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, automatica: false, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: false },
    });
    Object.assign(globalThis, { __rapido: opz.rapido || [], __ragionato: opz.ragionato || {}, __prompt: [] });
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      globalThis.__prompt.push(`${sistema}\n${t}`);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (sistema.includes('Sei il controllo rapido')) return fine(globalThis.__rapido.join('\n') || 'NIENTE');
      if (sistema.includes('proponi SUGGERIMENTI')) {
        const out = Object.entries(globalThis.__ragionato).filter(([p]) => t.includes(p)).flatMap(([, r]) => r);
        return fine(out.join('\n') || '[][][][nessuno]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, opz);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';
const UNA_RIGA = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;font:14px sans-serif">
<a id="lnk" href="#cliccato" style="display:block;width:760px;height:30px">Rispondi a tutti</a>
<div id="ce" contenteditable="true" lang="it" style="width:760px;font:16px sans-serif;padding:2px;border:1px solid #999"></div></body>`;

test('campo alto una riga: dal segnaposto il puntatore sale al collegamento sopra il campo e lo clicca', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, UNA_RIGA, { ragionato: { '14xx': [COLOMBO] } });
  await page.locator('#ce').click();
  const scritto = "l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso. ";
  await page.keyboard.type(scritto);
  const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
  await expect(v).toBeVisible({ timeout: 8000 });
  const x = await riquadroDelSegno(page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: '14xx' }));
  const ce = await page.locator('#ce').boundingBox();
  const lnk = await page.locator('#lnk').boundingBox();
  const bv = await v.boundingBox();
  console.log('x', x, 'ce', ce, 'lnk', lnk, 'valore', bv, await v.getAttribute('class'));
  await page.screenshot({ path: 'tests/.shots/1690-una-riga.png', clip: { x: 0, y: 30, width: 820, height: 120 } }).catch(() => {});
  // Il puntatore era sulle x (chi scrive ha cliccato lì), poi sale dritto al collegamento appena sopra il campo.
  await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
  await expect(v).toHaveClass(/sn-sveglio/);
  await page.mouse.move(x.x + x.width / 2, ce.y - 6, { steps: 6 });
  console.log('classe dopo la salita', await v.getAttribute('class'));
  await page.mouse.click(x.x + x.width / 2, ce.y - 6);
  await page.waitForTimeout(400);
  console.log('hash', await page.evaluate(() => location.hash), 'testo', await page.locator('#ce').innerText());
  expect(await page.evaluate(() => location.hash)).toBe('#cliccato');
  await expect(page.locator('#ce')).toHaveText(/nel 14xx/);
});

const DUE = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px;font:16px sans-serif">
<textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
<textarea id="en" lang="en" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
<input id="riga" lang="en" style="width:400px"></body>`;

test('«Filo» dal controllo ragionato e dal dizionario: nessun segno', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, DUE, {
    ragionato: { Filo: ['[usato Filo][usato filo][maiuscola][suggerimento]', '[su filo.red][su filo rosso][?][suggerimento]', '[Filo’s][Filo][x][errore]'] },
    rapido: ['[FILO][filo][maiuscolo][errore]', '[www.filo.red][www.filo.it][dominio][errore]'],
  });
  const dizionario = await nelMondoDelMenu(app, page, 'JSON.stringify(["Filo","FILO","filo","red","Filo\'s"].map((p) => [p, globalThis.SN_DIZIONARIO.sbagliata(p)]))');
  console.log('dizionario', dizionario);
  await page.locator('#ta').click();
  await page.keyboard.type('Ho usato Filo ieri. Poi su filo.red e www.filo.red ho letto. FILO va. ');
  await page.waitForTimeout(6000);
  const segni = await page.locator('.sn-spell-overlay .sn-errore, .sn-spell-overlay .sn-suggerimento').allInnerTexts();
  console.log('segni it', segni);
  await page.locator('#en').click();
  await page.keyboard.type("I used Filo yesterday, Filo's site is filo.red and FILO works. ");
  await page.waitForTimeout(6000);
  const segniEn = await page.locator('.sn-spell-overlay .sn-errore, .sn-spell-overlay .sn-suggerimento').allInnerTexts();
  console.log('segni tutti', segniEn);
  const prompt = await app.evaluate(() => globalThis.__prompt.map((p) => p.includes('Filo è il nome del browser')));
  console.log('prompt col nome', prompt);
  expect(segniEn.filter((s) => /filo/i.test(s))).toEqual([]);
});
