import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';
const NEWTAB = 'filo://newtab/';
test('nell’Aiuto, dopo l’invio o dopo un popup confermato da tastiera, «conferma» va nel campo del popup', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const area = page.locator('.sn-sidebar-input textarea');
  await expect(area).toBeVisible();
  const scriviConferma = async (caso) => {
    await expect.poll(async () => (await confirmState(page))?.hasInput).toBe(true);
    await page.keyboard.type('conferma', { delay: 30 });
    const s = await confirmState(page);
    const chat = await area.inputValue();
    await page.keyboard.press('Escape');
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
    expect(chat, `${caso}: «conferma» è finito nel campo dell’Aiuto`).toBe('');
    expect(s.okDisabled, `${caso}: «conferma» non è arrivato al campo del popup`).toBe(false);
  };

  await area.click();
  await page.keyboard.type('cancella tutta la memoria', { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.SN_CONFIRM_UI.confirmTyped({ title: 'Filo chiede conferma', text: 'Eliminare tutta la memoria.' }); });
  await scriviConferma('dopo l’invio');

  await area.evaluate((el) => { el.value = ''; });
  await area.click();
  await page.evaluate(() => {
    window.SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: 'Procedo?' })
      .then(() => window.SN_CONFIRM_UI.confirmTyped({ title: 'Filo chiede conferma', text: 'Eliminare tutta la memoria.' }));
  });
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  await page.waitForTimeout(600);
  const log = [];
  for (const tasto of ['Tab', 'Tab', 'Enter']) {
    log.push(await page.evaluate(() => { const a = document.activeElement; return `${a && a.tagName}.${a && a.className} | ${document.querySelector('.sn-sidebar') ? document.querySelector('.sn-sidebar').innerText.slice(-200).replace(/\n/g,' / ') : ''}`; }));
    await page.keyboard.press(tasto);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(300);
  log.push(JSON.stringify(await confirmState(page)));
  console.log('DEBUG', log.join('\n'));
  await scriviConferma('dopo un popup confermato da tastiera');
});

