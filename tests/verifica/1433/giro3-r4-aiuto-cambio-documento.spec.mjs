// Verifica #1433, giro 3, rilievo 4: la modifica chiesta all'Aiuto su un documento non finisce su un altro aperto nel frattempo.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('r4 la risposta dell\'Aiuto arrivata dopo «Nuovo documento» non mette il grassetto nel documento nuovo', async ({ app, openTab }) => {
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
      await new Promise((r) => setTimeout(r, 2500));
      return { ...base, text: JSON.stringify({ text: 'Fatto: titoli in grassetto.', formatta: [{ op: 'format', target: 'headings', style: 'bold', value: true }] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  });
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && document.querySelector('.pd-elemento'));
  await ed.evaluate(() => {
    document.getElementById('doc').innerHTML = '<h1>Capitolo A</h1><p>Testo del documento A.</p>';
    document.getElementById('doc').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await ed.fill('.sn-sidebar-input textarea', 'metti in grassetto i titoli');
  await ed.press('.sn-sidebar-input textarea', 'Enter');
  await ed.waitForTimeout(500);
  await ed.click('#docSwitch');
  await ed.click('#docNew');
  await ed.waitForTimeout(300);
  await ed.evaluate(() => {
    document.getElementById('doc').innerHTML = '<h1>Capitolo B</h1><p>Testo del documento B.</p>';
    document.getElementById('doc').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(ed.locator('.sn-sidebar-msg-assistant').last()).not.toHaveText('', { timeout: 15000 });
  await ed.waitForTimeout(3500);
  await expect(ed.locator('#doc h1')).toContainText('Capitolo B');
  expect(await ed.locator('#doc h1 b, #doc h1 strong').count(), 'il documento nuovo non è stato toccato').toBe(0);
});
