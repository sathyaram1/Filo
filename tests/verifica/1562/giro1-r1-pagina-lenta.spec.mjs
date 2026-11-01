// Verifica #1562 giro 1, rilievo 1: una pagina aperta prima di un messaggio, che finisce di caricarsi dopo, deve
// arrivare al modello in un messaggio successivo invece di sparire.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, { copione }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!(!!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic()))) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { if (r.text) onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text || '', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { copione });
}

async function scrivi(home, testo, risposta) {
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
}

const testo = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));

test('r1 una pagina che finisce di caricarsi dopo il messaggio arriva al modello col messaggio dopo', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  // Una pagina col titolo subito e un riquadro che risponde dopo quaranta secondi: il caricamento finisce dopo il messaggio.
  const server = createServer((req, res) => {
    if (req.url.startsWith('/lento')) {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<p>fine</p>'); }, 40_000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Orche che cacciano le foche</title><p>orche</p><iframe src="/lento"></iframe>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await preparaModello(app, [{ text: 'Ciao!' }, { text: 'Fino a novant\'anni.' }, { text: 'Prego.' }]);
    const home = await openTab('filo://newtab/');
    await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
    await scrivi(home, 'ciao', 'Ciao!');

    const sito = await openTab(`http://sito-pubblico.test:${server.address().port}/orche`);
    await expect(sito).toHaveTitle('Orche che cacciano le foche');
    // L'utente torna alla home e chiede mentre la pagina sta ancora caricando l'immagine.
    await home.bringToFront();
    await scrivi(home, 'quanto vivono?', 'Fino a novant\'anni.');
    // Il caricamento finisce: la visita entra nel filo.
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).map((p) => p.titolo)), { timeout: 30_000 })
      .toContain('Orche che cacciano le foche');
    await scrivi(home, 'grazie', 'Prego.');

    const chiamate = await app.evaluate(() => globalThis.__chiamate);
    const tutto = chiamate[chiamate.length - 1].messages.map(testo).join('\n');
    expect(tutto, 'la pagina sulle orche non arriva mai al modello').toContain('Orche che cacciano le foche');
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
