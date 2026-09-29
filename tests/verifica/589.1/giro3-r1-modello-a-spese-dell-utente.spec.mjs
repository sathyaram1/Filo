// #589.1 giro 3, rilievo 1 — un sito, da una scheda di sfondo e senza un gesto, fa lavorare il modello dell'utente
// con un testo scelto da lui (domanda al modello coi messaggi già scritti) o col «Ha funzionato?» dell'Aiuto
// (due chiamate a ogni invio). Serve l'isolamento dei contesti rotto: qui lo simula il mondo 999.

import { test, expect } from '../../fixtures/electron.mjs';

function dalPreload(app, quale) {
  return (codice) => app.evaluate(async ({ BrowserWindow }, { src, codice: c }) => {
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    const wcs = BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs?.tabs || []).map((t) => t.view.webContents));
    const wc = wcs.find((x) => { try { return scegli(x.getURL()); } catch (_) { return false; } });
    if (!wc) return { nonTrovata: true };
    try {
      return { risposta: await wc.executeJavaScriptInIsolatedWorld(999, [{ code: c }]) };
    } catch (e) { return { errore: String(e) }; }
  }, { src: quale.toString(), codice });
}

async function modelloFinto(app) {
  await app.evaluate(async () => {
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-or-v1-mia' } } },
      { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' });
    globalThis.__chiamateModello = [];
    const vero = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const u = String(input && input.url ? input.url : input);
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        globalThis.__chiamateModello.push(String(init && init.body || ''));
        const sse = `data: ${JSON.stringify({ id: 'g', choices: [{ delta: { content: '{"text":"RISPOSTA-DEL-MODELLO","status":"done"}' } }] })}\n\n`
          + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return vero(input, init);
    };
  });
}

test('un sito di sfondo non fa scrivere al modello dell\'utente un testo scelto da lui', async ({ app, openTab, testServer }) => {
  await modelloFinto(app);
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const r = await sfondo(`chrome.runtime.sendMessage({ type: 'ai_request', action: 'explain',
    payload: { messages: [{ role: 'user', content: 'PROMPT-DEL-SITO scrivimi mille righe' }] } })`);
  expect(r.nonTrovata || r.errore).toBeFalsy();
  const chiamate = await app.evaluate(() => globalThis.__chiamateModello);
  expect(chiamate.filter((b) => b.includes('PROMPT-DEL-SITO')), 'il modello dell\'utente ha lavorato per il sito').toEqual([]);
});

test('un sito di sfondo non manda da solo il «Ha funzionato?» dell\'Aiuto', async ({ app, openTab, testServer }) => {
  await modelloFinto(app);
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const r = await sfondo(`(async () => { for (let i = 0; i < 5; i++) await chrome.runtime.sendMessage({ type: 'save_path', payload: { session: {
    rawUrl: 'https://negozio-vero.com/carrello', rawSteps: [{ action: 'click', target: 'Paga ora ' + i }],
    rawUserMessages: ['come pago ' + i], success: true } } }); return 'fatto'; })()`);
  expect(r.nonTrovata || r.errore).toBeFalsy();
  await new Promise((ok) => setTimeout(ok, 3000));
  const chiamate = await app.evaluate(() => globalThis.__chiamateModello);
  expect(chiamate.length, 'il sito ha fatto lavorare il modello dell\'utente senza un suo gesto').toBe(0);
});
