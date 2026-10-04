// Verifica #949 giro 9, rilievo 1: una durata detta a parole o in più pezzi diventa un numero sbagliato.
// «due giorni» archiviava dopo 24 ore, «dodici ore» dopo 1, «1 giorno e 6 ore» dopo 168.

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

test('«archivia dopo due giorni» chiesto a Filo: la pagina Preferenze mostra 48 ore', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#autoArchiveIdleHours')).toHaveValue(/\d/, { timeout: 8_000 });

  await modelloFinto(app, [imposta('ore_inattivita', 'due giorni'), { text: 'Fatto.' }]);
  await scrivi(chat, 'archivia le schede dopo due giorni di inattività');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await impostazioni(app)).autoArchive.idleHours, { timeout: 5_000 }).toBe(48);
  await pref.bringToFront();
  await expect(pref.locator('#autoArchiveIdleHours')).toHaveValue('48', { timeout: 3_000 });
  await ripristina(app);
});

test('le altre durate dette a parole danno le ore giuste, o un rifiuto: mai un numero sbagliato', async ({ app }) => {
  const esiti = await app.evaluate(() => {
    const P = globalThis.SN_PREF;
    const ore = (v) => { const r = P.buildPreferencePartial('ore_inattivita', v); return r && r.partial ? r.partial.autoArchive.idleHours : null; };
    return {
      dodici: ore('dodici ore'), giornoEsei: ore('1 giorno e 6 ore'), dueEmezza: ore('due ore e mezza'),
      giornoEmezzo: ore('un giorno e mezzo'), dueGiorniEdodici: ore('2 giorni e 12 ore'),
    };
  });
  for (const [k, v] of Object.entries({ dodici: 12, giornoEsei: 30, dueEmezza: 3, giornoEmezzo: 36, dueGiorniEdodici: 60 })) {
    expect([v, null], `${k}: ${esiti[k]}`).toContain(esiti[k]);
  }
});
