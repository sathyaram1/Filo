// #948 giro 6 — porte ri-provate: invio col clic mentre ascolta in Editor e Aiuto, HTML detto, «Detta» nelle altre chat.
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

async function prepara(app, { tema = 'light', frasi = ['prima frase', 'seconda frase'], lenta = 0 } = {}) {
  await app.evaluate(async (_e, { tema: t, frasi: f, lenta: l }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: t,
      dictation: { autoSend: true },
    });
    let n = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => {
      n += 1;
      const mio = n;
      if (l) await new Promise((r) => setTimeout(r, l));
      return { text: f[Math.min(mio, f.length) - 1], usage: { seconds: 1, costUsd: 0 }, generationId: null };
    };
    globalThis.__richieste = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__richieste.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content));
      try { onDelta && onDelta('Va bene.'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'Va bene.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__richieste.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content));
      return { text: JSON.stringify({ text: 'Va bene.', status: 'done' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, { tema, frasi, lenta });
}

async function microfonoFinto(page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__mic = { gain };
      return dest.stream;
    };
  });
}
const voce = (page, on) => page.evaluate((v) => { window.__mic.gain.gain.value = v ? 0.4 : 0; }, on);

async function home(app) {
  const page = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  return page;
}

test('editor: clic sull\'invio mentre ascolta, la seconda frase resta nella casella', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="chat"]');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  const chat = page.locator('.ed-module[data-type="chat"]');
  const mic = chat.locator('.sn-voce-btn');
  const casella = chat.locator('[data-chat="input"]');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1200);
  await voce(page, false);
  await expect(casella).toHaveValue('prima frase', { timeout: 5_000 });
  await voce(page, true);
  await page.waitForTimeout(1200);
  await chat.locator('.sn-voce-btn + *').click();
  await expect(chat.locator('.ed-chat-msg.user', { hasText: 'prima frase' })).toBeVisible({ timeout: 8_000 });
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 2_000 });
  await voce(page, false);
  await expect(casella).toHaveValue('seconda frase', { timeout: 10_000 });
  await page.waitForTimeout(4000);
  await expect(chat.locator('.ed-chat-msg.user')).toHaveCount(1);
});

test('Aiuto: clic sull\'invio mentre ascolta, la seconda frase resta nella casella', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const aiuto = page.locator('.sn-sidebar');
  const mic = aiuto.locator('.sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1200);
  await voce(page, false);
  await expect(aiuto.locator('textarea')).toHaveValue('prima frase', { timeout: 5_000 });
  await voce(page, true);
  await page.waitForTimeout(1200);
  await aiuto.locator('button[type="submit"]').click();
  await expect(aiuto.locator('.sn-sidebar-msg-user', { hasText: 'prima frase' })).toBeVisible({ timeout: 8_000 });
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 2_000 });
  await voce(page, false);
  await expect(aiuto.locator('textarea')).toHaveValue('seconda frase', { timeout: 10_000 });
  await page.waitForTimeout(4000);
  await expect(aiuto.locator('.sn-sidebar-msg-user')).toHaveCount(1);
});

test('home: un testo detto con dentro HTML resta testo, e parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const html = '<img src=x onerror="window.__preso=1"> <b>grassetto</b> 😀';
  await prepara(app, { frasi: [html] });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await voce(page, false);
  await expect(page.locator('.dash-bubble-user', { hasText: 'grassetto' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__preso || 0)).toBe(0);
  expect(await page.locator('.dash-bubble-user img').count()).toBe(0);
});

test('editor e Aiuto: «Detta» dal tasto destro nella casella accende il microfono di quella chat', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app, { frasi: ['domanda detta'] });
  const page = await home(app);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const aiuto = page.locator('.sn-sidebar');
  await aiuto.locator('textarea').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-split-main', { hasText: 'Detta' }).click();
  await expect(aiuto.locator('.sn-voce-btn')).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await expect(page.locator('.sn-dictate-pill')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await voce(page, false);
  await expect(aiuto.locator('.sn-sidebar-msg-user', { hasText: 'domanda detta' })).toBeVisible({ timeout: 10_000 });

  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  await ed.waitForSelector('.ed-module[data-type="chat"]');
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(ed);
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await chat.locator('[data-chat="input"]').click({ button: 'right' });
  await ed.locator('.sn-menu .sn-menu-split-main', { hasText: 'Detta' }).click();
  await expect(chat.locator('.sn-voce-btn')).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await expect(ed.locator('.sn-dictate-pill')).toHaveCount(0);
});
