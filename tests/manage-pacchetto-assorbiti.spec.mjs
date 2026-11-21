// #2270: gli originali che un pacchetto assorbe escono dalle liste e dai conteggi di Gestione; la scheda del pacchetto
// li mostra (numero e titolo) e li apre, e la scheda di un assorbito riporta al suo pacchetto.

import { mkdirSync } from 'node:fs';
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const SHOTS = 'tests/.shots';

function fb(id, seq, status, extra) {
  return {
    _id: id, text: `Testo di ${seq}`, name: `Titolo di ${seq}`, seq, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-11-10T10:00:00Z', images: [], status, ...(extra || {}),
  };
}

const DATI = [
  fb('p', 300, 'todo', { name: 'Pacchetto di 2 segnalazioni: Il menu non si apre · Il menu è lento', unisce: [{ id: 'a1', num: '#101' }, { id: 'a2', num: '#102' }] }),
  fb('a1', 101, 'archived', { name: 'Il menu non si apre', unitoIn: 'p' }),
  fb('a2', 102, 'archived', { name: 'Il menu è lento', unitoIn: 'p' }),
  fb('q1', 110, 'todo'),
  fb('z1', 120, 'archived'),
  // Già chiuso dalla fusione del suo pacchetto: non entra nei Risolti, ci entra il pacchetto.
  fb('c1', 130, 'done', { unitoIn: 'pv', resolvedInVersion: '0.0.1' }),
  fb('pv', 131, 'done', { resolvedInVersion: '0.0.1', unisce: [{ id: 'c1', num: '#130' }] }),
];

async function apriPagina(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((items) => window.__mgTest.setData(items), DATI);
  return page;
}

const tab = (page, name) => page.locator(`.mg-tab[data-tab="${name}"]`);

test('gli assorbiti non stanno nelle liste né nei conteggi; il pacchetto sì', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  await expect(tab(page, 'queue')).toHaveText('In coda (2)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (1)');
  await expect(tab(page, 'resolved')).toContainText('(1)');
  await apriScheda(page, 'archived');
  await expect(page.locator('.mg-item[data-id="z1"]')).toBeVisible();
  for (const id of ['a1', 'a2']) await expect(page.locator(`.mg-item[data-id="${id}"]`)).toHaveCount(0);
  await apriScheda(page, 'queue');
  await expect(page.locator('.mg-item[data-id="p"]')).toBeVisible();
});

test('la scheda del pacchetto mostra gli assorbiti col titolo e li apre; un assorbito riporta al pacchetto', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  await apriScheda(page, 'queue');
  await page.locator('.mg-item[data-id="p"]').click();
  const box = page.locator('#mgAssorbite');
  await expect(box).toBeVisible();
  await expect(page.locator('#mgAssorbiteTitolo')).toHaveText('Unisce 2 segnalazioni');
  await expect(box.locator('.mg-attesa-num')).toHaveText(['#101', '#102']);
  await expect(box.locator('.mg-attesa-titolo')).toHaveText(['Il menu non si apre', 'Il menu è lento']);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/manage-pacchetto-assorbiti.png` });

  await box.locator('.mg-attesa-num', { hasText: '#101' }).click();
  await expect(page.locator('#mgThread')).toContainText('Testo di 101');
  await expect(page.locator('#mgAssorbiteTitolo')).toHaveText('Assorbita nel pacchetto');
  await expect(box.locator('.mg-attesa-num')).toHaveText(['#300']);
  await box.locator('.mg-attesa-num').click();
  await expect(page.locator('#mgAssorbiteTitolo')).toHaveText('Unisce 2 segnalazioni');

  // Una scheda qualunque non mostra il riquadro.
  await page.locator('.mg-item[data-id="q1"]').click();
  await expect(box).toBeHidden();
});
