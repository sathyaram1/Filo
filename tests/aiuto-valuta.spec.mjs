// #1449 — «Valuta» nel tasto destro di un campo: l'Aiuto riceve il testo intero del campo e la richiesta di giudicarlo,
// risponde il modello della chat con quello che Filo sa dell'utente, e una correzione proposta si scrive nel campo con
// un clic (un altro la toglie). La stessa voce sta sul suggerimento del correttore. Nessuna chiamata esce dalla macchina.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';

const MODELLO_CHAT = 'deepseek/deepseek-v4-pro';
const MODELLO_AIUTO = 'deepseek/deepseek-v4-flash';

// `risposte`: [[parola, risposta]] scelte sull'ultimo messaggio dell'utente. `senzaFoto`: il modello rifiuta le
// immagini, come uno di solo testo. Con `correttore` risponde anche ai due controlli del correttore.
async function prepara(app, { risposte, senzaFoto = false, correttore = false }) {
  await app.evaluate(async (_e, { risposte, senzaFoto, correttore }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek',
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: correttore, spellcheckContext: correttore },
    });
    globalThis.__chiamate = [];
    const finto = async ({ attempts, messages }) => {
      const tutto = JSON.stringify(messages);
      const fine = (text) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text });
      if (tutto.includes('Sei il controllo rapido di un correttore')) return fine('[][][][nessuno]');
      if (tutto.includes('proponi SUGGERIMENTI')) {
        return fine(tutto.includes('alle 18') ? '[alle 18][][Alle 18 di quale giorno?][suggerimento]' : '[][][][nessuno]');
      }
      const conFoto = tutto.includes('image_url');
      globalThis.__chiamate.push({ model: attempts[0].model, messages: JSON.parse(tutto), conFoto });
      if (senzaFoto && conFoto) throw Object.assign(new Error('This model does not support image input'), { status: 400 });
      const ultimo = JSON.stringify(messages[messages.length - 1]);
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return fine(scelta[1]);
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { risposte, senzaFoto, correttore });
}

const chiamate = (app) => app.evaluate(() => globalThis.__chiamate);
const testoDi = (m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text || '').join('\n'));

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Messaggio</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" style="display:block;width:520px;height:90px;font:16px sans-serif"></textarea>
  <div id="ce" contenteditable="true" style="width:520px;min-height:60px;border:1px solid #999;margin-top:12px"><div>Prima riga con un erore.</div><div>Seconda riga.</div></div>
  <textarea id="vuoto" style="display:block;width:300px;height:40px;margin-top:12px"></textarea>
  <input id="pw" type="password" style="margin-top:12px">
