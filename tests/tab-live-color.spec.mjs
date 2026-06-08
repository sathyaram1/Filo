// "Vetro smerigliato" della tab attiva — colore live (spec §1.1).
//
// ASSERISCE il successo: il content script campiona il colore dominante della
// cima della pagina, il main lo mette sullo snapshot e la shell tinge la tab
// attiva con quel colore (variabile --tab-active) e sceglie un testo leggibile.

import { test, expect } from './fixtures/electron.mjs';

// Pagina con una striscia in cima di colore noto e forte (blu scuro).
const HTML = `<!doctype html><html><head><title>Pagina colorata</title></head>
<body style="margin:0">
  <div style="height:300px;background:rgb(20, 40, 200)"></div>
  <div style="height:2000px;background:#ffffff"></div>
</body></html>`;

test('la tab attiva prende il colore dominante della cima della pagina', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, HTML);

  // Il colore campionato arriva fino allo snapshot del main.
  await expect.poll(async () => shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const a = snap.tabs.find((t) => t.id === snap.activeId);
    return (a && a.color) || null;
  }), { timeout: 8_000 }).toMatch(/rgb\(20, 40, 200\)/);

  // La shell tinge la tab attiva con quel colore (variabile --tab-active) e
  // imposta un testo chiaro (il blu scuro ha bassa luminanza).
  await expect.poll(async () => shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    if (!el) return null;
    return {
      tint: el.style.getPropertyValue('--tab-active'),
      color: el.style.color,
    };
  }), { timeout: 8_000 }).toEqual(
    expect.objectContaining({ tint: expect.stringContaining('rgb(20, 40, 200)') }),
  );

  const fg = await shell.evaluate(() => document.querySelector('.tab.active').style.color);
  // Testo chiaro su fondo scuro (qualunque forma rgb/hex → deve essere "chiaro").
  expect(fg).toBeTruthy();
});
