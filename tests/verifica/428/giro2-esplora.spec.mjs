// Esplorazione verifica #428 giro 2 (da cancellare).
import { test, expect } from '../../fixtures/electron.mjs';

async function larghezze(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id, x: Math.round(r.left * 10) / 10, w: Math.round(r.width * 10) / 10, active: el.classList.contains('active'), title: el.querySelector('.title')?.textContent };
  }));
}

async function apri(shell, openTab, testServer, n) {
  for (let i = 0; i < n; i++) {
    const url = testServer.html(`<title>Pagina ${String(i).padStart(2, '0')}</title><h1>p${i}</h1>`);
    await openTab(url);
  }
  await shell.waitForFunction((k) => document.querySelectorAll('#tabs .tab').length >= k && ![...document.querySelectorAll('#tabs .tab .spinner')].length, n, { timeout: 15000 });
}

test('scenario base: chiusura con la X, poi uscita', async ({ shell, openTab, testServer }) => {
  await apri(shell, openTab, testServer, 11);
  const vp = await shell.evaluate(() => ({ w: innerWidth, h: innerHeight, row: document.querySelector('.tab-row').getBoundingClientRect().toJSON() }));
  console.log('viewport', JSON.stringify(vp));
  // attiva la prima
  let t = await larghezze(shell);
  console.log('prima', JSON.stringify(t));
  const first = await shell.locator('#tabs .tab').first().boundingBox();
  await shell.mouse.click(first.x + 20, first.y + 16);
  await shell.waitForTimeout(300);
  t = await larghezze(shell);
  console.log('dopo attiva prima', JSON.stringify(t));
  const target = shell.locator('#tabs .tab').nth(4);
  await target.hover();
  const xb = await target.locator('.close').boundingBox();
  const cx = xb.x + xb.width / 2, cy = xb.y + xb.height / 2;
  const n0 = t.length;
  const prima = t;
  await shell.mouse.move(cx, cy);
  await shell.mouse.click(cx, cy);
  await shell.waitForFunction((k) => document.querySelectorAll('#tabs .tab').length === k - 1, n0);
  await shell.waitForTimeout(300);
  const dopo1 = await larghezze(shell);
  console.log('dopo chiusura 1', JSON.stringify(dopo1));
  const sotto = await shell.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.closest('.close') ? 'close:' + e.closest('.tab').dataset.id : e.className); }, [cx, cy]);
  console.log('sotto il puntatore', sotto);
  for (let k = 0; k < 3; k++) {
    await shell.mouse.click(cx, cy);
    await shell.waitForTimeout(250);
  }
  const dopo4 = await larghezze(shell);
  console.log('dopo 4 chiusure', JSON.stringify(dopo4));
  // esci verso la pagina
  await shell.mouse.move(cx, 300, { steps: 5 });
  await shell.waitForTimeout(300);
  const fuori = await larghezze(shell);
  console.log('fuori', JSON.stringify(fuori));
  const plus = await shell.locator('#tab-new').boundingBox();
  console.log('plus', JSON.stringify(plus));
  expect(dopo1.length).toBe(n0 - 1);
});
