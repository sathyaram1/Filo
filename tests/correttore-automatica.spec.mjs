// #1447 — la correzione automatica a fine parola: «perchè » diventa «perché» allo spazio col lampo, e l'annulla subito
// dopo la riporta indietro col cursore al suo posto (anche dalla barra del Mac); i nomi prendono la maiuscola dove chi
// scrive la usa; una correzione annullata due volte non torna, e la pagina del correttore la mostra e la toglie; una
// parola fuori dizionario scritta tre volte non si segna più, «qual'è» resta un errore; una correzione scelta tre volte
// diventa automatica. Il testo che mette uno script non si tocca. Nessuna chiamata esce dalla macchina. I contatori
// (#1586): ogni correzione per fonte, fatta, annullata e imparata.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';
import { voceOggi } from './helpers/riquadriOggi.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
</body>`;
const URL_CORRETTORE = 'filo://spellcheck/spellcheck.html';

// `errori`: pezzo → [correzione, motivo] che il controllo rapido finto conferma; senza, la parte del modello è spenta e
// restano i segni del codice.
async function apri(app, openTab, testServer, { errori = null, correttore = {} } = {}) {
  await app.evaluate(async (_e, { errori, correttore }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: !!errori, ripetizioni: true, automatica: true, ...correttore },
    });
    globalThis.__errori = errori || {};
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    const tag = (t, nome) => {
      const a = t.indexOf(`<${nome}>\n`);
      const b = t.indexOf(`</${nome}>`, a);
      if (a < 0 || b < 0) return '';
      const dentro = t.slice(a, b);
      const i = dentro.indexOf(M.inizio);
      return i < 0 ? '' : dentro.slice(i + M.inizio.length + 1, dentro.indexOf(M.fine) - 1);
    };
    const finto = async ({ messages }) => {
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (!String(messages[0].content).includes('Sei il controllo rapido')) return fine('');
      const nuovo = tag(String(messages[messages.length - 1].content), 'testo_nuovo');
      const righe = Object.entries(globalThis.__errori).filter(([p]) => nuovo.includes(p)).map(([p, [c, m]]) => `[${p}][${c}][${m}][errore]`);
      return fine(righe.join('\n') || 'NIENTE');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { errori, correttore });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

const errore = (page, testo) => page.locator('.sn-spell-overlay .sn-errore', { hasText: testo });
const valore = (page) => page.locator('#ta').inputValue();
const cursore = (page) => page.evaluate(() => document.getElementById('ta').selectionStart);
const magazzino = (app, chiave) => app.evaluate(async (_e, k) => (await globalThis.chrome.storage.local.get(k))[k] ?? null, chiave);
const imparato = (app) => magazzino(app, 'sn_correttore_imparato');

// Si torna alla scheda come l'utente, dalla barra delle schede.
async function attiva(shell, indirizzo) {
  await shell.evaluate(async (u) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => x.url === u);
    if (t) await window.filoShell.tabs.activate(t.id);
  }, indirizzo);
}

async function svuota(page, sel = '#ta') {
  await page.locator(sel).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

// Il punto in mezzo al pezzo [da, a) del testo del campo modificabile.
async function puntoNelCampo(page, da, a) {
  return page.evaluate(([da, a]) => {
    const el = document.getElementById('ce');
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    let tot = 0;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const len = n.nodeValue.length;
      if (da >= tot && da <= tot + len) r.setStart(n, da - tot);
      if (a >= tot && a <= tot + len) { r.setEnd(n, a - tot); break; }
      tot += len;
    }
    const q = r.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  }, [da, a]);
}

test('«perchè » diventa «perché» allo spazio col lampo, e l\'annulla subito dopo lo riporta col cursore dopo lo spazio', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ok perchè');
  expect(await valore(page), 'mentre si scrive la parola non cambia').toBe('ok perchè');
  await page.keyboard.type(' ');
  expect(await valore(page)).toBe('ok perché ');
  expect(await cursore(page)).toBe(10);
  const lampo = page.locator('.sn-spell-lampo');
  await expect(lampo.first()).toBeVisible();
  const colore = await lampo.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(colore).not.toBe('rgba(0, 0, 0, 0)');
  const b = await lampo.first().boundingBox();
  expect(b.width).toBeGreaterThan(40);
  await page.screenshot({ path: 'tests/.shots/1447-lampo.png' }).catch(() => {});
  await expect(lampo).toHaveCount(0, { timeout: 3000 });

  await page.keyboard.press('Control+z');
  expect(await valore(page)).toBe('ok perchè ');
  expect(await cursore(page), 'il cursore resta dopo lo spazio: il tasto dopo non cancella la parola').toBe(10);
  await page.keyboard.type('va bene ');
  expect(await valore(page)).toBe('ok perchè va bene ');
  // Annullata, resta un errore segnato.
  await expect(errore(page, 'perchè')).toHaveCount(1, { timeout: 4000 });
});

test('un secondo annulla toglie quello che si era scritto, non rimette la correzione', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ok perchè ');
  expect(await valore(page)).toBe('ok perché ');
  await page.keyboard.press('Control+z');
  expect(await valore(page)).toBe('ok perchè ');
  await page.keyboard.press('Control+z');
  expect(await valore(page)).not.toContain('perché');
  expect((await valore(page)).length).toBeLessThan('ok perchè '.length);
});

test('nel campo modificabile il cursore resta dopo lo spazio, e la punteggiatura chiude la parola subito', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('un pò di tempo, perchè? ');
  await expect(page.locator('#ce')).toHaveText('un po\' di tempo, perché? ');
  await page.keyboard.type('fine');
  await expect(page.locator('#ce')).toHaveText('un po\' di tempo, perché? fine');
  // La parola a inizio riga resta sulla sua riga: la correzione non si porta via l'a capo prima.
  await svuota(page, '#ce');
  await page.keyboard.type('Ciao,');
  await page.keyboard.press('Enter');
  await page.keyboard.type('marco ');
  await expect.poll(() => page.locator('#ce').innerText()).toMatch(/^Ciao,\n+Marco\s$/);
});

test('«marco» prende la maiuscola dove chi scrive usa le maiuscole, e non dove scrive tutto minuscolo apposta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('Domani vedo marco e anthropic. ');
  expect(await valore(page)).toBe('Domani vedo Marco e Anthropic. ');
  await svuota(page);
  await page.keyboard.type('ciao come va. tutto bene. domani vedo marco ');
  expect(await valore(page)).toBe('ciao come va. tutto bene. domani vedo marco ');
  // Lì, un nome minuscolo non è nemmeno un errore.
  await page.waitForTimeout(400);
  await expect(errore(page, 'marco')).toHaveCount(0);
  // Gli errori fissi invece si correggono anche lì.
  await page.keyboard.type('perchè ');
  expect(await valore(page)).toBe('ciao come va. tutto bene. domani vedo marco perché ');
  // Dentro un indirizzo o un nome di file niente.
  await svuota(page);
  await page.keyboard.type('Apri google.com e marco.txt ');
  expect(await valore(page)).toBe('Apri google.com e marco.txt ');
});

test('una correzione annullata due volte non torna; la pagina del correttore la mostra e da lì si toglie', async ({ app, shell, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  // La prima volta con l'annulla, subito dopo.
  await page.locator('#ce').click();
  await page.keyboard.type('Domani vedo marco ');
  await expect(page.locator('#ce')).toHaveText('Domani vedo Marco ');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ce')).toHaveText('Domani vedo marco ');
  await page.keyboard.type('al mare. ');
  await expect(page.locator('#ce')).toHaveText('Domani vedo marco al mare. ');
  // La seconda dal tasto destro sulla parola, anche dopo aver scritto altro.
  await svuota(page, '#ce');
  await page.keyboard.type('Domani vedo marco al mare. ');
  await expect(page.locator('#ce')).toHaveText('Domani vedo Marco al mare. ');
  const p = await puntoNelCampo(page, 12, 17);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Annulla correzione')).toBeVisible({ timeout: 5000 });
  await menu.voce('Annulla correzione').click();
  await expect(page.locator('#ce')).toHaveText('Domani vedo marco al mare. ');
  await expect.poll(async () => (await imparato(app))?.rifiutate).toEqual(['marco']);
  // La terza volta resta com'è scritta.
  await svuota(page, '#ce');
  await page.keyboard.type('Domani vedo marco ');
  await page.waitForTimeout(200);
  await expect(page.locator('#ce')).toHaveText('Domani vedo marco ');

  const pagina = await openTab(URL_CORRETTORE);
  const riga = pagina.locator('#rifiutateList .sn-spell-word');
  await expect(riga).toHaveCount(1, { timeout: 8000 });
  await expect(riga).toHaveValue('marco');
  await pagina.locator('#rifiutateList .sn-spell-row button').click();
  await expect(riga).toHaveCount(0);
  await expect(pagina.locator('#rifiutateEmpty')).toBeVisible();

  await attiva(shell, page.url());
  await svuota(page, '#ce');
  await page.keyboard.type('Domani vedo marco ');
  await expect(page.locator('#ce')).toHaveText('Domani vedo Marco ');
});

test('l\'annulla della barra dei menu del Mac riporta indietro la correzione come Ctrl+Z', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ok perchè ');
  expect(await valore(page)).toBe('ok perché ');
  const host = new URL(page.url()).host;
  await app.evaluate(({ webContents }, h) => {
    for (const wc of webContents.getAllWebContents()) {
      try { if (new URL(wc.getURL()).host === h) wc.undo(); } catch (_) {}
    }
  }, host);
  await expect.poll(() => valore(page)).toBe('ok perchè ');
  expect(await cursore(page)).toBe(10);
});

test('«ciuruglio» scritto tre volte non si segna più e compare fra le parole imparate, da dove si toglie; «qual\'è» no', async ({ app, shell, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  for (let i = 0; i < 3; i++) {
    await svuota(page);
    await page.keyboard.type('che ciuruglio ');
    if (i < 2) await expect(errore(page, 'ciuruglio')).toHaveCount(1, { timeout: 4000 });
  }
  await expect(errore(page, 'ciuruglio')).toHaveCount(0, { timeout: 4000 });
  for (let i = 0; i < 3; i++) {
    await svuota(page);
    await page.keyboard.type('qual\'è ');
    expect(await valore(page), `«qual'è» scritto ${i + 1} volte`).toBe('qual è ');
  }
  // Annullata due volte non torna da sé, ma resta un errore: non si impara mai.
  for (let i = 0; i < 2; i++) {
    await svuota(page);
    await page.keyboard.type('qual\'è ');
    await page.keyboard.press('Control+z');
    expect(await valore(page)).toBe('qual\'è ');
  }
  await svuota(page);
  await page.keyboard.type('qual\'è ');
  expect(await valore(page)).toBe('qual\'è ');
  await expect(errore(page, 'qual')).toHaveCount(1, { timeout: 4000 });

  const pagina = await openTab(URL_CORRETTORE);
  const parole = pagina.locator('#dictList .sn-spell-word');
  await expect(parole).toHaveCount(1, { timeout: 8000 });
  await expect(parole).toHaveValue('ciuruglio');
  await pagina.locator('#dictList .sn-spell-row button').click();
  await expect(parole).toHaveCount(0);

  await attiva(shell, page.url());
  await svuota(page);
  await page.keyboard.type('che ciuruglio ');
  await expect(errore(page, 'ciuruglio')).toHaveCount(1, { timeout: 4000 });
});

