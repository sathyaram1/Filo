// #974 — Le conversazioni dell'Editor, dei Mazzi e dell'Aiuto entrano nel filo come righe ripiegate: nella home
// compare la riga col numero di messaggi e il nome, aperta mostra lo scambio, e la chat della home la trova cercando
// (al modello arriva la riga, non lo scambio). Senza il #974 nessuna di queste conversazioni arrivava al filo.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, chiedi } from './helpers/chatFinta.mjs';
import { clickConfirm } from './helpers/confirm.mjs';
import { mkdirSync } from 'node:fs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

const SHOTS = 'tests/.shots';

// Modelli finti per le tre app (non in streaming, tranne i Mazzi che passano dal ragionamento): niente rete.
async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash',
        [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, model: attempts[0].model, provider: attempts[0].provider, usage: {} });
      const tutto = JSON.stringify(messages);
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const ultimo = String((messages[messages.length - 1] || {}).content || '');
      if (tutto.includes('preparare la dashboard')) return fatto('{"message":"","suggestions":[]}');
      if (/CARTE CANDIDATE/.test(ultimo)) return fatto(JSON.stringify({ keep: (ultimo.match(/^\d+(?=\. )/gm) || []).map(Number) }));
      if (sistema.includes('# Protocollo di risposta')) return fatto(JSON.stringify({ text: 'Il pulsante Iscriviti è in alto a destra.', status: 'done' }));
      if (sistema.includes('deck builder per Magic')) return fatto(JSON.stringify({ reply: 'Per questo mazzo servono più pescate.' }));
      if (sistema.includes('assistente di scrittura dentro un editor')) return fatto('Il capitolo sui licheni va accorciato di metà.');
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

async function attiva(shell, prefisso) {
  await shell.evaluate(async (p) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => String(x.url || '').startsWith(p));
    if (t) await window.filoShell.tabs.activate(t.id);
  }, prefisso);
}

async function chatDellEditor(openTab, titolo, domanda) {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.click('#docSwitch');
  await editor.locator('.ed-doc-item').first().locator('.ed-doc-rename').click();
  await editor.locator('.ed-doc-item-input').fill(titolo);
  await editor.locator('.ed-doc-item-input').press('Enter');
  await expect(editor.locator('#docTitle')).toHaveText(titolo);
  await editor.keyboard.press('Escape');
  await editor.locator('.ed-switch-icon').nth(1).click();
  const chat = editor.locator('.ed-module[data-type="chat"]');
  await chat.locator('[data-chat="input"]').fill(domanda);
  await chat.locator('[data-chat="send"]').click();
  await expect(chat.locator('.ed-chat-msg.assistant', { hasText: 'licheni va accorciato' })).toBeVisible({ timeout: 10_000 });
  return editor;
}

const righeFilo = (app) => app.evaluate(async () => (await globalThis.SN_IL_FILO.chats()).filter((c) => c.app));

test('un messaggio nella chat dell’Editor: nella home la riga ripiegata col numero e il documento, aperta mostra lo scambio', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const casa = await home(app);
  await chatDellEditor(openTab, 'tesi', 'Cosa ne pensi del capitolo sui licheni?');
  await attiva(shell, 'filo://newtab');

  const riga = casa.locator('#bubbles .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(riga.locator('.dash-riga-app-testo')).toHaveText("2 messaggi nell'Editor su tesi");
  await expect(riga.locator('.dash-riga-app-testa')).toHaveAttribute('title', 'Mostra lo scambio');
  await expect(riga.locator('.dash-riga-app-corpo')).toBeHidden();

  await riga.locator('.dash-riga-app-testa').click();
  await expect(riga.locator('.dash-riga-app-msg-user')).toHaveText('Cosa ne pensi del capitolo sui licheni?');
  await expect(riga.locator('.dash-riga-app-msg-filo')).toHaveText('Il capitolo sui licheni va accorciato di metà.');
  await expect(riga.locator('.dash-riga-app-vai')).toHaveText("Apri nell'Editor");
  mkdirSync(SHOTS, { recursive: true });
  await casa.mouse.move(5, 790);
  await casa.screenshot({ path: `${SHOTS}/974-home-riga-editor.png` });
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect(casa.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  // La riga cambia colore con una transizione: la foto dopo che è finita.
  await expect.poll(() => riga.locator('.dash-riga-app-testa').evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(37, 33, 28)');
  await casa.screenshot({ path: `${SHOTS}/974-home-riga-editor-scuro.png` });

  // «Apri nell'Editor» riporta al documento di quella conversazione.
  await riga.locator('.dash-riga-app-vai').click();
  await expect.poll(async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url)))
    .some((u) => /^filo:\/\/editor\/editor\.html\?file=/.test(u))).toBe(true);
});

