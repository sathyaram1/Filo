// Verifica #974 giro 2: esplorazione (HTML nei messaggi, ricerca in Cronologia, tema scuro, testi lunghi, due documenti).
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';

async function prepara(app, rispostaEditor) {
  await app.evaluate(async (_e, rEd) => {
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
      if (sistema.includes('assistente di scrittura dentro un editor')) return fatto(rEd);
      return fatto('{}');
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, rispostaEditor);
}

async function attiva(shell, prefisso) {
  await shell.evaluate(async (p) => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.find((x) => String(x.url || '').startsWith(p));
    if (t) await window.filoShell.tabs.activate(t.id);
  }, prefisso);
}

async function chatDellEditor(editor, titolo, domanda, attesa) {
  await editor.click('#docSwitch');
  await editor.locator('.ed-doc-item.active').locator('.ed-doc-rename').click();
  await editor.locator('.ed-doc-item-input').fill(titolo);
  await editor.locator('.ed-doc-item-input').press('Enter');
  await editor.keyboard.press('Escape');
  const chat = editor.locator('.ed-module[data-type="chat"]');
  if (!(await chat.count())) await editor.locator('.ed-switch-icon').nth(1).click();
  await chat.locator('[data-chat="input"]').fill(domanda);
  await chat.locator('[data-chat="send"]').click();
  await expect(chat.locator('.ed-chat-msg.assistant', { hasText: attesa })).toBeVisible({ timeout: 10_000 });
}

test('html nei messaggi, ricerca in Cronologia, tema scuro', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const RISP = 'Ecco <img src=x onerror="window.__xss=1"> e [clic](javascript:window.__xss=2) **grassetto** ' + 'parola '.repeat(400);
  await prepara(app, RISP);
  const casa = await home(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await chatDellEditor(editor, '<b>tesi</b> 🎓', 'domanda <img src=y onerror="window.__xss=3"> sui muschi zebrati', 'grassetto');
  await attiva(shell, 'filo://newtab');
  const riga = casa.locator('#righeApp .dash-riga-app');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(riga.locator('.dash-riga-app-testo')).toHaveText("2 messaggi nell'Editor su <b>tesi</b> 🎓");
  await riga.locator('.dash-riga-app-testa').click();
  await expect(riga.locator('.dash-riga-app-msg-user')).toContainText('<img src=y');
  expect(await riga.locator('img').count()).toBe(0);
  expect(await casa.evaluate(() => window.__xss || 0)).toBe(0);
  const hrefs = await riga.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  console.log('HREFS', JSON.stringify(hrefs));
  const larghezza = await casa.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  console.log('LARGHEZZA', larghezza);
  mkdirSync(SHOTS, { recursive: true });
  await casa.screenshot({ path: `${SHOTS}/v974g2-lungo-chiaro.png` });
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await casa.waitForTimeout(800);
  await casa.screenshot({ path: `${SHOTS}/v974g2-lungo-scuro.png` });

  const cron = await openTab('filo://archive/archive.html');
  await cron.fill('#search', 'muschi zebrati');
  await cron.press('#search', 'Enter');
  await cron.waitForTimeout(1500);
  const titoli = await cron.locator('.arc-chat-title').allTextContents();
  console.log('CRONOLOGIA', JSON.stringify(titoli));
  await cron.screenshot({ path: `${SHOTS}/v974g2-cronologia.png` });
  expect(titoli.join(' ')).toContain('Editor');
});