test('«Ignora» su una parola fuori dizionario la impara; su un refuso di una parola vera vale solo lì', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('che ciuruglio e propio ');
  for (const parola of ['ciuruglio', 'propio']) {
    const segno = errore(page, parola);
    await expect(segno).toHaveCount(1, { timeout: 4000 });
    const b = await riquadroDelSegno(segno);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    await menuDi(page).voce('Ignora').click();
    await expect(segno).toHaveCount(0);
    // «propio» è a un tasto da «proprio»: resta fuori dalle parole imparate.
    await expect.poll(() => magazzino(app, 'sn_personal_dict')).toEqual(['ciuruglio']);
  }
  await svuota(page);
  await page.keyboard.type('che ciuruglio e propio ');
  await expect(errore(page, 'propio')).toHaveCount(1, { timeout: 4000 });
  await expect(errore(page, 'ciuruglio')).toHaveCount(0);
});

test('una correzione scelta tre volte dal tasto destro diventa automatica e compare fra le correzioni', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { errori: { propio: ['proprio', 'Refuso: «proprio».'] } });
  for (let i = 0; i < 3; i++) {
    await svuota(page);
    await page.keyboard.type('è propio bello ');
    expect(await valore(page)).toBe('è propio bello ');
    const segno = errore(page, 'propio');
    await expect(segno).not.toHaveClass(/sn-dubbio/, { timeout: 6000 });
    const b = await riquadroDelSegno(segno);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
    const prima = menuDi(page).principale.locator(':scope > *').first();
    await expect(prima).toHaveText(/proprio/, { timeout: 5000 });
    await prima.click();
    await expect.poll(() => valore(page)).toBe('è proprio bello ');
  }
  await expect.poll(() => magazzino(app, 'sn_autocorrect')).toEqual({ propio: 'proprio' });
  await svuota(page);
  await page.keyboard.type('è propio ');
  expect(await valore(page)).toBe('è proprio ');
});

