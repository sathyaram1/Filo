// "Chiudi = archivia" + pagina archivio (spec §3.1 / §3.3 / §4).
//
// ASSERISCE il successo: chiudendo una scheda web i suoi metadati finiscono
// nell'archivio e la pagina filo://archive li mostra (raggruppati per giorno,
// con il colore identità per l'ordine cromatico) e permette di riaprirli.
// Senza il fix la tab chiusa spariva del tutto.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from './helpers/confirm.mjs';

const PAGE = `<!doctype html><html><head><title>Sito Archivio</title>
  <meta name="theme-color" content="rgb(200, 40, 60)">
</head><body style="margin:0"><div style="height:1200px;background:#fff"></div></body></html>`;

test('chiudere una scheda la archivia e la pagina archivio la mostra', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGE);

  // Aspetta che il colore identità sia stato catturato (così finisce in archivio
  // e abilita l'ordine cromatico).
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await expect.poll(async () => shell.evaluate(async (id) => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === id);
    return (t && t.identityColor) || null;
  }, tabId), { timeout: 8_000 }).toMatch(/rgb\(200, 40, 60\)/);

  // Chiudi la scheda → deve essere archiviata.
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  // Apri la pagina archivio e verifica che la scheda chiusa compaia.
  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');

  // La riga della scheda archiviata compare, come chip compatta col titolo;
  // l'URL non è più visibile a schermo ma resta nel tooltip (title).
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archivio' });
  await expect(row).toBeVisible({ timeout: 8_000 });
  await expect(row).toHaveAttribute('title', /127\.0\.0\.1/);

  // Metadato cromatico preservato: la riga porta il colore identità (--arc-color),
  // usato per l'ordine arcobaleno dentro il giorno.
  const arcColor = await row.evaluate((el) => el.style.getPropertyValue('--arc-color'));
  expect(arcColor).toContain('rgb(200, 40, 60)');

  // È raggruppata sotto un giorno, e oggi → etichetta "Oggi".
  await expect(archive.locator('.arc-day-label', { hasText: 'Oggi' })).toBeVisible();

  // Le pagine interne filo:// NON vengono archiviate (privacy/utilità).
  const hasInternal = await archive.evaluate(() =>
    [...document.querySelectorAll('.arc-tab')].some((e) => /filo:\/\//.test(e.title || '')));
  expect(hasInternal).toBe(false);

  // Tasto destro sulla chip apre il menu contestuale con "Riapri"/"Elimina".
  await row.click({ button: 'right' });
  const menu = archive.locator('.arc-ctxmenu');
  await expect(menu).toBeVisible();
  await menu.getByText('Riapri', { exact: true }).click();
  await expect.poll(async () => shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.some((t) => /127\.0\.0\.1/.test(t.url || ''));
  }), { timeout: 8_000 }).toBe(true);
});

test('la pagina è "Cronologia", un giorno per riga, con chip colorate come le tab in alto (#281)', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGE);

  // Aspetta il colore identità (serve per la tinta di sfondo della chip).
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await expect.poll(async () => shell.evaluate(async (id) => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = snap.tabs.find((x) => x.id === id);
    return (t && t.identityColor) || null;
  }, tabId), { timeout: 8_000 }).toMatch(/rgb\(200, 40, 60\)/);

  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');

  // (1) È la pagina principale di cronologia: il titolo lo dice.
  await expect(archive.locator('h1')).toHaveText('Cronologia');

  const row = archive.locator('.arc-tab', { hasText: 'Sito Archivio' });
  await expect(row).toBeVisible({ timeout: 8_000 });

  // (2) Un giorno per riga: il contenitore del giorno NON va a capo (nowrap).
  //     Prima del fix era flex-wrap:wrap → più righe per giorno.
  const wrap = await row.evaluate((el) => {
    const cont = el.closest('.arc-tabs');
    return getComputedStyle(cont).flexWrap;
  });
  expect(wrap).toBe('nowrap');

  // (3) Chip colorata come le tab in alto: la tinta identità (attenuata) è
  //     impostata come variabile di sfondo e il fondo NON è trasparente.
  const tint = await row.evaluate((el) => el.style.getPropertyValue('--arc-tint'));
  expect(tint.trim()).toMatch(/^rgb\(/);
  const bg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
});

test('menu contestuale: "Elimina" rimuove la tab dall\'archivio', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archivio' });
  await expect(row).toBeVisible({ timeout: 8_000 });

  await row.click({ button: 'right' });
  const menu = archive.locator('.arc-ctxmenu');
  await expect(menu).toBeVisible();
  await menu.getByText('Elimina', { exact: true }).click();

  // La chip sparisce dalla pagina: la tab è stata rimossa dall'archivio.
  await expect(archive.locator('.arc-tab', { hasText: 'Sito Archivio' })).toHaveCount(0, { timeout: 8_000 });
});

test('"Svuota archivio" usa il popup stilizzato di Filo, non il confirm nativo', async ({ shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGE);
  const tabId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const row = archive.locator('.arc-tab', { hasText: 'Sito Archivio' });
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Se ricomparisse il confirm nativo, Playwright lo intercetterebbe qui:
  // lo registriamo per far FALLIRE il test (il fix serve proprio a evitarlo).
  let nativeDialog = false;
  archive.on('dialog', async (d) => { nativeDialog = true; await d.dismiss().catch(() => {}); });

  await archive.getByRole('button', { name: 'Svuota archivio' }).click();

  // Compare il popup stilizzato (host in shadow DOM), NON un dialogo di sistema.
  await expect(archive.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  expect(nativeDialog, 'nessun confirm nativo del browser deve comparire').toBe(false);

  // Confermando, l'archivio si svuota davvero (la chip sparisce).
  await clickConfirm(archive, 'ok');
  await expect(archive.locator('.arc-tab')).toHaveCount(0, { timeout: 8_000 });
  await expect(archive.locator('#empty')).toBeVisible();
});
