import { test, expect } from './fixtures/electron.mjs';

test('probe: capture main-process stderr while opening editor', async ({ app, shell }) => {
  const mainLogs = [];
  try {
    const proc = app.process();
    proc.stderr?.on('data', (d) => mainLogs.push('[main stderr] ' + d.toString()));
    proc.stdout?.on('data', (d) => mainLogs.push('[main stdout] ' + d.toString()));
  } catch (e) { mainLogs.push('no proc: ' + e.message); }

  await shell.click('#nav-apps');
  await shell.click('#apps-menu .apps-item');
  await shell.waitForTimeout(2500);

  console.log('=== MAIN LOGS ===');
  console.log(mainLogs.join(''));
  console.log('=== END ===');
});
