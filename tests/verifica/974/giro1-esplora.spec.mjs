// Verifica #974 giro 1: esplorazione avversariale delle righe ripiegate delle altre app nella home.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';
const AIUTO = '**Iscriviti** è in alto a destra: vedi [la guida](https://example.com/guida).';

async function prepara(app) {
  await app.evaluate(async (_e, aiuto) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, model: attempts[0].model, provider: attempts[0].provider, usage: {} });
      const tutto = JSON.stringify(messages);
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (tutto.includes('preparare la dashboard')) return fatto('{"message":"","suggestions":[]}');
      if (sistema.includes('# Protocollo di risposta')) return fatto(JSON.stringify({ text: aiuto, status: 'done' }));
      if (sistema.includes('assistente di scrittura dentro un editor')) return fatto('Il capitolo sui licheni va accorciato di metà.');
      return fatto('{}');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, AIUTO);
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
  await editor.keyboard.press('Escape');
  await editor.locator('.ed-switch-icon').nth(1).click();
  const chat = editor.locator('.ed-module[data-type="chat"]');
  await chat.locator('[data-chat="input"]').fill(domanda);
  await chat.locator('[data-chat="send"]').click();
  await expect(chat.locator('.ed-chat-msg.assistant', { hasText: 'licheni va accorciato' })).toBeVisible({ timeout: 10_000 });
  return editor;
}

test('aiuto con risposta formattata: nello scambio aperto della home niente asterischi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const casa = await home(app);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Iscrizioni</title><h1>Iscriviti</h1><button>Iscriviti</button>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await sito.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await sito.fill('.sn-sidebar-input textarea', 'dove mi iscrivo?');
  await sito.press('.sn-sidebar-input textarea', 'Enter');
  const nelSito = sito.locator('.sn-sidebar-msg-assistant').last();
  await expect(nelSito).toContainText('Iscriviti', { timeout: 10_000 });
  const htmlSito = await nelSito.innerHTML();
  await attiva(shell, 'filo://newtab');
  const riga = casa.locator('#righeApp .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await riga.locator('.dash-riga-app-testa').click();
  const msg = riga.locator('.dash-riga-app-msg-filo');
  await expect(msg).toBeVisible();
  mkdirSync(SHOTS, { recursive: true });
  await casa.screenshot({ path: `${SHOTS}/v974-aiuto-markdown.png` });
  expect(htmlSito, 'nel sito la risposta è formattata').toContain('<strong>');
  await expect(msg).not.toContainText('**');
});

test('home aperta dopo la chat dell’Editor: la riga c’è', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await home(app);
  await chatDellEditor(openTab, 'tesi', 'Cosa ne pensi del capitolo sui licheni?');
  const nuova = await openTab('filo://newtab/');
  await expect(nuova.locator('#input')).toBeVisible({ timeout: 10_000 });
  await expect(nuova.locator('.dash-riga-app-testo')).toHaveText("2 messaggi nell'Editor su tesi", { timeout: 10_000 });
});

test('documento con nome lungo, emoji e markup: riga su una riga, niente markup, niente scorrimento orizzontale', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app);
  const casa = await home(app);
  const nome = `<b>tesi</b> 🦎 ${'licheni crostosi e fogliosi '.repeat(8)}`;
  await chatDellEditor(openTab, nome, 'Cosa ne pensi?');
  await attiva(shell, 'filo://newtab');
  const riga = casa.locator('#righeApp .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(riga.locator('.dash-riga-app-testo')).toContainText('<b>tesi</b>');
  const m = await riga.evaluate((el) => {
    const t = el.querySelector('.dash-riga-app-testa');
    const r = t.getBoundingClientRect();
    return { h: r.height, right: r.right, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
  });
  mkdirSync(SHOTS, { recursive: true });
  await casa.screenshot({ path: `${SHOTS}/v974-nome-lungo.png` });
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect(casa.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await riga.locator('.dash-riga-app-testa').click();
  await casa.waitForTimeout(600);
  await casa.screenshot({ path: `${SHOTS}/v974-nome-lungo-scuro-aperta.png` });
  expect(m.sw).toBeLessThanOrEqual(m.vw);
  expect(m.right).toBeLessThanOrEqual(m.vw);
});

test('documento rinominato dopo la chat: la riga dice il nome nuovo', async ({ app, shell, openTab }) => {
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
  await expect(casa.locator('#righeApp .dash-riga-app-testo')).toHaveText("2 messaggi nell'Editor su tesi definitiva", { timeout: 10_000 });
});