test('il testo messo da uno script resta com\'è, e con la correzione automatica spenta niente cambia da solo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.waitForTimeout(1700);
  await page.evaluate(() => { document.getElementById('ta').focus(); document.execCommand('insertText', false, 'ok perchè '); });
  expect(await valore(page)).toBe('ok perchè ');
  await svuota(page);
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { correttore: { automatica: false } } },
    { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await expect.poll(() => page.evaluate(() => 1)).toBe(1);
  await page.waitForTimeout(300);
  await page.keyboard.type('ok perchè marco ');
  expect(await valore(page)).toBe('ok perchè marco ');
  await expect(errore(page, 'perchè')).toHaveCount(1, { timeout: 4000 });
});

test('dopo l\'apostrofo d\'elisione il nome prende la maiuscola, «perche\'» diventa «perché», e l\'apice che chiude una virgoletta resta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  const scritto = async (testo) => { await svuota(page); await page.keyboard.type(testo); return valore(page); };
  expect(await scritto("Mi piace l'italia ")).toBe("Mi piace l'Italia ");
  expect(await scritto("Il sud dell'europa e l'iphone ")).toBe("Il sud dell'Europa e l'iPhone ");
  expect(await scritto("Ok perche' no, ci vediamo piu' tardi e va bene cosi' ")).toBe('Ok perché no, ci vediamo più tardi e va bene così ');
  expect(await scritto("Ok c'e' tempo ")).toBe("Ok c'è tempo ");
  expect(await scritto("Aspetta un po' e di' la verità ")).toBe("Aspetta un po' e di' la verità ");
  expect(await scritto("La congiunzione 'e' si scrive senza accento ")).toBe("La congiunzione 'e' si scrive senza accento ");
  expect(await scritto("Chiedi a 'marco' ")).toBe("Chiedi a 'Marco' ");
  // L'annullo del nome dopo l'apostrofo riporta solo il nome.
  await scritto("Mi piace l'italia ");
  await page.keyboard.press('Control+z');
  expect(await valore(page)).toBe("Mi piace l'italia ");
});

