// VERIFICA INDIPENDENTE (temporanea) — tab Automazioni: #446/#447/#448 dal
// punto di vista di chi guarda la pagina.
import { test, expect } from './fixtures/electron.mjs';

async function openAutomation(openTab) {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForSelector('#mgTabs', { timeout: 15000 });
  await page.click('#mgTabs button[data-tab="automation"]');
  await expect(page.locator('#panel-automation')).toHaveClass(/mg-panel--active/);
  return page;
}

test('#447 — il campo del timeout accetta più di 120 secondi', async ({ openTab }) => {
  const page = await openAutomation(openTab);
  const input = page.locator('#mgJudgeTimeout');
  await expect(input).toHaveCount(1);
  const max = Number(await input.getAttribute('max'));
  expect(max).toBeGreaterThan(120);
  // Il campo deve poter contenere 300 e non essere considerato non valido.
  await page.evaluate(() => {
    const el = document.getElementById('mgJudgeTimeout');
    el.disabled = false;
    el.value = '300';
  });
  const valid = await page.evaluate(() => document.getElementById('mgJudgeTimeout').checkValidity());
  expect(valid).toBe(true);
  const tooBig = await page.evaluate(() => {
    const el = document.getElementById('mgJudgeTimeout');
    el.value = '301';
    return el.checkValidity();
  });
  expect(tooBig).toBe(false);
});

test('#446 — esistono interruttori distinti per mittente, inerti con la master spenta', async ({ openTab }) => {
  const page = await openAutomation(openTab);
  for (const id of ['mgAutoApproveOwner', 'mgAutoApproveFilo', 'mgAutoApproveClaude', 'mgAutoApproveUser']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  // Senza sessione admin e con la master spenta i sottointerruttori sono disabilitati.
  const disabled = await page.evaluate(() =>
    ['mgAutoApproveOwner', 'mgAutoApproveFilo', 'mgAutoApproveClaude', 'mgAutoApproveUser']
      .map((id) => document.getElementById(id).disabled));
  expect(disabled).toEqual([true, true, true, true]);
  const dimmed = await page.evaluate(() =>
    document.getElementById('mgAutoApproveBlock').classList.contains('mg-auto-sub--off'));
  expect(dimmed).toBe(true);
});

test('#448 — esiste l\'interruttore dell\'esplorazione a coda vuota', async ({ openTab }) => {
  const page = await openAutomation(openTab);
  await expect(page.locator('#mgProberIdle')).toHaveCount(1);
});

test('lo switch master non mente: se il salvataggio fallisce torna indietro', async ({ openTab }) => {
  const page = await openAutomation(openTab);
  // Nessuna sessione admin ⇒ il main rifiuta la scrittura ⇒ lo switch deve
  // tornare Off e dirlo, invece di restare acceso senza effetto.
  await page.evaluate(() => {
    const el = document.getElementById('mgAutoToggle');
    el.disabled = false;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#mgAutoMsg')).toContainText('NON è cambiata', { timeout: 10000 });
  expect(await page.evaluate(() => document.getElementById('mgAutoToggle').checked)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('mgAutoState').textContent)).toBe('Off');
});
