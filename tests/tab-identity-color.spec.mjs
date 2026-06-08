// Colore identità attenuato sulle tab INATTIVE (spec §1.2).
//
// ASSERISCE il successo: il content script estrae il colore identità del sito
// (qui dal <meta name="theme-color">), il main lo mette sullo snapshot e la
// shell tinge la tab INATTIVA con quel colore attenuato (variabile --tab-bg-eff,
// via color-mix col neutro del tab bar). Senza il fix la tab inattiva non
// avrebbe alcun --tab-bg-eff inline e lo snapshot non avrebbe identityColor.

import { test, expect } from './fixtures/electron.mjs';

// Pagina con un theme-color forte e noto (magenta acceso).
const PAGE_A = `<!doctype html><html><head><title>Sito A</title>
  <meta name="theme-color" content="rgb(220, 30, 90)">
</head><body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

// Seconda pagina senza identità particolare: serve solo a rendere INATTIVA la A.
const PAGE_B = `<!doctype html><html><head><title>Sito B</title></head>
<body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

test('la tab inattiva prende il colore identità del sito attenuato', async ({ shell, openTab, testServer }) => {
  const pageA = await testServer.openReady(openTab, PAGE_A);

  // Il colore identità (dal theme-color) arriva fino allo snapshot del main.
  await expect.poll(async () => shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const a = snap.tabs.find((t) => t.id === snap.activeId);
    return (a && a.identityColor) || null;
  }), { timeout: 8_000 }).toMatch(/rgb\(220, 30, 90\)/);

  // Apri una seconda tab: ora la tab A diventa INATTIVA.
  await testServer.openReady(openTab, PAGE_B);

  // Trova nello snapshot la tab del Sito A (inattiva) con il suo identityColor.
  const tabAId = await expect.poll(async () => shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const a = snap.tabs.find(
      (t) => t.id !== snap.activeId && /rgb\(220, 30, 90\)/.test(t.identityColor || ''),
    );
    return a ? a.id : null;
  }), { timeout: 8_000 }).not.toBeNull();

  // La shell tinge quella tab INATTIVA con la tinta attenuata: la variabile
  // --tab-bg-eff è impostata inline e mescola un colore col neutro del tab bar.
  const id = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const a = snap.tabs.find(
      (t) => t.id !== snap.activeId && /rgb\(220, 30, 90\)/.test(t.identityColor || ''),
    );
    return a ? a.id : null;
  });
  expect(id).not.toBeNull();

  const bgEff = await shell.evaluate((tid) => {
    const el = document.querySelector(`.tab[data-id="${tid}"]`);
    if (!el) return null;
    return {
      bgEff: el.style.getPropertyValue('--tab-bg-eff'),
      isActive: el.classList.contains('active'),
    };
  }, id);

  expect(bgEff).not.toBeNull();
  // È una tab inattiva e ha la tinta identità (color-mix col neutro del tab bar).
  expect(bgEff.isActive).toBe(false);
  expect(bgEff.bgEff).toContain('color-mix');
});
