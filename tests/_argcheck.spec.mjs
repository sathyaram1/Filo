import { test } from './fixtures/electron.mjs';
test('arg', async ({ app }) => {
  const got = await app.evaluate((m) => 'seen:' + String(m), 'empty');
  console.log('ARGCHECK:', got);
});
