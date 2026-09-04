// VERIFICA INDIPENDENTE — sonda: il microfono finto arriva davvero?
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WAV = 'C:/Users/AGENTI~1/AppData/Local/Temp/claude/C--Users-agenti-AI-Desktop-Filo-Filo/868afa78-eb42-4303-8142-6ea39d549556/scratchpad/voce48.wav';

test('sonda microfono finto', async () => {
  test.setTimeout(120000);
  const userData = mkdtempSync(join(tmpdir(), 'filo-zz-'));
  const app = await electron.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${WAV}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html lang="it"><body><textarea id="campo"></textarea></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://127.0.0.1:${port}/x`);
    let page = null;
    const dl = Date.now() + 15000;
    while (Date.now() < dl && !page) {
      page = app.windows().find((w) => { try { return new URL(w.url()).hostname === '127.0.0.1'; } catch (_) { return false; } });
      if (!page) await new Promise((r) => setTimeout(r, 150));
    }
    await page.waitForLoadState('domcontentloaded');
    const rms = await page.evaluate(async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(s);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      let peak = 0; let frames = 0;
      proc.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        frames++;
        for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
      };
      src.connect(proc); proc.connect(ctx.destination);
      await new Promise((r) => setTimeout(r, 6000));
      return { peak, frames, rate: ctx.sampleRate };
    });
    console.log('MICROFONO:', JSON.stringify(rms));
    expect(rms.peak, 'il microfono finto porta suono').toBeGreaterThan(0.01);
  } finally {
    try { await app.close(); } catch (_) {}
    await new Promise((r) => server.close(r));
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
