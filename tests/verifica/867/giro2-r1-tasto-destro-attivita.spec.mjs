// Verifica #867, giro 2, rilievo 1: il tasto destro sulla riga del blocco di attività che nomina il cambio offre di annullarlo.

import { test, expect } from '../../fixtures/electron.mjs';


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

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, ex) => {
    const C = globalThis.SN_CONST;
    // L'intervista di benvenuto ha una chat sua: qui serve la chat di tutti i giorni.
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...ex,
    });
  }, extra);
}

// Il modello finto: un giro per elemento di `giri`. `annullaTema: true` cerca nel prompt l'id del
// cambio del tema e lo annulla, come farebbe il modello leggendo i CAMBI RECENTI.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__finto_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__finto_prompt = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const testo = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
      globalThis.__finto_prompt.push(testo);
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      let calls = giro.toolCalls || [];
      if (giro.annullaTema) {
        const m = testo.match(/(c[0-9a-f]{10}): tema: chiaro → scuro/);
        calls = [{ id: 'u1', name: 'ANNULLA_CAMBIO', arguments: JSON.stringify({ id: m ? m[1] : 'nessuno' }) }];
      }
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__finto_restore?.(); } catch (_) {} });

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const registro = (app) => app.evaluate(async () => {
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  const r = await globalThis.chrome.storage.local.get('filo_cambi');
  return r.filo_cambi || [];
});

async function scrivi(page, testo, risposta) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 10_000 });
}


test('tasto destro sulla riga «Impostato · tema: chiaro → scuro»: il menu offre di annullare, e annulla davvero', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  await page.locator('.dash-activity-head').first().click();
  const riga = page.locator('.dash-activity-row', { hasText: 'tema: chiaro → scuro' }).first();
  await expect(riga).toBeVisible();
  await riga.click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const voce = menu.getByText(/annulla|rimetti/i).first();
  await expect(voce).toBeVisible();
  await voce.click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  await ripristina(app);
});