</body>`;

const TESTO = 'Ieri sono andato al mare con i mei amici. L\'acqua era calda.';
const PARERE = JSON.stringify({
  text: 'Si legge bene. C\'è un refuso.',
  correzioni: [{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }],
  status: 'done',
});

async function apri(app, openTab, testServer, opz) {
  await prepara(app, opz);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#ta', TESTO);
  return page;
}

async function valutaSu(page, selettore, foto = '') {
  await page.locator(selettore).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  if (foto) await menu.superficie.screenshot({ path: foto }).catch(() => {});
  await menu.voce('Valuta').click();
}

test('«Valuta» apre l’Aiuto col testo del campo, col modello della chat, e la correzione si scrive nel campo e si toglie', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer, { risposte: [['', PARERE]] });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Scrive ai clienti tedeschi della sua azienda.', PREFERENZE: '' }));

  await valutaSu(page, '#ta', 'tests/.shots/1449-menu-campo.png');
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sn-sidebar-msg-user')).toContainText('Valuta «Ieri sono andato al mare');
  await expect(page.locator('.sn-sidebar-msg-assistant')).toContainText('C\'è un refuso.', { timeout: 20_000 });

  const [prima] = await chiamate(app);
  expect(prima.model, 'risponde il modello della chat, non quello dell’Aiuto').toBe(MODELLO_CHAT);
  expect(testoDi(prima.messages[0])).toContain('# Valutare il testo di un campo');
  expect(testoDi(prima.messages[0]), 'il contesto dell’utente arriva al modello').toContain('Scrive ai clienti tedeschi');
  expect(testoDi(prima.messages[prima.messages.length - 1]), 'il testo intero del campo arriva al modello').toContain(TESTO);

  const correzione = page.locator('.sn-sidebar-correzione');
  await expect(correzione).toHaveCount(1);
  await expect(correzione).toContainText('i miei amici');
  await correzione.click();
  await expect(page.locator('#ta')).toHaveValue('Ieri sono andato al mare con i miei amici. L\'acqua era calda.');
  await expect(correzione).toHaveClass(/sn-sidebar-correzione-fatta/);
  await page.screenshot({ path: 'tests/.shots/1449-valuta-chiaro.png' }).catch(() => {});

  await correzione.click();
  await expect(page.locator('#ta')).toHaveValue(TESTO);
  await expect(correzione).not.toHaveClass(/sn-sidebar-correzione-fatta/);
});

test('dopo aver cambiato il campo, la domanda nell’Aiuto porta il testo com’è adesso, sempre col modello della chat', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer, {
    risposte: [['adesso', JSON.stringify({ text: 'Ora va bene.', status: 'done' })], ['', PARERE]],
  });
  await valutaSu(page, '#ta');
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue(/i miei amici/);

  await page.fill('.sn-sidebar-input textarea', 'e adesso?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-msg-assistant', { hasText: 'Ora va bene.' })).toBeVisible({ timeout: 20_000 });
  const tutte = await chiamate(app);
  const seconda = tutte[tutte.length - 1];
  expect(seconda.model).toBe(MODELLO_CHAT);
  const domanda = testoDi(seconda.messages[seconda.messages.length - 1]);
  expect(domanda).toContain('e adesso?');
  expect(domanda).toContain('i miei amici. L\'acqua era calda.');
  // Il testo di prima resta nella cronologia, una volta: il modello vede da dove è partito.
  const storia = seconda.messages.slice(1, -1).map(testoDi).join('\n');
  expect(storia.split(TESTO).length - 1).toBe(1);
});

test('in un campo modificabile su più righe il modello vede le righe e la correzione cade sulla parola giusta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer, {
    risposte: [['', JSON.stringify({
      text: 'Un refuso.', correzioni: [{ prima: 'un erore', dopo: 'un errore', perche: 'doppia r' }], status: 'done',
    })]],
  });
  await valutaSu(page, '#ce');
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  const [prima] = await chiamate(app);
  expect(testoDi(prima.messages[prima.messages.length - 1])).toContain('Prima riga con un erore.\nSeconda riga.');
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ce')).toHaveText(/Prima riga con un errore\.\s*Seconda riga\./);
});

test('un modello della chat che non vede le immagini risponde lo stesso, senza la foto della pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apri(app, openTab, testServer, { risposte: [['', PARERE]], senzaFoto: true });
  await valutaSu(page, '#ta');
  await expect(page.locator('.sn-sidebar-msg-assistant')).toContainText('C\'è un refuso.', { timeout: 20_000 });
  const tutte = await chiamate(app);
  expect(tutte[tutte.length - 1].conFoto).toBe(false);
  expect(tutte[tutte.length - 1].model).toBe(MODELLO_CHAT);
});

test('«Valuta» non c’è in un campo vuoto né in una password; dall’Aiuto normale risponde il suo modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, { risposte: [['', JSON.stringify({ text: 'Ciao.', status: 'done' })]] });
  await page.fill('#pw', 'Gatto.Rosso.77');
  for (const sel of ['#vuoto', '#pw']) {
    await page.locator(sel).click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
    await expect(menu.voce('Valuta')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu.pannelli).toHaveCount(0);
  }
  // Senza «Valuta» la conversazione resta dell'Aiuto, col suo modello.
  await page.mouse.click(700, 500, { button: 'right' });
  await menuDi(page).voce('Aiuto').click();
  await page.fill('.sn-sidebar-input textarea', 'ciao');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-msg-assistant', { hasText: 'Ciao.' })).toBeVisible({ timeout: 20_000 });
  expect((await chiamate(app))[0].model).toBe(MODELLO_AIUTO);
});

test('sul suggerimento del correttore «Valuta» c’è una volta sola e apre l’Aiuto col testo del campo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, { risposte: [['', PARERE]], correttore: true });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.locator('#ta').click();
  await page.keyboard.type('Ci vediamo alle 18. ');
  const segno = page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: 'alle 18' });
  await expect(segno).toHaveCount(1, { timeout: 10_000 });
  const b = await riquadroDelSegno(segno);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-segno')).toContainText('Alle 18 di quale giorno?', { timeout: 5000 });
  await expect(menu.voce('Valuta')).toHaveCount(1);
  await menu.superficie.screenshot({ path: 'tests/.shots/1449-menu-suggerimento.png' }).catch(() => {});
  await menu.voce('Valuta').click();
  await expect(page.locator('.sn-sidebar-msg-user')).toContainText('Valuta «Ci vediamo alle 18.', { timeout: 8000 });
  await expect(page.locator('.sn-sidebar-msg-assistant')).toContainText('C\'è un refuso.', { timeout: 20_000 });
});

test('in un editor dentro un riquadro dello stesso sito «Valuta» apre l’Aiuto della pagina e la correzione si scrive nel riquadro', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, { risposte: [['', PARERE]] });
  const dentro = '<textarea id=ta style=width:500px;height:60px></textarea><div id=ce contenteditable=true style=width:500px;min-height:40px><div>Vado con i mei amici.</div></div>';
  const page = await testServer.openReady(openTab,
    `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px"><iframe id="ed" width="620" height="220" srcdoc="${dentro}"></iframe></body>`);
  const fr = page.frameLocator('#ed');
  await fr.locator('#ta').fill(TESTO);
  for (const [i, [sel, atteso]] of [['#ta', /i miei amici\. L'acqua era calda\./], ['#ce', /Vado con i miei amici\./]].entries()) {
    await fr.locator(sel).click({ button: 'right' });
    const menu = menuDi(fr);
    await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
    await menu.voce('Valuta').click();
    const ultima = page.locator('.sn-sidebar-correzione').last();
    await expect(page.locator('.sn-sidebar-msg-user').last()).toContainText(sel === '#ta' ? 'Ieri sono andato' : 'Vado con i mei', { timeout: 8000 });
    await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(i + 1, { timeout: 20_000 });
    await expect(ultima).toContainText('i miei amici');
    await ultima.click();
    if (sel === '#ta') await expect(fr.locator(sel)).toHaveValue(atteso);
    else await expect(fr.locator(sel)).toHaveText(atteso);
    expect((await chiamate(app)).at(-1).model).toBe(MODELLO_CHAT);
  }
});