test('la conversazione di un mazzo: la riga col nome del mazzo, e svuotando la chat sparisce anche dal filo', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await app.evaluate(() => {
    const NIV = {
      id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6, type_line: 'Legendary Creature — Dragon Wizard',
      colors: ['U', 'R'], color_identity: ['U', 'R'], image_uris: { normal: 'https://cards.test/niv.jpg' }, prices: { eur: '3.21' },
      legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/niv',
    };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      const body = u.pathname === '/cards/niv-1' ? NIV : (u.pathname === '/symbology' ? { data: [] } : null);
      return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
    });
  });
  const casa = await home(app);
  const mazzi = await openTab('filo://decks/decks.html');
  await mazzi.waitForLoadState('domcontentloaded');
  await mazzi.click('#newDeck');
  await expect(mazzi.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await mazzi.evaluate(() => location.hash)).replace('#/deck/', ''));
  await mazzi.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  await mazzi.fill('#chatInput', 'che ne pensi del mazzo?');
  await mazzi.press('#chatInput', 'Enter');
  await expect(mazzi.locator('.dk-msg-bot').last()).toContainText('servono più pescate', { timeout: 15_000 });

  await attiva(shell, 'filo://newtab');
  const riga = casa.locator('#bubbles .dash-riga-app');
  await expect(riga.locator('.dash-riga-app-testo')).toHaveText('2 messaggi nei Mazzi su Niv-Mizzet, Parun', { timeout: 10_000 });
  await riga.locator('.dash-riga-app-testa').click();
  await expect(riga.locator('.dash-riga-app-msg-user')).toHaveText('che ne pensi del mazzo?');
  await expect(riga.locator('.dash-riga-app-msg-filo')).toContainText('servono più pescate');

  // «La conversazione sparisce per sempre»: anche dal filo, e la riga se ne va dalla home aperta.
  await mazzi.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_CHAT_CLEAR, deckId: id }), deckId);
  await expect(riga).toHaveCount(0, { timeout: 10_000 });
  expect(await righeFilo(app)).toEqual([]);
});

test('una conversazione con l’Aiuto sopra un sito: la riga col nome del sito, e a ogni apertura una riga nuova', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const casa = await home(app);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Iscrizioni</title><h1>Iscriviti</h1><button>Iscriviti</button>');
  // Su un sito l'Aiuto sta nello strato sopra la scheda (#1509.3).
  let aiuto = null;
  const apri = async () => {
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
    await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
    aiuto = await paginaDellAiuto(app, sito);
    await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  };
  await apri();
  await aiuto.fill('.sn-sidebar-input textarea', 'dove mi iscrivo?');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant').last()).toContainText('Iscriviti è in alto', { timeout: 10_000 });

  await attiva(shell, 'filo://newtab');
  const righe = casa.locator('#bubbles .dash-riga-app');
  await expect(righe).toHaveCount(1, { timeout: 10_000 });
  await expect(righe.first().locator('.dash-riga-app-testo')).toHaveText("2 messaggi nell'Aiuto su 127.0.0.1");
  await righe.first().locator('.dash-riga-app-testa').click();
  await expect(righe.first().locator('.dash-riga-app-msg-user')).toHaveText('dove mi iscrivo?');
  await expect(righe.first().locator('.dash-riga-app-msg-filo')).toHaveText('Il pulsante Iscriviti è in alto a destra.');
  await expect(righe.first().locator('.dash-riga-app-vai')).toHaveText('Apri la pagina');
  const [c] = await righeFilo(app);
  expect(c.dove).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);

  // Chiusa e riaperta, l'Aiuto comincia un'altra conversazione: una riga sua.
  await attiva(shell, 'http://127.0.0.1');
  await aiuto.locator('.sn-sidebar-close').click();
  await expect(aiuto.locator('.sn-sidebar')).toHaveCount(0);
  await apri();
  await aiuto.fill('.sn-sidebar-input textarea', 'e il modulo?');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(async () => (await righeFilo(app)).length, { timeout: 10_000 }).toBe(2);
});

