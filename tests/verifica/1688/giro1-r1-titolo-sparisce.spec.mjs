// Verifica #1688 giro 1, rilievo 1: con nove schede in una finestra normale, una scheda dietro che comincia a suonare
// perde tutto il titolo (ne restano icona, vuoto e altoparlante), mentre le vicine larghe uguale lo mostrano.
import { test, expect } from '../../fixtures/electron.mjs';

async function patch(app, p) {
  return app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    p.forEach((q, i) => { if (q && w._filoTabs.tabs[i]) Object.assign(w._filoTabs.tabs[i], q); });
    w._filoTabs._broadcast();
    return w._filoTabs.tabs.map((t) => t.id);
  }, p);
}

const titolo = (shell, id) => shell.evaluate((id) => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const t = document.querySelector(`#tabs .tab[data-id="${id}"] .title`);
  const cs = getComputedStyle(t);
  const c = document.createElement('canvas').getContext('2d');
  c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const serve = c.measureText(([...t.textContent][0] || '') + '…').width;
  ok({ leggibile: cs.display !== 'none' && cs.visibility === 'visible' && t.offsetWidth >= serve, largo: t.offsetWidth });
}))), id);

test('r1 la scheda dietro che comincia a suonare tiene un titolo leggibile, come le vicine', async ({ shell, app }) => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).setSize(1280, 800);
  });
  await shell.evaluate(async () => { for (let i = 0; i < 8; i++) await window.filoShell.tabs.open('filo://newtab/'); });
  await expect(shell.locator('#tabs .tab')).toHaveCount(9, { timeout: 20_000 });
  await expect(shell.locator('#tabs .tab .spinner')).toHaveCount(0, { timeout: 20_000 });
  const ids = await patch(app, Array.from({ length: 9 }, (_, i) => ({
    url: `https://esempio${i}.test/pagina`, title: `Sito numero ${i} con un titolo abbastanza lungo da tagliare`,
  })));
  const k = 2;
  expect((await titolo(shell, ids[k])).leggibile, 'prima di suonare').toBe(true);
  const p = []; p[k] = { audible: true };
  await patch(app, p);
  await expect(shell.locator(`#tabs .tab[data-id="${ids[k]}"] .tab-alert`)).toHaveCount(1);
  expect(await titolo(shell, ids[k]), 'mentre suona').toMatchObject({ leggibile: true });
});
