// VERIFICA #427 — lo zoom "resta com'e"? (temporaneo)
import { test, expect } from './fixtures/electron.mjs';

const z = (page) => page.evaluate(() => window.devicePixelRatio);

test('lo zoom sopravvive a chiusura e riapertura della stessa pagina?', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForTimeout(900);
  await page.mouse.click(400, 300).catch(() => {});
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Equal'); await page.waitForTimeout(150); }
  await page.waitForTimeout(400);
  console.log('[427] zoom impostato:', await z(page));

  // chiudo la scheda
  await shell.evaluate(() => {
    const t = window.filoShell?.tabs;
    const list = t?.list?.() || [];
    const target = list.find((x) => String(x.url || '').includes('manage'));
    if (target && t.close) t.close(target.id);
  }).catch((e) => console.log('[427] chiusura via API fallita:', String(e).slice(0, 80)));
  await shell.waitForTimeout(700);

  // riapro la stessa pagina
  const again = await openTab('filo://manage/manage.html');
  await again.waitForTimeout(1200);
  const after = await z(again);
  console.log('[427] zoom alla riapertura:', after, after > 1 ? '(RICORDATO)' : '(tornato al 100%)');

  // navigare altrove e tornare, nella stessa scheda
  const p2 = await openTab('filo://history/history.html');
  await p2.waitForTimeout(800);
  await p2.mouse.click(400, 300).catch(() => {});
  for (let i = 0; i < 3; i++) { await p2.keyboard.press('Control+Equal'); await p2.waitForTimeout(150); }
  await p2.waitForTimeout(300);
  const hBefore = await z(p2);
  await p2.evaluate(() => { location.reload(); });
  await p2.waitForTimeout(1500);
  const hAfter = await z(p2);
  console.log('[427] history: prima del reload', hBefore, '-> dopo', hAfter, hAfter >= hBefore ? '(mantenuto)' : '(perso)');
});