test('con modello finto la chat della home ha davanti la riga, non lo scambio, e cercando nel filo lo trova', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const casa = await home(app);
  await chatDellEditor(openTab, 'tesi', 'Il capitolo sui licheni crostosi è troppo lungo?');
  await attiva(shell, 'filo://newtab');
  const [conv] = await righeFilo(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'CERCA_CHAT', arguments: JSON.stringify({ query: 'licheni crostosi' }) }] },
    { toolCalls: [{ id: 't2', name: 'CERCA_CHAT', arguments: JSON.stringify({ id: conv.id }) }] },
    { text: 'Nell’Editor ti avevo detto di accorciarlo.' },
  ]);
  await chiedi(casa, 'cosa mi avevi detto sul capitolo?');
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'accorciarlo' })).toBeVisible({ timeout: 20_000 });

  const chiamate = await chiamateAlModello(app);
  const testo = (msgs) => msgs.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const prima = testo(chiamate[0]);
  expect(prima).toContain("(conversazione nell'Editor su «tesi»: 2 messaggi");
  expect(prima, 'lo scambio intero non entra nel contesto').not.toContain('licheni crostosi è troppo lungo');
  const trovati = testo(chiamate[1].filter((m) => m.role === 'tool'));
  expect(trovati).toContain('Editor · tesi');
  expect(trovati).toContain('licheni crostosi');
  const riletta = testo(chiamate[2].filter((m) => m.role === 'tool'));
  expect(riletta).toContain('Utente: Il capitolo sui licheni crostosi è troppo lungo?');
  expect(riletta).toContain('Filo: Il capitolo sui licheni va accorciato di metà.');

  await casa.mouse.move(5, 790);
  mkdirSync(SHOTS, { recursive: true });
  await casa.screenshot({ path: `${SHOTS}/974-home-riga-nella-conversazione.png` });
  // La riga sta nella conversazione della home in testa, prima della domanda.
  const ordine = await casa.locator('#bubbles > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0]));
  expect(ordine.indexOf('dash-riga-app')).toBeGreaterThanOrEqual(0);
  expect(ordine.indexOf('dash-riga-app')).toBeLessThan(ordine.indexOf('dash-bubble'));
});

test('la riga si toglie dal filo col tasto destro, e la ricerca del filo la trova dal testo dello scambio', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const casa = await home(app);
  await chatDellEditor(openTab, 'appunti', 'Mi riassumi i licheni?');

  await attiva(shell, 'filo://newtab');
  // La ricerca del filo la trova dal testo dello scambio (la Cronologia, che lo faceva, non c'è più: #872).
  await casa.locator('#cercaInput').fill('licheni');
  await expect(casa.locator('.dash-cerca-msg', { hasText: 'licheni' }).first()).toBeVisible({ timeout: 10_000 });
  await casa.locator('#cercaInput').press('Escape');
  const riga = casa.locator('#bubbles .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await riga.locator('.dash-riga-app-testa').click({ button: 'right' });
  const menu = menuDi(casa).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Mostra lo scambio', { exact: true })).toBeVisible();
  await expect(menu.getByText("Apri nell'Editor", { exact: true })).toBeVisible();
  await menu.getByText('Copia lo scambio', { exact: true }).click();
  await expect(riga.locator('.dash-riga-app-ora')).toHaveText('copiato');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Tu: Mi riassumi i licheni?');
  await riga.locator('.dash-riga-app-testa').click({ button: 'right' });
  await menu.getByText('Togli dal filo', { exact: true }).click();
  await clickConfirm(casa, 'ok');
  await expect(riga).toHaveCount(0);
  await expect.poll(async () => (await righeFilo(app)).length).toBe(0);
});

test('da un sito parla solo l’Aiuto, e il sito lo dice l’indirizzo di chi manda; righe e cancellazioni solo da Filo', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const { MSG } = globalThis.SN_MSG;
    const sito = { tab: { url: 'https://ostile.example/pagina?x=1' }, url: 'https://ostile.example/pagina?x=1' };
    const msg = (o) => globalThis.SN_HANDLE_MESSAGE(o, sito);
    const finta = await msg({ type: MSG.FILO_CONVERSAZIONE_APP, app: 'editor', rif: 'f:m', soggetto: 'tesi', messaggi: [{ role: 'user', text: 'x' }] });
    const aiuto = await msg({ type: MSG.FILO_CONVERSAZIONE_APP, app: 'aiuto', rif: '1', soggetto: 'banca.it', dove: 'filo://manage', messaggi: [{ role: 'user', text: 'ciao' }] });
    const righe = await msg({ type: MSG.FILO_RIGHE_APP });
    const via = await msg({ type: MSG.FILO_CONVERSAZIONE_APP_DIMENTICA, app: 'aiuto', prefisso: '' });
    const chats = (await globalThis.SN_IL_FILO.chats()).filter((c) => c.app);
    return { finta, aiuto, righe, via, chats: chats.map((c) => ({ app: c.app, soggetto: c.soggetto, dove: c.dove, rif: c.rif })) };
  });
  expect(r.finta.code).toBe('forbidden');
  expect(r.aiuto.ok).toBe(true);
  expect(r.righe.code).toBe('forbidden');
  expect(r.via.code).toBe('forbidden');
  expect(r.chats).toEqual([{ app: 'aiuto', soggetto: 'ostile.example', dove: 'https://ostile.example/pagina?x=1', rif: 'ostile.example|1' }]);
});

