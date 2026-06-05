import { test } from './fixtures/electron.mjs';

test('screenshot tab bar teardrop', async ({ shell, openTab }) => {
  await openTab('filo://newtab/');
  await openTab('filo://newtab/');
  await shell.waitForTimeout(500);
  // Cattura solo la fascia superiore (tab-row) della shell.
  await shell.screenshot({ path: 'tests/.shots/teardrop.png', clip: { x: 0, y: 0, width: 900, height: 90 } });
});
