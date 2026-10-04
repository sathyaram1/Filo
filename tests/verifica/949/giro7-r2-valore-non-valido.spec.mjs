// Verifica #949 giro 7, rilievo 2: un valore che Filo non sa applicare su una voce con conferma apre un popup vuoto
// («Modificare una preferenza») e dopo l'OK non cambia niente. Il successo: nessun OK chiesto per niente.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState } from '../../helpers/confirm.mjs';

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
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  });
}

// Il modello finto: un giro per elemento. `rispondiDa: '<nome voce>'` risponde con la riga di quella voce
// presa dall'esito di LEGGI_IMPOSTAZIONI, come farebbe un modello che legge il valore vero.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__imp_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__imp_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__imp_tool.push(String(ultimo.content || ''));
      let text = giro.text || '';
      if (giro.rispondiDa) {
        const riga = String((ultimo && ultimo.content) || '').split('\n').find((r) => r.startsWith(`- ${giro.rispondiDa}:`));
        text = riga ? `Adesso ${riga.slice(2).replace(/ \[.*$/, '')}.` : 'Non lo so.';
      }
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__imp_restore?.(); } catch (_) {} });
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const imposta = (chiave, valore, id = 'i1') => ({
  toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }],
});

async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('«spegni l\'anti-fingerprinting» con un valore sì/no: spento davvero, o nessun OK chiesto a vuoto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [imposta('fingerprint', false), { text: 'Ecco.' }]);
  await scrivi(chat, 'spegni l\'anti-fingerprinting');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ecco.' })).toBeVisible({ timeout: 10_000 });
  await chat.waitForTimeout(800);
  const st = await confirmState(chat);
  if (st) {
    expect(st.text, 'il popup non dice cosa cambia').not.toBe('Modificare una preferenza');
    await clickConfirm(chat, 'ok');
    await expect.poll(async () => (await impostazioni(app)).security.fingerprint.mode, { timeout: 5_000 }).toBe('off');
  }
  await ripristina(app);
});