test('in un riquadro di un altro sito «Valuta» non c’è', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, { risposte: [['', PARERE]] });
  const dentro = testServer.html('<!doctype html><meta charset="utf-8"><textarea id="ta">Testo scritto qui.</textarea>').replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><body><iframe id="ed" src="${dentro}" width="600" height="200"></iframe></body>`);
  const fr = page.frameLocator('#ed');
  await fr.locator('#ta').click({ button: 'right' });
  const menu = menuDi(fr);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await expect(menu.voce('Valuta')).toHaveCount(0);
});

test('di un testo oltre il tetto l’Aiuto dice fin dove arriva la valutazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, { risposte: [['', PARERE]] });
  await page.fill('#ta', 'parola '.repeat(15000));
  await valutaSu(page, '#ta');
  await expect(page.locator('.sn-sidebar-log', { hasText: 'primi 100.000 caratteri' })).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sn-sidebar-msg-assistant')).toContainText('C\'è un refuso.', { timeout: 20_000 });
});

test('aspetto delle correzioni col tema scuro', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const page = await apri(app, openTab, testServer, {
    risposte: [['', JSON.stringify({
      text: 'Il tono va bene per un amico. Due cose:',
      correzioni: [
        { prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' },
        { prima: 'L\'acqua era calda.', dopo: 'L\'acqua era caldissima, perfetta per nuotare.', perche: 'più vivo' },
      ],
      status: 'done',
    })]],
  });
  await valutaSu(page, '#ta');
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(2, { timeout: 20_000 });
  await page.locator('.sn-sidebar-correzione').first().click();
  await page.locator('.sn-sidebar-correzione').nth(1).hover();
  await page.screenshot({ path: 'tests/.shots/1449-valuta-scuro.png' }).catch(() => {});
});
