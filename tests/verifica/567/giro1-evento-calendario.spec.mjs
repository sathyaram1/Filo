// #567.5 — un evento proposto da Filo si deve poter aggiungere davvero, e
// finché non lo si aggiunge il diario non deve chiamarlo «creato».
//
// Le porte contate qui: il bottone che apre il calendario; il caso in cui il
// computer non ha nessun calendario (il file deve comunque essere raggiungibile);
// una data che non esiste; un titolo ostile (HTML, punto e virgola, a capo,
// emoji, 10.000 caratteri) che non deve rompere né la pagina né il file.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

// Il calendario vero non esiste nel contenitore: fingiamo l'apertura, così la
// prova misura Filo e non l'ambiente.
async function fingiApertura(app, esito = '') {
  await app.evaluate(({ shell }, e) => {
    if (!globalThis.__v567openOrig) globalThis.__v567openOrig = shell.openPath;
    globalThis.__v567aperti = [];
    shell.openPath = async (p) => { globalThis.__v567aperti.push(p); return e; };
  }, esito);
}
const cartellaEventi = async (app) => join(await app.evaluate(({ app: a }) => a.getPath('temp')), 'filo-eventi');

const EVENTO = '{"titolo":"Riunione col dentista","data":"2026-09-21","ora":"10:00","durata_min":45,"luogo":"Studio Rossi"}';

test('l\'evento proposto si aggiunge al calendario, e fino ad allora il diario lo chiama proposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fingiApertura(app, '');

  await fakeProvider(app, [
    { toolCalls: [{ id: 'k1', name: 'EVENTO_CALENDARIO', arguments: EVENTO }] },
    { text: 'Ecco l\'evento.' },
  ], '__v567m');

  await chiedi(page, 'segnami la riunione col dentista lunedì alle 10');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco l\'evento.' })).toBeVisible({ timeout: 10_000 });

  // Il diario non promette un evento creato.
  const activity = page.locator('.dash-activity');
  await expect(activity.locator('.dash-activity-label')).toContainText('proposto un evento');
  await activity.locator('.dash-activity-head').click();
  const riga = activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Evento' });
  await expect(riga).toHaveCount(1);
  const testoRiga = await riga.textContent();
  expect(testoRiga).toContain('proposto');
  expect(testoRiga).not.toContain('creato');
  expect(testoRiga).toContain('21/09/2026 alle 10:00');

  // Il bottone c'è, è acceso, e fa quello che dice.
  const btn = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  await page.screenshot({ path: 'tests/.shots/567-evento-proposto.png' });
  await btn.click();
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });

  const dir = await cartellaEventi(app);
  expect(existsSync(dir)).toBe(true);
  const file = readdirSync(dir).find((f) => f.endsWith('.ics'));
  expect(file, 'un file .ics è stato scritto').toBeTruthy();
  const ics = readFileSync(join(dir, file), 'utf8');
  expect(ics).toContain('BEGIN:VEVENT');
  expect(ics).toContain('SUMMARY:Riunione col dentista');
  expect(ics).toContain('DTSTART:20260921T100000');
  expect(ics).toContain('DTEND:20260921T104500');
  expect(ics).toContain('LOCATION:Studio Rossi');

  // Chi chiude per sbaglio il calendario deve poterlo rimandare.
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeEnabled();

  await restore(app, '__v567m');
});

test('senza nessun calendario sul computer l\'utente sa comunque dov\'è finito l\'evento', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fingiApertura(app, 'nessun programma associato');

  await fakeProvider(app, [
    { toolCalls: [{ id: 'k2', name: 'EVENTO_CALENDARIO', arguments: EVENTO }] },
    { text: 'Ecco.' },
  ], '__v567n');

  await chiedi(page, 'segna la riunione');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco.' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' }).click();

  const nota = page.locator('.dash-bubble-note');
  await expect(nota).toBeVisible({ timeout: 10_000 });
  expect(await nota.textContent()).toContain('.ics');

  await restore(app, '__v567n');
});

test('una data che non esiste non diventa un bottone: il diario dice perché', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'k3', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Mai","data":"2026-02-31","ora":"10:00"}' }] },
    { text: 'Non ci riesco.' },
  ], '__v567o');

  await chiedi(page, 'segna una cosa il 31 febbraio');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non ci riesco.' })).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' })).toHaveCount(0);
  const activity = page.locator('.dash-activity');
  await expect(activity.locator('.dash-activity-label')).not.toContainText('proposto un evento');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'data o ora non valide' })).toHaveCount(1);

  await restore(app, '__v567o');
});

test('un titolo ostile non rompe né la pagina né il file dell\'evento', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fingiApertura(app, '');

  const titolo = `<script>alert(1)</script>; a capo\nqui 🙂 ${'x'.repeat(10_000)}`;
  await fakeProvider(app, [
    {
      toolCalls: [{
        id: 'k4',
        name: 'EVENTO_CALENDARIO',
        arguments: JSON.stringify({ titolo, data: '2026-12-31', ora: '23:59', durata_min: 999999 }),
      }],
    },
    { text: 'Ok.' },
  ], '__v567p');

  await chiedi(page, 'segna quella cosa');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 10_000 });

  // Niente HTML iniettato, e la pagina non sborda di lato.
  await expect(page.locator('.dash-activity script')).toHaveCount(0);
  await page.locator('.dash-activity .dash-activity-head').click();
  const sborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(sborda).toBe(false);

  const btn = page.locator('.dash-action-btn', { hasText: 'Aggiungi al calendario' });
  await expect(btn).toBeVisible();
  // Due click di fila non devono scrivere due eventi.
  await btn.click();
  await btn.click().catch(() => {});
  await expect(page.locator('.dash-action-btn', { hasText: 'Aperto nel calendario' })).toBeVisible({ timeout: 10_000 });

  const dir = await cartellaEventi(app);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ics'));
  const ics = readFileSync(join(dir, files[0]), 'utf8');
  // Nessuna riga oltre i 75 ottetti, e nessun a capo vero dentro un campo:
  // un .ics malformato il calendario lo rifiuta.
  const righe = ics.split('\r\n');
  for (const r of righe) expect(Buffer.byteLength(r, 'utf8')).toBeLessThanOrEqual(75);
  expect(ics).toContain('SUMMARY:');
  expect(ics).not.toContain('\n\n');

  await restore(app, '__v567p');
});
