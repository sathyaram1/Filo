// Verifica #429, giro 5. r1: con le schede larghe quanto il nome, chiusa una scheda con la X la X della
// successiva non arriva sotto il puntatore e il secondo clic la apre invece di chiuderla (#428).
// r2: con la fila piena la scheda attiva taglia il suo nome per un pixel.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINE = ['filo://manage/manage.html', 'filo://options/options.html', 'filo://history/history.html',
  'filo://feedback/feedback.html', 'filo://downloads/downloads.html'];

async function apri(shell) {
  for (const u of PAGINE) await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  await expect.poll(() => shell.locator('#tabs .tab').count(), { timeout: 10_000 }).toBe(PAGINE.length + 1);
  await shell.waitForTimeout(1500);
}

test('r1 chiudendo di fila con la X schede dai nomi diversi, la X successiva arriva sotto il puntatore', async ({ shell }) => {
  await apri(shell);
  const p = await shell.evaluate(() => {
    const r = document.querySelectorAll('#tabs .tab')[1].querySelector('.close').getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
  });
  await shell.mouse.move(p.x, p.y);
  await shell.waitForTimeout(200);
  await shell.mouse.click(p.x, p.y);
  await expect(shell.locator('#tabs .tab')).toHaveCount(PAGINE.length);
  await shell.waitForTimeout(500);
  const sotto = await shell.evaluate(({ x, y }) => {
    const e = document.elementFromPoint(x, y);
    return { x: Boolean(e && e.closest('.close')), scheda: e && e.closest('.tab') ? e.closest('.tab').querySelector('.title').textContent : null };
  }, p);
  expect(sotto.x, `sotto il puntatore c'è il corpo della scheda «${sotto.scheda}», non la sua X`).toBe(true);
});

test('r2 con la fila piena la scheda attiva non taglia il suo nome per un pixel', async ({ app, shell }) => {
  await apri(shell);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 600)?.setSize(760, 600));
  await shell.waitForTimeout(1500);
  const t = await shell.evaluate(() => { const ti = document.querySelector('#tabs .tab.active .title'); return { nome: ti.textContent, posto: ti.clientWidth, testo: ti.scrollWidth }; });
  const manca = t.testo - t.posto;
  expect(manca > 0 && manca <= 2, `«${t.nome}» ${t.posto}/${t.testo} px: tagliato per ${manca} px`).toBe(false);
});
