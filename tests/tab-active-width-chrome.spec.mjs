// Feedback alpha: "rendi la tab selezionata un po' allargata ... la divisione
// fra le tab mi piace più quella di chrome, copiane l'estetica".
//
// Verifica IL SUCCESSO della richiesta:
//   1) la tab attiva è davvero PIÙ LARGA delle tab inattive;
//   2) le tab si toccano (niente gap) e sono separate da una linea verticale
//      sottile in stile Chrome (.tab::after), che però scompare sulla tab
//      attiva.

import { test, expect } from './fixtures/electron.mjs';

test('la tab selezionata è più larga delle altre', async ({ shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // Apre qualche tab così che ce ne sia più d'una e una sia attiva.
  await openTab('filo://newtab/');
  await openTab('filo://newtab/');
  await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 8_000 });
  await expect(shell.locator('.tab.active')).toHaveCount(1);

  // Attendi che il layout flex si assesti: subito dopo l'apertura la riga di
  // tab può misurare 0px per un frame (corsa di layout), falsando i confronti.
  await expect
    .poll(() => shell.locator('.tab.active').evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(0);

  const widths = await shell.locator('.tab').evaluateAll((els) =>
    els.map((el) => ({
      active: el.classList.contains('active'),
      width: el.getBoundingClientRect().width,
    })),
  );

  const active = widths.find((w) => w.active);
  const inactive = widths.filter((w) => !w.active);
  expect(active).toBeTruthy();
  expect(inactive.length).toBeGreaterThan(0);

  // La tab attiva deve essere strettamente più larga di OGNI tab inattiva.
  for (const t of inactive) {
    expect(active.width).toBeGreaterThan(t.width);
  }
});

test('le tab si toccano e usano un separatore verticale in stile Chrome', async ({ shell, openTab }) => {
  await openTab('filo://newtab/');
  await openTab('filo://newtab/');
  await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 8_000 });

  // Niente gap fra le tab: si toccano come in Chrome.
  const gap = await shell.locator('.tabs').evaluate(
    (el) => getComputedStyle(el).columnGap || getComputedStyle(el).gap,
  );
  expect(gap).toBe('0px');

  // Una tab inattiva NON ultima ha il separatore ::after visibile (largo 1px);
  // la tab attiva non lo ha (display:none).
  const probe = await shell.locator('.tab').evaluateAll((els) => {
    const result = { inactiveDivider: null, activeDivider: null };
    for (const el of els) {
      const after = getComputedStyle(el, '::after');
      const isActive = el.classList.contains('active');
      const isLast = el === els[els.length - 1];
      if (isActive) {
        result.activeDivider = { display: after.display, width: after.width };
      } else if (!isLast && result.inactiveDivider === null) {
        result.inactiveDivider = { display: after.display, width: after.width };
      }
    }
    return result;
  });

  // La scheda attiva non mostra la sottile linea verticale da 1px (al suo posto
  // ::after fa da piedino "a goccia", largo 8px — vedi test dedicato).
  expect(probe.activeDivider).toBeTruthy();
  expect(probe.activeDivider.width).not.toBe('1px');
  expect(probe.inactiveDivider).toBeTruthy();
  expect(probe.inactiveDivider.display).not.toBe('none');
  expect(probe.inactiveDivider.width).toBe('1px');
});

test('la scheda attiva ha le curve "a goccia" in stile Chrome', async ({ shell, openTab }) => {
  await openTab('filo://newtab/');
  await openTab('filo://newtab/');
  await expect(shell.locator('.tab.active')).toHaveCount(1, { timeout: 8_000 });
  await expect
    .poll(() => shell.locator('.tab.active').evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(0);

  // I due piedini curvi sono pseudo-elementi ::before/::after sulla scheda
  // attiva: devono essere visibili (display block, 8px) e disegnati con un
  // radial-gradient (l'arco concavo che fonde la scheda con la barra).
  const feet = await shell.locator('.tab.active').evaluate((el) => {
    const read = (sel) => {
      const s = getComputedStyle(el, sel);
      return { display: s.display, width: s.width, bg: s.backgroundImage };
    };
    return { before: read('::before'), after: read('::after') };
  });

  for (const foot of [feet.before, feet.after]) {
    expect(foot.display).not.toBe('none');
    expect(foot.width).toBe('8px');
    expect(foot.bg).toContain('radial-gradient');
  }
});
