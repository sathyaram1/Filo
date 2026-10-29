// #1433 giro 6, rilievo 1: con l'Aiuto aperto nell'Editor le righe del foglio finiscono sotto l'Aiuto, e un clic sul
// foglio per tornare a scrivere non lo riduce alla casella.
import { test, expect } from '../../fixtures/electron.mjs';
import { EDITOR, apriAiuto } from '../../helpers/strumentiEditor.mjs';

// I rettangoli delle righe del testo che cadono sotto l'Aiuto.
const righeSotto = (ed) => ed.evaluate(() => {
  const a = document.querySelector('.sn-sidebar').getBoundingClientRect();
  const r = document.createRange();
  r.selectNodeContents(document.getElementById('doc'));
  return [...r.getClientRects()].filter((x) => x.width > 0 && x.right > a.left + 1 && x.left < a.right && x.bottom > a.top && x.top < a.bottom).length;
});

test('r1 con l\'Aiuto aperto e dopo un clic sul foglio, nessuna riga del documento resta sotto l\'Aiuto', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, finishReason: 'stop' };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      return { ...base, text: JSON.stringify({ text: 'Parla di una riga lunga.' }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  });
  // Una finestra da portatile: 1180 per 760.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setContentSize(1180, 760));
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('Un paragrafo abbastanza lungo da occupare tutta la colonna di testo del foglio e andare a capo almeno una volta, per vedere dove finisce davvero ogni riga del testo che sto scrivendo.');
  await apriAiuto(app, ed);
  await ed.fill('.sn-sidebar-input textarea', 'di cosa parla?');
  await ed.press('.sn-sidebar-input textarea', 'Enter');
  await expect(ed.locator('.sn-sidebar-msg-assistant').last()).toContainText('riga lunga');
  // Torno a scrivere: clic sul foglio.
  await ed.mouse.click(300, 300);
  await ed.waitForTimeout(800);
  expect(await righeSotto(ed), 'righe del foglio coperte dall\'Aiuto').toBe(0);
});
