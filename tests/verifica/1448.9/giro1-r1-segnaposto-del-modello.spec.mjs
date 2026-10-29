// Verifica #1448.9 giro 1, r1: un segnaposto che riconosce solo il controllo ragionato («XX» maiuscole) non deve avere
// sopra l'onda dell'errore del controllo rapido, né il suo menu da errore. Rapido e ragionato finti, nessuna chiamata esce.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<main>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999;margin-top:40px;padding:24px 8px 8px"></div>
</main>
</body>`;

// `ragionato`: pezzo del testo nuovo → righe che il controllo ragionato finto risponde; `rapido`: le righe del controllo
// rapido finto, che sennò non trova niente; `estrai`: la riga del modello che
// legge le fonti; `web` e `wiki`: le fonti che danno le ricerche finte. Con `__trattieniWeb` la ricerca aspetta.
async function apri(app, openTab, testServer, opz = {}) {
  await app.evaluate(async (_e, opz) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: opz.suggerimenti !== false },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: opz.segnaposti !== false, segnapostiWeb: opz.web !== false },
    });
    Object.assign(globalThis, {
      __ragionate: [], __rapide: [], __rapido: opz.rapido || [], __estrazioni: [], __webChieste: [], __wikiChieste: [], __ragionato: opz.ragionato || {},
      __estrai: opz.estrai || '[][][][nessuno]', __fontiWeb: opz.web === false ? [] : (opz.fontiWeb || []),
      __fontiWiki: opz.fontiWiki || [], __trattieniWeb: false, __inAttesaWeb: [],
    });
    globalThis.__rilasciaWeb = () => { globalThis.__trattieniWeb = false; for (const r of globalThis.__inAttesaWeb.splice(0)) r(); };
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const busta = (t, dopo) => {
      const i = t.indexOf(dopo);
      if (i < 0) return '';
      const a = t.indexOf(M.inizio, i) + M.inizio.length + 1;
      return t.slice(a, t.indexOf(M.fine, a) - 1);
    };
    const finto = async ({ messages }) => {
      // Le regole del ragionato stanno nel system, il testo nel messaggio dell'utente (#1580).
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Chi scrive ha messo delle x')) {
        globalThis.__estrazioni.push(t);
        return fine(globalThis.__estrai);
      }
      if (sistema.includes('Sei il controllo rapido')) {
        globalThis.__rapide.push(t);
        return fine(globalThis.__rapido.join('\n') || 'NIENTE');
      }
      if (sistema.includes('proponi SUGGERIMENTI')) {
        const nuovo = busta(t, 'TESTO DA RILEGGERE:\n');
        globalThis.__ragionate.push({ nuovo, prompt: `${sistema}\n${t}`, candidati: busta(t, 'Candidati del controllo automatico') });
        const out = Object.entries(globalThis.__ragionato).filter(([p]) => nuovo.includes(p)).flatMap(([, righe]) => righe);
        return fine(out.join('\n') || '[][][][nessuno]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async (q, l) => { globalThis.__wikiChieste.push({ q, l }); return globalThis.__fontiWiki; };
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      if (globalThis.__trattieniWeb) await new Promise((r) => globalThis.__inAttesaWeb.push(r));
      return globalThis.__fontiWeb;
    };
  }, opz);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const ocra = (page, testo) => page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: testo });
const valore = (page, testo) => page.locator('.sn-spell-valori .sn-spell-valore', { hasText: testo });
const globale = (app, nome) => app.evaluate((_e, n) => globalThis[n], nome);

async function tastoDestroSu(page, loc) {
  const b = await riquadroDelSegno(loc);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(menuDi(page).pannelli.first()).toBeVisible({ timeout: 5000 });
  return menuDi(page);
}

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';


test('r1 le X di un segnaposto riconosciuto dal ragionato non prendono l\'onda dell\'errore del rapido', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    ragionato: { XX: ['[vinto XX scudetti][vinto 36 scudetti][Scudetti vinti dalla Juventus][segnaposto]'] },
    rapido: ['[XX][20][numero scritto a metà][errore]'],
  });
  await page.locator('#ta').click();
  await page.keyboard.type('la Juve ha vinto XX scudetti. ');
  await expect(valore(page, '36')).toBeVisible({ timeout: 8000 });
  await expect.poll(async () => (await globale(app, '__rapide')).length, { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveCount(0);
  const menu = await tastoDestroSu(page, ocra(page, 'XX'));
  await expect(menu.pannelli.first()).toContainText('36');
  await expect(menu.pannelli.first()).not.toContainText('numero scritto a metà');
});
