// #1448 giro 5, rilievo 1: il valore di un segnaposto dipende dalle parole della frase in cui è stato chiesto, non dal
// dato. Un refuso corto corretto (a → ha) lo fa ricercare o perdere; una parola aggiunta che cambia il dato, o un nome
// simile (Iran → Iraq), lascia il valore vecchio con la sua fonte.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<main><textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea></main>
</body>`;

// `righe(nuovo)`: le righe del controllo ragionato finto per il testo nuovo; `valore(domanda)`: la riga che legge le fonti.
async function apri(app, openTab, testServer, { righe, valore }) {
  await app.evaluate(async (_e, { righe, valore }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
    });
    globalThis.__webChieste = [];
    globalThis.__riletture = [];
    const righeDi = new Function('nuovo', `return (${righe})(nuovo);`);
    const valoreDi = new Function('t', `return (${valore})(t);`);
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const busta = (t, dopo) => {
      const i = t.indexOf(dopo);
      if (i < 0) return '';
      const a = t.indexOf(M.inizio, i) + M.inizio.length + 1;
      return t.slice(a, t.indexOf(M.fine, a) - 1);
    };
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Chi scrive ha messo delle x')) return fine(valoreDi(t));
      if (t.includes('proponi SUGGERIMENTI')) {
        const nuovo = busta(t, 'TESTO NUOVO:\n');
        globalThis.__riletture.push(nuovo);
        return fine(righeDi(nuovo).join('\n') || '[][][][nessuno]');
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      await new Promise((ok) => setTimeout(ok, 1500));
      return [{ titolo: 'Dati', sito: 'dati.example', url: 'https://dati.example/x', data: '', testo: `risultati per ${q}` }];
    };
  }, { righe: righe.toString(), valore: valore.toString() });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const valori = (page) => page.locator('.sn-spell-valori .sn-spell-valore');
const pronti = (page) => page.locator('.sn-spell-valori .sn-spell-valore:not(.sn-cercando)');
const web = (app) => app.evaluate(() => globalThis.__webChieste);
const riletture = (app) => app.evaluate(() => globalThis.__riletture);

async function sostituisci(page, vecchio, nuovo) {
  const ta = page.locator('#ta');
  const i = (await ta.inputValue()).indexOf(vecchio);
  await ta.evaluate((e, [a, b]) => e.setSelectionRange(a, b), [i, i + vecchio.length]);
  await page.keyboard.type(nuovo);
  await page.keyboard.press('End');
}

async function restaIlValore(page, testo, ms) {
  for (const fine = Date.now() + ms; Date.now() < fine;) {
    expect(await page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando').count(), 'il valore è tornato ai puntini').toBe(0);
    await expect(valori(page), 'il valore trovato è sparito').toHaveText([testo]);
    await page.waitForTimeout(200);
  }
}

for (const [come, riga] of [['con altre parole', '[di soli xx][][Google P/E ratio][cerca][web]'], ['tacendo', '']]) {
  test(`r1 «Google a un p/e di soli xx», corretto «a» in «ha» e la frase riletta ${come}: il 27 resta e non si ricerca`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, {
      righe: new Function('nuovo', `return nuovo.includes('Google a un') ? ['[di soli xx][][Alphabet P/E ratio][cerca][web]'] : (nuovo.includes('Google ha un') ? ${JSON.stringify(riga ? [riga] : [])} : []);`),
      valore: () => '[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]',
    });
    await page.locator('#ta').click();
    await page.keyboard.type('Google a un p/e di soli xx, davvero basso. ');
    await expect(pronti(page)).toHaveText(['27'], { timeout: 10000 });
    await sostituisci(page, ' a ', ' ha ');
    await expect.poll(async () => (await riletture(app)).some((n) => n.includes('Google ha un')), { timeout: 8000 }).toBe(true);
    await restaIlValore(page, '27', 3000);
    expect(await web(app)).toEqual(['Alphabet P/E ratio']);
  });
}

test('r1 «il Nasdaq aveva un p/e di xx», fermati e poi aggiunto «al picco delle dot-com»: il valore è quello del picco', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    righe: (nuovo) => (nuovo.includes('dot-com')
      ? ['[un p/e di xx][][Nasdaq average P/E at the 2000 dot-com peak][cerca][web]']
      : (nuovo.includes('p/e di xx') ? ['[un p/e di xx][][Nasdaq average P/E ratio][cerca][web]'] : [])),
    valore: (t) => (t.includes('dot-com peak') ? '[175][P/E medio del Nasdaq al picco del 2000][1][marzo 2000]' : '[31][P/E medio del Nasdaq oggi][1][20 ottobre 2026]'),
  });
  await page.locator('#ta').click();
  await page.keyboard.type('Il Nasdaq aveva in media un p/e di xx');
  await expect(pronti(page)).toHaveText(['31'], { timeout: 10000 });
  await page.keyboard.type(' al picco delle dot-com. ');
  await expect.poll(async () => (await riletture(app)).some((n) => n.includes('dot-com')), { timeout: 8000 }).toBe(true);
  await expect(pronti(page)).toHaveText(['175'], { timeout: 8000 });
});

test('r1 «L\'Iran ha xx abitanti.», cambiato Iran in Iraq: il valore è quello dell\'Iraq', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    righe: (nuovo) => (nuovo.includes('Iraq') ? ['[ha xx abitanti][][Popolazione dell\'Iraq][cerca][web]']
      : (nuovo.includes('Iran') ? ['[ha xx abitanti][][Popolazione dell\'Iran][cerca][web]'] : [])),
    valore: (t) => (t.includes('dell\'Iraq') ? '[46 milioni][Abitanti dell\'Iraq][1][2025]' : '[90 milioni][Abitanti dell\'Iran][1][2025]'),
  });
  await page.locator('#ta').click();
  await page.keyboard.type("L'Iran ha xx abitanti. ");
  await expect(pronti(page)).toHaveText(['90 milioni'], { timeout: 10000 });
  await sostituisci(page, 'Iran', 'Iraq');
  await expect.poll(async () => (await riletture(app)).some((n) => n.includes('Iraq')), { timeout: 8000 }).toBe(true);
  await expect(pronti(page)).toHaveText(['46 milioni'], { timeout: 8000 });
});

test('r1 tolta una parola di riempimento dopo le x, la frase riletta tacendo: il 27 resta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    righe: (nuovo) => (nuovo.includes('davvero molto basso') ? ['[di soli xx][][Alphabet P/E ratio][cerca][web]'] : []),
    valore: () => '[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]',
  });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero molto basso. ');
  await expect(pronti(page)).toHaveText(['27'], { timeout: 10000 });
  await sostituisci(page, 'molto ', '');
  await expect.poll(async () => (await riletture(app)).some((n) => n.includes('davvero basso')), { timeout: 8000 }).toBe(true);
  await restaIlValore(page, '27', 3000);
});
