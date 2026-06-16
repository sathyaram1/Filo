import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

const HTML = `<!doctype html><html><body><h1>x</h1></body></html>`;

function makeWavSource(seconds, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const dv = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, 36 + n, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  wr(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) dv.setUint8(44 + i, 128);
  const u8 = new Uint8Array(buf);
  let bin = ''; for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return `data:audio/wav;base64,${Buffer.from(bin, 'binary').toString('base64')}`;
}

test('debug media report 2', async () => {
  test.setTimeout(60000);
  const userData = mkdtempSync(join(tmpdir(), 'filo-dbg2-'));
  const server = createServer((req, res) => { res.writeHead(200,{'Content-Type':'text/html'}); res.end(HTML); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/m`;
  const app = await electron.launch({ args: ['.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await new Promise(r => setTimeout(r, 500));
  const w = app.windows().find(x => x.url().startsWith(url));
  await w.waitForLoadState('domcontentloaded');
  w.on('console', msg => console.log('[PAGE]', msg.text()));
  const wav = makeWavSource(10);
  const res = await w.evaluate(async (wavSrc) => {
    const a = document.createElement('audio');
    a.src = wavSrc;
    a.loop = true;
    document.body.appendChild(a);
    window.__a = a;
    await new Promise(r => { if (a.readyState>=1) return r(); a.addEventListener('loadedmetadata', r, {once:true}); });
    return { dur: a.duration, readyState: a.readyState };
  }, wav);
  console.log('audio meta', res);
  await w.evaluate(() => { window.__a.currentTime = 4; window.__a.pause(); });
  await new Promise(r => setTimeout(r, 2000));
  const stor = await shell.evaluate(() => window.filoShell.message({ type: '_storage:get', keys: ['sn_open_tabs'] }));
  console.log('storage', JSON.stringify(stor));
  await app.close();
  try { rmSync(userData, { recursive: true, force: true }); } catch(_) {}
  server.close();
});