// Il campo che ha il cursore prima che il correttore parta non ha più un focusin da dare: si scrive subito, senza clic.
test('nella chat di casa e in una pagina in autofocus, scritto subito senza clic, «perchè » diventa «perché»', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const casa = await openTab('filo://dashboard/dashboard.html');
  await expect.poll(() => casa.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 8000 }).toBe('input');
  await casa.waitForTimeout(1500);
  await casa.keyboard.type('Domani vedo marco perchè ');
  await expect.poll(() => casa.locator('#input').inputValue(), { timeout: 4000 }).toBe('Domani vedo Marco perché ');

  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body>
    <textarea id="ta" lang="it" autofocus style="width:600px;height:100px"></textarea></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('ta');
  await page.keyboard.type('Ciao marco perchè ');
  await expect.poll(() => valore(page), { timeout: 4000 }).toBe('Ciao Marco perché ');

  // Acceso mentre il cursore è già nel campo, vale da subito.
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { featureFlags: { spellcheck: false, spellcheckContext: false }, correttore: { automatica: false } } },
    { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.waitForTimeout(500);
  await page.keyboard.type('poi ');
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { correttore: { automatica: true } } },
    { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.waitForTimeout(500);
  await page.keyboard.type('perchè ');
  await expect.poll(() => valore(page), { timeout: 4000 }).toBe('Ciao Marco perché poi perché ');
});

