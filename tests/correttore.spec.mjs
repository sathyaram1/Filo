// #1446 e #1580 — il correttore a due segni con un modello finto: il codice segna subito pieni gli errori sicuri e
// sbiaditi i dubbi (in attesa, senza segno, le parole maiuscole); il controllo rapido conferma o scarta i dubbi, e
// aggiunge gli errori che il codice non vede; una risposta vuota si ripete una volta; il tasto destro mette la correzione
// in cima; «Correggi tutti gli errori» non tocca i suggerimenti; dove il sito chiede di non correggere non c'è nessun
// segno. Nessuna chiamata esce dalla macchina.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<main>
  <p>Anna: ciao! ci vediamo martedì?</p>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
  <textarea id="nos" lang="it" spellcheck="false" style="display:block;width:760px;height:60px;font:22px monospace;margin-top:12px"></textarea>
  <div class="cm-editor"><div class="cm-content" id="codice" contenteditable="true" style="width:760px;min-height:40px;font:22px monospace;border:1px solid #999;margin-top:12px"></div></div>
  <input id="riga" lang="it" style="width:300px">
  <textarea id="gramm" lang="it" data-gramm="false" style="display:block;width:300px;height:40px"></textarea>
</main>
</body>`;

// `errori` e `suggerimenti`: pezzo → [correzione, motivo] che il modello finto dà quando il pezzo sta nel testo nuovo;
// come il prompt del banco tace sui candidati giusti e risponde NIENTE se non trova niente. Con `__trattieni` la
// risposta del controllo rapido aspetta `__rilascia()`; `__vuote`: quante risposte vuote dà prima di quella vera.
async function apri(app, openTab, testServer, opz = {}) {
  await app.evaluate(async (_e, opz) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: opz.suggerimenti !== undefined },
      // La correzione automatica (#1447) cambierebbe gli errori fissi battuti qui: la prova sta in correttore-automatica.spec.mjs.
      correttore: { modelloErrori: true, ripetizioni: true, automatica: false, ...(opz.correttore || {}) },
    });
    Object.assign(globalThis, {
      __rapide: [], __ragionate: [], __errori: opz.errori || {},
      __suggerimenti: opz.suggerimenti || {}, __trattieni: false, __inAttesa: [], __vuote: 0,
    });
    globalThis.__rilascia = () => { globalThis.__trattieni = false; for (const r of globalThis.__inAttesa.splice(0)) r(); };
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const busta = (t, dopo) => {
      const i = t.indexOf(dopo);
      if (i < 0) return '';
      const a = t.indexOf(M.inizio, i) + M.inizio.length + 1;
      return t.slice(a, t.indexOf(M.fine, a) - 1);
    };
    // Il contenuto imbustato dentro <nome>…</nome> del messaggio del controllo rapido.
    const tag = (t, nome) => {
      const a = t.indexOf(`<${nome}>\n`);
      const b = t.indexOf(`</${nome}>`, a);
      if (a < 0 || b < 0) return '';
      const dentro = t.slice(a, b);
      const i = dentro.indexOf(M.inizio);
      return i < 0 ? '' : dentro.slice(i + M.inizio.length + 1, dentro.indexOf(M.fine) - 1);
    };
    const finto = async ({ messages }) => {
      // Le regole stanno nel system, il testo nel messaggio dell'utente (#1580).
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      const righe = (nuovo, voci, tipo) => Object.entries(voci).filter(([p]) => nuovo.includes(p)).map(([p, [c, m]]) => `[${p}][${c}][${m}][${tipo}]`);
      if (sistema.includes('Sei il controllo rapido')) {
        const nuovo = tag(t, 'testo_nuovo');
        const candidati = tag(t, 'candidati');
        globalThis.__rapide.push({ nuovo, candidati, sistema: messages[0].role === 'system' });
        if (globalThis.__trattieni) await new Promise((r) => globalThis.__inAttesa.push(r));
        if (globalThis.__vuote > 0) { globalThis.__vuote -= 1; return fine(''); }
        return fine(righe(nuovo, globalThis.__errori, 'errore').join('\n') || 'NIENTE');
      }
      if (sistema.includes('proponi SUGGERIMENTI')) {
        const nuovo = busta(t, 'TESTO DA RILEGGERE:\n');
        globalThis.__ragionate.push({ nuovo });
        return fine(righe(nuovo, globalThis.__suggerimenti, 'suggerimento').join('\n') || '[][][][nessuno]');
      }
      return fine('');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, opz);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  // Il dizionario del browser carica le sue lingue all'avvio: finché non c'è, nessuna parola risulta sbagliata.
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

const errore = (page, testo) => page.locator('.sn-spell-overlay .sn-errore', { hasText: testo });
const suggerimento = (page, testo) => page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: testo });
const rapide = (app) => app.evaluate(() => globalThis.__rapide);
const coloreDelSegno = (loc) => loc.evaluate((el) => getComputedStyle(el).textDecorationColor);

async function tastoDestroSu(page, loc) {
  const b = await riquadroDelSegno(loc);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(menuDi(page).pannelli.first()).toBeVisible({ timeout: 5000 });
  return menuDi(page);
}

test('«quseta» compare sbiadito e diventa pieno alla conferma, con «questa» in cima al tasto destro', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { quseta: ['questa', 'Refuso: «questa».'] } });
  await app.evaluate(() => { globalThis.__trattieni = true; });
  await page.locator('#ta').click();
  await page.keyboard.type('ciao quseta ');
  const segno = errore(page, 'quseta');
  await expect(segno).toHaveClass(/sn-dubbio/, { timeout: 4000 });
  const sbiadito = await coloreDelSegno(segno);
  await expect.poll(async () => (await rapide(app)).length).toBeGreaterThan(0);
  expect((await rapide(app))[0].candidati).toContain('quseta');
  await app.evaluate(() => globalThis.__rilascia());
  await expect(segno).not.toHaveClass(/sn-dubbio/, { timeout: 4000 });
  await expect.poll(() => coloreDelSegno(segno)).not.toBe(sbiadito);
  const menu = await tastoDestroSu(page, segno);
  const prima = menu.principale.locator(':scope > *').first();
  await expect(prima).toHaveClass(/sn-menu-correction/);
  await expect(prima).toHaveText(/questa/);
  await expect(menu.locator('.sn-menu-segno')).toHaveText('Refuso: «questa».');
  await expect(menu.voce('Ignora')).toBeVisible();
  await expect(menu.voce('Aggiungi al dizionario')).toBeVisible();
  await prima.locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ta')).toHaveValue('ciao questa ');
  await expect(errore(page, 'quseta')).toHaveCount(0);
});

test('un nome proprio fuori dizionario non ha segno finché il controllo non risponde, e taciuto non ne avrà', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  expect(await nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("Zanzottera")')).toBe(true);
  await app.evaluate(() => { globalThis.__trattieni = true; });
  await page.locator('#ta').click();
  await page.keyboard.type('ho parlato con Zanzottera e quseta ');
  // «quseta», minuscola, è sbiadita subito: è la prova che i segni sono già disegnati mentre il nome aspetta.
  await expect(errore(page, 'quseta')).toHaveClass(/sn-dubbio/, { timeout: 4000 });
  await expect.poll(async () => (await rapide(app)).length).toBeGreaterThan(0);
  expect((await rapide(app))[0].candidati).toContain('Zanzottera');
  await expect(errore(page, 'Zanzottera')).toHaveCount(0);
  await app.evaluate(() => globalThis.__rilascia());
  await page.waitForTimeout(800);
  await expect(errore(page, 'Zanzottera')).toHaveCount(0);
  await page.keyboard.type('e poi Zanzottera ');
  await page.waitForTimeout(800);
  await expect(errore(page, 'Zanzottera')).toHaveCount(0);
});

test('un dubbio sbiadito che il controllo rapido non conferma sparisce alla risposta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  await app.evaluate(() => { globalThis.__trattieni = true; });
  await page.locator('#ta').click();
  await page.keyboard.type('ciao quseta ');
  await expect(errore(page, 'quseta')).toHaveClass(/sn-dubbio/, { timeout: 4000 });
  await expect.poll(async () => (await rapide(app)).length).toBeGreaterThan(0);
  expect((await rapide(app))[0].candidati).toContain('quseta');
  await app.evaluate(() => globalThis.__rilascia());
  await expect(errore(page, 'quseta')).toHaveCount(0, { timeout: 4000 });
  await page.keyboard.type('e ancora quseta ');
  await page.waitForTimeout(800);
  await expect(errore(page, 'quseta')).toHaveCount(0);
});

test('una parola maiuscola fuori dizionario che il controllo dice sbagliata compare piena alla risposta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { Zanzotterra: ['Zanzottera', 'Refuso nel cognome.'] } });
  await app.evaluate(() => { globalThis.__trattieni = true; });
  await page.locator('#ta').click();
  await page.keyboard.type('ho parlato con Zanzotterra ');
  await expect.poll(async () => (await rapide(app)).length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await expect(errore(page, 'Zanzotterra')).toHaveCount(0);
  await app.evaluate(() => globalThis.__rilascia());
  await expect(errore(page, 'Zanzotterra')).toHaveCount(1, { timeout: 4000 });
  await expect(errore(page, 'Zanzotterra')).not.toHaveClass(/sn-dubbio/);
});

test('«qual\'è» e «il il» hanno il segno pieno subito, prima che il modello risponda', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  await app.evaluate(() => { globalThis.__trattieni = true; });
  await page.locator('#ta').click();
  await page.keyboard.type('qual\'è il il motivo? ');
  await expect(errore(page, 'qual\'è')).toHaveCount(1, { timeout: 4000 });
  await expect(errore(page, 'qual\'è')).not.toHaveClass(/sn-dubbio/);
  await expect(errore(page, 'il')).not.toHaveClass(/sn-dubbio/);
  // Il modello non ha ancora risposto: i segni pieni non lo aspettavano, e non gli sono stati chiesti.
  await expect.poll(async () => (await rapide(app)).length, { timeout: 4000 }).toBeGreaterThan(0);
  await page.screenshot({ path: 'tests/.shots/1580-segni-pieni.png' }).catch(() => {});
  const [prima] = await rapide(app);
  expect(prima.candidati).toBe('');
  expect(prima.sistema, 'le regole viaggiano nel messaggio di sistema').toBe(true);
  const menu = await tastoDestroSu(page, errore(page, 'qual'));
  await expect(menu.principale.locator(':scope > *').first()).toHaveText(/qual è/);
  await expect(menu.voce('Correggi tutti gli errori (2)')).toBeVisible();
  await app.evaluate(() => globalThis.__rilascia());
});

test('una risposta vuota del controllo rapido si chiede una volta ancora, e la seconda segna l\'errore', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { 'oggi sonno andato': ['oggi sono andato', 'Qui va il verbo essere.'] } });
  await app.evaluate(() => { globalThis.__vuote = 1; });
  await page.locator('#ta').click();
  await page.keyboard.type('oggi sonno andato al mare ');
  await expect(errore(page, 'sonno')).toHaveCount(1, { timeout: 6000 });
  const lista = await rapide(app);
  expect(lista).toHaveLength(2);
  expect(lista[1].nuovo).toBe(lista[0].nuovo);
  // Due vuote di fila: una ripetizione sola, poi niente.
  await app.evaluate(() => { globalThis.__vuote = 2; globalThis.__rapide = []; });
  await page.keyboard.type('e oggi sonno stato bene ');
  await expect.poll(async () => (await rapide(app)).length, { timeout: 6000 }).toBe(2);
  await page.waitForTimeout(1500);
  expect(await rapide(app)).toHaveLength(2);
});

test('«oggi sonno andato al mare»: un errore su «sonno», con «sono» in cima al tasto destro', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { 'oggi sonno andato': ['oggi sono andato', 'Qui va il verbo essere.'] } });
  await page.locator('#ta').click();
  await page.keyboard.type('oggi sonno andato al mare ');
  const segno = errore(page, 'sonno');
  await expect(segno).toHaveText('sonno', { timeout: 6000 });
  await expect(segno).not.toHaveClass(/sn-dubbio/);
  const menu = await tastoDestroSu(page, segno);
  const prima = menu.principale.locator(':scope > *').first();
  await expect(prima).toHaveText(/^sono/);
  await prima.locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ta')).toHaveValue('oggi sono andato al mare ');
});

test('la parola che si sta scrivendo non è mai segnata e non parte; chiusa, sì', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { quset: ['questo', 'Refuso.'] } });
  await page.locator('#ta').click();
  await page.keyboard.type('ciao a tutti, quset', { delay: 40 });
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(300);
    await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveCount(0);
  }
  expect((await rapide(app)).some((r) => r.nuovo.includes('quset'))).toBe(false);
  await page.keyboard.type(' ');
  await expect(errore(page, 'quset')).toHaveCount(1, { timeout: 4000 });
  await expect(errore(page, 'quset')).not.toHaveClass(/sn-dubbio/, { timeout: 4000 });
});

test('una risposta arrivata dopo un cambio del testo si posa sul pezzo giusto, o si scarta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { 'oggi sonno andato': ['oggi sono andato', 'Verbo essere.'] } });
  await app.evaluate(() => { globalThis.__trattieni = true; });
  const ta = page.locator('#ta');
  await ta.click();
  await page.keyboard.type('oggi sonno andato al mare ');
  await expect.poll(async () => (await rapide(app)).length, { timeout: 4000 }).toBe(1);
  await page.keyboard.press('Home');
  await page.keyboard.type('Ciao! ');
  await app.evaluate(() => globalThis.__rilascia());
  await expect(errore(page, 'sonno')).toHaveCount(1, { timeout: 4000 });
  // Il segno sta sotto la parola spostata, non dove stava prima.
  const dov = await page.evaluate(() => {
    const t = document.getElementById('ta');
    const s = document.querySelector('.sn-spell-overlay .sn-errore').getBoundingClientRect();
    return { segno: s.left - t.getBoundingClientRect().left };
  });
  expect(dov.segno, 'sei caratteri più a destra di dove stava, «oggi » finito alla posizione 5').toBeGreaterThan(120);

  await app.evaluate(() => { globalThis.__trattieni = true; globalThis.__rapide = []; });
  await page.keyboard.press('Control+End');
  await page.keyboard.type('e oggi sonno andato via ');
  await expect.poll(async () => (await rapide(app)).length, { timeout: 4000 }).toBe(1);
  await ta.fill('');
  await page.keyboard.type('tutto a posto ');
  await app.evaluate(() => globalThis.__rilascia());
  await page.waitForTimeout(600);
  await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveCount(0);
});

test('in un campo su più righe il segno sta sotto la parola, sulla sua riga', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { quseta: ['questa', 'Refuso.'] } });
  await page.locator('#ce').click();
  await page.keyboard.type('Prima riga');
  await page.keyboard.press('Enter');
  await page.keyboard.type('seconda riga con quseta dentro ');
  const segno = errore(page, 'quseta');
  await expect(segno).not.toHaveClass(/sn-dubbio/, { timeout: 6000 });
  const r = await page.evaluate(() => {
    const ce = document.getElementById('ce');
    const w = document.createTreeWalker(ce, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && !n.nodeValue.includes('quseta'));
    const range = document.createRange();
    const i = n.nodeValue.indexOf('quseta');
    range.setStart(n, i);
    range.setEnd(n, i + 6);
    const p = range.getBoundingClientRect();
    const s = document.querySelector('.sn-spell-overlay .sn-errore').getBoundingClientRect();
    return { parola: { left: p.left, top: p.top, bottom: p.bottom, right: p.right }, segno: { left: s.left, top: s.top, bottom: s.bottom, right: s.right } };
  });
  expect(Math.abs(r.segno.left - r.parola.left)).toBeLessThan(3);
  expect(Math.abs(r.segno.right - r.parola.right)).toBeLessThan(3);
  expect(r.segno.top).toBeGreaterThan(r.parola.top - 4);
  expect(r.segno.top).toBeLessThan(r.parola.bottom);
});

test('«quasi quasi» non è segnato, «il il» sì', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { 'il il': ['il', '«il» ripetuto.'] } });
  await page.locator('#ta').click();
  await page.keyboard.type('quasi quasi vado piano piano con il il cane ');
  await expect(errore(page, 'il')).toHaveCount(1, { timeout: 6000 });
  await expect(errore(page, 'il')).not.toHaveClass(/sn-dubbio/, { timeout: 6000 });
  await expect(errore(page, 'quasi')).toHaveCount(0);
  await expect(errore(page, 'piano')).toHaveCount(0);
  const menu = await tastoDestroSu(page, errore(page, 'il'));
  await menu.principale.locator(':scope > *').first().locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ta')).toHaveValue('quasi quasi vado piano piano con il cane ');
});

test('«Correggi tutti gli errori» corregge gli errori e non tocca i suggerimenti', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    errori: { quseta: ['questa', 'Refuso.'], 'oggi sonno andato': ['oggi sono andato', 'Verbo essere.'] },
    suggerimenti: { 'alle 18': ['', 'Alle 18 di quale giorno?'] },
  });
  await page.locator('#ta').click();
  await page.keyboard.type('oggi sonno andato a vedere quseta casa alle 18. ');
  await expect(page.locator('.sn-spell-overlay .sn-errore:not(.sn-dubbio)')).toHaveCount(2, { timeout: 6000 });
  await expect(suggerimento(page, 'alle 18')).toHaveCount(1, { timeout: 8000 });
  const parola = await page.evaluate(() => {
    const t = document.getElementById('ta').getBoundingClientRect();
    return { x: t.left + 30, y: t.top + 80 };
  });
  await page.mouse.click(parola.x, parola.y, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Correggi tutti gli errori (2)')).toBeVisible({ timeout: 5000 });
  await menu.voce('Correggi tutti gli errori (2)').click();
  await expect(page.locator('#ta')).toHaveValue('oggi sono andato a vedere questa casa alle 18. ');
  await expect(suggerimento(page, 'alle 18')).toHaveCount(1);
});

test('un campo con spellcheck="false" e un editor di codice non hanno segni né controlli', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { quseta: ['questa', 'Refuso.'] } });
  for (const id of ['#nos', '#codice']) {
    await page.locator(id).click();
    await page.keyboard.type('ciao quseta con il il cane ');
  }
  await page.waitForTimeout(1500);
  await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveCount(0);
  expect(await rapide(app)).toEqual([]);
});

test('spenta la parte del modello restano i segni del codice, pieni i sicuri e sbiaditi i dubbi, e non parte niente', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { quseta: ['questa', 'Refuso.'] }, correttore: { modelloErrori: false } });
  await page.locator('#ta').click();
  await page.keyboard.type('ciao quseta e il il cane, qual\'è? Zanzottera ');
  await expect(page.locator('.sn-spell-overlay .sn-errore.sn-dubbio')).toHaveText(['quseta', 'Zanzottera'], { timeout: 4000 });
  await expect(page.locator('.sn-spell-overlay .sn-errore:not(.sn-dubbio)')).toHaveText(['il', 'qual\'è']);
  await page.waitForTimeout(1200);
  expect(await rapide(app)).toEqual([]);
  // Il tasto destro sul candidato propone lo stesso la correzione che il codice conosce.
  const menu = await tastoDestroSu(page, errore(page, 'qual'));
  await expect(menu.principale.locator(':scope > *').first()).toHaveText(/qual è/);
});

test('lo zigzag del browser si spegne dove i segni li disegna Filo; con «Errori» spento anche nelle caselle di una riga', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  const zigzag = () => page.evaluate(() => Object.fromEntries(['ta', 'ce', 'riga', 'gramm'].map((id) => [id,
    getComputedStyle(document.getElementById(id), '::spelling-error').textDecorationLine])));
  expect(await zigzag()).toEqual({ ta: 'none', ce: 'none', riga: 'spelling-error', gramm: 'spelling-error' });
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { featureFlags: { spellcheck: false } } },
    { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snCorrettore)).toBe('senza-errori');
  await expect.poll(zigzag).toEqual({ ta: 'none', ce: 'none', riga: 'none', gramm: 'none' });
});

// Quello che parte davvero verso il modello, domanda per domanda.
async function spiaPartiti(app) {
  await app.evaluate(() => {
    const vero = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.__partiti = [];
    // Le regole stanno nel system, il testo nell'ultimo messaggio (#1580): si guardano tutti e due.
    const spia = async (req) => { globalThis.__partiti.push(req.messages.map((m) => String(m.content)).join('\n')); return vero(req); };
    globalThis.SN_PROVIDERS.completeWithFallback = spia;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = spia;
  });
  return () => app.evaluate(() => globalThis.__partiti);
}

test('una password scritta dopo una pausa e una carta scritta in due tempi non partono verso il modello', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  const tutti = await spiaPartiti(app);
  const quante = () => app.evaluate(() => globalThis.__rapide.length);
  await page.locator('#ta').click();
  await page.keyboard.type('ciao Marco, la password del wifi è ');
  await expect.poll(quante, { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(400);
  await page.keyboard.type('Gatto2024 e la carta è 4111 1111 ');
  await expect.poll(quante, { timeout: 5000 }).toBe(2);
  await page.waitForTimeout(400);
  await page.keyboard.type('1111 1111 grazie');
  await expect.poll(quante, { timeout: 5000 }).toBe(3);
  const partiti = await tutti();
  expect(partiti.some((t) => t.includes('[dato riservato]'))).toBe(true);
  for (const t of partiti) {
    expect(t).not.toContain('Gatto2024');
    expect(t).not.toMatch(/1111/);
  }
});

// #1446.1 — chi risponde a chi chiede la password la scrive senza annunciarla: l'annuncio è la domanda sopra il campo.

test('una password scritta in chat come risposta a chi la chiede non parte, anche con la domanda appena arrivata', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  const partiti = await spiaPartiti(app);
  const quante = () => app.evaluate(() => globalThis.__rapide.length);
  await page.locator('#ta').click();
  await page.keyboard.type('a martedì allora ');
  await expect.poll(quante, { timeout: 5000 }).toBe(1);
  // Il messaggio parte e subito arriva la domanda: la conversazione letta un attimo fa non la contiene.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'Marco: mi mandi la password del wifi?';
    document.querySelector('#ta').before(p);
  });
  await page.keyboard.type('certo, Gatto2024 ');
  await expect.poll(async () => (await partiti()).some((t) => t.includes('certo, [dato riservato]')), { timeout: 5000 }).toBe(true);
  for (const t of await partiti()) expect(t).not.toContain('Gatto2024');
});

test('nella casella di una riga il controllo chiesto col tasto destro non porta la password data in risposta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  const partiti = await spiaPartiti(app);
  await page.evaluate(() => { document.querySelector('main p').textContent = 'Marco: mi mandi la password del wifi?'; });
  await page.locator('#riga').click();
  await page.keyboard.type('Gatto2024');
  await page.locator('#riga').click({ button: 'right', position: { x: 20, y: 8 } });
  await expect.poll(() => app.evaluate(() => globalThis.__rapide.length), { timeout: 5000 }).toBeGreaterThan(0);
  const tutti = await partiti();
  expect(tutti.some((t) => t.includes('[dato riservato]'))).toBe(true);
  for (const t of tutti) expect(t).not.toContain('Gatto2024');
});

test('il controllo ragionato, a fine frase, non porta la password data in risposta a chi la chiede', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { suggerimenti: {} });
  const partiti = await spiaPartiti(app);
  await page.evaluate(() => { document.querySelector('main p').textContent = 'Marco: mi mandi la password del wifi?'; });
  await page.locator('#ta').click();
  await page.keyboard.type('certo, Gatto2024. ');
  await expect.poll(() => app.evaluate(() => globalThis.__ragionate.length), { timeout: 8000 }).toBeGreaterThan(0);
  const tutti = await partiti();
  expect(tutti.some((t) => t.includes('proponi SUGGERIMENTI') && t.includes('certo, [dato riservato].'))).toBe(true);
  for (const t of tutti) expect(t).not.toContain('Gatto2024');
});

// #1447 — una chat che all'invio svuota la casella da script non manda input: i segni del testo partito non restano
// sulla casella vuota.
test('svuotata la casella da script, i segni del testo di prima spariscono', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {});
  await page.locator('#ta').click();
  await page.keyboard.type('qual\'è il il motivo');
  await expect(errore(page, 'qual\'è')).toHaveCount(1, { timeout: 4000 });
  await page.evaluate(() => { document.getElementById('ta').value = ''; });
  await expect(page.locator('.sn-spell-overlay .sn-errore')).toHaveCount(0, { timeout: 2000 });
  await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll('.sn-spell-overlay')).map((o) => o.textContent).join('')))
    .toBe('');
});
