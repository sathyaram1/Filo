// I contatori dei riquadri AI e dell'Editor (#1465) nell'app vera: Copia e le domande nel riquadro di Traduci, il
// riquadro chiuso prima della risposta, la spiegazione preparata e aperta, la riscrittura sostituita, la traduzione
// della pagina e il ritorno all'originale, il titolo automatico riscritto a mano e la chat che formatta il documento.
// Forma, spedizione e regole: tests/unit/contatoriRiquadri.test.mjs e firestoreRulesContatori.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { statoDi, conta, clicca, scrivi, paginaDelloStrato } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';
import { apriAiuto, chiediAllAiuto } from './helpers/strumentiEditor.mjs';

// Le ore di oggi sommate, misura per misura.
const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const m of globalThis.SN_CONTATORI.MISURE_RIQUADRI) {
      for (const [chiave, conti] of Object.entries(ora[m] || {})) {
        const a = ((out[m] = out[m] || {})[chiave] = (out[m] || {})[chiave] || conti.map(() => 0));
        conti.forEach((n, i) => { a[i] += n; });
      }
    }
  }
  return out;
});
// La voce di una misura per nome, letta con l'elenco dell'app: { voce: conto }.
const voceOra = async (app, misura, chiave) => {
  const conti = ((await oggi(app))[misura] || {})[chiave];
  if (!conti) return null;
  const nomi = await app.evaluate((_e, m) => globalThis.SN_CONTATORI.RIQUADRI[m].gruppi.flat(), misura);
  return Object.fromEntries(nomi.map((n, i) => [n, conti[i]]).filter(([, n]) => n > 0));
};

// I modelli finti nel main: le risposte a pezzi si fermano finché la prova non le libera, se `__ferma`.
async function modelliFinti(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const A = C.ACTIONS;
    const m = 'deepseek-flash';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [A.TRANSLATE_SELECTION]: m, [A.EXPLAIN_DEEP]: m, [A.EXPLAIN]: m, [A.FOLLOWUP || 'followup']: m, [A.EDIT_TEXT]: m, [A.TRANSLATE_PAGE]: m },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__ferma = false;
    globalThis.__libera = null;
    globalThis.__spiegazioni = 0;
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...P,
      streamComplete: async ({ onDelta }) => {
        if (globalThis.__ferma) await new Promise((r) => { globalThis.__libera = r; });
        onDelta('La risposta ');
        onDelta('arriva.');
        return { text: 'La risposta arriva.', usage: {} };
      },
    };
    const PS = globalThis.SN_PROVIDERS;
    const orig = PS.completeWithFallback;
    PS.completeWithFallback = async (args) => {
      const ultimo = [...args.messages].reverse().find((x) => typeof x.content === 'string');
      const prompt = (ultimo && ultimo.content) || '';
      if (prompt.includes('@@@SN_SEP@@@')) {
        const APRE = '<<<TESTO_IN_PAGINA>>>\n';
        const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
        const pezzo = prompt.slice(prompt.indexOf(APRE) + APRE.length, prompt.lastIndexOf(CHIUDE));
        return { text: pezzo.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: m, usage: {} };
      }
      const tutto = args.messages.map((x) => (typeof x.content === 'string' ? x.content : '')).join('\n');
      if (/Rendi il testo più formale/.test(tutto)) return { text: 'Gentile cliente, la riunione è spostata.', provider: 'test', model: m, usage: {} };
      if (/gatto/.test(tutto)) { globalThis.__spiegazioni++; return { text: 'Un felino domestico.', provider: 'test', model: m, usage: {} }; }
      return orig(args);
    };
  });
}

const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);

const PAGINA = '<!doctype html><html lang="it"><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">'
  + '<p style="font-size:20px">Il <span id="parola">gatto</span> dorme sul tetto.</p>'
  + '<textarea id="campo" style="margin-top:200px;width:420px;height:90px">ciao, la riunione è spostata</textarea></body></html>';

test('nel riquadro di Traduci contano Copia e la domanda dopo la risposta; quello chiuso prima della risposta, l’attesa', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await modelliFinti(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(() => conta(app, page, '.sn-msg-copia'), { timeout: 15_000 }).toBe(1);
  await clicca(app, page, '.sn-msg-copia');
  await scrivi(app, page, '.sn-popup-input', 'e al plurale? <b>gatti</b> 🐈');
  await page.keyboard.press('Enter');
  await expect.poll(() => conta(app, page, '.sn-msg-copia'), { timeout: 15_000 }).toBe(2);
  await clicca(app, page, '.sn-popup-close');
  await expect.poll(() => voceOra(app, 'riquadro_uso', 'translate-selection'), { timeout: 10_000 }).toEqual({ copia: 1, d1: 1 });

  // Approfondisci che resta sull'attesa e si chiude: contato col suo tempo, e niente domande per lui.
  await app.evaluate(() => { globalThis.__ferma = true; });
  await page.locator('#parola').dblclick();
  await comando(app, 'explain-selection');
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup'))?.visibile || false, { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(700);
  await clicca(app, page, '.sn-popup-close');
  await expect.poll(() => voceOra(app, 'riquadro_chiuso_prima', 'explain-deep'), { timeout: 10_000 }).not.toBeNull();
  const chiuso = await voceOra(app, 'riquadro_chiuso_prima', 'explain-deep');
  expect(Object.values(chiuso)).toEqual([1]);
  expect(Object.keys(chiuso)[0], 'sette decimi di secondo di attesa non stanno nel mezzo secondo').not.toBe('ms500');
  expect(await voceOra(app, 'riquadro_uso', 'explain-deep')).toBeNull();
  await app.evaluate(() => { globalThis.__ferma = false; globalThis.__libera?.(); });

  // Nessun testo di quello che si è scritto nel riquadro arriva fra i contatori.
  const disco = await app.evaluate(async () => JSON.stringify(await globalThis.SN_CONTATORI_MAIN.letto()));
  for (const x of ['plurale', 'gatti', 'gatto', '🐈']) expect(disco).not.toContain(x);
});

