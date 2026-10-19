// Verifica #835 giro 2, rilievo 1 — «blocca example.org» col blocco dei siti spento, sulla strada del riquadro di
// conferma (Conservativo): l'utente deve sapere, prima o dopo l'OK, che il blocco è spento e il sito si apre lo stesso.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState } from '../../helpers/confirm.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

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
async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry, theme: 'light',
    });
  });
}
// Il modello finto risponde come risponderebbe un modello che non sa niente dell'interruttore spento.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__imp_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      const spento = /blocco dei siti in blacklist è spento/.test(String((ultimo && ultimo.content) || ''));
      const text = spento ? 'Attenzione: il blocco dei siti è spento.' : (giro.text || '');
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}
const sicurezza = async (app) => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).security;

test('r1 a Conservativo, col blocco dei siti spento, «blocca example.org» dice all\'utente che il blocco è spento', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await livelloAutonomia(app, 'conservativo');
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ security: { siteBlock: { enabled: false, blacklist: [] } } }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'siti_bloccati', valore: 'aggiungi example.org' }) }] },
    { text: 'Ti chiedo un OK.' },
  ]);
  await chat.bringToFront();
  await chat.locator('#input').fill('blocca example.org');
  await chat.locator('#sendBtn').click();
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('example.org');
  const popup = (await confirmState(chat)).text;
  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await sicurezza(app)).siteBlock.blacklist, { timeout: 5_000 }).toEqual(['example.org']);
  await chat.waitForTimeout(2000);
  const visto = `${popup}\n${(await chat.locator('.dash-bubble-filo').allInnerTexts()).join('\n')}`;
  expect(visto, 'né il riquadro né la chat dicono che il blocco dei siti è spento').toMatch(/spent/i);
  await app.evaluate(() => globalThis.__imp_restore?.());
});
