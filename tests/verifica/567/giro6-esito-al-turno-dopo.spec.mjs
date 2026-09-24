// #567, sesto giro — cosa Filo si porta al turno dopo di un'azione che ha
// finito l'UTENTE col bottone. La riga del diario adesso distingue il riordino
// riuscito da quello a vuoto (quinto giro); qui si guarda se la distinzione
// arriva anche al modello, che è chi risponde alla domanda dopo.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, restore, chiedi } from './aiuto.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

// Un modello finto che tiene da parte i turni dell'assistente con cui riparte.
async function provideRegistrando(app, slot, risposte) {
  await app.evaluate(async (_e, { s, r }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis[`${s}_restore`] = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis[`${s}_visto`] = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis[`${s}_visto`].push(JSON.stringify(
        (messages || []).filter((m) => m.role === 'assistant').map((m) => String(m.content || '')),
      ));
      const giro = r[Math.min(n, r.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { s: slot, r: risposte });
}

test('un riordino che non aveva niente da archiviare non deve diventare «schede archiviate» al turno dopo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    // Il riordino gira davvero e non trova niente da chiudere: è l'esito che il
    // diario adesso chiama «Nessuna scheda da archiviare».
    win._filoTabs.runAutoTriage = async () => ({ archived: 0 });
  });

  await provideRegistrando(app, '__v567g6c', [
    { toolCalls: [{ id: 'c1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede aperte.' },
    { text: 'Rispondo.' },
  ]);

  await chiedi(page, 'riordina le schede e archivia quelle che non servono');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Valuto le schede aperte.' })).toBeVisible({ timeout: 15_000 });
  const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia' });
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(page.locator('.dash-action-btn', { hasText: 'Nessuna scheda da archiviare' })).toBeVisible({ timeout: 15_000 });

  await app.evaluate(() => { globalThis.__v567g6c_visto = []; });
  await chiedi(page, 'quante ne hai archiviate?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rispondo.' })).toBeVisible({ timeout: 15_000 });

  const visto = await app.evaluate(() => (globalThis.__v567g6c_visto || []).join('\n'));
  // Al modello arriva una frase fissa sull'esito del click. Se dice «archiviate»
  // di un riordino che non ha chiuso niente, alla domanda dopo Filo risponde
  // che le schede sono in «Tab archiviate», e lì non c'è niente.
  expect(visto, `quello che il modello si ritrova: ${visto}`)
    .not.toMatch(/Schede valutate e archiviate/i);

  await app.evaluate(() => { try { globalThis.__v567g6c_restore?.(); } catch (_) {} });
});
