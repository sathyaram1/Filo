import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

test('probe PROD: open editor from dashboard, capture everything', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'filo-prod-'));
  const env = { ...process.env, FILO_USER_DATA: userData };
  delete env.NODE_ENV; // produzione-like
  delete env.FILO_SMOKE;

  const app = await electron.launch({ args: ['.'], cwd: APP_ROOT, env });
  const mainLogs = [];
  app.process().stdout?.on('data', (d) => mainLogs.push(d.toString()));
  app.process().stderr?.on('data', (d) => mainLogs.push('[ERR] ' + d.toString()));

  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  await shell.waitForTimeout(800);

  await shell.click('#nav-apps');
  await shell.click('#apps-menu .apps-item');

  const deadline = Date.now() + 8000;
  let ed = null;
  while (Date.now() < deadline) {
    ed = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'editor'; } catch { return false; } });
    if (ed) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(ed, 'editor window').toBeTruthy();
  const errors = [];
  ed.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  ed.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  await ed.waitForSelector('#doc', { timeout: 5000 });
  await ed.waitForTimeout(600);
  await ed.click('#doc');
  await ed.keyboard.type('prova produzione');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: 'tests/.smoke/_prod-editor.png' }).catch(() => {});

  console.log('PROD ERRORS:', JSON.stringify(errors));
  console.log('MAIN LOG TAIL:', mainLogs.join('').split('\n').filter(l => /error|fail|uncaught|exception/i.test(l)).join('\n'));

  await app.close();
  rmSync(userData, { recursive: true, force: true });
});
