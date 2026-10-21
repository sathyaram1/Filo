// Verifica #1446 giro 2, rilievo 1: la password detta in chat come risposta a chi la chiede non deve partire.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const pagina = (sopra = '<p>Anna: ciao! ci vediamo martedì?</p>', scuro = false) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif;${scuro ? 'background:#1f1b18;color:#ece4da;color-scheme:dark' : ''}">
<main>
  ${sopra}
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
</main>
</body>`;

async function apri(app, openTab, testServer, opz = {}) {
  await app.evaluate(async (_e, opz) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: opz.suggerimenti !== undefined },
      correttore: { modelloErrori: true, ripetizioni: true },
    });
    Object.assign(globalThis, { __rapide: [], __partiti: [], __errori: opz.errori || {}, __suggerimenti: opz.suggerimenti || {} });
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const busta = (t, dopo) => {
      const i = t.indexOf(dopo);
      if (i < 0) return '';
      const a = t.indexOf(M.inizio, i) + M.inizio.length + 1;
      return t.slice(a, t.indexOf(M.fine, a) - 1);
    };
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      globalThis.__partiti.push(t);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      const righe = (nuovo, voci, tipo) => Object.entries(voci).filter(([p]) => nuovo.includes(p)).map(([p, [c, m]]) => `[${p}][${c}][${m}][${tipo}]`);
      if (t.includes('Sei il controllo rapido di un correttore')) {
        const nuovo = busta(t, 'TESTO NUOVO:\n');
        globalThis.__rapide.push({ nuovo });
        return fine(righe(nuovo, globalThis.__errori, 'errore').join('\n') || '[][][][nessuno]');
      }
      if (t.includes('proponi SUGGERIMENTI')) {
        const nuovo = busta(t, 'TESTO NUOVO:\n');
        return fine(righe(nuovo, globalThis.__suggerimenti, 'suggerimento').join('\n') || '[][][][nessuno]');
      }
      return fine('');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, opz);
  const page = await testServer.openReady(openTab, pagina(opz.sopra, opz.scuro), { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

test('r1 una password scritta in chat come risposta a chi la chiede non parte verso il modello', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { sopra: '<p>Marco: mi mandi la password del wifi?</p>' });
  await page.locator('#ta').click();
  await page.keyboard.type('certo, Gatto2024 ');
  await expect.poll(() => app.evaluate(() => globalThis.__rapide.length), { timeout: 5000 }).toBeGreaterThan(0);
  const partiti = await app.evaluate(() => globalThis.__partiti);
  for (const t of partiti) expect(t).not.toContain('Gatto2024');
});
