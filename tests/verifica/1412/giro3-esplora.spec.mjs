// Verifica #1412 giro 3: la storia già mandata resta identica fino al punto di cache, turno dopo turno, oltre i venti messaggi.
import { test, expect } from '../../fixtures/electron.mjs';

async function primaScheda(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('oltre i venti messaggi il punto della storia cade su un prefisso che il turno dopo ripete identico', async ({ app }) => {
  test.setTimeout(300_000);
  const page = await primaScheda(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giri = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, cache, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = messages.some((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      n += 1;
      const corpo = globalThis.SN_PROVIDER_OPENROUTER.conPuntiDiCache('anthropic/claude-haiku-5.5', messages, cache);
      globalThis.__giri.push({ messaggi: JSON.parse(JSON.stringify(messages)), piano: cache ? JSON.parse(JSON.stringify(cache)) : null, corpo: JSON.parse(JSON.stringify(corpo)) });
      const text = `Risposta ${n}.`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text, toolCalls: [], reasoningDetails: [{ type: 'reasoning.text', text: `pensiero ${n}`, format: 'anthropic-claude-v1', index: 0, signature: `firma${n}` }], finishReason: 'stop' };
    };
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  const TURNI = 16;
  for (let i = 1; i <= TURNI; i++) {
    await page.locator('#input').fill(`domanda numero ${i}`);
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: `Risposta ${i}.` })).toBeVisible({ timeout: 20_000 });
  }
  const giri = await app.evaluate(() => globalThis.__giri);
  expect(giri.length).toBe(TURNI);
  const rapporto = [];
  const rotti = [];
  for (let k = 0; k < giri.length - 1; k++) {
    const a = giri[k];
    const b = giri[k + 1];
    const punti = (a.piano && a.piano.punti) || [];
    const ultimo = a.messaggi.length - 1;
    const storia = punti.find((p) => p.indice > 0 && p.indice < ultimo);
    const coda = a.messaggi.findIndex((m) => m.role === 'user' && String(m.content).startsWith('═══ CONTESTO DI ADESSO'));
    const conRagionamento = a.messaggi.filter((m) => m.reasoning_details).length;
    rapporto.push({ turno: k + 1, n: a.messaggi.length, coda, puntoStoria: storia ? storia.indice : null, punti: punti.map((p) => `${p.indice}${p.durata ? ':' + p.durata : ''}`), conRagionamento });
    if (!storia) continue;
    const h = storia.indice;
    const uguali = JSON.stringify(a.messaggi.slice(0, h + 1)) === JSON.stringify(b.messaggi.slice(0, h + 1));
    if (!uguali) {
      const primo = a.messaggi.findIndex((m, i) => i <= h && JSON.stringify(m) !== JSON.stringify(b.messaggi[i]));
      rotti.push({ turno: k + 1, h, primoDiverso: primo });
    }
  }
  console.log(JSON.stringify(rapporto));
  console.log('ROTTI', JSON.stringify(rotti));
  console.log('CORPO ULTIMO', JSON.stringify(giri[giri.length - 1].corpo.map((m) => ({ role: m.role, cc: Array.isArray(m.content) ? m.content.filter((p) => p.cache_control).map((p) => p.cache_control) : null, rd: !!m.reasoning_details }))));
  expect(rotti).toEqual([]);
  // Il punto della storia deve stare vicino alla fine: il grosso della storia si rilegge.
  const tardi = rapporto.filter((r) => r.turno > 2);
  for (const r of tardi) expect(r.puntoStoria, JSON.stringify(r)).toBeGreaterThanOrEqual(r.coda - 4);
});
