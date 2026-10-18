// Aiuti comuni alle prove della verifica #810: modello finto, assistente di pagina, nuova scheda.

import { expect } from '../../fixtures/electron.mjs';

export const CODICE = '482913';
export const RACCOLTA = 'raccolta.example';

export const apertoVerso = (app, host) => app.windows().some((w) => {
  try { return w.url().includes(host); } catch (_) { return false; }
});

export async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      terminal: { enabled: true },
    });
  });
}

// L'assistente di pagina risponde secondo l'ultimo messaggio dell'utente (`aiuto`: [[parola, risposta]]);
// la chat riceve i giri `giri` in fila. Ogni messaggio arrivato al modello resta in __visti.
export async function modelloFinto(app, { giri = [], aiuto = [] } = {}) {
  await app.evaluate(async (_electron, { giri, aiuto }) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    let n = 0;
    const risposta = (attempts, messages, onToolCall) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const testo = JSON.stringify(messages);
      if (!testo.includes('toolCalls') && !messages.some((m) => m.role === 'tool') && giri.length === 0) {
        const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
        const scelta = aiuto.find(([parola]) => ultimo.includes(parola)) || aiuto[aiuto.length - 1];
        return { ...base, text: scelta ? scelta[1] : '{"text":"ok","status":"done"}' };
      }
      const g = giri[Math.min(n, giri.length - 1)] || { text: 'ok' };
      n += 1;
      const calls = g.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: g.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages, null);
    P.streamCompleteWithFallback = async ({ attempts, messages, onToolCall }) => risposta(attempts, messages, onToolCall);
  }, { giri, aiuto });
}

// Le ricerche che partono davvero verso il motore restano in __ricerche.
export async function ricercheFinte(app, results = []) {
  await app.evaluate((_electron, results) => {
    globalThis.__ricerche = [];
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => {
      globalThis.__ricerche.push(query);
      return { provider: 'finto', results };
    };
  }, results);
}

export async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}

export async function scriviAllAiuto(page, testo) {
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

export async function newtab(app, prefisso = 'filo://newtab') {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith(prefisso));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${prefisso} non trovata`);
}

export const NAVIGA_COL_CODICE = JSON.stringify({
  action: 'filo', filo: { type: 'NAVIGA', url: `https://${RACCOLTA}/c?v=${CODICE}` }, text: 'Apro la verifica.',
});

// La riga che dice all'utente che l'uscita è stata fermata, oppure il segno che è partita.
export async function esitoUscita(app, page) {
  const riga = page.locator('.sn-sidebar-log', { hasText: "non ho aperto l'indirizzo" });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (apertoVerso(app, RACCOLTA)) return 'aperto';
    if (await riga.count()) return 'fermato';
    await new Promise((r) => setTimeout(r, 200));
  }
  return 'niente';
}