test('l\'interruttore sta in Opzioni → Altro e in Preferenze, insieme a quante volte serve per imparare', async ({ app, openTab }) => {
  const altro = await openTab('filo://options/altro.html');
  const sw = altro.locator('#spellcheckAutomatica');
  await expect(sw).toBeChecked({ timeout: 8000 });
  await expect(altro.locator('#spellcheckAutomatica-label')).toHaveText('Correzione automatica');
  await sw.uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).correttore.automatica)).toBe(false);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#correttoreAutomatica')).not.toBeChecked({ timeout: 8000 });
  await expect(pref.locator('#correttoreAnnulli')).toHaveValue('2');
  await pref.locator('#correttoreAnnulli').fill('4');
  await pref.locator('#correttoreAnnulli').blur();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).correttore.annulliPerImparare)).toBe(4);
  await pref.locator('#correttoreAutomatica').check();
  await expect(altro.locator('#spellcheckAutomatica')).toBeChecked();
});

test('nella pagina del correttore una parola imparata si cambia scrivendoci, e una già presente non si duplica', async ({ app, openTab }) => {
  await app.evaluate(async () => { await globalThis.chrome.storage.local.set({ sn_personal_dict: ['ciuruglio', 'zanzotera'] }); });
  const pagina = await openTab(URL_CORRETTORE);
  const parole = pagina.locator('#dictList .sn-spell-word');
  await expect(parole).toHaveCount(2, { timeout: 8000 });
  await parole.nth(1).fill('Zanzottera');
  await parole.nth(1).press('Enter');
  await expect.poll(() => magazzino(app, 'sn_personal_dict')).toEqual(['ciuruglio', 'Zanzottera']);
  await parole.nth(0).fill('zanzottera');
  await parole.nth(0).press('Enter');
  await expect(pagina.locator('#dictConflict')).toContainText('zanzottera');
  await expect(parole.nth(0)).toHaveValue('ciuruglio');
  expect(await magazzino(app, 'sn_personal_dict')).toEqual(['ciuruglio', 'Zanzottera']);
  // A mano anche le parole da non correggere da sé.
  await pagina.locator('#newRifiutata').fill('Marco');
  await pagina.locator('#addRifiutata').click();
  await expect(pagina.locator('#rifiutateList .sn-spell-word')).toHaveValue('marco');
  await expect.poll(async () => (await imparato(app))?.rifiutate).toEqual(['marco']);
});

// Gli editor di testo ricco veri tengono un loro modello del testo, del cursore e dell'annulla: Lexical (WhatsApp Web)
// rimette il cursore da sé, ProseMirror (ChatGPT) prende la scorciatoia di annulla.
const EDITORI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'editori');
const editore = (nome, avvio) => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" contenteditable="true" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${fs.readFileSync(path.join(EDITORI, `${nome}.js`), 'utf8')}</script><script>${avvio}(document.getElementById('m'));</script></body>`;

