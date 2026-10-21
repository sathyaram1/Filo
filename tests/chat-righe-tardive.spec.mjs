// #1295 — una riga che arriva quando la scheda ha già lasciato la sua conversazione (l'esito di un comando lento, il
// resoconto di «/pulisci») si legge una volta sola, sotto il comando che l'ha chiesta e non sotto la conversazione dopo.

import { test, expect } from './fixtures/electron.mjs';

const HOME = 'filo://newtab/';

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, extra) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...extra,
    });
  }, extra);
}

async function modello(app, { titoli = {}, chiede = null, chiamata = null } = {}) {
  await app.evaluate(async (_e, { titoli, chiede, chiamata }) => {
    const testo = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    const rispondi = async ({ attempts, messages, onToolCall, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const tutto = messages.map(testo).join('\n');
      if (tutto.includes('Classifichi le conversazioni')) {
        for (const [ago, titolo] of Object.entries(titoli)) {
          if (tutto.includes(ago)) return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo }) };
        }
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Senza etichetta' }) };
      }
      const ultimo = messages[messages.length - 1];
      const utente = [...messages].reverse().find((m) => m.role === 'user');
      if (chiede && chiamata && ultimo && ultimo.role !== 'tool' && utente && testo(utente).includes(chiede)) {
        const calls = [{ id: 't1', name: chiamata.name, arguments: JSON.stringify(chiamata.args || {}) }];
        for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
        return { ...base, text: '', toolCalls: calls, finishReason: 'tool_calls' };
      }
      const t = ultimo && ultimo.role === 'tool' ? 'Fatto.' : 'Va bene, ci penso.';
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { titoli, chiede, chiamata });
}

const tutte = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list({ nascoste: true }));
const bolle = (page) => page.evaluate(() => [...document.querySelectorAll('.dash-bubble')].map((x) => x.textContent));

async function kantConComandoLento(app, openTab) {
  await configura(app, { terminal: { enabled: true } });
  await modello(app, { titoli: { Kant: 'Kant', carbonara: 'Carbonara' } });
  const dash = await openTab(HOME);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 15_000 });
  await dash.locator('#input').fill('Parlami di Kant');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });
  await dash.locator('#input').fill("/sleep 4; echo ESIT''O-TARDIVO");
  await dash.locator('#input').press('Enter');
  await dash.waitForTimeout(700);
  await dash.locator('#input').fill('/clear');
  await dash.locator('#input').press('Enter');
  return dash;
}

test('tornato alla home durante un comando, il suo esito si legge una volta sola', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const dash = await kantConComandoLento(app, openTab);
  await expect.poll(async () => (await tutte(app)).map((c) => c.messages.map((m) => m.text).join('\n')).join('\n'), { timeout: 40_000 }).toContain('ESITO-TARDIVO');
  await dash.waitForTimeout(1500);
  expect((await bolle(dash)).filter((t) => t.includes('ESITO-TARDIVO')).length).toBe(1);
});

test('l’esito di un comando dato parlando di Kant non si legge sotto la chat sulla carbonara', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const dash = await kantConComandoLento(app, openTab);
  await dash.waitForTimeout(300);
  await dash.locator('#input').fill('Come si fa la carbonara?');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => (await tutte(app)).map((c) => c.messages.map((m) => m.text).join('\n')).join('\n'), { timeout: 40_000 }).toContain('ESITO-TARDIVO');
  await dash.waitForTimeout(1500);
  for (const page of [dash, await openTab(HOME)]) {
    await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    const b = await bolle(page);
    const i = b.findIndex((t) => t.includes('Come si fa la carbonara?'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(b.slice(i).join('\n'), 'sotto la carbonara non c’è l’esito di Kant').not.toContain('ESITO-TARDIVO');
  }
});

test('il resoconto di «/pulisci» non si legge sotto la chat cominciata subito dopo', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await configura(app, { autonomia: { livello: 'conservativo' } });
  await modello(app, { titoli: { Epicuro: 'Epicuro', carbonara: 'Carbonara' } });
  const dash = await openTab(HOME);
  await expect(dash.locator('#input')).toBeVisible({ timeout: 15_000 });
  await dash.evaluate(() => {
    window.SN_CONFIRM_UI = { confirm: async () => true };
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === 'run_tab_triage') {
        setTimeout(() => { if (typeof cb === 'function') cb({ ok: true, archived: 2 }); }, 4000);
        return undefined;
      }
      return vero(msg, cb);
    };
  });
  await dash.locator('#input').fill('Parlami di Epicuro');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });
  await dash.locator('#input').fill('/pulisci');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => dash.evaluate(() => document.body.innerText), { timeout: 20_000 }).toContain('Riordino in corso');
  await dash.locator('#input').fill('/clear');
  await dash.locator('#input').press('Enter');
  await dash.locator('#input').fill('Come si fa la carbonara?');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => (await tutte(app)).map((c) => c.messages.map((m) => m.text).join('\n')).join('\n'), { timeout: 30_000 }).toContain('Archiviate 2');
  await dash.waitForTimeout(1500);
  for (const page of [dash, await openTab(HOME)]) {
    await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const b = await bolle(page);
    const i = b.findIndex((t) => t.includes('Come si fa la carbonara?'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(b.slice(0, i).join('\n'), 'il resoconto resta sotto Epicuro').toContain('Archiviate 2');
    expect(b.slice(i).join('\n')).not.toContain('Archiviate 2');
  }
});
