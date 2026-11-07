// #2096 (#1620.2) — le altre chat come la home: al passaggio del mouse sotto domande e risposte compaiono Copia e
// Rispondi senza spostare niente; Copia mette il testo negli appunti, Rispondi lo cita nel campo della stessa chat.
// Aiuto nell'Editor e su un sito, riquadro, Mazzi, scambi delle app nella home. I modelli sono finti.

import { test, expect } from './fixtures/electron.mjs';
import { home } from './helpers/chatFinta.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { apriAiuto, chiediAllAiuto } from './helpers/strumentiEditor.mjs';
import { paginaDellAiuto, statoDi, conta, clicca, tastieraDi, scrivi } from './helpers/riquadri.mjs';

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__domande = [];
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], finishReason: 'stop' });
      const tutto = JSON.stringify(messages);
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const ultimo = messages[messages.length - 1] || {};
      if (tutto.includes('preparare la dashboard')) return fatto('{"message":"","suggestions":[]}');
      if (sistema.includes('# Protocollo di risposta')) return fatto(JSON.stringify({ text: 'Il capitolo sui licheni va accorciato.\n\nIl resto regge.', status: 'done' }));
      if (sistema.includes('deck builder per Magic')) return fatto(JSON.stringify({ reply: 'Per questo mazzo servono più pescate.' }));
      if (sistema.startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic())) {
        globalThis.__domande.push(messages.filter((m) => m.role === 'user')
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'));
        return fatto('Va bene.');
      }
      return fatto('{}');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => {
      const r = risposta(o);
      try { o.onDelta && o.onDelta(r.text); } catch (_) {}
      return r;
    };
  });
}

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

// La geometria dei messaggi e dello scorrimento della chat, al pixel.
const geometria = (pagina, contenitore, messaggi) => pagina.evaluate(([c, m]) => {
  const el = document.querySelector(c);
  return {
    alto: el.scrollHeight, scrollTop: el.scrollTop,
    msg: [...el.querySelectorAll(m)].map((n) => { const r = n.getBoundingClientRect(); return [r.top, r.height, r.width]; }),
  };
}, [contenitore, messaggi]);

// Hover su ogni messaggio: la barra compare e niente si muove. Poi Copia e Rispondi sull'ultimo `filo`.
async function provaChat(app, pagina, { contenitore, messaggi, risposta, campo, testoCopiato, citato }) {
  await pagina.mouse.move(1, 1);
  const ferma = await geometria(pagina, contenitore, messaggi);
  const tutti = pagina.locator(`${contenitore} :is(${messaggi})`);
  const n = await tutti.count();
  expect(n).toBeGreaterThanOrEqual(2);
  for (let k = 0; k < n; k++) {
    await tutti.nth(k).hover();
    await expect(tutti.nth(k).locator('.sn-azioni-msg')).toBeVisible();
    expect(await geometria(pagina, contenitore, messaggi), `passando sul messaggio ${k}`).toEqual(ferma);
  }
  const r = pagina.locator(risposta).last();
  await r.hover();
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await r.getByRole('button', { name: 'Copia' }).click();
  await expect(r.getByRole('button', { name: 'Copiato' })).toBeVisible();
  await expect.poll(() => appunti(app)).toBe(testoCopiato);
  await r.hover();
  await r.getByRole('button', { name: 'Rispondi' }).click();
  // In un campo di una riga la citazione sta fra virgolette basse, in una casella su una riga sua.
  const unaRiga = await pagina.locator(campo).evaluate((el) => el.tagName !== 'TEXTAREA');
  await expect(pagina.locator(campo)).toHaveValue(unaRiga ? `«${citato}» ` : `> ${citato}\n`);
  await expect(pagina.locator(campo)).toBeFocused();
}

test('l’Aiuto dell’Editor: Copia e Rispondi sotto domanda e risposta, anche dal tasto destro', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await apriAiuto(app, editor);
  await chiediAllAiuto(editor, 'Cosa ne pensi del capitolo sui licheni?');
  await expect(editor.locator('.sn-sidebar-msg-assistant', { hasText: 'licheni va accorciato' })).toBeVisible({ timeout: 10_000 });
  await provaChat(app, editor, {
    contenitore: '.sn-sidebar-conv', messaggi: '.sn-sidebar-msg-user, .sn-sidebar-msg-assistant',
    risposta: '.sn-sidebar-msg-assistant', campo: '.sn-sidebar-input textarea',
    testoCopiato: 'Il capitolo sui licheni va accorciato.\n\nIl resto regge.', citato: 'Il capitolo sui licheni va accorciato. Il resto regge.',
  });
  await editor.screenshot({ path: 'tests/.shots/2096-aiuto-editor.png' });

  await editor.locator('.sn-sidebar-input textarea').fill('');
  const domanda = editor.locator('.sn-sidebar-msg-user').last();
  await domanda.click({ button: 'right' });
  await expect(menuDi(editor).voce('Rispondi').first()).toBeVisible();
  await menuDi(editor).voce('Copia il messaggio').first().click();
  await expect.poll(() => appunti(app)).toBe('Cosa ne pensi del capitolo sui licheni?');
});

test('l’Aiuto sopra un sito: la barra compare sotto la risposta senza spostarla, e Copia copia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await home(app);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Iscrizioni</title><h1>Iscriviti</h1>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'dove mi iscrivo?');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('licheni', { timeout: 10_000 });
  await provaChat(app, aiuto, {
    contenitore: '.sn-sidebar-conv', messaggi: '.sn-sidebar-msg-user, .sn-sidebar-msg-assistant',
    risposta: '.sn-sidebar-msg-assistant', campo: '.sn-sidebar-input textarea',
    testoCopiato: 'Il capitolo sui licheni va accorciato.\n\nIl resto regge.', citato: 'Il capitolo sui licheni va accorciato. Il resto regge.',
  });
});

