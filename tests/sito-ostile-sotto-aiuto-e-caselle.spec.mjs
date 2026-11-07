// #1340 — Su un sito l'Aiuto e le caselle di Filo stanno nello strato sopra la scheda: un velo del sito non copre
// microfono e documento dell'Aiuto, e lo script del sito non scrive, non cancella e non sposta la selezione in quello
// che l'utente scrive. Regola: patterns/un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md

import { test, expect } from './fixtures/electron.mjs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { paginaDelloStrato, nelMondoDiFilo, neiRiquadri, statoDi, scrivi, clicca } from './helpers/riquadri.mjs';
import { confermaSopraPagina, clickConfirm } from './helpers/confirm.mjs';
import { cartellaDellaProva, BOLLETTA_MARZO } from './helpers/documentiFinti.mjs';
import * as Gesti from './helpers/gestiVeri.mjs';

const DETTO = 'dove si cambia la password';
const INTRUSO = 'SCRITTO DAL SITO';

// Il sito ostile: a ogni gesto e ogni quindici millesimi seleziona tutto, scrive e cancella dove sta il fuoco, e
// riempie ogni casella che trova; su richiesta stende un velo bianco che il mouse attraversa, col quadrato da cliccare.
const ATTACCO = `<script>
  window.__clic = 0;
  document.addEventListener('click', () => { window.__clic++; }, true);
  const colpo = () => {
    try { document.execCommand('selectAll'); } catch (_) {}
    const a = document.activeElement;
    try { if (a && a.setSelectionRange) a.setSelectionRange(0, String(a.value || '').length); } catch (_) {}
    try { document.execCommand('insertText', false, '${INTRUSO}'); } catch (_) {}
    for (const t of document.querySelectorAll('textarea, input')) t.value = '${INTRUSO}';
  };
  for (const t of ['keydown', 'beforeinput', 'input', 'paste', 'compositionstart', 'mousedown', 'click', 'focusin']) window.addEventListener(t, colpo, true);
  window.martella = () => { if (!window.__martello) window.__martello = setInterval(() => { colpo(); try { document.execCommand('delete'); } catch (_) {} }, 15); return true; };
  window.stendiVelo = (p) => {
    const v = document.createElement('div');
    v.id = 'velo';
    v.style.cssText = 'position:fixed;inset:0;background:#fff;pointer-events:none;z-index:2147483647;font:22px sans-serif;padding:40px';
    v.textContent = 'clicca il quadrato per continuare';
    const q = document.createElement('div');
    q.style.cssText = 'position:fixed;width:60px;height:40px;background:#c33;left:' + (p.x - 30) + 'px;top:' + (p.y - 20) + 'px';
    v.appendChild(q);
    document.documentElement.appendChild(v);
    return true;
  };
</script>`;
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Sito ostile</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif"><h1>Un sito</h1>
  <p id="parola" style="font-size:20px">supercalifragilistico</p>${ATTACCO}</body></html>`;

// Modelli finti nel main: l'Aiuto risponde con la coda del test e tiene le domande; la dettatura trascrive DETTO.
async function prepara(app, risposte = []) {
  await app.evaluate(async (_e, { detto, risposte: coda }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      dictation: { autoSend: false },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ audioBase64 }) => {
      const bytes = Buffer.from(String(audioBase64 || ''), 'base64').length;
      return { text: ` ${detto} `, usage: { seconds: bytes / 32000, costUsd: 0.00001 }, generationId: null };
    };
    globalThis.__domande = [];
    globalThis.__coda = coda.slice();
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return fatto('{"message":"Ciao.","suggestions":[],"issues":[]}');
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__domande.push(JSON.stringify(ultimo ? ultimo.content : ''));
      return fatto(globalThis.__coda.shift() || JSON.stringify({ text: 'Fine.', status: 'done' }));
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => risposta(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, { detto: DETTO, risposte });
}

// Un tono al posto del microfono, nella cornice che sui siti lo apre per Filo.
async function microfonoFinto(shell) {
  await shell.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      return dest.stream;
    };
  });
}

async function apriAiuto(app, shell, sito) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  return strato;
}

const centroIn = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const incollaDalMenu = (app, page) => app.evaluate(({ webContents }, u) => {
  webContents.getAllWebContents().find((w) => w.getURL() === u).paste();
}, page.url());

test('sotto il velo di un sito il microfono dell\'Aiuto spostato parte al primo clic, e la dettatura arriva intera', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono un display X e XTest (lo schermo virtuale delle prove su Linux)');
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const sito = await testServer.openReady(openTab, PAGINA);
  await Gesti.finestraASchermo(app);
  const strato = await apriAiuto(app, shell, sito);
  await sito.evaluate(() => window.martella());

  // Spostato dalla testata, come nel rilievo del giro 4.
  const prima = await strato.locator('.sn-sidebar').boundingBox();
  const testata = await Gesti.sulloSchermo(app, sito, strato, '.sn-sidebar-title');
  Gesti.trascina(testata, { x: testata.x - 200, y: testata.y + 60 });
  await expect.poll(async () => (await strato.locator('.sn-sidebar').boundingBox()).x).toBeLessThan(prima.x - 150);

  // Il velo copre la pagina intera, col quadrato sul microfono: il pannello resta sopra, e il clic è suo.
  await sito.evaluate((p) => window.stendiVelo(p), await centroIn(strato, '.sn-sidebar .sn-voce-btn'));
  const mic = await Gesti.sulloSchermo(app, sito, strato, '.sn-sidebar .sn-voce-btn');
  Gesti.trascina(mic, mic);
  await expect(strato.locator('.sn-sidebar .sn-voce-btn')).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await sito.waitForTimeout(1500);
  Gesti.trascina(mic, mic);
  await expect(strato.locator('.sn-sidebar-input textarea')).toHaveValue(DETTO, { timeout: 10_000 });
  await expect(strato.locator('.sn-toast', { hasText: 'coperto' })).toHaveCount(0);
  expect(await sito.evaluate(() => window.__clic), 'i clic sul microfono non arrivano al sito').toBe(0);
  expect(await sito.evaluate(() => !!document.querySelector('.sn-sidebar, .sn-voce-btn')), 'nel documento del sito non c\'è il pannello').toBe(false);
  await strato.screenshot({ path: 'tests/.shots/aiuto-sopra-il-velo.png' });
});

test('sotto il velo di un sito il documento trovato dall\'Aiuto si apre e si trascina col gesto dell\'utente', async ({ app, shell, openTab, testServer }) => {
  test.skip(!Gesti.disponibili(), 'servono un display X e XTest (lo schermo virtuale delle prove su Linux)');
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Velo1340');
  cartellaDellaProva(dir);
  const bolletta = join(dir, BOLLETTA_MARZO);
  try {
    await prepara(app, [
      JSON.stringify({ action: 'documenti', cosa: 'bolletta luce energia elettrica marzo', text: 'La cerco fra i tuoi documenti.' }),
      JSON.stringify({ text: 'Eccola: trascinala nella pagina.', file: 1, status: 'done' }),
    ]);
    await app.evaluate(({ shell: s }) => {
      globalThis.__aperti = [];
      globalThis.__trascinati = [];
      s.openPath = async (p) => { globalThis.__aperti.push(p); return ''; };
    });
    const sito = await testServer.openReady(openTab, PAGINA);
    await Gesti.finestraASchermo(app);
    const strato = await apriAiuto(app, shell, sito);
    await strato.fill('.sn-sidebar-input textarea', 'mi serve la bolletta della luce di marzo');
    await strato.press('.sn-sidebar-input textarea', 'Enter');
    await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
    const file = strato.locator('.sn-sidebar .sn-sidebar-file');
    await expect(file).toHaveCount(1, { timeout: 20_000 });
    await app.evaluate(({ webContents }) => {
      for (const wc of webContents.getAllWebContents()) wc.startDrag = (item) => { globalThis.__trascinati.push(item.file); };
    });

    await sito.evaluate((p) => window.stendiVelo(p), await centroIn(strato, '.sn-sidebar .sn-sidebar-file'));
    const doc = await Gesti.sulloSchermo(app, sito, strato, '.sn-sidebar .sn-sidebar-file');
    Gesti.trascina(doc, doc);
    await expect.poll(() => app.evaluate(() => globalThis.__aperti)).toEqual([bolletta]);
    Gesti.trascina(doc, { x: doc.x - 250, y: doc.y + 120 });
    await expect.poll(() => app.evaluate(() => globalThis.__trascinati)).toEqual([bolletta]);
    expect(await sito.evaluate(() => window.__clic), 'i clic sul documento non arrivano al sito').toBe(0);
    expect(await sito.evaluate(() => document.documentElement.outerHTML)).not.toContain(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nell\'Aiuto su un sito lo script che seleziona, scrive e cancella non tocca la domanda: clic, incolla dal menu e composizione dell\'utente passano uguali', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app);
  const sito = await testServer.openReady(openTab, PAGINA);
  const strato = await apriAiuto(app, shell, sito);
  await sito.evaluate(() => window.martella());
  const ta = strato.locator('.sn-sidebar-input textarea');

  await ta.click();
  await strato.keyboard.insertText('dove si cambia password');
  // Un clic in mezzo alla domanda e una lettera lì, come nel rilievo del giro 3.
  await ta.click({ position: { x: 4, y: 8 } });
  await strato.keyboard.press('Control+End');
  for (let i = 0; i < 'password'.length; i++) await strato.keyboard.press('ArrowLeft');
  await strato.keyboard.type('la ');
  await strato.keyboard.press('Control+End');
  // Incolla dal menu dell'app (la strada di Cmd+V su Mac), poi una composizione vera.
  await app.evaluate(({ clipboard }) => clipboard.writeText(' del conto'));
  await incollaDalMenu(app, strato);
  const cdp = await strato.context().newCDPSession(strato);
  await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '日本' });
  await strato.keyboard.type('?');
  await sito.waitForTimeout(400);
  await expect(ta).toHaveValue('dove si cambia la password del conto日本?');

  await strato.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__domande.length), { timeout: 15_000 }).toBe(1);
  const partita = await app.evaluate(() => globalThis.__domande[0]);
  expect(partita).toContain('dove si cambia la password del conto日本?');
  expect(partita).not.toContain(INTRUSO);
  expect(await sito.evaluate(() => !!document.querySelector('textarea')), 'la casella non sta nel documento del sito').toBe(false);
});

test('nel feedback e nella domanda della spiegazione su un sito lo script non cambia il testo: parte quello dell\'utente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__spiegazioni = [];
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      streamComplete: async ({ onDelta, messages }) => {
        globalThis.__spiegazioni.push(JSON.stringify(messages || []));
        onDelta('Risposta del modello.');
        return { text: 'Risposta del modello.', usage: {} };
      },
    };
  });
  const sito = await testServer.openReady(openTab, PAGINA);

  // Spiegazione: la domanda dopo la risposta.
  await sito.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('explain-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(async () => (await statoDi(app, sito, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Risposta del modello');
  await sito.evaluate(() => window.martella());
  const dove = await scrivi(app, sito, '.sn-popup-input', 'e in breve?');
  await sito.waitForTimeout(400);
  expect((await statoDi(app, sito, '.sn-popup-input'))?.valore).toBe('e in breve?');
  await dove.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__spiegazioni.length)).toBe(2);
  const domanda = await app.evaluate(() => globalThis.__spiegazioni[1]);
  expect(domanda).toContain('e in breve?');
  expect(domanda).not.toContain(INTRUSO);
  await dove.keyboard.press('Escape');

  // Feedback: scritto, incollato dal menu dell'app, inviato col clic vero.
  await nelMondoDiFilo(app, sito, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, sito, '.sn-fb-text')).not.toBeNull();
  await neiRiquadri(app, sito, () => {
    window.__inviati = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => {
      if (m && m.type === 'submit_feedback') { window.__inviati.push(m.payload && m.payload.text); return Promise.resolve({ ok: true, id: 'prova-1340' }); }
      return orig(m, ...r);
    };
    return true;
  });
  const fb = await scrivi(app, sito, '.sn-fb-text', 'Il tasto indietro non va');
  await app.evaluate(({ clipboard }) => clipboard.writeText(' su questo sito'));
  await incollaDalMenu(app, fb);
  await sito.waitForTimeout(400);
  expect((await statoDi(app, sito, '.sn-fb-text'))?.valore).toBe('Il tasto indietro non va su questo sito');
  await clicca(app, sito, '.sn-fb-send');
  await expect.poll(async () => (await neiRiquadri(app, sito, () => window.__inviati.slice())).length).toBe(1);
  expect((await neiRiquadri(app, sito, () => window.__inviati[0]))).toBe('Il tasto indietro non va su questo sito');
});

test('Ctrl+Z nel feedback su un sito annulla anche dopo un log di centomila caratteri', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const sito = await testServer.openReady(openTab, PAGINA);
  await nelMondoDiFilo(app, sito, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, sito, '.sn-fb-text')).not.toBeNull();
  const dove = await scrivi(app, sito, '.sn-fb-text', 'Log: '.padEnd(100000, 'abcdefghij '));
  await dove.keyboard.press('Control+End');
  await dove.keyboard.type('fine');
  await expect.poll(async () => (await statoDi(app, sito, '.sn-fb-text')).valore.length).toBe(100004);
  await dove.keyboard.press('Control+Z');
  await expect.poll(async () => (await statoDi(app, sito, '.sn-fb-text')).valore.length, { timeout: 5_000 }).toBeLessThan(100004);
});
