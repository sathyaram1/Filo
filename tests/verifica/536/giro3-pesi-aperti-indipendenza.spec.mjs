// Verifica #536 — giro 3.
//
// LA PORTA: il controllo di indipendenza guarda i NOMI dei modelli, e li guarda
// PRIMA che qualcun altro li riscriva. L'interruttore «solo modelli a pesi
// aperti» (Opzioni) sostituisce ogni modello proprietario col suo equivalente
// aperto, e lo fa DOPO: il guardiano parte con un nome diverso da quello della
// chat, supera il controllo, e arriva al fornitore con esattamente lo stesso
// modello che ha scritto il testo.
//
// È la terza faccia dello stesso danno (il giro 2 aveva trovato quella della
// coda): il secondo giudizio non è più indipendente, e nessuno lo dice — non
// l'utente, che ha solo acceso un interruttore sulla privacy dei pesi, e non
// Filo, che qui non ha nessun messaggio da mostrare. Due contesti sullo stesso
// modello cadono insieme: è la cosa che questa funzione esiste per impedire.
//
// Rosso finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('con «solo pesi aperti» il controllo finisce sullo stesso modello della chat', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      // L'interruttore della politica sui pesi: una scelta che si fa nelle
      // Opzioni e che con la sicurezza non c'entra niente.
      openWeightsOnly: true,
      apiKeys: { openrouter: 'k-test' },
      models: {
        // Due nickname DIVERSI: il controllo di indipendenza è contento.
        [C.ACTIONS.FILO_CHAT]: 'deepseek',
        [C.ACTIONS.GUARD_TEXT]: 'claude',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Portale', url: 'https://esempio.it/', snippet: 'accedi' }],
    });
    globalThis.__modelliGuardiano = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async (opt) => {
      const attempts = opt.attempts;
      const sistema = String(((opt.messages || [])[0] || {}).content || '');
      if (/^Sei il guardiano degli avvisi di Filo/.test(sistema)) {
        globalThis.__modelliGuardiano.push(String(attempts[0].model || ''));
      }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: '{"esito":"passa","motivo":""}',
      };
    };
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"portale"}' }],
        };
      }
      return { ...base, text: 'Ecco cosa ho trovato.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('cerca il portale');
  await page.locator('#sendBtn').click();

  // Quello che deve succedere: il controllo si rifiuta di partire e lo DICE,
  // nominando l'interruttore. A porta aperta invece la risposta arriva come se
  // niente fosse, controllata da sé stessa.
  const ultima = page.locator('.dash-bubble-filo').last();
  await expect(ultima).not.toHaveText('', { timeout: 30_000 });
  await expect(ultima, 'all’utente non viene detto perché il controllo non può partire')
    .toContainText('pesi aperti');

  const usati = await app.evaluate(() => globalThis.__modelliGuardiano.slice());
  const chat = await app.evaluate(() => globalThis.SN_TEST_MODELS.registry.deepseek.model);
  expect(
    usati.filter((m) => m === chat),
    'il controllo è girato sullo stesso modello che ha scritto la risposta',
  ).toEqual([]);
});
