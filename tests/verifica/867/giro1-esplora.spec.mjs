// Verifica #867, giro 1: esplorazione avversariale dei cambi nel filo.

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
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...ex,
    });
    await globalThis.SN_REGISTRO_CAMBI.attesa();
    await globalThis.chrome.storage.local.set({ filo_cambi: [] });
  }, extra);
}

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
      const calls = giro.toolCalls || [];
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

test('esplora — tema scuro in chat: aspetto al buio, annulla riporta davvero il chiaro nella home', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto, ora il tema è scuro.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const bgScuro = await bg();
  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  await bolla.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v867-scuro-hover.png' });
  await bolla.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('light');
  await expect.poll(bg).not.toBe(bgScuro);
  await bolla.hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v867-chiaro-annullato.png' });
  await ripristina(app);
});

test('esplora — aprire le pagine delle impostazioni senza toccare niente non lascia eventi', async ({ app, openTab, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  for (const u of ['filo://preferences/preferences.html', 'filo://options/options.html', 'filo://security/security.html', 'filo://credits/credits.html']) {
    try { await openTab(u); } catch (_) {}
  }
  await new Promise((r) => setTimeout(r, 3000));
  const ev = await registro(app);
  console.log('EVENTI-SPURI', JSON.stringify(ev).slice(0, 2000));
  expect(ev).toEqual([]);
});

test('esplora — una sola voce cambiata da ogni pagina lascia un evento con UN cambio', async ({ app, openTab, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configura(app);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#theme').selectOption('dark');
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await new Promise((r) => setTimeout(r, 4500));
  await pref.locator('#notifSoundEnabled').click();
  await new Promise((r) => setTimeout(r, 4500));
  const slider = pref.locator('#textScale');
  await slider.focus();
  for (let i = 0; i < 4; i++) { await pref.keyboard.press('ArrowRight'); await pref.waitForTimeout(250); }
  await new Promise((r) => setTimeout(r, 1500));
  const ev = await registro(app);
  const righe = await app.evaluate((_e, l) => l.map((e) => `${globalThis.SN_CAMBI.provenienza(e)} | ${globalThis.SN_CAMBI.frase(e, 10)}`), ev);
  console.log('RIGHE', JSON.stringify(righe, null, 1));
  for (const e of ev) expect(e.cambi.length, JSON.stringify(e)).toBe(1);
  expect(ev.length).toBe(3);
});

test('esplora — timer con nome in HTML ed emoji, bolla lunga in cima: la frase resta testo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  const nome = '<img src=x onerror="window.__xss=1"> pasta 🍝';
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'TIMER', arguments: JSON.stringify({ secondi: 600, etichetta: nome }) }] },
    { text: 'Avviato.' },
  ]);
  const lungo = `timer di 10 minuti ${'per la pasta al pomodoro con il basilico '.repeat(12)}`;
  await scrivi(page, lungo, 'Avviato.');
  const bolla = page.locator('.dash-bubble-user').first();
  await bolla.hover();
  await page.waitForTimeout(400);
  const pop = bolla.locator('.dash-cambi-pop');
  await expect(pop).toContainText('pasta 🍝');
  await expect(pop).toContainText('<img');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const box = await pop.boundingBox();
  const vista = page.viewportSize();
  console.log('POP', JSON.stringify(box), JSON.stringify(vista));
  await page.screenshot({ path: 'tests/.shots/v867-timer-lungo.png' });
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vista.width + 1);
  await ripristina(app);
});

test('esplora — due annulla quasi insieme sullo stesso cambio, poi rifai: lo stato e il segno restano d\'accordo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' }] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'tema scuro', 'Fatto.');
  const id = (await registro(app)).find((e) => e.via === 'chat').id;
  const esiti = await app.evaluate(async (_e, i) => Promise.all([
    globalThis.SN_REGISTRO_CAMBI.annulla(i, { via: 'interfaccia' }),
    globalThis.SN_REGISTRO_CAMBI.annulla(i, { via: 'chat' }),
  ]), id);
  console.log('ESITI', JSON.stringify(esiti));
  const lista = await registro(app);
  console.log('LISTA', JSON.stringify(lista.map((e) => ({ id: e.id, annulla: e.annulla, cambi: e.cambi.length }))));
  const bolla = page.locator('.dash-bubble-user', { hasText: 'tema scuro' });
  await bolla.hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('rifai');
  await bolla.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme).toBe('dark');
  await bolla.hover();
  await expect(bolla.locator('.dash-cambi-annulla')).toHaveText('annulla');
  await ripristina(app);
});