test('con una conversazione della home aperta, la riga di un’app nata adesso arriva da sola in fondo', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const casa = await home(app);
  await modelloFinto(app, [{ text: 'Ciao, dimmi.' }]);
  await chiedi(casa, 'ciao Filo');
  await expect(casa.locator('.dash-bubble-filo', { hasText: 'Ciao, dimmi.' })).toBeVisible({ timeout: 15_000 });
  await prepara(app);
  await chatDellEditor(openTab, 'tesi', 'E il capitolo sui licheni?');
  await attiva(shell, 'filo://newtab');
  const riga = casa.locator('#bubbles .dash-riga-app');
  await expect(riga.locator('.dash-riga-app-testo')).toHaveText("2 messaggi nell'Editor su tesi", { timeout: 10_000 });
  const ordine = await casa.locator('#bubbles > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0]));
  expect(ordine[ordine.length - 1]).toBe('dash-riga-app');
  expect(ordine.indexOf('dash-bubble')).toBeLessThan(ordine.indexOf('dash-riga-app'));
  await expect(casa.locator('#righeApp')).toBeHidden();
});

test('rinominato dopo la chat, il documento o il mazzo: la riga e la ricerca dicono il nome nuovo', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const casa = await home(app);
  const editor = await chatDellEditor(openTab, 'bozza', 'Cosa ne pensi del capitolo sui licheni?');
  await editor.click('#docSwitch');
  await editor.locator('.ed-doc-item').first().locator('.ed-doc-rename').click();
  await editor.locator('.ed-doc-item-input').fill('tesi definitiva');
  await editor.locator('.ed-doc-item-input').press('Enter');
  await editor.keyboard.press('Escape');
  await attiva(shell, 'filo://newtab');
  await expect(casa.locator('#bubbles .dash-riga-app-testo')).toHaveText("2 messaggi nell'Editor su tesi definitiva", { timeout: 10_000 });
  const [conv] = await righeFilo(app);
  expect(conv.title).toBe('Editor · tesi definitiva');

  // Il mazzo rinominato, da qualunque strada passi il salvataggio, porta con sé la sua riga.
  const mazzo = await app.evaluate(async () => {
    const deck = await globalThis.SN_DECK_STORE.create({ nome: 'Prova' });
    await globalThis.SN_DECK_CHATS_SVC.edit(deck.id, { op: 'append', messages: [{ who: 'user', text: 'serve più rampa?' }] });
    await globalThis.SN_DECK_STORE.put(globalThis.SN_DECKS.renameDeck(deck, 'Draghi rossi'));
    return (await globalThis.SN_IL_FILO.chats()).find((c) => c.app === 'mazzi');
  });
  expect(mazzo.soggetto).toBe('Draghi rossi');
  expect(mazzo.title).toBe('Mazzi · Draghi rossi');
});

test('le risposte di Filo nello scambio aperto restano formattate, e il loro link apre una scheda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    const prima = P.completeWithFallback;
    P.completeWithFallback = async (o) => {
      const sistema = String((o.messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return prima(o);
      const text = '**Iscriviti** è in alto a destra: vedi [la guida](https://example.com/guida). <b>niente markup</b>';
      return { text: JSON.stringify({ text, status: 'done' }), model: o.attempts[0].model, provider: o.attempts[0].provider, usage: {} };
    };
  });
  const casa = await home(app);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Iscrizioni</title><h1>Iscriviti</h1><button>Iscriviti</button>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'dove mi iscrivo?');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect(aiuto.locator('.sn-sidebar-msg-assistant strong').last()).toHaveText('Iscriviti', { timeout: 10_000 });

  await attiva(shell, 'filo://newtab');
  const riga = casa.locator('#bubbles .dash-riga-app');
  await riga.locator('.dash-riga-app-testa').click();
  const msg = riga.locator('.dash-riga-app-msg-filo');
  await expect(msg.locator('strong')).toHaveText('Iscriviti');
  await expect(msg).not.toContainText('**');
  await expect(msg).toContainText('<b>niente markup</b>');
  await expect(msg.locator('b')).toHaveCount(0);
  await expect(riga.locator('.dash-riga-app-msg-user')).toHaveText('dove mi iscrivo?');
  mkdirSync(SHOTS, { recursive: true });
  await casa.screenshot({ path: `${SHOTS}/974-home-riga-formattata.png` });
  await msg.locator('a.filo-md-link').click();
  await expect.poll(async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url)))
    .some((u) => u.startsWith('https://example.com/guida'))).toBe(true);
});
