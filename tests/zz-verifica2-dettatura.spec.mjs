// VERIFICA INDIPENDENTE (2° giro) — da cancellare a fine verifica.
// Dettatura dal vivo: microfono finto di Chromium alimentato da una voce vera.
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = (readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8')
  .match(/OPENROUTER_KEY=(\S+)/) || [])[1];
const WAV = 'C:/Users/AGENTI~1/AppData/Local/Temp/claude/C--Users-agenti-AI-Desktop-Filo-Filo/868afa78-eb42-4303-8142-6ea39d549556/scratchpad/voce48.wav';

test('dettatura dal vivo: quel che dico finisce nel campo', async () => {
  test.setTimeout(300000);
  const userData = mkdtempSync(join(tmpdir(), 'filo-zz2-'));
  const app = await electron.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html lang="it"><body style="font:16px sans-serif;padding:40px"><h1>Prova</h1><textarea id="campo" rows="5" cols="60"></textarea></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    const openTab = async (url) => {
      const target = new URL(url).hostname;
      await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === target; } catch (_) { return false; } });
        if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('nessuna window per ' + url);
    };

    const opt = await openTab('filo://options/options.html');
    await opt.waitForTimeout(3000);
    const chk = opt.locator('#useDefaultModels');
    if (await chk.isChecked()) await chk.click();
    await opt.waitForTimeout(500);
    await opt.locator('#apiKey').fill(KEY);
    await opt.locator('#apiKey').blur();
    await opt.waitForTimeout(3000);

    const page = await openTab(`http://127.0.0.1:${port}/x`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 15000 });

    await page.locator('#campo').click();
    await page.locator('#campo').type('nota: ');
    await page.locator('#campo').click({ button: 'right' });
    await page.waitForTimeout(1500);
    await page.locator('text=Detta').first().click();

    const pill = page.locator('.sn-dictate-pill');
    await expect(pill, 'compare il riquadro "ti ascolto"').toBeVisible({ timeout: 15000 });
    let live = '';
    for (let i = 0; i < 60; i++) {
      const t = await page.evaluate(() => {
        const el = document.querySelector('.sn-dictate-pill-live');
        return el && !el.hidden ? el.textContent : '';
      });
      if (t && t.length > live.length) live = t;
      await page.waitForTimeout(300);
    }
    console.log('PROVVISORIO IN DIRETTA:', JSON.stringify(live));

    await pill.click();
    await page.waitForTimeout(25000);
    const val = await page.locator('#campo').inputValue();
    console.log('CAMPO DOPO LA DETTATURA:', JSON.stringify(val));
    expect(val.toLowerCase()).toContain('gatto');
    expect(val.startsWith('nota: ')).toBe(true);
    expect(live).not.toBe('');
  } finally {
    try { await app.close(); } catch (_) {}
    await new Promise((r) => server.close(r));
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
