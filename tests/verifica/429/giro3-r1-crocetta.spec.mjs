// Verifica #429, giro 3, rilievo 1: ogni scheda in secondo piano tiene il posto di una X che non mostra,
// e quel posto lo toglie al nome; la X che compare al passaggio del mouse non deve riprenderselo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINE = ['filo://manage/manage.html', 'filo://options/options.html', 'filo://history/history.html',
  'filo://feedback/feedback.html', 'filo://board/board.html', 'filo://downloads/downloads.html', 'filo://archive/archive.html'];

async function apri(shell, quante) {
  for (const u of PAGINE.slice(0, quante)) await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  await expect.poll(() => shell.locator('#tabs .tab').count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(quante + 1);
  await shell.waitForTimeout(1500);
}

const schede = (shell) => shell.evaluate(() => [...document.querySelectorAll('#tabs .tab:not(.active)')].map((t) => {
  const ti = t.querySelector('.title');
  const r = t.getBoundingClientRect(); const q = ti.getBoundingClientRect();
  return { nome: ti.textContent, posto: ti.clientWidth, testo: ti.scrollWidth, vuoto: Math.round(r.right - q.right) };
}));

// Con le larghezze a misura del nome sette pagine di Filo ci stanno intere: per avere nomi tagliati ne servono di più.
test('r1 con tredici schede su 1280 px il nome tagliato arriva fino al bordo della scheda', async ({ shell }) => {
  await shell.evaluate(async () => { for (let i = 0; i < 6; i++) await window.filoShell.tabs.open('filo://newtab/'); });
  await apri(shell, 7);
  const tagliate = (await schede(shell)).filter((s) => s.testo > s.posto + 0.5);
  expect(tagliate.length, 'con sette schede qualche nome è tagliato').toBeGreaterThan(0);
  for (const s of tagliate) expect(s.vuoto, `«${s.nome}»: spazio vuoto dopo il nome tagliato`).toBeLessThanOrEqual(14);
});

test('r1 nella finestra più stretta, con otto schede, ogni scheda mostra almeno l\'inizio del nome', async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 600)?.setSize(720, 600));
  await apri(shell, 7);
  for (const s of await schede(shell)) expect(s.posto, `«${s.nome}» senza nemmeno una lettera`).toBeGreaterThan(8);
});

test('r1 il mouse su una scheda stretta non le toglie il nome', async ({ shell }) => {
  await apri(shell, 7);
  const prima = (await schede(shell))[2];
  await shell.hover('#tabs .tab:nth-child(3) .favicon');
  await shell.waitForTimeout(300);
  const dopo = (await schede(shell))[2];
  expect(dopo.posto).toBeGreaterThanOrEqual(prima.posto);
});
