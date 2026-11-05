// Esplorazione #2119 giro 1: chiusura a metà, domanda di seguito, testo con HTML ed emoji.
import { test, expect } from '../../fixtures/electron.mjs';

async function provider(app, testi) {
  await app.evaluate(async (_e, testi) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__n = 0;
    globalThis.__orig = globalThis.__orig || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__orig,
      streamComplete: async ({ onDelta }) => {
        const t = testi[Math.min(globalThis.__n++, testi.length - 1)];
        for (let i = 0; i < t.length; i += 3) {
          onDelta(t.slice(i, i + 3));
          if (i % 90 === 0) await new Promise((r) => setTimeout(r, 5));
        }
        return { text: t, usage: {} };
      },
    };
  }, testi);
}

const apri = (page) => page.evaluate(() => {
  window.__errori = [];
  window.addEventListener('error', (e) => window.__errori.push(String(e.message)));
  window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
    anchor: { x: 120, y: 200 },
    title: 'Approfondisci',
  });
});

test('seguito e testo con HTML ed emoji finiscono identici', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming, null, { timeout: 8000 });
  const a = 'Prima risposta **forte** <img src=x onerror="window.__xss=1"> 😀👨‍👩‍👧 ' + 'parola '.repeat(400) + '\n\n```\ncodice <b>\n```\n';
  const b = '## Seconda\n\n' + '- voce 🍕 <script>window.__xss=2</script>\n'.repeat(120) + '\nfine.';
  await provider(app, [a, b]);
  await apri(page);
  const meta = page.locator('.sn-popup .sn-popup-meta');
  await expect(meta).toContainText('€', { timeout: 20_000 });
  const input = page.locator('.sn-popup .sn-popup-input');
  await input.fill('e poi?');
  await input.press('Enter');
  const bolle = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text');
  await expect(bolle).toHaveCount(2);
  await expect(bolle.nth(1)).toContainText('fine.', { timeout: 20_000 });
  await expect(page.locator('.sn-popup .sn-msg-assistant .sn-msg-copia')).toHaveCount(2, { timeout: 10_000 });
  const r = await page.evaluate(({ a, b }) => {
    const el = [...document.querySelectorAll('.sn-popup .sn-msg-assistant .sn-msg-text')];
    const P = window.SN_POPUP;
    return {
      uno: el[0].innerHTML === P.renderMarkdown(P.resolveCalcMarkers(a)),
      due: el[1].innerHTML === P.renderMarkdown(P.resolveCalcMarkers(b)),
      xss: window.__xss, errori: window.__errori,
    };
  }, { a, b });
  expect(r).toEqual({ uno: true, due: true, xss: undefined, errori: [] });
  await page.screenshot({ path: 'tests/.shots/2119-seguito.png' });
});

test('chiudere il riquadro a metà risposta non lascia errori e non lo riapre', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming, null, { timeout: 8000 });
  await provider(app, ['parola '.repeat(3000)]);
  await apri(page);
  await expect(page.locator('.sn-popup .sn-msg-assistant .sn-msg-text')).toContainText('parola', { timeout: 20_000 });
  await page.keyboard.press('Escape');
  await page.locator('.sn-popup .sn-popup-close').click({ timeout: 2000 }).catch(() => {});
  await expect(page.locator('.sn-popup')).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(800);
  await expect(page.locator('.sn-popup')).toHaveCount(0);
  expect(await page.evaluate(() => window.__errori)).toEqual([]);
});
