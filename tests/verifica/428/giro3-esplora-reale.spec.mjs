// Esplorazione verifica #428 giro 3 (da cancellare): puntatore vero via xdotool, finestra visibile.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';

const xdo = (...a) => execFileSync('xdotool', a.map(String), { encoding: 'utf8' });
const log = (...a) => console.log('[esplora]', ...a);

async function larghezze(shell) {
  return shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((el) => Math.round(el.getBoundingClientRect().width)));
}

async function prepara(app, shell, testServer, n) {
  for (let i = 0; i < n; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>Una pagina con un titolo abbastanza lungo numero ${i}</title><p>${i}</p>`));
  }
  await expect(shell.locator('#tabs .tab')).toHaveCount(n + 1, { timeout: 15_000 });
  const b = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito) || BrowserWindow.getAllWindows()[0];
    w.setOpacity(1);
    w.setBounds({ x: 100, y: 120, width: 1200, height: 700 });
    w.show(); w.focus();
    return { c: w.getContentBounds(), z: w.webContents.getZoomFactor() };
  });
  await shell.waitForTimeout(1200);
  const b2 = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito) || BrowserWindow.getAllWindows()[0];
    return { c: w.getContentBounds(), z: w.webContents.getZoomFactor() };
  });
  log('bounds', JSON.stringify(b2));
  return (x, y) => [Math.round(b2.c.x + x * b2.z), Math.round(b2.c.y + y * b2.z)];
}

async function chiudiDi(shell, i) {
  return shell.evaluate((k) => {
    const el = document.querySelectorAll('#tabs .tab')[k];
    const c = el.querySelector('.close').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id, x: c.left + c.width / 2, y: c.top + c.height / 2, bx: r.left + 30, by: r.top + r.height / 2 };
  }, i);
}

test('A: X, X, poi giù sulla pagina', async ({ app, shell, testServer }) => {
  const scr = await prepara(app, shell, testServer, 13);
  const prima = await larghezze(shell);
  log('A prima', JSON.stringify(prima));
  const t = await chiudiDi(shell, 4);
  xdo('mousemove', ...scr(t.x - 30, t.y)); await shell.waitForTimeout(150);
  xdo('mousemove', ...scr(t.x, t.y)); await shell.waitForTimeout(300);
  xdo('click', 1); await shell.waitForTimeout(700);
  log('A dopo 1', JSON.stringify(await larghezze(shell)));
  xdo('click', 1); await shell.waitForTimeout(700);
  log('A dopo 2', JSON.stringify(await larghezze(shell)));
  for (let y = t.y; y <= 300; y += 12) { xdo('mousemove', ...scr(t.x, y)); await shell.waitForTimeout(25); }
  await shell.waitForTimeout(800);
  log('A sulla pagina', JSON.stringify(await larghezze(shell)));
});

test('B: tasto destro → Chiudi dal menu vero', async ({ app, shell, testServer }) => {
  const scr = await prepara(app, shell, testServer, 13);
  const n0 = await shell.locator('#tabs .tab').count();
  const t = await chiudiDi(shell, 4);
  xdo('mousemove', ...scr(t.bx, t.by)); await shell.waitForTimeout(300);
  xdo('click', 3); await shell.waitForTimeout(1200);
  const pop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => ({ id: w.id, b: w.getBounds(), url: w.webContents.getURL().slice(0, 40) })));
  log('B finestre', JSON.stringify(pop));
  // Trova la voce Chiudi nella finestra del menu.
  const voce = await app.evaluate(async ({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isVisible() || w._filoTabs) continue;
      const r = await w.webContents.executeJavaScript(`(() => { const els=[...document.querySelectorAll('*')].filter(e=>e.children.length<=3 && /^\\s*Chiudi\\s*$/.test(e.textContent)); const e=els[els.length-1]; if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`).catch(() => null);
      if (r) { const b = w.getContentBounds(); return { x: b.x + r.x * w.webContents.getZoomFactor(), y: b.y + r.y * w.webContents.getZoomFactor() }; }
    }
    return null;
  });
  log('B voce Chiudi', JSON.stringify(voce));
  if (voce) {
    xdo('mousemove', Math.round(voce.x), Math.round(voce.y)); await shell.waitForTimeout(300);
    xdo('click', 1);
  }
  await shell.waitForTimeout(1500);
  const n1 = await shell.locator('#tabs .tab').count();
  const ids = await shell.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map((e) => e.dataset.id));
  log('B schede', n0, '→', n1, 'chiusa ancora nella striscia:', ids.includes(t.id));
  const stato = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.length);
  log('B schede per il main', stato);
  // Un secondo giro: un titolo che cambia arriva nella striscia?
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await shell.waitForTimeout(1500);
  log('B dopo una scheda nuova', await shell.locator('#tabs .tab').count());
});

test('C: tasto centrale vero, due volte, poi fuori dalla finestra in alto', async ({ app, shell, testServer }) => {
  const scr = await prepara(app, shell, testServer, 13);
  const t = await chiudiDi(shell, 4);
  xdo('mousemove', ...scr(t.bx, t.by)); await shell.waitForTimeout(300);
  xdo('click', 2); await shell.waitForTimeout(700);
  log('C dopo 1', await shell.locator('#tabs .tab').count(), JSON.stringify(await larghezze(shell)));
  xdo('click', 2); await shell.waitForTimeout(700);
  log('C dopo 2', await shell.locator('#tabs .tab').count(), JSON.stringify(await larghezze(shell)));
  // esce dall'alto della finestra
  for (let y = t.by; y >= -40; y -= 6) { xdo('mousemove', ...scr(t.bx, y)); await shell.waitForTimeout(25); }
  await shell.waitForTimeout(900);
  log('C fuori in alto', JSON.stringify(await larghezze(shell)));
});

test('D: dopo la chiusura aspetta il fumetto e ci entra', async ({ app, shell, testServer }) => {
  const scr = await prepara(app, shell, testServer, 13);
  const t = await chiudiDi(shell, 4);
  xdo('mousemove', ...scr(t.x - 30, t.y)); await shell.waitForTimeout(150);
  xdo('mousemove', ...scr(t.x, t.y)); await shell.waitForTimeout(300);
  xdo('click', 1); await shell.waitForTimeout(900);
  const tip = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible() && !w._filoTabs).map((w) => w.getBounds()));
  log('D fumetti', JSON.stringify(tip));
  if (tip[0]) {
    xdo('mousemove', tip[0].x + 10, tip[0].y + Math.round(tip[0].height / 2));
  }
  await shell.waitForTimeout(1000);
  log('D nel fumetto', JSON.stringify(await larghezze(shell)));
});

test('E: raffica di cinque clic sulla X', async ({ app, shell, testServer }) => {
  const scr = await prepara(app, shell, testServer, 13);
  const prima = await larghezze(shell);
  const t = await chiudiDi(shell, 3);
  xdo('mousemove', ...scr(t.x, t.y)); await shell.waitForTimeout(400);
  for (let i = 0; i < 5; i++) { xdo('click', 1); await shell.waitForTimeout(120); }
  await shell.waitForTimeout(800);
  log('E prima', JSON.stringify(prima));
  log('E dopo', await shell.locator('#tabs .tab').count(), JSON.stringify(await larghezze(shell)));
});
