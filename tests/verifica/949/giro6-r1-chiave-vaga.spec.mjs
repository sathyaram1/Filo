// #949 giro 6, rilievo 1 — una chiave detta in modo vago non deve cambiare un'impostazione diversa da quella chiesta.
// «pubblicità» per il blocco della pubblicità oggi spegne subito, senza conferma, il salto delle pubblicità dei video.

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

async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      const text = giro.text || '';
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const imposta = (chiave, valore, id = 'i1') => ({
  toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }],
});
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('chiave «pubblicità» per «spegni il blocco della pubblicità»: il salto delle pubblicità dei video resta acceso', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#sec-adskip')).toBeChecked({ timeout: 8_000 });
  await modelloFinto(app, [imposta('pubblicità', false), { text: 'Fatto.' }]);
  await scrivi(chat, 'spegni il blocco della pubblicità');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  await chat.waitForTimeout(800);
  expect((await impostazioni(app)).security.adSkip.enabled, 'una chiave vaga ha spento un\'altra impostazione, senza conferma').not.toBe(false);
});

test('chiave vaga «voce» con valore false non salva «false» come nome della voce', async ({ app }) => {
  const r = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('voce', false));
  const voce = r && r.partial && r.partial.tts && r.partial.tts.voice;
  expect(voce, 'il nome della voce di lettura diventa «false»').not.toBe('false');
});
