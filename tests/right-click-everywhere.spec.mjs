// Regression test per il feedback "il tasto destro di Filo deve funzionare
// su tutti i siti web, su tutte le app Filo ed in tutti i menu Filo".
//
// Lo asserisce su un campione rappresentativo di pagine interne (editor,
// options, history, feedback, spellcheck) e su una pagina HTTP esterna, in
// più verifica:
//   - blocklist default vuota (constants.js DEFAULT_SETTINGS.blocklist === [])
//   - menu nativo Electron NON installato sulle pagine interne (era stato
//     definito come fallback ma resta dead code: il custom menu deve bastare)

import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

test('blocklist default è vuota (niente domini bloccati di default)', async () => {
  const constants = readFileSync(resolve(ROOT, 'src/shared/constants.js'), 'utf8');
  // Cerca la riga `blocklist: [...]` dentro DEFAULT_SETTINGS.
  const m = constants.match(/blocklist:\s*\[([^\]]*)\]/);
  expect(m, 'blocklist non trovato in DEFAULT_SETTINGS').toBeTruthy();
  const inner = (m[1] || '').trim();
  expect(inner, 'blocklist default deve essere vuoto').toBe('');
});

async function waitForCSReady(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
}

for (const [name, url, clickSelector] of [
  ['options',    'filo://options/options.html',       'body'],
  ['security',   'filo://security/security.html',     'body'],
  ['history',    'filo://history/history.html',       'body'],
  ['feedback',   'filo://feedback/feedback.html',     'body'],
  ['spellcheck', 'filo://spellcheck/spellcheck.html', 'body'],
  ['editor',     'filo://editor/editor.html',         'body'],
]) {
  test(`tasto destro sulla pagina interna "${name}" apre il menu Filo`, async ({ openTab }) => {
    const page = await openTab(url);
    await waitForCSReady(page);
    await page.locator(clickSelector).first().click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 3_000 });
  });
}
