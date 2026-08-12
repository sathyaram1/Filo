// VERIFICA #427 — debug mirato dei due casi dubbi. (temporaneo)
import { test, expect } from './fixtures/electron.mjs';

const z = (page) => page.evaluate(() => window.devicePixelRatio);

test('DEBUG editor', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForTimeout(1200);

  const probe = () => page.evaluate(() => {
    const d = document.querySelector('#doc');
    return {
      ownZoom: document.documentElement.dataset.filoOwnZoom || null,
      styleZoom: d ? (d.style.zoom || '(vuoto)') : '(no #doc)',
      rectW: d ? d.getBoundingClientRect().width : null,
      offsetW: d ? d.offsetWidth : null,
      active: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
      dpr: window.devicePixelRatio,
    };
  });

  console.log('[dbg] editor iniziale:', JSON.stringify(await probe()));

  // Focus esplicito dentro il documento, come farebbe l'utente che scrive
  await page.evaluate(() => { const d = document.querySelector('#doc'); d && d.focus(); });
  await page.waitForTimeout(300);
  console.log('[dbg] dopo focus #doc:', JSON.stringify(await probe()));

  for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Equal'); await page.waitForTimeout(200); }
  await page.waitForTimeout(400);
  console.log('[dbg] dopo 3x Ctrl+ :', JSON.stringify(await probe()));

  // e col click reale invece del focus programmatico
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(300);
  await page.mouse.click(300, 300);
  await page.waitForTimeout(300);
  console.log('[dbg] dopo click(300,300):', JSON.stringify(await probe()));
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Equal'); await page.waitForTimeout(200); }
  await page.waitForTimeout(400);
  console.log('[dbg] dopo click + 3x Ctrl+ :', JSON.stringify(await probe()));

  // ctrl+rotella in editor
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(300);
  await page.keyboard.down('Control');
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(120); }
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  console.log('[dbg] dopo ctrl+wheel :', JSON.stringify(await probe()));
});

test('DEBUG fuoco shell / barra schede', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForTimeout(900);

  const activeUrl = () => app.evaluate(async ({ BrowserWindow }) => {
    // quale tab e attivo secondo la shell
    return globalThis.__filoTabsDebug || null;
  });

  console.log('[dbg] manage dpr iniziale:', await z(page));

  // Caso A: premo Ctrl+ direttamente sulla shell senza cliccare nulla
  await shell.evaluate(() => window.focus());
  await shell.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await shell.keyboard.press('Control+Equal'); await shell.waitForTimeout(180); }
  await shell.waitForTimeout(500);
  console.log('[dbg] A) Ctrl+ sulla shell -> manage dpr:', await z(page));

  // Cosa c'e nella barra schede?
  const tabsInfo = await shell.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[class*="tab"]')).slice(0, 12);
    return els.map((e) => ({ cls: e.className, txt: (e.textContent || '').trim().slice(0, 24) }));
  });
  console.log('[dbg] elementi barra:', JSON.stringify(tabsInfo));

  // quante tab aperte
  const urls = app.windows().map((w) => w.url());
  console.log('[dbg] windows:', JSON.stringify(urls));
});