async function apriEditore(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

test('nell\'editor Lexical la parola dopo una correzione resta staccata, e l\'annulla e il tasto destro la riportano com\'era', async ({ app, openTab, testServer }) => {
  const page = await apriEditore(app, openTab, testServer, editore('lexical', 'avviaLX'));
  const testo = () => page.evaluate(() => window.lxText().replace(/ /g, ' '));
  await page.locator('#m').click();
  await page.keyboard.type('Ciao marco come va, non so perchè ');
  await expect.poll(testo).toBe('Ciao Marco come va, non so perché ');
  await page.keyboard.press('Control+z');
  await expect.poll(testo).toBe('Ciao Marco come va, non so perchè ');
  await page.keyboard.type('ok');
  await expect.poll(testo).toBe('Ciao Marco come va, non so perchè ok');
  const p = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#m span')].find((s) => s.textContent.includes('Marco')).firstChild;
    const i = t.nodeValue.indexOf('Marco');
    const r = document.createRange();
    r.setStart(t, i + 1); r.setEnd(t, i + 4);
    const q = r.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await menuDi(page).voce('Annulla correzione').click();
  await expect.poll(testo).toBe('Ciao marco come va, non so perchè ok');
});

test('nell\'editor ProseMirror l\'annulla subito dopo la correzione riporta la parola com\'era, e quello dopo non la rimette', async ({ app, openTab, testServer }) => {
  const page = await apriEditore(app, openTab, testServer, editore('prosemirror', 'avviaPM'));
  const testo = () => page.evaluate(() => window.pmView.state.doc.textContent.replace(/ /g, ' '));
  await page.locator('#m .ProseMirror').click();
  await page.keyboard.type('Domani vedo marco perchè ');
  await expect.poll(testo).toBe('Domani vedo Marco perché ');
  await page.keyboard.press('Control+z');
  await expect.poll(testo).toBe('Domani vedo Marco perchè ');
  await page.keyboard.type('va bene');
  await expect.poll(testo).toBe('Domani vedo Marco perchè va bene');
  await page.keyboard.press('Control+z');
  await expect.poll(testo).not.toContain('perché');
});

test('nel campo modificabile semplice un secondo annulla toglie quello che si era scritto, non rimette la correzione', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ce').click();
  await page.keyboard.type('ok perchè ');
  await expect(page.locator('#ce')).toHaveText('ok perché ');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ce')).toHaveText('ok perchè ');
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.locator('#ce').innerText()).not.toContain('perché');
});

// Una chat come tante: Invio manda il messaggio e la pagina svuota la casella da sé, senza un input.
const CHAT = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <div id="log"></div>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:80px;font:22px monospace"></textarea>
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:60px;font:22px monospace;border:1px solid #999;margin-top:12px"></div>
  <script>
    const manda = (testo) => { const d = document.createElement('p'); d.textContent = testo; document.getElementById('log').appendChild(d); };
    document.getElementById('ta').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda(e.target.value); e.target.value = ''; }
    });
    document.getElementById('ce').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda(e.target.innerText); e.target.innerHTML = ''; }
    });
  </script>
</body>`;

async function apriChat(app, page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
}
const testoDi = (page, sel) => page.locator(sel).evaluate((el) => (el.tagName === 'TEXTAREA' ? el.value : el.innerText.replace(/\u00a0/g, ' ')));

test('in una chat che svuota la casella da sé, i messaggi tutti minuscoli già mandati tengono «marco» minuscolo, anche riaperta', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, CHAT, { pubblico: true });
  await apriChat(app, page);
  for (const sel of ['#ta', '#ce']) {
    await page.locator(sel).click();
    // Il primo messaggio, da solo, non basta a dirlo.
    if (sel === '#ta') {
      await page.keyboard.type('ciao marco ');
      expect(await testoDi(page, sel)).toBe('ciao Marco ');
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('ok porto la pizza');
    await page.keyboard.press('Enter');
    await page.keyboard.type('allora da marco ');
    await page.waitForTimeout(200);
    expect(await testoDi(page, sel), sel).toBe('allora da marco ');
    await page.keyboard.press('Enter');
  }
  // Riaperta la chat, Filo sa già come si scrive lì; in un altro sito no.
  await page.reload();
  await apriChat(app, page);
  await page.locator('#ta').click();
  await page.keyboard.type('domani da marco ');
  await page.waitForTimeout(200);
  expect(await testoDi(page, '#ta')).toBe('domani da marco ');
  const altro = await testServer.openReady(openTab, CHAT);
  await apriChat(app, altro);
  await altro.locator('#ta').click();
  await altro.keyboard.type('domani da marco ');
  await expect.poll(() => testoDi(altro, '#ta')).toBe('domani da Marco ');
});
