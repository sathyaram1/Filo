// Verifica #1580, giro 3: il modello cita il pezzo con più spazi di quanti ne abbia il testo e corregge anche una
// parola; la correzione proposta non deve incollare le parole togliendo lo spazio che c'è nel testo.
import { test, expect } from '../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const require = createRequire(import.meta.url);
require('../../../src/content/correttoreRegole.js');
const R = globalThis.SN_CORRETTORE;

const corretto = (testo, riga) => {
  let out = testo;
  for (const s of [...R.segniDaRisposta(riga, testo).segni].reverse()) {
    if (s.segno === 'errore' && s.correzioni.length) out = out.slice(0, s.start) + s.correzioni[0] + out.slice(s.end);
  }
  return out;
};

for (const [testo, riga, atteso] of [
  ['oggi sonno andato al mare', '[oggi  sonno andato][oggi sono andato][verbo][errore]', 'oggi sono andato al mare'],
  ['va bene ma sonno qui', '[va  bene  ma sonno][va bene ma sono][verbo][errore]', 'va bene ma sono qui'],
  ['oggi sonno', '[oggi   sonno][oggi sono][verbo][errore]', 'oggi sono'],
]) {
  test(`r1 «${riga}» su «${testo}» corregge la parola e lascia gli spazi`, () => {
    expect(corretto(testo, riga)).toBe(atteso);
  });
}

test('r1 nella pagina, la correzione di una riga citata con lo spazio doppio lascia «oggi sono andato»', async ({ app, openTab, testServer }) => {
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
      const text = t.includes('sonno') ? '[oggi  sonno andato][oggi sono andato][verbo essere][errore]' : 'NIENTE';
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
  await page.keyboard.type('oggi sonno andato al mare ');
  const segno = page.locator('.sn-spell-overlay .sn-errore', { hasText: 'sonno' });
  await expect(segno).toBeVisible({ timeout: 6000 });
  const b = await riquadroDelSegno(segno);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await menu.principale.locator(':scope > *').first().locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ta')).toHaveValue('oggi sono andato al mare ');
});
