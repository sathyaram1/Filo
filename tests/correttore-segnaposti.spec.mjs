// #1448 — i segnaposti del correttore con modello e ricerca finti: «nel 14xx» mostra 1492 sopra le x e un clic lo mette
// col lampo; «x te», «3x4» e i baci restano senza segni; un dato di adesso passa dalla ricerca finta e il tasto destro ne
// cita la fonte e la data; «Correggi tutti gli errori» riempie i segnaposti; spenti, niente. Nessuna chiamata esce.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<main>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999;margin-top:40px;padding:24px 8px 8px"></div>
</main>
</body>`;

// `ragionato`: pezzo del testo nuovo → righe che il controllo ragionato finto risponde; `estrai`: la riga del modello che
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
      __ragionate: [], __estrazioni: [], __webChieste: [], __wikiChieste: [], __ragionato: opz.ragionato || {},
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

for (const campo of ['#ta', '#ce']) {
  test(`«nel 14xx» (${campo}): 1492 compare sopra le x e un clic lo mette, col lampo`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, { ragionato: { '14xx': [COLOMBO] } });
    await page.locator(campo).click();
    await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
    await expect(ocra(page, '14xx')).toHaveCount(1, { timeout: 4000 });
    const v = valore(page, '1492');
    await expect(v).toBeVisible({ timeout: 8000 });
    await expect(ocra(page, '14xx')).not.toHaveClass(/sn-dubbio/);
    const [segno, sopra] = [await riquadroDelSegno(ocra(page, '14xx')), await v.boundingBox()];
    expect(sopra.y + sopra.height).toBeLessThanOrEqual(segno.y + 2);
    expect(Math.abs((sopra.x + sopra.width / 2) - (segno.x + segno.width / 2))).toBeLessThan(6);
    expect((await globale(app, '__ragionate'))[0].candidati).toContain('14xx (segnaposto)');
    await v.click();
    // Un campo modificabile scrive lo spazio in fondo come spazio unificatore.
    const testo = () => page.locator(campo).evaluate((el) => (el.tagName === 'TEXTAREA' ? el.value : el.textContent).replace(/ /g, ' '));
    await expect.poll(testo).toBe("l'America l'hanno scoperta nel 1492. ");
    await expect(page.locator('.sn-spell-valori .sn-spell-lampo').first()).toBeAttached({ timeout: 1000 });
    await expect(page.locator('.sn-spell-valori .sn-spell-lampo')).toHaveCount(0, { timeout: 3000 });
    await expect(valore(page, '1492')).toHaveCount(0);
    await expect(ocra(page, '14xx')).toHaveCount(0);
    // Il campo ha ancora il fuoco: si continua a scrivere dove si era.
    await page.keyboard.type('Bene');
    await expect.poll(testo).toBe("l'America l'hanno scoperta nel 1492. Bene");
  });
}

test('«x te», «3x4» e i baci non hanno segni, e non arrivano al modello come segnaposti', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Lo prendo io x te, la stanza è 3x4 e domani gioco alla Xbox. A domani xx');
  await expect.poll(async () => (await globale(app, '__ragionate')).length, { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await expect(page.locator('.sn-spell-overlay .sn-suggerimento')).toHaveCount(0);
  await expect(page.locator('.sn-spell-valori .sn-spell-valore')).toHaveCount(0);
  for (const r of await globale(app, '__ragionate')) expect(r.candidati).not.toContain('segnaposto');
});

test('un dato di adesso passa dalla ricerca: mentre cerca respirano i puntini, poi il valore, e il tasto destro cita fonte e data', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    ragionato: { 'p/e di soli xx': ['[di soli xx][][Alphabet P/E ratio][cerca][web]'] },
    fontiWeb: [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet (GOOG) P/E ratio: 27.1 as of October 20, 2026' }],
    estrai: '[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]',
  });
  await app.evaluate(() => { globalThis.__trattieniWeb = true; });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero basso. ');
  await expect(page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando')).toBeVisible({ timeout: 8000 });
  const menuInAttesa = await tastoDestroSu(page, ocra(page, 'xx'));
  await expect(menuInAttesa.locator('.sn-menu-correction-loading')).toHaveText(/Cerco il dato/);
  await app.evaluate(() => globalThis.__rilasciaWeb());
  // Il menu aperto si riempie quando la ricerca risponde.
  await expect(menuInAttesa.principale.locator('.sn-menu-correction').first()).toHaveText(/27/, { timeout: 5000 });
  await expect(menuInAttesa.locator('.sn-menu-segno')).toContainText('Fonte: borsa.example, 20 ottobre 2026');
  await page.keyboard.press('Escape');
  await expect(valore(page, '27')).toBeVisible({ timeout: 5000 });
  expect(await globale(app, '__webChieste')).toEqual(['Alphabet P/E ratio']);
  expect(await globale(app, '__wikiChieste')).toEqual([]);
  const [estrazione] = await globale(app, '__estrazioni');
  expect(estrazione).toContain('Alphabet (GOOG) P/E ratio: 27.1');
  expect(estrazione).toContain('Google ha un p/e di soli xx, davvero basso.');

  const menu = await tastoDestroSu(page, valore(page, '27'));
  const prima = menu.principale.locator(':scope > *').first();
  await expect(prima).toHaveClass(/sn-menu-correction/);
  await expect(prima).toHaveText(/27/);
  await expect(menu.locator('.sn-menu-segno')).toContainText('Rapporto prezzo/utili di Alphabet');
  await expect(menu.locator('.sn-menu-segno')).toContainText('Fonte: borsa.example, 20 ottobre 2026');
  await expect(menu.voce('Apri la fonte')).toBeVisible();
  await expect(menu.voce('Ignora')).toBeVisible();
  await prima.locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ta')).toHaveValue('Google ha un p/e di soli 27, davvero basso. ');
});

test('due «xx» da cercare nella stessa frase hanno ciascuno la sua ricerca e il suo valore', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    ragionato: { 'Nasdaq aveva': ['[di soli xx][][Alphabet P/E ratio][cerca][web]', '[media un p/e di xx][][Nasdaq dot-com average P/E][cerca][web]'] },
    fontiWeb: [{ titolo: 'P/E', sito: 'borsa.example', url: 'https://borsa.example/pe', data: '', testo: 'P/E ratios' }],
    estrai: '[27][P/E di Alphabet][1][20 ottobre 2026]',
  });
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.completeWithFallback;
    const nasdaq = async (a) => {
      const t = String(a.messages[a.messages.length - 1].content);
      if (t.includes('Chi scrive ha messo delle x') && t.includes('Nasdaq dot-com')) {
        return { text: '[175][P/E medio del Nasdaq nel 2000][1][marzo 2000]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      }
      return prima(a);
    };
    globalThis.SN_PROVIDERS.completeWithFallback = nasdaq;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = nasdaq;
  });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, mentre al picco delle dot-com il Nasdaq aveva in media un p/e di xx. ');
  await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
  await expect(valore(page, '175')).toBeVisible({ timeout: 5000 });
  expect((await globale(app, '__webChieste')).sort()).toEqual(['Alphabet P/E ratio', 'Nasdaq dot-com average P/E']);
  const menu = await tastoDestroSu(page, ocra(page, 'xx').last());
  await menu.voce('Correggi tutti gli errori (2)').click();
  await expect(page.locator('#ta')).toHaveValue('Google ha un p/e di soli 27, mentre al picco delle dot-com il Nasdaq aveva in media un p/e di 175. ');
});

// Una ricerca vera dura qualche secondo: qui due, così i puntini di una seconda ricerca si vedono.
async function webLento(app) {
  await app.evaluate(() => {
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    const w = F.web;
    F.web = async (q) => { const r = await w(q); await new Promise((ok) => setTimeout(ok, 2000)); return r; };
  });
}
async function restaIlValore(page, testo, ms) {
  for (const fine = Date.now() + ms; Date.now() < fine;) {
    expect(await page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando').count(), 'il valore è tornato ai puntini').toBe(0);
    await expect(valore(page, testo)).toHaveCount(1);
    await page.waitForTimeout(200);
  }
}
const P_E = {
  ragionato: { 'p/e di soli xx': ['[di soli xx][][Alphabet P/E ratio][cerca][web]'] },
  fontiWeb: [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet P/E ratio: 27.1' }],
  estrai: '[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]',
};

test('lo stesso dato non si ricerca quando la frase cambia altrove: una pausa a metà frase, un refuso corretto', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, P_E);
  await webLento(app);
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, ');
  await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
  await page.keyboard.type('davero basso per una azienda così. ');
  await restaIlValore(page, '27', 4000);
  const i = (await page.locator('#ta').inputValue()).indexOf('davero') + 3;
  await page.locator('#ta').evaluate((e, i) => e.setSelectionRange(i, i), i);
  await page.keyboard.type('v');
  await page.keyboard.press('End');
  await restaIlValore(page, '27', 4000);
  expect(await globale(app, '__webChieste')).toEqual(['Alphabet P/E ratio']);
});

// Un modello vero, rileggendo la frase finita, scrive la ricerca con altre parole o nel dubbio tace: il valore resta.
for (const [come, riga] of [['con altre parole', '[di soli xx][][Google P/E ratio][cerca][web]'], ['tacendo', '[][][][nessuno]']]) {
  test(`la frase finita riletta ${come}: il dato trovato resta e non si ricerca`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, P_E);
    await webLento(app);
    await app.evaluate((_e, riga) => {
      globalThis.__riletture = 0;
      const prima = globalThis.SN_PROVIDERS.completeWithFallback;
      const f = async (a) => {
        const t = String(a.messages[a.messages.length - 1].content);
        // Le fonti di Alphabet non dicono il p/e di Apple.
        if (t.includes('Chi scrive ha messo delle x') && t.includes('Apple P/E')) return { text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
        if (!t.includes('proponi SUGGERIMENTI') || !t.includes('davvero basso')) return prima(a);
        globalThis.__riletture++;
        return { text: t.includes('Apple ha') ? riga.replace('Google', 'Apple') : riga, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      };
      globalThis.SN_PROVIDERS.completeWithFallback = f;
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = f;
    }, riga);
    await page.locator('#ta').click();
    await page.keyboard.type('Google ha un p/e di soli xx, ');
    await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
    await page.keyboard.type('davvero basso per una azienda così. ');
    await expect.poll(() => globale(app, '__riletture'), { timeout: 8000 }).toBeGreaterThan(0);
    await restaIlValore(page, '27', 3000);
    expect(await globale(app, '__webChieste')).toEqual(['Alphabet P/E ratio']);
    // Cambiato il soggetto prima delle x, il dato è un altro: il valore vecchio non resta.
    const i = (await page.locator('#ta').inputValue()).indexOf('Google');
    await page.locator('#ta').evaluate((e, i) => e.setSelectionRange(i, i + 6), i);
    await page.keyboard.type('Apple');
    await expect.poll(async () => (await valore(page, '27').count()) === 0 || (await globale(app, '__webChieste')).length === 2,
      { timeout: 6000 }).toBe(true);
  });
}

// Corretto un refuso prima delle x, che è proprio quello che il correttore segna: il dato è lo stesso.
for (const [come, riga] of [['con altre parole', '[di soli xx][][Google P/E ratio][cerca][web]'], ['tacendo', '[][][][nessuno]']]) {
  test(`un refuso prima delle x corretto, la frase riletta ${come}: il dato trovato resta e non si ricerca`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, { ...P_E, ragionato: { 'Gogle ha': P_E.ragionato['p/e di soli xx'], 'Google ha': [riga] } });
    await webLento(app);
    await page.locator('#ta').click();
    await page.keyboard.type('Gogle ha un p/e di soli xx, davvero basso. ');
    await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
    await page.locator('#ta').evaluate((e) => e.setSelectionRange(2, 2));
    await page.keyboard.type('o');
    await page.keyboard.press('End');
    await expect.poll(async () => (await globale(app, '__ragionate')).some((r) => r.nuovo.includes('Google ha')), { timeout: 8000 }).toBe(true);
    await restaIlValore(page, '27', 3000);
    expect(await globale(app, '__webChieste')).toEqual(['Alphabet P/E ratio']);
  });
}

// Quello che il dato descrive può stare dopo le x: due frasi che cominciano uguali hanno due dati, e cambiare il
// soggetto dopo le x cambia il dato.
test('«Ci sono xx abitanti a Roma.» e «… a Milano.» hanno ciascuna il suo dato, e Roma cambiata in Milano cambia il dato', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    ragionato: {
      'abitanti a Roma': ['[xx abitanti a Roma][][Popolazione di Roma][cerca][web]'],
      'abitanti a Milano': ['[xx abitanti a Milano][][Popolazione di Milano][cerca][web]'],
    },
    fontiWeb: [{ titolo: 'Istat', sito: 'istat.example', url: 'https://istat.example/x', data: '', testo: 'popolazione dei comuni' }],
  });
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.completeWithFallback;
    const f = async (a) => {
      const t = String(a.messages[a.messages.length - 1].content);
      if (!t.includes('Chi scrive ha messo delle x')) return prima(a);
      const text = t.includes('Popolazione di Milano') ? '[1370000][Abitanti di Milano][1][2025]' : '[2750000][Abitanti di Roma][1][2025]';
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = f;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = f;
  });
  const valori = page.locator('.sn-spell-valori .sn-spell-valore:not(.sn-cercando)');
  const ta = page.locator('#ta');
  await ta.click();
  await page.keyboard.type('Ci sono xx abitanti a Roma. ');
  await expect(valori).toHaveText(['2750000'], { timeout: 10000 });
  await page.keyboard.type('Ci sono xx abitanti a Milano. ');
  await expect.poll(async () => (await valori.allTextContents()).sort(), { timeout: 10000 }).toEqual(['1370000', '2750000']);
  expect((await globale(app, '__webChieste')).sort()).toEqual(['Popolazione di Milano', 'Popolazione di Roma']);
  await ta.fill('');
  await page.keyboard.type('Ci sono xx abitanti a Roma. ');
  await expect(valori).toHaveText(['2750000'], { timeout: 10000 });
  const i = (await ta.inputValue()).indexOf('Roma');
  await ta.evaluate((e, i) => e.setSelectionRange(i, i + 4), i);
  await page.keyboard.type('Milano');
  await page.keyboard.press('End');
  await expect(valori).toHaveText(['1370000'], { timeout: 10000 });
});

// La rilettura che chiede un dato decide: un'altra domanda rilegge prima le fonti già lette, e ripaga la ricerca solo
// se lì il dato non c'è. Quando tace, un refuso corto corretto non toglie il valore.
async function rilettura(app, righe, valore) {
  await app.evaluate((_e, [righe, valore]) => {
    const prima = globalThis.SN_PROVIDERS.completeWithFallback;
    const righeDi = new Function('t', `return (${righe})(t);`);
    const valoreDi = new Function('t', `return (${valore})(t);`);
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const f = async (a) => {
      const t = String(a.messages[a.messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Chi scrive ha messo delle x')) return fine(valoreDi(t));
      if (!t.includes('proponi SUGGERIMENTI')) return prima(a);
      await prima(a);
      const i = t.indexOf(M.inizio, t.indexOf('TESTO NUOVO:\n')) + M.inizio.length + 1;
      return fine(righeDi(t.slice(i, t.indexOf(M.fine, i) - 1)).join('\n') || '[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = f;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = f;
  }, [righe.toString(), valore.toString()]);
}
async function sostituisci(page, vecchio, nuovo) {
  const ta = page.locator('#ta');
  const i = (await ta.inputValue()).indexOf(vecchio);
  await ta.evaluate((e, [a, b]) => e.setSelectionRange(a, b), [i, i + vecchio.length]);
  await page.keyboard.type(nuovo);
  await page.keyboard.press('End');
}
const pronti = (page) => page.locator('.sn-spell-valori .sn-spell-valore:not(.sn-cercando)');

for (const riga of ['[di soli xx][][Google P/E ratio][cerca][web]', '']) {
  test(`«a» corretto in «ha» dopo il valore, la frase riletta ${riga ? 'con altre parole' : 'tacendo'}: il 27 resta e non si ricerca`, async ({ app, openTab, testServer }) => {
    const page = await apri(app, openTab, testServer, P_E);
    await webLento(app);
    await rilettura(app, new Function('t', `return t.includes('Google a un') ? ['[di soli xx][][Alphabet P/E ratio][cerca][web]'] : (t.includes('Google ha un') ? ${JSON.stringify(riga ? [riga] : [])} : []);`),
      () => '[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]');
    await page.locator('#ta').click();
    await page.keyboard.type('Google a un p/e di soli xx, davvero basso. ');
    await expect(pronti(page)).toHaveText(['27'], { timeout: 10000 });
    await sostituisci(page, ' a ', ' ha ');
    await expect.poll(async () => (await globale(app, '__ragionate')).some((r) => r.nuovo.includes('Google ha un')), { timeout: 8000 }).toBe(true);
    await restaIlValore(page, '27', 3000);
    expect(await globale(app, '__webChieste')).toEqual(['Alphabet P/E ratio']);
  });
}

test('un dato precisato dopo la pausa («al picco delle dot-com») o un nome cambiato (Iran → Iraq) prende il valore nuovo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, P_E);
  await rilettura(app, (t) => {
    if (t.includes('Iraq ha')) return ['[ha xx abitanti][][Popolazione dell\'Iraq][cerca][web]'];
    if (t.includes('Iran ha')) return ['[ha xx abitanti][][Popolazione dell\'Iran][cerca][web]'];
    if (t.includes('dot-com')) return ['[un p/e di xx][][Nasdaq average P/E at the 2000 dot-com peak][cerca][web]'];
    return t.includes('p/e di xx') ? ['[un p/e di xx][][Nasdaq average P/E ratio][cerca][web]'] : [];
  }, (t) => {
    // Le fonti lette per un dato non dicono l'altro: il primo dei due dati nuovi si ricerca, il secondo no.
    if (t.includes('Iraq')) return t.includes('risultati per Popolazione dell\'Iraq') ? '[46 milioni][Abitanti dell\'Iraq][1][2025]' : '[][][][nessuno]';
    if (t.includes('Iran')) return '[90 milioni][Abitanti dell\'Iran][1][2025]';
    return t.includes('dot-com peak') ? '[175][P/E medio del Nasdaq al picco del 2000][1][marzo 2000]' : '[31][P/E medio del Nasdaq oggi][1][20 ottobre 2026]';
  });
  await app.evaluate(() => {
    globalThis.SN_FONTI_SEGNAPOSTO.web = async (q) => {
      globalThis.__webChieste.push(q);
      return [{ titolo: 'Dati', sito: 'dati.example', url: 'https://dati.example/x', data: '', testo: `risultati per ${q}` }];
    };
  });
  const ta = page.locator('#ta');
  await ta.click();
  await page.keyboard.type('Il Nasdaq aveva in media un p/e di xx');
  await expect(pronti(page)).toHaveText(['31'], { timeout: 10000 });
  await page.keyboard.type(' al picco delle dot-com. ');
  await expect(pronti(page)).toHaveText(['175'], { timeout: 10000 });
  expect(await globale(app, '__webChieste')).toEqual(['Nasdaq average P/E ratio']);
  await ta.fill('');
  await page.keyboard.type("L'Iran ha xx abitanti. ");
  await expect(pronti(page)).toHaveText(['90 milioni'], { timeout: 10000 });
  await sostituisci(page, 'Iran', 'Iraq');
  await expect(pronti(page)).toHaveText(['46 milioni'], { timeout: 10000 });
  expect(await globale(app, '__webChieste')).toEqual(['Nasdaq average P/E ratio', 'Popolazione dell\'Iran', 'Popolazione dell\'Iraq']);
});

test('in un sito delicato (accesso fatto) il dato non si cerca da solo: lo dice, e «Cerca il dato» lo trova', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, P_E);
  await app.evaluate(async (_e, u) => { await globalThis.SN_DELICATE.segnaCampi(u); }, page.url());
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero basso. ');
  await expect.poll(async () => (await globale(app, '__ragionate')).length, { timeout: 8000 }).toBeGreaterThan(0);
  await expect(ocra(page, 'xx')).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando')).toHaveCount(0, { timeout: 5000 });
  expect(await globale(app, '__webChieste')).toEqual([]);
  const menu = await tastoDestroSu(page, ocra(page, 'xx'));
  await expect(menu.locator('.sn-menu-segno')).toHaveText('Su questa pagina non cerco da solo.', { timeout: 3000 });
  await menu.voce('Cerca il dato').click();
  await expect(valore(page, '27')).toBeVisible({ timeout: 8000 });
  expect(await globale(app, '__webChieste')).toEqual(['Alphabet P/E ratio']);
});

test('fonti che non rispondono: «La ricerca non è riuscita» e «Cerca di nuovo», che tornata la rete trova il valore', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, P_E);
  await app.evaluate(() => {
    globalThis.__reteGiu = true;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    for (const k of ['web', 'wikipedia']) {
      const f = F[k];
      F[k] = async (...a) => { if (globalThis.__reteGiu) throw new Error('fetch failed: ENOTFOUND'); return f(...a); };
    }
  });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero basso. ');
  await expect(ocra(page, 'xx')).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando')).toHaveCount(0, { timeout: 8000 });
  const menu = await tastoDestroSu(page, ocra(page, 'xx'));
  await expect(menu.locator('.sn-menu-segno')).toContainText('La ricerca non è riuscita', { timeout: 3000 });
  await app.evaluate(() => { globalThis.__reteGiu = false; });
  await menu.voce('Cerca di nuovo').click();
  await expect(valore(page, '27')).toBeVisible({ timeout: 8000 });
});

test('col web spento un dato di adesso si cerca solo su Wikipedia, e se non c\'è lo dice', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { web: false, ragionato: { 'p/e di soli xx': ['[di soli xx][][Alphabet P/E ratio][cerca][web]'] } });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, davvero basso. ');
  await expect.poll(async () => (await globale(app, '__wikiChieste')).length, { timeout: 8000 }).toBe(1);
  expect(await globale(app, '__webChieste')).toEqual([]);
  expect((await globale(app, '__wikiChieste'))[0]).toEqual({ q: 'Alphabet P/E ratio', l: 'en' });
  const menu = await tastoDestroSu(page, ocra(page, 'xx'));
  await expect(menu.locator('.sn-menu-segno')).toHaveText('Non ho trovato questo dato.', { timeout: 5000 });
  await expect(menu.voce('Ignora')).toBeVisible();
  await menu.voce('Ignora').click();
  await expect(ocra(page, 'xx')).toHaveCount(0);
});

test('«Correggi tutti gli errori» riempie i segnaposti che hanno un valore', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    ragionato: { '14xx': [COLOMBO, '[nel 17xx][nel 1789][La presa della Bastiglia, 14 luglio 1789][segnaposto]'] },
  });
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx e la Bastiglia l'hanno presa nel 17xx. ");
  await expect(page.locator('.sn-spell-valori .sn-spell-valore')).toHaveCount(2, { timeout: 8000 });
  const menu = await tastoDestroSu(page, ocra(page, '17xx'));
  await expect(menu.voce('Correggi tutti gli errori (2)')).toBeVisible();
  await menu.voce('Correggi tutti gli errori (2)').click();
  await expect(page.locator('#ta')).toHaveValue("l'America l'hanno scoperta nel 1492 e la Bastiglia l'hanno presa nel 1789. ");
  await expect(page.locator('.sn-spell-valori .sn-spell-valore')).toHaveCount(0);
});

test('con «Segnaposto» spento le x non hanno segni e il modello non riceve la richiesta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { segnaposti: false, ragionato: { '14xx': [COLOMBO] } });
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect.poll(async () => (await globale(app, '__ragionate')).length, { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await expect(page.locator('.sn-spell-overlay .sn-suggerimento')).toHaveCount(0);
  await expect(page.locator('.sn-spell-valori .sn-spell-valore')).toHaveCount(0);
  expect((await globale(app, '__ragionate'))[0].prompt).not.toContain('segnaposto:');
});

test('coi suggerimenti spenti i segnaposti restano: il controllo parte solo dove ci sono delle x, e chiede solo di loro', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    suggerimenti: false,
    ragionato: { '14xx': [COLOMBO, '[ci vediamo][][Frase poco chiara][suggerimento]'] },
  });
  await page.locator('#ta').click();
  await page.keyboard.type('Ciao, ci vediamo domani. ');
  await page.waitForTimeout(1800);
  expect(await globale(app, '__ragionate')).toEqual([]);
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page, '1492')).toBeVisible({ timeout: 8000 });
  const [r] = await globale(app, '__ragionate');
  expect(r.prompt).toContain('1. segnaposto:');
  expect(r.prompt).not.toContain('contraddizione: il testo dice');
  await expect(ocra(page, 'ci vediamo')).toHaveCount(0);
});
