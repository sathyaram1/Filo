// VERIFICA #427 — parte 2: stress test, casi limite, regressioni. (temporaneo)
import { test, expect } from './fixtures/electron.mjs';

const z = (page) => page.evaluate(() => window.devicePixelRatio);

async function focusPage(page) {
  await page.mouse.click(300, 300).catch(() => {});
  await page.waitForTimeout(200);
}

test.describe('#427 stress', () => {
  test('20x Ctrl+ e 40x Ctrl- : clamp sensato, niente pagina invisibile o crash', async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(600);
    await focusPage(page);

    for (let i = 0; i < 20; i++) await page.keyboard.press('Control+Equal');
    await page.waitForTimeout(600);
    const max = await z(page);
    console.log('[427] 20x Ctrl+ ->', max);
    expect(max).toBeGreaterThan(1);
    expect(max, 'lo zoom massimo deve restare in un intervallo da browser').toBeLessThanOrEqual(6);

    for (let i = 0; i < 40; i++) await page.keyboard.press('Control+Minus');
    await page.waitForTimeout(600);
    const min = await z(page);
    console.log('[427] 40x Ctrl- ->', min);
    expect(min).toBeGreaterThan(0.1);
    expect(min).toBeLessThan(1);

    // la pagina risponde ancora
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(300);
    expect(await z(page)).toBeCloseTo(1, 3);
    expect(await page.evaluate(() => document.body.childElementCount)).toBeGreaterThan(0);
  });

  test('raffica di ctrl+rotella (40 eventi) non rompe nulla', async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(600);
    await focusPage(page);
    await page.keyboard.down('Control');
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, i % 2 ? 120 : -120);
    await page.keyboard.up('Control');
    await page.waitForTimeout(600);
    const v = await z(page);
    console.log('[427] raffica wheel ->', v);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0.1);
    expect(v).toBeLessThanOrEqual(6);
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(300);
    expect(await z(page)).toBeCloseTo(1, 3);
  });

  test('lo zoom di una scheda NON contagia le altre', async ({ openTab }) => {
    const manage = await openTab('filo://manage/manage.html');
    await manage.waitForTimeout(600);
    const history = await openTab('filo://history/history.html');
    await history.waitForTimeout(600);

    await focusPage(history);
    for (let i = 0; i < 3; i++) { await history.keyboard.press('Control+Equal'); await history.waitForTimeout(120); }
    await history.waitForTimeout(400);

    const hz = await z(history);
    const mz = await z(manage);
    console.log('[427] isolamento: history', hz, ' manage', mz);
    expect(hz).toBeGreaterThan(1);
    expect(mz, 'la scheda non toccata deve restare al 100%').toBeCloseTo(1, 3);
  });

  test('rotella SENZA ctrl scrolla e non zooma', async ({ openTab }) => {
    const page = await openTab('filo://history/history.html');
    await page.waitForTimeout(700);
    await focusPage(page);
    const base = await z(page);
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(80); }
    await page.waitForTimeout(300);
    const after = await z(page);
    console.log('[427] wheel senza ctrl :', base, '->', after);
    expect(after, 'senza ctrl la rotella non deve zoomare').toBeCloseTo(base, 3);
  });

  test('digitare + e - in un campo di testo non zooma', async ({ openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(800);
    await focusPage(page);
    const base = await z(page);
    const typed = await page.evaluate(() => {
      const el = document.querySelector('input[type="text"], input:not([type]), input[type="search"], textarea');
      if (!el) return false;
      el.focus();
      return true;
    });
    if (typed) {
      await page.keyboard.type('+++---aaa+++');
      await page.waitForTimeout(300);
      const after = await z(page);
      console.log('[427] typing + in campo :', base, '->', after, '(campo trovato)');
      expect(after).toBeCloseTo(base, 3);
    } else {
      // nessun campo: batti comunque i tasti sulla pagina
      await page.keyboard.type('+++---');
      await page.waitForTimeout(300);
      const after = await z(page);
      console.log('[427] typing + su pagina :', base, '->', after, '(nessun campo)');
      expect(after).toBeCloseTo(base, 3);
    }
  });

  test('editor: Ctrl+ non lascia la pagina rotta e Ctrl+0 riporta tutto a posto', async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForTimeout(900);
    await focusPage(page);
    const base = await z(page);
    const sheetBefore = await page.evaluate(() => {
      const el = document.querySelector('#doc') || document.body;
      return el.getBoundingClientRect().width;
    });
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Equal'); await page.waitForTimeout(150); }
    await page.waitForTimeout(400);
    const after = await z(page);
    const sheetAfter = await page.evaluate(() => {
      const el = document.querySelector('#doc') || document.body;
      return el.getBoundingClientRect().width;
    });
    console.log('[427] editor dPR:', base, '->', after, ' foglio:', sheetBefore, '->', sheetAfter);
    // qualcosa deve essere cambiato: o la finestra o il foglio
    const changed = Math.abs(after - base) > 0.001 || Math.abs(sheetAfter - sheetBefore) > 1;
    expect(changed, 'in editor Ctrl+ deve fare qualcosa di visibile').toBe(true);

    await page.keyboard.press('Control+0');
    await page.waitForTimeout(400);
    const reset = await z(page);
    expect(reset).toBeCloseTo(base, 3);
    // la pagina è ancora viva
    expect(await page.evaluate(() => document.body.childElementCount)).toBeGreaterThan(0);
  });

  test('Ctrl+ subito dopo aver cliccato una scheda (fuoco sulla barra)', async ({ app, shell, openTab }) => {
    const page = await openTab('filo://manage/manage.html');
    await page.waitForTimeout(700);
    const base = await z(page);
    // clic sulla scheda attiva nella barra: il fuoco passa alla shell
    await shell.evaluate(() => {
      const el = document.querySelector('.tab.active, [class*="tab"][class*="active"], .tab');
      if (el) el.click();
      window.focus();
      document.body.focus?.();
    });
    await shell.waitForTimeout(300);
    for (let i = 0; i < 3; i++) { await shell.keyboard.press('Control+Equal'); await shell.waitForTimeout(150); }
    await shell.waitForTimeout(500);
    const after = await z(page);
    console.log('[427] fuoco su barra schede :', base, '->', after);
    expect(after, 'Ctrl+ deve zoomare la pagina anche col fuoco sulla barra').toBeGreaterThan(base);
  });
});