test('la spiegazione preparata alla selezione e aperta col tasto destro è «pronta»; la riscrittura sostituita conta la sua scorciatoia', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await modelliFinti(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#parola').dblclick();
  await expect.poll(() => app.evaluate(() => globalThis.__spiegazioni), { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(300);
  await page.locator('#parola').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-inline-explain')).toContainText('Un felino', { timeout: 10_000 });
  await expect.poll(() => voceOra(app, 'anticipo_al_gesto', 'spiega'), { timeout: 10_000 }).toEqual({ pronto: 1 });
  // Riaperta, la stessa spiegazione non è un anticipo nuovo.
  await page.keyboard.press('Escape');
  await page.locator('#parola').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-inline-explain')).toContainText('Un felino', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  expect(await voceOra(app, 'anticipo_al_gesto', 'spiega')).toEqual({ pronto: 1 });

  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await menu.voce('Modifica').click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox'))?.visibile, { timeout: 10_000 }).toBe(true);
  await clicca(app, page, '.sn-editbox-shortcuts button[data-sc="formal"]');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-replace'))?.disabilitato, { timeout: 15_000 }).toBe(false);
  await clicca(app, page, '.sn-editbox-replace');
  await expect(page.locator('#campo')).toHaveValue('Gentile cliente, la riunione è spostata.');
  await expect.poll(() => voceOra(app, 'riscrittura', 'formale'), { timeout: 10_000 }).toEqual({ 'sostituito|p1': 1 });
});

test('la pagina tradotta intera e riportata all’originale entro un minuto conta il ritorno', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await modelliFinti(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">'
    + '<p id="p1">First paragraph of the body text, long enough to be picked up.</p>'
    + '<p id="p2">Second paragraph with some more English words in it.</p></body></html>');
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 15_000 });
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('#p1')).toHaveText(/^First paragraph/, { timeout: 10_000 });
  await expect.poll(() => voceOra(app, 'traduzione_pagina', 'intera'), { timeout: 10_000 }).toEqual({ 'r10|si': 1 });
});

test('nell’Editor il titolo automatico riscritto a mano conta quando, e l’Aiuto che formatta conta le modifiche', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch');
  // Solo le richieste ai modelli finiscono finte: i contatori arrivano al main.
  await page.evaluate(() => {
    const MSG = window.SN_MSG.MSG;
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.__risposta = 'Il giardino in primavera';
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) r = { ok: true, text: window.__risposta };
      else if (msg && msg.type === MSG.FILO_GET_MEMORY) r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      if (!r) return orig(msg, cb);
      if (typeof cb === 'function') { cb(r); return undefined; }
      return Promise.resolve(r);
    };
  });
  const parole = Array.from({ length: 120 }, (_, i) => ['il', 'giardino', 'in', 'primavera', 'fiorisce'][i % 5]).join(' ');
  await page.evaluate((t) => {
    const d = document.getElementById('doc');
    d.innerHTML = `<h1>Titolo</h1><p>${t}</p>`;
    d.dispatchEvent(new Event('input', { bubbles: true }));
  }, parole);
  await expect(page.locator('#docTitle')).toHaveText('Il giardino in primavera', { timeout: 8000 });
  await expect.poll(() => voceOra(app, 'editor_titolo', 'automatico'), { timeout: 10_000 }).toEqual({ applicato: 1 });

  await page.click('#docSwitch', { button: 'right' });
  await page.locator('.ed-title-ctxmenu').getByText('Rinomina', { exact: true }).click();
  const campo = page.locator('.ed-doc-title-input');
  await campo.fill('Appunti di Mario');
  await campo.press('Enter');
  await expect(page.locator('#docTitle')).toHaveText('Appunti di Mario');
  await expect.poll(() => voceOra(app, 'editor_titolo', 'automatico'), { timeout: 10_000 }).toEqual({ applicato: 1, riscritto_ora: 1 });

  // La chat dell'Editor è l'Aiuto (#1433): la sua richiesta passa dalla pagina, finta come quella del titolo.
  await page.evaluate(() => {
    window.__risposta = JSON.stringify({ text: 'Fatto.', formatta: [{ op: 'format', target: 'headings', style: 'bold', value: true }] });
  });
  await apriAiuto(app, page);
  await chiediAllAiuto(page, 'metti in grassetto i titoli');
  await expect(page.locator('.sn-sidebar-msg-assistant').last()).toContainText('Fatto.');
  await expect.poll(() => voceOra(app, 'editor_chat', 'intero'), { timeout: 10_000 }).toEqual({ f1: 1 });

  const disco = await app.evaluate(async () => JSON.stringify(await globalThis.SN_CONTATORI_MAIN.letto()));
  for (const x of ['Mario', 'giardino', 'grassetto']) expect(disco).not.toContain(x);
});
