// #1448 giro 6. r1: la rilettura decide il dato solo quando chiede una ricerca; se dà il valore da sé, o tace, il
// valore resta quello di prima finché la frase somiglia a parole. r2: mentre il dato si rifà resta il valore vecchio,
// uguale, e un clic lo mette.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<main><textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea></main>
</body>`;

// `righe(nuovo)`: le righe del controllo ragionato finto per il testo nuovo; `valore(domanda)`: la riga che legge le
// fonti; `attesa(domanda)`: quanto ci mette quella lettura.
async function apri(app, openTab, testServer, { righe, valore, attesa = () => 0 }) {
  await app.evaluate(async (_e, { righe, valore, attesa }) => {
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
    const attesaDi = new Function('t', `return (${attesa})(t);`);
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
      if (t.includes('Chi scrive ha messo delle x')) {
        await new Promise((ok) => setTimeout(ok, attesaDi(t)));
        return fine(valoreDi(t));
      }
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
      return [{ titolo: 'Dati', sito: 'dati.example', url: 'https://dati.example/x', data: '', testo: `risultati per ${q}` }];
    };
  }, { righe: righe.toString(), valore: valore.toString(), attesa: attesa.toString() });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const pronti = (page) => page.locator('.sn-spell-valori .sn-spell-valore:not(.sn-cercando)');
const riletture = (app) => app.evaluate(() => globalThis.__riletture);

async function sostituisci(page, vecchio, nuovo) {
  const ta = page.locator('#ta');
  const i = (await ta.inputValue()).indexOf(vecchio);
  await ta.evaluate((e, [a, b]) => e.setSelectionRange(a, b), [i, i + vecchio.length]);
  await page.keyboard.type(nuovo);
  await page.keyboard.press('End');
}

test('r1 «Luigi XIV morì nel 17xx», corretto XIV in XVI: la rilettura dà 1793 e sopra le x compare 1793', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    righe: (nuovo) => (nuovo.includes('XVI') ? ['[nel 17xx][nel 1793][Luigi XVI fu ghigliottinato il 21 gennaio 1793][segnaposto]']
      : (nuovo.includes('XIV') ? ['[nel 17xx][nel 1715][Luigi XIV morì il 1º settembre 1715][segnaposto]'] : [])),
    valore: () => '[][][][nessuno]',
  });
  await page.locator('#ta').click();
  await page.keyboard.type('Luigi XIV morì nel 17xx. ');
  await expect(pronti(page)).toHaveText(['1715'], { timeout: 10000 });
  await sostituisci(page, 'XIV', 'XVI');
  await expect.poll(async () => (await riletture(app)).some((n) => n.includes('XVI')), { timeout: 8000 }).toBe(true);
  await expect(pronti(page)).toHaveText(['1793'], { timeout: 5000 });
});

test('r1 «La Gambia è indipendente dal 19xx», cambiato in «Lo Zambia»: sopra le x compare 1964', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    righe: (nuovo) => (nuovo.includes('Zambia') ? ['[dal 19xx][dal 1964][Lo Zambia è indipendente dal 24 ottobre 1964][segnaposto]']
      : (nuovo.includes('Gambia') ? ['[dal 19xx][dal 1965][La Gambia è indipendente dal 18 febbraio 1965][segnaposto]'] : [])),
    valore: () => '[][][][nessuno]',
  });
  await page.locator('#ta').click();
  await page.keyboard.type('La Gambia è indipendente dal 19xx. ');
  await expect(pronti(page)).toHaveText(['1965'], { timeout: 10000 });
  await sostituisci(page, 'La Gambia', 'Lo Zambia');
  await expect.poll(async () => (await riletture(app)).some((n) => n.includes('Zambia')), { timeout: 8000 }).toBe(true);
  await expect(pronti(page)).toHaveText(['1964'], { timeout: 5000 });
});

test('r1 «il Nasdaq aveva un p/e di xx», poi aggiunto «al picco delle dot-com» e la rilettura tace: il 31 di oggi non resta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    righe: (nuovo) => (nuovo.includes('dot-com') ? [] : (nuovo.includes('p/e di xx') ? ['[un p/e di xx][][Nasdaq average P/E ratio][cerca][web]'] : [])),
    valore: (t) => (t.includes('dot-com peak') ? '[175][P/E medio del Nasdaq al picco del 2000][1][marzo 2000]' : '[31][P/E medio del Nasdaq oggi][1][20 ottobre 2026]'),
  });
  await page.locator('#ta').click();
  await page.keyboard.type('Il Nasdaq aveva in media un p/e di xx');
  await expect(pronti(page)).toHaveText(['31'], { timeout: 10000 });
  await page.keyboard.type(' al picco delle dot-com. ');
  await expect.poll(async () => (await riletture(app)).some((n) => n.includes('dot-com')), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(3000);
  await expect(pronti(page), 'sopra le x resta il p/e di oggi, con la sua fonte').not.toHaveText(['31']);
});

test('r2 «L\'Iran ha xx abitanti.», cambiato in Iraq: mentre il dato si rifà, un clic sul valore non mette gli abitanti dell\'Iran', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    righe: (nuovo) => (nuovo.includes('Iraq') ? ['[ha xx abitanti][][Popolazione dell\'Iraq][cerca][web]']
      : (nuovo.includes('Iran') ? ['[ha xx abitanti][][Popolazione dell\'Iran][cerca][web]'] : [])),
    valore: (t) => (t.includes('dell\'Iraq') ? '[46 milioni][Abitanti dell\'Iraq][1][2025]' : '[90 milioni][Abitanti dell\'Iran][1][2025]'),
    attesa: (t) => (t.includes('dell\'Iraq') ? 4000 : 0),
  });
  await page.locator('#ta').click();
  await page.keyboard.type("L'Iran ha xx abitanti. ");
  await expect(pronti(page)).toHaveText(['90 milioni'], { timeout: 10000 });
  await sostituisci(page, 'Iran', 'Iraq');
  await expect.poll(async () => (await riletture(app)).some((n) => n.includes('Iraq')), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(300);
  const v = page.locator('.sn-spell-valori .sn-spell-valore').first();
  await v.click();
  await page.waitForTimeout(300);
  await expect(page.locator('#ta'), 'nella frase sull\'Iraq è finito il numero dell\'Iran').not.toHaveValue(/90 milioni/);
});
