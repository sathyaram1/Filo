import { test } from '../../fixtures/electron.mjs';

test('sonda appunti', async ({ app }) => {
  const r = await app.evaluate(async ({ clipboard }) => {
    const out = {};
    clipboard.write({ text: 'uno', html: '<b>uno</b>' });
    out.a = clipboard.readText();
    out.af = clipboard.availableFormats ? clipboard.availableFormats() : 'n/a';
    clipboard.writeText('due');
    out.b = clipboard.readText();
    out.proto = Object.getOwnPropertyNames(Object.getPrototypeOf(clipboard) || {}).join(',');
    out.tipo = typeof clipboard.readHTML;
    return out;
  });
  console.log(JSON.stringify(r));
});
