import { test } from '../../fixtures/electron.mjs';
test('diag', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const b = Uint8Array.from([0x63, 0x61, 0x66, 0x66, 0xe8, 0x20, 0x80, 0x20, 0x31]);
    const out = {};
    for (const enc of ['iso-8859-1', 'windows-1252', 'latin1', 'utf-8']) {
      try { out[enc] = JSON.stringify(new TextDecoder(enc, { fatal: false }).decode(b)); } catch (e) { out[enc] = 'ERR ' + e.message; }
    }
    return out;
  });
  console.log('DIAG ' + JSON.stringify(r));
});
