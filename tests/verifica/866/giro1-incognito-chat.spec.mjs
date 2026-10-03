// Verifica #866 giro 1 — la chat della home in una finestra incognito non arriva mai sul file del filo,
// e una chat normale scritta mentre l'incognito è aperto ci arriva.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const leggiFilo = (ud) => { const f = join(ud, 'filo', 'eventi.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Segreto' }) };
      return { ...base, text: JSON.stringify({ text: 'Risposta RISP-INCOG di Filo.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}

test('la chat della home in incognito resta fuori dal file, anche dopo aver chiuso la scheda', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await configura(app);
  await shell.evaluate(() => window.filoShell.openIncognito());
  // La home della finestra incognito si riconosce dal main: le si mette un segno e la si cerca fra le pagine.
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w && w._filoTabs.tabs.find((tt) => tt.view.webContents.getURL().startsWith('filo://newtab'));
    if (!t) return false;
    try { await t.view.webContents.executeJavaScript('window.__homeIncognito = 1'); return true; } catch (_) { return false; }
  }), { timeout: 20_000 }).toBe(true);
  let home = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try { if (await w.evaluate(() => window.__homeIncognito === 1)) { home = w; return true; } } catch (_) {}
    }
    return false;
  }, { timeout: 20_000 }).toBe(true);
  await home.waitForLoadState('domcontentloaded');
  await home.locator('#input').fill('Messaggio SEGRETO-INCOG-42');
  await home.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.chats({ incognito: true }))
    .some((c) => c.messages.some((m) => m.text.includes('SEGRETO-INCOG-42')))), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.chats({ incognito: true }))
    .some((c) => c.messages.some((m) => m.text.includes('RISP-INCOG')))), { timeout: 20_000 }).toBe(true);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(leggiFilo(userData)).not.toContain('SEGRETO-INCOG-42');
  expect(leggiFilo(userData)).not.toContain('RISP-INCOG');

  // Una chat della finestra normale mentre l'incognito è aperto va sul file.
  await app.evaluate((_e) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'Messaggio NORMALE-77', threadHistory: [], chatId: 'chat-normale-77' }));
  await expect.poll(() => leggiFilo(userData).includes('NORMALE-77'), { timeout: 10_000 }).toBe(true);

  // Chiusa la finestra incognito (la scheda muore, la chat si chiude e si classifica): il file resta pulito.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito)), { timeout: 10_000 }).toBe(false);
  await new Promise((r) => setTimeout(r, 1500));
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(leggiFilo(userData)).not.toContain('SEGRETO-INCOG-42');
  expect(leggiFilo(userData)).not.toContain('Segreto');
  expect(await app.evaluate(async () => (await globalThis.SN_IL_FILO.chats({ incognito: true })).length)).toBe(0);
});
