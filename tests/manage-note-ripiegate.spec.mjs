// Gestione, conversazione di un feedback (#1333, da #559): una nota lunga si mostra ripiegata con l'inizio visibile,
// si apre al tocco (tasto o testo) e si richiude; l'ultima nota resta sempre aperta, anche quando ne arriva una dopo
// mentre la si legge; aperte e chiuse sopravvivono ai ridisegni.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'filo://manage/manage.html';

const lunga = (chi, n = 200) => Array.from({ length: n }, (_, i) => `${chi} riga ${i + 1}: provato il caso, regge.`).join('\n');
const NOTE = [
  `INIZIO DEL REPORT\n${lunga('report')}\nFINE DEL REPORT`,
  '',
  '--- La tua risposta del 05/10/2026, 10:00 ---',
  'Va bene, prosegui.',
  '',
  "--- Aggiornamento dell'agente del 06/10/2026, 11:00 ---",
  `Verifica: 1 rilievo.\n${lunga('critica')}\n[2i] FINE DELLA CRITICA`,
  '',
  "--- Aggiornamento dell'agente del 07/10/2026, 12:00 ---",
  `ULTIMA NOTA\n${lunga('correzione')}\nFINE DELL'ULTIMA`,
].join('\n');

const FB = {
  _id: 'note-ripiegate-1', seq: 1333, subSeq: 0, text: 'Le note lunghe non si ripiegano.', name: 'Note lunghe',
  clientId: 'tester@example.com', createdAt: '2026-10-01T10:00:00Z', status: 'revision_capability', images: [],
  notes: NOTE,
};

async function apri(page, fb) {
  await page.evaluate((f) => {
    window.__mgTest.setData([f]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(f._id);
  }, fb);
}

const bolle = (page) => page.locator('#mgThread .mg-bubble');
const bolla = (page, testo) => bolle(page).filter({ hasText: testo });

test('una nota lunga si ripiega e si apre al tocco; l’ultima resta aperta e non si richiude da sola', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);
  await apri(page, FB);

  const report = bolla(page, 'INIZIO DEL REPORT');
  const critica = bolla(page, 'FINE DELLA CRITICA');
  const ultima = bolla(page, 'ULTIMA NOTA');
  const risposta = bolla(page, 'Va bene, prosegui.');
  await expect(report).toHaveClass(/mg-bubble--ripiegata/);
  await expect(critica).toHaveClass(/mg-bubble--ripiegata/);
  await expect(ultima).not.toHaveClass(/mg-bubble--ripiegata/);
  await expect(ultima.locator('.mg-bubble-apri')).toHaveCount(0);
  await expect(risposta.locator('.mg-bubble-apri')).toHaveCount(0);

  // L'inizio si legge, e il turno dopo sta subito sotto invece che duecento righe più in basso.
  await expect(report.locator('.mg-bubble-body')).toContainText('INIZIO DEL REPORT');
  const [rb, qb] = [await report.boundingBox(), await risposta.boundingBox()];
  expect(qb.y - rb.y).toBeLessThan(260);
  // L'ultima è intera: niente di nascosto.
  const corpoUltima = await ultima.locator('.mg-bubble-body').evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight }));
  expect(corpoUltima.s).toBeLessThanOrEqual(corpoUltima.c + 1);

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/manage-note-ripiegate-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/manage-note-ripiegate-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });

  // Un tocco sul tasto apre: la nota è intera e il tasto dice come richiuderla.
  const tasto = report.locator('.mg-bubble-apri');
  await expect(tasto).toHaveText('Mostra tutto');
  await expect(tasto).toHaveAttribute('aria-expanded', 'false');
  await tasto.click();
  await expect(report).not.toHaveClass(/mg-bubble--ripiegata/);
  await expect(tasto).toHaveText('Riduci');
  await expect(tasto).toHaveAttribute('aria-expanded', 'true');
  const corpo = await report.locator('.mg-bubble-body').evaluate((e) => ({ s: e.scrollHeight, c: e.clientHeight }));
  expect(corpo.s).toBeLessThanOrEqual(corpo.c + 1);
  await expect(report.locator('.mg-bubble-body')).toContainText('FINE DEL REPORT');
  await tasto.scrollIntoViewIfNeeded();
  await tasto.hover();
  await page.screenshot({ path: 'tests/.shots/manage-note-ripiegate-aperta.png' });

  // Un tocco sul testo ripiegato apre anche lui.
  await critica.locator('.mg-bubble-body').click();
  await expect(critica).not.toHaveClass(/mg-bubble--ripiegata/);

  // Si richiude dal tasto, e la bolla resta sotto gli occhi.
  await critica.locator('.mg-bubble-apri').click();
  await expect(critica).toHaveClass(/mg-bubble--ripiegata/);
  await expect(critica).toBeInViewport();

  // Arriva un turno nuovo mentre si legge (ridisegno dal vivo): quella che era l'ultima resta aperta, il report
  // aperto a mano resta aperto, la critica richiusa a mano resta chiusa, la nuova ultima è aperta.
  const nuova = { ...FB, notes: `${NOTE}\n\n--- La tua risposta del 08/10/2026, 09:00 ---\nNUOVO TURNO ${lunga('owner', 60)}` };
  await page.evaluate((f) => {
    window.__mgTest.setData([f]);
    window.__mgTest.openDetail(f._id, { ridisegno: true });
  }, nuova);
  await expect(bolla(page, 'NUOVO TURNO')).not.toHaveClass(/mg-bubble--ripiegata/);
  await expect(bolla(page, 'ULTIMA NOTA')).not.toHaveClass(/mg-bubble--ripiegata/);
  await expect(bolla(page, 'ULTIMA NOTA').locator('.mg-bubble-apri')).toHaveText('Riduci');
  await expect(bolla(page, 'INIZIO DEL REPORT')).not.toHaveClass(/mg-bubble--ripiegata/);
  await expect(bolla(page, 'FINE DELLA CRITICA')).toHaveClass(/mg-bubble--ripiegata/);
});

test('un testo con HTML in una nota ripiegata resta testo, e una nota corta non si ripiega', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);
  const html = `<img src=x onerror="window.__rotto=1"><b>grassetto</b> ${'😀 '.repeat(40)}`;
  const notes = [
    `${html}\n${lunga('html', 60)}`,
    '',
    '--- La tua risposta del 05/10/2026, 10:00 ---',
    `${html}\n${lunga('owner', 60)}`,
    '',
    "--- Aggiornamento dell'agente del 06/10/2026, 11:00 ---",
    'Breve.',
  ].join('\n');
  await apri(page, { ...FB, _id: 'note-ripiegate-2', notes });
  const turni = bolle(page).filter({ has: page.locator('.mg-bubble-apri') });
  await expect(turni).toHaveCount(2);
  await turni.nth(1).locator('.mg-bubble-apri').click();
  await expect(turni.nth(1).locator('.mg-bubble-body')).toContainText('<b>grassetto</b>');
  expect(await page.evaluate(() => window.__rotto)).toBeUndefined();
  await expect(bolla(page, 'Breve.').locator('.mg-bubble-apri')).toHaveCount(0);
  const thread = await page.evaluate(() => { const t = document.getElementById('mgThread'); return t.scrollWidth - t.clientWidth; });
  expect(thread).toBeLessThanOrEqual(0);
});
