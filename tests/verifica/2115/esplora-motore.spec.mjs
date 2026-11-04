// Esplorazione del giro 1 di #2115: il motore che gira è davvero quello chiesto.
import { test, expect } from '../../fixtures/electron.mjs';

test('il motore avviato porta Node 24.22.2 e Chromium 152.0.7977.169', async ({ app }) => {
  const v = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }));
  expect(v).toEqual({ electron: '44.10.2', node: '24.22.2', chrome: '152.0.7977.169' });
});
