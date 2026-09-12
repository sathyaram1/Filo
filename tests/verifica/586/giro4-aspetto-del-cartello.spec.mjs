// Verifica #586, giro 4 — come si vede il cartello nuovo (fotocamera e
// microfono aperti) nei due temi. Le fotografie restano in tests/.shots/.

import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HTML = `<!doctype html><html><body style="margin:0;font:14px system-ui;padding:20px">
<p>una pagina qualunque</p>
<script>
  window.__sensori = () => navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(() => 'ok', (e) => 'rifiutato:' + ((e && e.name) || 'errore'));
</script></body></html>`;

async function conServer(fn) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}/p`); }
  finally { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); }
}

async function apriScheda(app, shell, url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const p = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; } catch (_) { return false; }
    });
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nessuna scheda per ' + url);
}

for (const tema of ['light', 'dark']) {
  test(`il cartello di fotocamera e microfono — tema ${tema}`, async () => {
    test.setTimeout(180_000);
    await conServer(async (url) => {
      const userData = cartellaTemporanea(`filo-586-g4-${tema}-`);
      writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: tema } }), 'utf8');
      const app = await electron.launch({
        args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
        cwd: APP_ROOT,
        env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
      });
      try {
        const shell = await app.firstWindow();
        await shell.waitForLoadState('domcontentloaded');
        await shell.waitForTimeout(800);
        await app.evaluate(({ nativeTheme }, t) => { nativeTheme.themeSource = t; }, tema);
        await shell.emulateMedia({ colorScheme: tema }).catch(() => {});
        await shell.waitForTimeout(400);
        const page = await apriScheda(app, shell, url);
        await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15_000 });

        page.evaluate(() => window.__sensori()).catch(() => {});
        await expect(shell.locator('.perm-chip')).toHaveCount(1, { timeout: 20_000 });
        await shell.locator('.perm-chip .perm-chip-allow').click();
        await expect(shell.locator('.perm-live')).toHaveCount(1, { timeout: 20_000 });
        await shell.waitForTimeout(500);
        console.log(`[586 g4] cartello ${tema}:`,
          JSON.stringify(await shell.locator('.perm-live').first().textContent()));
        await shell.screenshot({ path: `tests/.shots/586-giro4-cartello-sensori-${tema}.png` });
      } finally {
        try { await app.close(); } catch (_) {}
      }
    });
  });
}
