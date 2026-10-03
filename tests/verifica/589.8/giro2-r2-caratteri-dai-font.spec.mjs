// #589.8 giro 2 — a cronologia aperta dall'utente, il sito ridefinisce il font che il pannello eredita dal suo
// documento e, guardando quali pezzi del font il browser carica, sa quali caratteri ci sono nelle voci.
// Successo per l'utente: il sito non scopre i caratteri della password.

import { test, expect } from '../../fixtures/electron.mjs';
import { testiCronologia } from '../../helpers/cronologiaAppunti.mjs';

const SEGRETO = 'pw-Segreta-589-otto';
const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

const facce = [...ALFABETO].map((c) => {
  const cp = c.codePointAt(0).toString(16);
  return `@font-face{font-family:'Spia';src:url('/spia-${cp}.woff');unicode-range:U+${cp};}`;
}).join('\n');

const PAGINA = `<!doctype html><html><head><style>
${facce}
html { --sn-font: 'Spia', monospace !important; }
.sn-menu, .sn-menu * { font-family: monospace !important; }
</style></head><body style="padding:40px;font-family:monospace">
  <input id="campo" style="width:320px;font-size:16px">
  <script>
  window.caratteriVisti = () => [...document.fonts]
    .filter((f) => f.family.replace(/["']/g, '') === 'Spia' && f.status !== 'unloaded')
    .map((f) => String.fromCodePoint(parseInt(f.unicodeRange.replace(/^U\\+/i, ''), 16)))
    .join('');
  </script>
</body></html>`;

test('a cronologia aperta dall\'utente il sito non scopre i caratteri delle voci ridefinendo il font', async ({ app, shell, openTab, testServer }) => {
  for (const text of ['un testo qualsiasi', SEGRETO]) {
    await shell.evaluate((t) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: t } }), text);
  }
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  expect(await page.evaluate(() => window.caratteriVisti())).toBe('');

  await page.locator('#campo').click({ button: 'right' });
  await page.locator('.sn-menu-paste-arrow').hover();
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
  await page.waitForTimeout(800);

  const visti = await page.evaluate(() => window.caratteriVisti());
  console.log('caratteri visti dal sito:', JSON.stringify(visti));
  // 5, 8, 9 e la S maiuscola stanno solo nella password.
  for (const c of ['5', '8', '9', 'S']) {
    expect(visti, `il sito non deve vedere che la cronologia contiene «${c}»`).not.toContain(c);
  }
});
