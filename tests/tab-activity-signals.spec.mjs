// Segnali di attività per-tab (spec §2.1, Fase 1).
//
// ASSERISCE il successo: i segnali che alimenteranno la decisione di
// auto-archiviazione arrivano fino allo snapshot del main:
//  - lastActiveAt valorizzato per la tab attiva
//  - scrollPct aumenta quando l'utente scrolla
//  - formDirty diventa true quando l'utente scrive in un campo
// Senza la Fase 1 lo snapshot non avrebbe questi campi.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><title>Pagina attività</title></head>
<body style="margin:0">
  <input id="f" />
  <div style="height:3000px;background:#fff"></div>
</body></html>`;

test('i segnali di attività (lastActive, scroll%, formDirty) arrivano allo snapshot', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  const activeId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });

  // La tab attiva ha un lastActiveAt valorizzato.
  const lastActive = await shell.evaluate(async (id) => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === id);
    return t ? t.lastActiveAt : null;
  }, activeId);
  expect(typeof lastActive).toBe('number');
  expect(lastActive).toBeGreaterThan(0);

  // Scroll → scrollPct sale.
  await page.evaluate(() => window.scrollTo(0, 2000));
  await expect.poll(async () => shell.evaluate(async (id) => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === id);
    return t ? t.scrollPct : 0;
  }, activeId), { timeout: 8_000 }).toBeGreaterThan(0);

  // Scrivere in un campo → formDirty true.
  await page.evaluate(() => {
    const el = document.getElementById('f');
    el.focus();
    el.value = 'ciao';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => shell.evaluate(async (id) => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === id);
    return t ? t.formDirty : false;
  }, activeId), { timeout: 8_000 }).toBe(true);
});
