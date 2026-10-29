// Verifica #1448.9 giro 2: le x riconosciute solo dalla rilettura e l'errore del controllo rapido, sulle altre porte.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<main>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999;margin-top:40px;padding:24px 8px 8px"></div>
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
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
    });
    Object.assign(globalThis, {
      __ragionate: [], __rapide: [], __rapido: opz.rapido || [], __ragionato: opz.ragionato || {},
      __estrai: opz.estrai || '[][][][nessuno]', __fontiWeb: opz.fontiWeb || [], __trattieniWeb: !!opz.trattieni, __inAttesaWeb: [],
    });
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const busta = (t, dopo) => {
      const i = t.indexOf(dopo);
      if (i < 0) return '';
      const a = t.indexOf(M.inizio, i) + M.inizio.length + 1;
      return t.slice(a, t.indexOf(M.fine, a) - 1);
    };
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Chi scrive ha messo delle x')) return fine(globalThis.__estrai);
      if (sistema.includes('Sei il controllo rapido')) {
        globalThis.__rapide.push(t);
        return fine(globalThis.__rapido.join('\n') || 'NIENTE');
      }
      if (sistema.includes('proponi SUGGERIMENTI')) {
        const nuovo = busta(t, 'TESTO DA RILEGGERE:\n');
        globalThis.__ragionate.push(nuovo);
        const out = Object.entries(globalThis.__ragionato).filter(([p]) => nuovo.includes(p)).flatMap(([, righe]) => righe);
        return fine(out.join('\n') || '[][][][nessuno]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async () => {
      if (globalThis.__trattieniWeb) await new Promise((r) => globalThis.__inAttesaWeb.push(r));
      return globalThis.__fontiWeb;
    };
  }, opz);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const errori = (page) => page.locator('.sn-spell-overlay .sn-errore').allTextContents();
async function campiona(page, ms) {
  const visti = new Set();
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    for (const e of await errori(page)) visti.add(e);
    await page.waitForTimeout(80);
  }
  return [...visti];
}

const JUVE = { XX: ['[vinot XX scudetti][vinot 36 scudetti][Scudetti vinti dalla Juventus][segnaposto]'] };
const RAPIDO = ['[XX][20][numero scritto a metà][errore]', '[vinot][vinto][refuso][errore]'];

test('ce: XX riconosciute dalla rilettura senza onda', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { ragionato: JUVE, rapido: RAPIDO });
  await page.locator('#ce').click();
  await page.keyboard.type('la Juve ha vinot XX scudetti. ');
  await expect(page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '36' })).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(800);
  expect(await errori(page)).toEqual(['vinot']);
});

test('prima della rilettura: onda sulle XX?', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { ragionato: JUVE, rapido: RAPIDO });
  await page.locator('#ta').click();
  await page.keyboard.type('la Juve ha vinot XX scudetti. ');
  const visti = await campiona(page, 4500);
  console.log('VISTI prima', JSON.stringify(visti), JSON.stringify(await app.evaluate(() => globalThis.__ragionate.length)));
  expect(visti).not.toContain('XX');
});

test('ritocco della frase dopo il valore: onda sulle XX?', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { ragionato: JUVE, rapido: RAPIDO });
  await page.locator('#ta').click();
  await page.keyboard.type('la Juve ha vinot XX scudetti. ');
  await expect(page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '36' })).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.locator('#ta').evaluate((el) => { el.focus(); const i = el.value.indexOf('scudetti'); el.setSelectionRange(i + 8, i + 8); });
  await page.keyboard.type(' italiani');
  const visti = await campiona(page, 5000);
  console.log('VISTI ritocco', JSON.stringify(visti), await page.locator('#ta').inputValue());
  expect(visti).not.toContain('XX');
});

test('dato da cercare riconosciuto solo dalla rilettura: niente onda mentre cerca', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    ragionato: { XX: ['[vale XX dollari][][Prezzo attuale del bitcoin in dollari][cerca][web]'] },
    rapido: ['[XX][60000][numero scritto a metà][errore]'],
    trattieni: true,
  });
  await page.locator('#ta').click();
  await page.keyboard.type('oggi il bitcoin vale XX dollari. ');
  await expect(page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando')).toBeVisible({ timeout: 8000 });
  const visti = await campiona(page, 1500);
  console.log('VISTI cerca', JSON.stringify(visti));
  expect(visti).not.toContain('XX');
});
