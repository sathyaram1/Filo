// TEMPORANEO — audit prober: box "Modifica" sulla selezione in una casella di testo.
import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif">
<h1>Prova</h1>
<textarea id="t" rows="6" cols="60">Questo e un testo con qualche errore che vorrei sistemare.</textarea>
</body>`;

test('edit box: apertura e stato di errore', async ({ openTab, testServer, shell }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGE);

  await page.click('#t');
  await page.evaluate(() => {
    const t = document.getElementById('t');
    t.focus();
    t.setSelectionRange(0, t.value.length);
  });
  // tasto destro dentro la textarea
  await page.click('#t', { button: 'right' });
  await page.waitForTimeout(700);

  const menu = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.sn-menu-item, [class*="sn-menu"] .sn-item, .sn-menu .sn-row')]
      .map((e) => e.textContent.trim()).filter(Boolean);
    return { count: items.length, items: items.slice(0, 30), html: document.querySelector('.sn-menu, [class*=sn-menu]') ? 'menu-presente' : 'nessun menu' };
  });
  console.log('MENU:', JSON.stringify(menu, null, 1));

  // Clicca la voce "Modifica"
  const clicked = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /modifica/i.test(e.textContent || ''));
    if (!all.length) return false;
    all[all.length - 1].click();
    return true;
  });
  console.log('clic Modifica:', clicked);
  await page.waitForTimeout(800);
  const boxOpen = await page.evaluate(() => !!document.querySelector('.sn-editbox'));
  console.log('editbox aperto:', boxOpen);
  if (!boxOpen) return;

  await page.screenshot({ path: 'tests/.shots/zprobe-editbox-open.png' });

  // Clicca una scorciatoia (es. "correggi") e osserva il risultato
  await page.evaluate(() => document.querySelector('.sn-editbox-shortcuts button[data-sc="fix"]').click());
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => ({
    proposed: document.querySelector('.sn-editbox-proposed')?.textContent?.slice(0, 300),
    instr: document.querySelector('.sn-editbox-instruction')?.value,
    copyDisabled: document.querySelector('.sn-editbox-copy')?.disabled,
    replaceDisabled: document.querySelector('.sn-editbox-replace')?.disabled,
  }));
  console.log('STATO DOPO ERRORE:', JSON.stringify(state, null, 1));
  await page.screenshot({ path: 'tests/.shots/zprobe-editbox-error.png' });
});
