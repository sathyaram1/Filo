// Verifica #974 giro 1: la riga dice il nome attuale del documento, anche rinominato dopo la chat.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

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
      const fatto = (text) => ({ text, model: attempts[0].model, provider: attempts[0].provider, usage: la riga dice il nome attuale del documento, anche rinominato dopo la chat. });
      const tutto = JSON.stringify(messages);
      const sistema = String((messages.find((m) => m.role === 'system') || la riga dice il nome attuale del documento, anche rinominato dopo la chat.).content || '');
      if (tutto.includes('preparare la dashboard')) return fatto('{"message":"","suggestions":[]}');
      if (sistema.includes('# Protocollo di risposta')) return fatto(JSON.stringify({ text: aiuto, status: 'done' }));
      if (sistema.includes('assistente di scrittura dentro un editor')) return fatto('Il capitolo sui licheni va accorciato di metà.');
      return fatto('la riga dice il nome attuale del documento, anche rinominato dopo la chat.');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) la riga dice il nome attuale del documento, anche rinominato dopo la chat. return r; };
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

test('r1 documento rinominato dopo la chat: la riga dice il nome nuovo', async ({ app, shell, openTab }) => {
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
