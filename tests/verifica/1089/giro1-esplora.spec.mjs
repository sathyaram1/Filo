// Verifica #1089 giro 1 — esplorazione: barra riconciliata sotto stress, valori cambiati senza set, formato del file.

import { test, expect } from '../../fixtures/electron.mjs';

test('stress: aperture, chiusure e titoli che cambiano lasciano la barra uguale allo stato', async ({ shell, testServer }) => {
  const viva = '<script>let n=0;setInterval(()=>{document.title="T"+(++n)},40)</script>';
  for (let i = 0; i < 8; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(`<title>T${i}</title>${i % 2 ? viva : ''}`));
  }
  await expect(shell.locator('#tabs .tab')).toHaveCount(9, { timeout: 15_000 });
  // Chiusure ravvicinate dalla X, dal tasto centrale e dall'API, mentre i titoli cambiano.
  await shell.locator('#tabs .tab').nth(2).locator('.close').click();
  await shell.locator('#tabs .tab').nth(3).click({ button: 'middle' });
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    window.filoShell.tabs.close(s.tabs[1].id);
    for (let i = 0; i < 4; i++) window.filoShell.tabs.open('about:blank');
    const s2 = await window.filoShell.tabs.snapshot();
    window.filoShell.tabs.close(s2.tabs[s2.tabs.length - 1].id);
    window.filoShell.tabs.activate(s2.tabs[2].id);
  });
  await shell.waitForTimeout(1500);
  const confronto = async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const dom = [...document.querySelectorAll('#tabs .tab')];
    return {
      ids: JSON.stringify(dom.map((e) => e.dataset.id)) === JSON.stringify(s.tabs.map((t) => String(t.id))),
      unici: new Set(dom.map((e) => e.dataset.id)).size === dom.length,
      attiva: document.querySelector('#tabs .tab.active')?.dataset.id === String(s.activeId),
      attive: document.querySelectorAll('#tabs .tab.active').length,
    };
  });
  await expect.poll(confronto, { timeout: 5_000 }).toEqual({ ids: true, unici: true, attiva: true, attive: 1 });

  // Trascinata della prima in fondo mentre i titoli cambiano: ordine nel DOM uguale allo stato.
  const prima = shell.locator('#tabs .tab').first();
  const ultima = shell.locator('#tabs .tab').last();
  const a = await prima.boundingBox();
  const b = await ultima.boundingBox();
  const idPrima = await prima.getAttribute('data-id');
  await shell.mouse.move(a.x + 15, a.y + a.height / 2);
  await shell.mouse.down();
  for (let k = 1; k <= 10; k++) await shell.mouse.move(a.x + 15 + ((b.x + b.width - 5 - a.x - 15) * k) / 10, a.y + a.height / 2);
  await shell.mouse.up();
  await expect.poll(async () => shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    return String(s.tabs[s.tabs.length - 1].id);
  }), { timeout: 5_000 }).toBe(idPrima);
  await expect.poll(confronto, { timeout: 5_000 }).toEqual({ ids: true, unici: true, attiva: true, attive: 1 });
  // Il clic dopo il rilascio non deve essere stato inghiottito: un clic su un'altra scheda la attiva.
  const altra = shell.locator('#tabs .tab').nth(1);
  const idAltra = await altra.getAttribute('data-id');
  await altra.click({ position: { x: 15, y: 10 } });
  await expect(shell.locator('#tabs .tab.active')).toHaveAttribute('data-id', idAltra, { timeout: 3_000 });
});

test('dopo un uso normale nessun valore resta cambiato senza essere scritto, e il file ha il formato di prima', async ({ app, shell, openTab, testServer }) => {
  const p1 = await testServer.openReady(openTab, '<title>Uno</title><input id=i><div style="height:4000px"></div>');
  await p1.fill('#i', 'ciao');
  await p1.evaluate(() => window.scrollTo(0, 1500));
  await testServer.openReady(openTab, '<title>Due</title><a href="#x">x</a>');
  await openTab('filo://options/options.html');
  await shell.waitForTimeout(1500);
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.close(s.tabs[s.tabs.length - 1].id);
  });
  await shell.waitForTimeout(1500);
  const cambiate = await app.evaluate(async () => {
    const S = globalThis.__filoStorage;
    await S.whenSettled();
    return S.verificaMutazioni();
  });
  expect(cambiate, 'valori cambiati in memoria senza set: con un arresto prima del controllo periodico vanno persi').toEqual([]);

  const esito = await app.evaluate(async () => {
    const S = globalThis.__filoStorage;
    await S.set({ __sonda: { n: Date.now() } });
    await S.whenSettled();
    const fs = process.mainModule.require('fs');
    const path = process.mainModule.require('path');
    const file = JSON.parse(fs.readFileSync(path.join(process.env.FILO_USER_DATA, 'storage.json'), 'utf8'));
    const mem = await S.get(null);
    const diverse = Object.keys(mem).filter((k) => k !== 'settings' && JSON.stringify(mem[k]) !== JSON.stringify(file[k]));
    return { diverse, mancanti: Object.keys(mem).filter((k) => !(k in file)) };
  });
  expect(esito).toEqual({ diverse: [], mancanti: [] });
});
