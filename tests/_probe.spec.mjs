import { test, expect } from './fixtures/electron.mjs';

test('probe: real apps-menu path + heavy editor use', async ({ app, shell }) => {
  const errors = [];
  shell.on('pageerror', (e) => errors.push('[shell pageerror] ' + e.message));
  shell.on('console', (m) => { if (m.type() === 'error') errors.push('[shell console] ' + m.text()); });

  // dashboard è già aperta al boot (newtab). Apri l'editor dal menu app.
  await shell.click('#nav-apps');
  await shell.click('#apps-menu .apps-item');

  // trova la page dell'editor
  const deadline = Date.now() + 8000;
  let ed = null;
  while (Date.now() < deadline) {
    ed = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'editor'; } catch { return false; } });
    if (ed) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ed) { console.log('NO EDITOR WINDOW. errors=', errors); throw new Error('no editor'); }
  ed.on('pageerror', (e) => errors.push('[ed pageerror] ' + e.message));
  ed.on('console', (m) => { if (m.type() === 'error') errors.push('[ed console] ' + m.text()); });
  await ed.waitForSelector('#doc');

  // USA l'editor: scrivi, formatta, markdown, cambia pagina, cerca/sostituisci
  await ed.click('#doc');
  await ed.keyboard.type('Titolo del mio testo');
  await ed.keyboard.press('Enter');
  await ed.keyboard.type('# ');
  await ed.keyboard.type('Sezione uno');
  await ed.keyboard.press('Enter');
  await ed.keyboard.type('Un paragrafo con parole varie da contare bene.');
  await ed.keyboard.down('Control'); await ed.keyboard.press('a'); await ed.keyboard.up('Control');
  await ed.keyboard.down('Control'); await ed.keyboard.press('b'); await ed.keyboard.up('Control');
  await ed.waitForTimeout(300);

  // cambia pagina (switch) → page revisione, usa search-replace
  await ed.locator('.ed-switch-icon').nth(1).click();
  await ed.waitForTimeout(200);
  const sr = ed.locator('.ed-module[data-type="search-replace"] [data-sr="find"]');
  if (await sr.count()) { await sr.fill('parole'); await ed.waitForTimeout(200); }

  await ed.waitForTimeout(300);
  await ed.screenshot({ path: 'tests/.smoke/_probe-editor.png' }).catch((e) => console.log('shot fail', e.message));
  const docHtml = await ed.evaluate(() => document.getElementById('doc').innerHTML);
  console.log('DOC HTML:', docHtml);
  console.log('ALL ERRORS:', JSON.stringify(errors, null, 2));
});
