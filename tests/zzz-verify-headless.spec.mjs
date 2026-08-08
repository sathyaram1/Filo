// SPEC DI VERIFICA INDIPENDENTE — creato dalla verifica, da rimuovere.
import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';

test('misura oggettiva dello stato finestra', async ({ app, shell }) => {
  // Lascia il tempo a eventuali show() ritardati di manifestarsi
  await new Promise((r) => setTimeout(r, 2500));
  const info = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const wins = BrowserWindow.getAllWindows();
    let displays = [];
    try { displays = screen.getAllDisplays().map((d) => d.bounds); } catch (_) {}
    return {
      count: wins.length,
      displays,
      wins: wins.map((w) => ({
        id: w.id,
        title: w.getTitle(),
        isVisible: w.isVisible(),
        isMinimized: w.isMinimized(),
        isFocused: w.isFocused(),
        opacity: w.getOpacity(),
        bounds: w.getBounds(),
        showInactive: false,
      })),
      env: {
        FILO_HIDE_WINDOW: process.env.FILO_HIDE_WINDOW || null,
        FILO_TEST_VISIBLE: process.env.FILO_TEST_VISIBLE || null,
      },
    };
  });
  console.log('WINDOW_STATE_JSON=' + JSON.stringify(info));
  writeFileSync(
    process.env.VERIFY_OUT || 'tests/.verify-window-state.json',
    JSON.stringify(info, null, 2),
  );

  // La shell deve comunque funzionare (renderer vivo)
  const t = await shell.evaluate(() => document.title);
  expect(typeof t).toBe('string');
});

test('screenshot dal debugger funziona anche a finestra nascosta', async ({ shell }) => {
  const buf = await shell.screenshot();
  console.log('SHELL_SCREENSHOT_BYTES=' + buf.length);
  expect(buf.length).toBeGreaterThan(1000);
});
