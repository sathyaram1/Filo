// #1089 — la barra delle schede non si ricostruisce a ogni aggiornamento: il titolo che cambia in una scheda
// lascia vivi i nodi delle altre, e scorrere o cliccare in una pagina non ridisegna la barra né riscrive la
// sessione, mentre il main continua a sapere quanto si è scorso.

import { test, expect } from './fixtures/electron.mjs';

test('il titolo che cambia in una scheda lascia vivi i nodi delle altre e non scorre la striscia', async ({ shell, testServer }) => {
  for (let i = 0; i < 3; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Pagina ${i}</title><p>${i}</p>`));
  }
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(
    '<title>(0) Posta</title><script>let n=0;setInterval(()=>{document.title="("+(++n)+") Posta"},80)</script>',
  ));
  await expect(shell.locator('#tabs .tab')).toHaveCount(5, { timeout: 15_000 });
  const titolo = () => shell.evaluate(() => document.querySelector('#tabs .tab:last-child .title')?.textContent || '');
  await expect.poll(titolo, { timeout: 8_000 }).toMatch(/\(\d+\) Posta/);

  await shell.evaluate(() => {
    window.__nodi = [...document.querySelectorAll('#tabs .tab')];
    window.__titoli = window.__nodi.map((el) => el.querySelector('.title'));
    window.__scorrimenti = 0;
    const vero = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...a) { window.__scorrimenti++; return vero.apply(this, a); };
    window.__staccati = 0;
    new MutationObserver((ms) => { for (const m of ms) window.__staccati += m.removedNodes.length; })
      .observe(document.getElementById('tabs'), { childList: true });
  });
  const primo = await titolo();
  await expect.poll(async () => {
    const t = await titolo();
    return Number((/\((\d+)\)/.exec(t) || [])[1]) - Number((/\((\d+)\)/.exec(primo) || [])[1]);
  }, { timeout: 8_000 }).toBeGreaterThanOrEqual(5);

  const esito = await shell.evaluate(() => {
    const ora = [...document.querySelectorAll('#tabs .tab')];
    return {
      stessi: ora.length === window.__nodi.length && ora.every((el, i) => el === window.__nodi[i]),
      titoliStessi: ora.every((el, i) => el.querySelector('.title') === window.__titoli[i]),
      staccati: window.__staccati,
      scorrimenti: window.__scorrimenti,
    };
  });
  expect(esito.stessi, 'i nodi delle schede sono stati ricreati').toBe(true);
  expect(esito.titoliStessi).toBe(true);
  expect(esito.staccati).toBe(0);
  expect(esito.scorrimenti, 'la striscia è stata riportata alla scheda attiva a ogni titolo').toBe(0);

  // Cambiare scheda la porta in vista, e le schede restano le stesse.
  const prima = await shell.evaluate(() => document.querySelector('#tabs .tab:first-child').dataset.id);
  await shell.locator('#tabs .tab:first-child').click({ position: { x: 20, y: 10 } });
  await expect(shell.locator('#tabs .tab.active')).toHaveAttribute('data-id', prima, { timeout: 3_000 });
  await expect.poll(() => shell.evaluate(() => window.__scorrimenti)).toBeGreaterThan(0);
  expect(await shell.evaluate(() => document.querySelector('#tabs .tab:first-child') === window.__nodi[0])).toBe(true);
});

test('scorrere una pagina non ridisegna la barra né riscrive la sessione, e il main sa quanto si è scorso', async ({ app, shell, testServer, openTab }) => {
  const page = await testServer.openReady(openTab, '<title>Lunga</title><div style="height:6000px">testo</div>');
  await expect(shell.locator('#tabs .tab.active .title')).toHaveText('Lunga', { timeout: 8_000 });
  // Il primo campione dello scorrimento parte 600 ms dopo il caricamento: lo si lascia passare.
  await page.waitForTimeout(1200);

  await shell.evaluate(() => {
    window.__aggiornamenti = 0;
    window.filoShell.tabs.onUpdate(() => { window.__aggiornamenti++; });
  });
  await app.evaluate(() => {
    globalThis.__sessioniScritte = 0;
    const S = globalThis.SN_STORAGE;
    const vero = S.setRaw;
    S.setRaw = function (k, v) { if (k === 'sn_open_tabs') globalThis.__sessioniScritte++; return vero.call(this, k, v); };
  });

  for (const y of [800, 1800, 2800, 3800]) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(700);
  }

  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      const t = tm && tm.tabs.find((x) => x.title === 'Lunga');
      if (t) return t.scrollPct;
    }
    return null;
  }), { timeout: 5_000 }).toBeGreaterThan(50);
  await page.waitForTimeout(600);
  expect(await shell.evaluate(() => window.__aggiornamenti), 'ogni scorrimento ridisegnava la barra').toBe(0);
  expect(await app.evaluate(() => globalThis.__sessioniScritte), 'ogni scorrimento riscriveva la sessione').toBe(0);
});
