// Verifica #1580, giro 2: una riga del modello che corregge solo gli spazi (o la sola forma dell'apostrofo) non deve
// diventare un errore la cui correzione cancella le parole: «Correggi tutti gli errori» le lascerebbe sparire.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const require = createRequire(import.meta.url);
require('../../../src/content/correttoreRegole.js');
const R = globalThis.SN_CORRETTORE;

// Quello che fa «Correggi» col segno: il pezzo segnato prende la prima correzione.
const corretto = (testo, riga) => {
  let out = testo;
  for (const s of [...R.segniDaRisposta(riga, testo).segni].reverse()) {
    if (s.segno === 'errore' && s.correzioni.length) out = out.slice(0, s.start) + s.correzioni[0] + out.slice(s.end);
  }
  return out;
};

for (const [nome, testo] of [
  ['con lo spazio doppio nel testo', "ieri l'altro  giorno ho visto Marco"],
  ['con lo spazio singolo nel testo e doppio nella risposta', "ieri l'altro giorno ho visto Marco"],
]) {
  test(`r1 una correzione di soli spazi non cancella le parole, ${nome}`, () => {
    const dopo = corretto(testo, "[l'altro  giorno][l'altro giorno][spazio doppio][errore]");
    expect(dopo).toContain("l'altro");
    expect(dopo).toContain('giorno');
  });
}

test('r1 nella pagina, «Correggi tutti gli errori» dopo una riga sugli spazi lascia «l\'altro giorno» al suo posto', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: true, ripetizioni: true },
    });
    globalThis.__rapide = 0;
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      globalThis.__rapide += 1;
      const text = t.includes("l'altro") ? "[l'altro  giorno][l'altro giorno][spazio doppio][errore]" : 'NIENTE';
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px">
    <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await page.locator('#ta').click();
  await page.keyboard.type("ieri l'altro  giorno ho visto Marco ");
  await expect.poll(() => app.evaluate(() => globalThis.__rapide), { timeout: 6000 }).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  const box = await page.locator('#ta').boundingBox();
  await page.mouse.click(box.x + 40, box.y + 20, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  const tutti = menu.voce('Correggi tutti gli errori');
  if (await tutti.count()) await tutti.first().click();
  else await page.keyboard.press('Escape');
  await expect(page.locator('#ta')).toHaveValue(/l'altro\s+giorno ho visto Marco/);
});
