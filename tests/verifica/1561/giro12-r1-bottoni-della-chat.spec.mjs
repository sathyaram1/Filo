// Verifica #1561 giro 12: i bottoni dentro una risposta della chat (il file da aprire, l'evento da mettere nel
// calendario) lasciano un'azione che non se ne va con la chat che li ha prodotti.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
const accaduti = (app) => app.evaluate(async () => {
  await globalThis.SN_IL_FILO.quandoFermo();
  return globalThis.SN_IL_FILO.accaduti({});
});

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  });
}

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text && onDelta) onDelta(giro.text);
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

test('r1 il file aperto dal bottone di una risposta e l\'evento messo nel calendario dal suo bottone se ne vanno con la chat tolta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  // Niente programmi veri del sistema: il file e il calendario «si aprono» senza aprire niente.
  await app.evaluate(({ shell: s }) => { s.openPath = async () => ''; });
  const cartella = cartellaTemporanea('filo-referto-');
  const file = join(cartella, 'referto-oncologia-rossi.txt');
  writeFileSync(file, 'referto');
  try {
    const page = await homeDi(app);
    await modelloFinto(app, [
      { toolCalls: [
        { id: 'f1', name: 'APRI_FILE', arguments: JSON.stringify({ percorso: file }) },
        { id: 'c1', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ titolo: 'Visita oncologica Rossi', data: '2030-03-04', ora: '10:00' }) },
      ] },
      { text: 'Ecco il referto e la visita.' },
    ]);
    await page.locator('#input').fill('apri il referto e segna la visita');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco il referto' })).toBeVisible({ timeout: 15_000 });

    await page.locator('.dash-file-btn').first().click();
    await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).first().click();
    const nomina = async () => (await accaduti(app)).filter((e) => /referto-oncologia-rossi|Visita oncologica Rossi/.test(JSON.stringify(e)));
    // Il bottone del file e quello del calendario hanno lasciato la loro azione.
    await expect.poll(async () => (await nomina()).filter((e) => !e.chat).map((e) => e.nome).sort(), { timeout: 10_000 })
      .toEqual(['APRI_FILE', 'EVENTO_CALENDARIO']);

    const chatId = await app.evaluate(async () => {
      const cs = await globalThis.SN_IL_FILO.chats();
      return cs.filter((c) => !c.app).map((c) => c.id).pop();
    });
    expect(chatId).toBeTruthy();
    const tolta = await page.evaluate((id) => new Promise((r) => chrome.runtime.sendMessage({ type: 'filo_chat_delete', id }, r)), chatId);
    expect(tolta && tolta.ok).toBe(true);
    await expect.poll(async () => (await nomina()).map((e) => [e.tipo, e.nome, e.chat || null]), {
      timeout: 8_000,
      message: 'tolta la chat, nel filo non resta niente che nomini il file o la visita che lei ha proposto',
    }).toEqual([]);
  } finally {
    try { rmSync(cartella, { recursive: true, force: true }); } catch (_) {}
  }
});
