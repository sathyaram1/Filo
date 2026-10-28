// Verifica di #1619, giro 1, rilievo 1: chi ha scelto i modelli a mano chiede «rimetti tutte le impostazioni di serie»
// e il riquadro dell'OK deve far leggere i cambi che contano, senza righe «modello per …: … → nessuno» né righe doppie.
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmState } from '../../helpers/confirm.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito') && !u.includes('accoglienza'));
async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    globalThis.__pp_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__pp_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}
const premi = (pulsante, text = '', extra = {}, id = 'p1') => ({ text, toolCalls: [{ id, name: 'PULSANTE_PREFERENZE', arguments: JSON.stringify({ pulsante, ...extra }) }] });
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('r1 il riquadro del ripristino con i modelli scelti a mano non dice «nessuno» e non ripete righe', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await modelloFinto(app, [premi('ripristina_tutto', 'Ti chiedo conferma.'), { text: 'Ti chiedo conferma.' }]);
  await scrivi(chat, 'rimetti tutte le impostazioni di serie');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 8_000 }).toContain('tema: scuro');
  const testo = (await confirmState(chat)).text;
  await chat.screenshot({ path: 'tests/.shots/v1619-r1-conferma.png' });
  // Dopo il ripristino i modelli tornano quelli di Filo: «nessuno» è falso.
  expect(testo).not.toMatch(/modello per «[^»]+»:[^\n]*→ nessuno/);
  const righe = testo.split('\n').map((r) => r.trim()).filter(Boolean);
  expect(righe.filter((r, i) => righe.indexOf(r) !== i), 'righe doppie').toEqual([]);
});
