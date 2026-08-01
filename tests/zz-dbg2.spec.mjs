import { test } from './fixtures/electron.mjs';
test('arg', async ({ app }) => {
  const r = await app.evaluate(async ({ a, b }) => ({ a, b, typeofA: typeof a }), { a: 'mio', b: false });
  console.log('ARG', JSON.stringify(r));
});
