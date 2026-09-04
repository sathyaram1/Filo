import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('sonda: una scorciatoia di modulo su Ctrl+S viene accettata e non parte mai', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();

  // La regola dice che Ctrl+S è libero?
  const libero = await page.evaluate(() => ({
    win: window.SN_TASTI.riservato('Ctrl+S', 'win32'),
    mac: window.SN_TASTI.riservato('Cmd+S', 'darwin'),
    winBack: window.SN_TASTI.riservato('Ctrl+\\', 'win32'),
    macBack: window.SN_TASTI.riservato('Cmd+\\', 'darwin'),
  }));
  console.log('RISERVATO S e backslash:', JSON.stringify(libero));
});

test('sonda visiva: elenco scorciatoie nelle Opzioni', async ({ app, openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForLoadState('domcontentloaded');
  // la sezione "Altro" contiene l'elenco scorciatoie
  const testo = await page.evaluate(() => {
    const el = document.getElementById('shortcutsList');
    return el ? el.innerText : '(nessun elenco in questa pagina)';
  });
  console.log('ELENCO:', JSON.stringify(testo));
  try { mkdirSync('tests/.shots', { recursive: true }); } catch (_) {}
  await page.screenshot({ path: 'tests/.shots/527-g4-opzioni.png', fullPage: false });
});
