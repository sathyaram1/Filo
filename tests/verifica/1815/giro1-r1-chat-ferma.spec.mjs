// Verifica #1815 giro 1: in chat una trascrizione lunga dice a che punto è e lo Stop della chat la ferma.
import { test, expect } from '../../fixtures/electron.mjs';

function wav(secondi) {
  const sr = 8000;
  const n = Math.round(sr * secondi);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin(i / 3)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
    });
    globalThis.__pezzi = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => {
      globalThis.__pezzi++;
      await new Promise((r) => setTimeout(r, 2000));
      return { text: ' parola ', usage: { seconds: 30, costUsd: 0.0001 }, generationId: null };
    };
    globalThis.SN_TRASCRIVI_MEDIA_MAIN._dip.scarica = (url, opts) => fetch(url, opts);
    globalThis.SN_TRASCRIVI_MEDIA_MAIN._ricordate.clear();
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const ultima = messages.map((m) => m.role).lastIndexOf('user');
      const esiti = messages.slice(ultima + 1).filter((m) => m.role === 'tool');
      if (!esiti.length) {
        const url = (/https?:\/\/\S+/.exec(String(messages[ultima]?.content || '')) || [''])[0];
        return { ...base, text: '', toolCalls: [{ id: `t${ultima}`, name: 'web', arguments: JSON.stringify({ azione: 'trascrivi', url }) }], finishReason: 'tool_calls' };
      }
      try { onDelta && onDelta('fatto'); } catch (_) {}
      return { ...base, text: 'fatto', toolCalls: [], finishReason: 'stop' };
    };
  });
}

test('r1 in chat la trascrizione lunga dice a che punto è e lo Stop la ferma', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await prepara(app);
  // 10 minuti: una ventina di pezzi da mezzo minuto, due alla volta da due secondi l'uno → una ventina di secondi di lavoro.
  const src = testServer.asset(wav(600), 'audio/wav');
  const page = await openTab('filo://newtab/');
  await page.locator('#input').fill(`trascrivi ${src}`);
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__pezzi), { timeout: 60_000 }).toBeGreaterThan(2);

  // A metà lavoro la riga d'attesa dice quanti pezzi ha fatto, come «2 di 5» nel riquadro del tasto destro.
  await expect.soft(page.locator('body')).toContainText(/\d+ di 2\d/, { timeout: 5_000 });

  await page.locator('#stopBtn').click();
  const allaFermata = await app.evaluate(() => globalThis.__pezzi);
  await page.waitForTimeout(8_000);
  const dopo = await app.evaluate(() => globalThis.__pezzi);
  // Fermata la chat, al modello non partono altri pezzi (al più quelli già in volo).
  expect(dopo).toBeLessThanOrEqual(allaFermata + 2);
});
