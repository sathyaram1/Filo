// Verifica #430 giro 8 — esplorazione: mentre si fotografa una scheda nata dietro, la si vede attraverso quella davanti?
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { readFileSync, unlinkSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { pagina, schede } from './giro2-carta.mjs';

async function rossiSulloSchermo(file) {
  await run('scrot', ['-o', file]);
  const ppm = file.replace(/\.png$/, '.ppm');
  await run('convert', [file, '-resize', '25%', ppm]);
  const b = readFileSync(ppm);
  // P6\nW H\n255\n
  let i = 0, campi = [];
  while (campi.length < 4) { let s = ''; while (b[i] !== 0x0a && b[i] !== 0x20) s += String.fromCharCode(b[i++]); i++; if (s) campi.push(s); }
  const W = Number(campi[1]);
  let rossi = 0;
  // Sotto la barra della shell (88px): la scheda rossa ha la sua tinta nella barra, e lì è giusto.
  for (let p = i + W * 3 * 30; p + 2 < b.length; p += 3) if (b[p] > 180 && b[p + 1] < 90 && b[p + 2] < 90) rossi++;
  try { unlinkSync(ppm); } catch (_) {}
  return rossi;
}

for (const davanti of ['home', 'trasparente']) {
  test(`scheda rossa aperta dietro mentre davanti c'è ${davanti}: non si vede mai`, async ({ app, shell, testServer }) => {
    const win = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setBounds({ x: 0, y: 0, width: 1000, height: 700 }); w.show(); return w.getBounds(); });
    console.log('finestra', JSON.stringify(win));
    if (davanti === 'trasparente') {
      await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<!doctype html><title>Vuota</title><style>html,body{background:transparent}</style><p>vuota</p>'));
    }
    await shell.waitForTimeout(1500);
    const base = await rossiSulloSchermo('tests/.shots/g8-base.png');
    console.log('rossi prima', base);
    const url = testServer.html(pagina('#e01010', 'Rossa'));
    await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.openTab(u, { activate: false }); }, url);
    let massimo = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const r = await rossiSulloSchermo('tests/.shots/g8-trasp.png');
      if (r > massimo) { massimo = r; await run('cp', ['tests/.shots/g8-trasp.png', `tests/.shots/g8-trasp-max-${davanti}.png`]); }
    }
    const s = await schede(app);
    console.log('rossi massimo', massimo, JSON.stringify(s.tutte.map((t) => [t.title, t.url.slice(0, 40), t.loading, t.foto])));
    expect(massimo).toBeLessThan(200);
  });
}