test('i Mazzi: Copia e Rispondi sotto domanda e risposta, senza spostare la chat', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await home(app);
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await expect(mazzi.locator('#screenBuilder')).toBeVisible();
  await mazzi.fill('#chatInput', 'che ne pensi del mazzo?');
  await mazzi.press('#chatInput', 'Enter');
  await expect(mazzi.locator('.dk-msg-bot').last()).toContainText('servono più pescate', { timeout: 15_000 });
  await provaChat(app, mazzi, {
    contenitore: '#chatLog', messaggi: '.dk-msg-user, .dk-msg-bot.sn-con-azioni-msg',
    risposta: '.dk-msg-bot.sn-con-azioni-msg', campo: '#chatInput',
    testoCopiato: 'Per questo mazzo servono più pescate.', citato: 'Per questo mazzo servono più pescate.',
  });
  await mazzi.screenshot({ path: 'tests/.shots/2096-mazzi.png' });
});

test('uno scambio di un’app nella home: Copia e Rispondi, e la risposta parte citata col suo posto', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const casa = await home(app);
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await mazzi.fill('#chatInput', 'che ne pensi del mazzo?');
  await mazzi.press('#chatInput', 'Enter');
  await expect(mazzi.locator('.dk-msg-bot').last()).toContainText('servono più pescate', { timeout: 15_000 });
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => String(x.url || '').startsWith('filo://newtab'));
    if (t) await window.filoShell.tabs.activate(t.id);
  });
  const riga = casa.locator('#bubbles .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await riga.locator('.dash-riga-app-testa').click();
  const risposta = riga.locator('.dash-riga-app-msg-filo');
  await expect(risposta).toContainText('servono più pescate');

  await casa.mouse.move(1, 1);
  const ferma = await geometria(casa, '#bubbles', '.dash-riga-app-msg, .dash-riga-app');
  for (const m of [riga.locator('.dash-riga-app-msg-user'), risposta]) {
    await m.hover();
    await expect(m.locator('.sn-azioni-msg')).toBeVisible();
    expect(await geometria(casa, '#bubbles', '.dash-riga-app-msg, .dash-riga-app')).toEqual(ferma);
  }
  await risposta.hover();
  await risposta.getByRole('button', { name: 'Copia' }).click();
  await expect.poll(() => appunti(app)).toBe('Per questo mazzo servono più pescate.');
  await risposta.hover();
  await risposta.getByRole('button', { name: 'Rispondi' }).click();
  await expect(casa.locator('#citazione')).toContainText('servono più pescate');
  await casa.screenshot({ path: 'tests/.shots/2096-righe-citazione.png' });
  await casa.locator('#input').fill('quali carte?');
  await casa.locator('#input').press('Enter');
  // La domanda arriva al modello con la citazione in testa, e il testo citato è quello dei Mazzi.
  await expect.poll(() => app.evaluate(() => globalThis.__domande.length), { timeout: 20_000 }).toBeGreaterThan(0);
  console.log('DEBUG', JSON.stringify(await app.evaluate(() => globalThis.__domande.map((t) => t.slice(-600)))));
  const conCitazione = () => app.evaluate(() => globalThis.__domande.flatMap((t) => t.split('\n')).find((r) => r.includes("l'utente risponde al tuo messaggio")) || '');
  await expect.poll(conCitazione, { timeout: 20_000 }).toContain('servono più pescate');
});

// Il riquadro di Traduci: la risposta ha Copia e Rispondi sempre a schermo, la domanda dopo li ha al passaggio del mouse.
const PAGINA = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">'
  + '<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p></body></html>';

test('il riquadro: Rispondi accanto a Copia sotto la risposta, e Copia e Rispondi sotto la domanda dopo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const rs = ['The **cat** sleeps.', 'Cats sleep.'];
    let n = 0;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => { const t = rs[n++] || 'Altro.'; onDelta(t); return { text: t, usage: {} }; },
    };
  });
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('translate-selection', win);
  });
  await expect.poll(() => conta(app, page, '.sn-msg-rispondi'), { timeout: 15_000 }).toBe(1);
  expect(await conta(app, page, '.sn-msg-copia')).toBe(1);
  await clicca(app, page, '.sn-msg-rispondi');
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-input'))?.valore || '').toBe('> The cat sleeps.\n');

  const dove = await scrivi(app, page, '.sn-popup-input', 'and the plural?');
  await dove.keyboard.press('Enter');
  await expect.poll(() => conta(app, page, '.sn-msg-copia'), { timeout: 15_000 }).toBe(2);
  // Sopra la domanda la barra compare e niente si sposta.
  const prima = await statoDi(app, page, '.sn-msg-user');
  const mouse = await tastieraDi(app, page);
  await mouse.mouse.move(prima.x + prima.width / 2, prima.y + prima.height / 2);
  await expect.poll(async () => (await statoDi(app, page, '.sn-msg-user .sn-azioni-msg'))?.visibile, { timeout: 5_000 }).toBe(true);
  const dopo = await statoDi(app, page, '.sn-msg-user');
  expect([dopo.x, dopo.y, dopo.width, dopo.height]).toEqual([prima.x, prima.y, prima.width, prima.height]);
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await clicca(app, page, '.sn-msg-user .sn-azioni-msg-tasto[data-azione="copia"]');
  // La domanda è partita con la citazione in testa: si copia com'è stata scritta.
  await expect.poll(() => appunti(app)).toBe('> The cat sleeps.\nand the plural?');
});
