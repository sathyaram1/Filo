// Ottava volta che rientra la stessa famiglia. Le Preferenze sono la pagina da
// cui è partita, e due suoi campi numerici non l'hanno ancora ricevuta: quello
// che si vede sullo schermo non parte da nessuna uscita, e la conferma resta.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';

async function chiudiScheda(shell, frammento) {
  const id = await shell.evaluate(async (f) => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    const t = lista.find((x) => (x.url || '').includes(f));
    return t ? t.id : null;
  }, frammento);
  expect(id, `la scheda ${frammento} non compare fra quelle aperte`).toBeTruthy();
  await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
}

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

async function digita(page, selettore, testo) {
  await page.waitForSelector(selettore, { timeout: 20_000 });
  await page.click(selettore);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(testo);
  await expect.poll(() => page.locator(selettore).inputValue(), { timeout: 5000 }).toBe(testo);
}

const oreArchiviazione = (s) => String((s.autoArchive || {}).idleHours ?? '');
const durataNotifiche = (s) => String((s.notifications || {}).durationSec ?? '');

// ─── Le ore di inattività dell'auto-archiviazione ───────────────────────────

test('Preferenze: le ore di inattività appena digitate non si perdono chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await digita(page, '#autoArchiveIdleHours', '23');

  await chiudiScheda(shell, 'preferences');

  await expect
    .poll(() => impostazioni(app).then(oreArchiviazione), {
      timeout: 8000,
      message: 'chiudendo la scheda col cursore ancora nel campo, le ore digitate spariscono',
    })
    .toBe('23');
});

test('Preferenze: le ore di inattività appena digitate non si perdono ricaricando la pagina', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await digita(page, '#autoArchiveIdleHours', '19');

  await page.reload();

  await expect
    .poll(() => impostazioni(app).then(oreArchiviazione), {
      timeout: 8000,
      message: 'ricaricando la pagina col cursore ancora nel campo, le ore digitate spariscono',
    })
    .toBe('19');
});

// Controllo: uscendo dal campo prima di chiudere, lo stesso numero resta.
test('Preferenze: uscendo dal campo prima di chiudere, le ore restano', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await digita(page, '#autoArchiveIdleHours', '17');
  await page.keyboard.press('Tab');
  await expect.poll(() => impostazioni(app).then(oreArchiviazione), { timeout: 8000 }).toBe('17');

  await chiudiScheda(shell, 'preferences');
});

// ─── La durata delle notifiche ──────────────────────────────────────────────

test('Preferenze: la durata delle notifiche appena digitata non si perde chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await digita(page, '#notifDuration', '42');

  await chiudiScheda(shell, 'preferences');

  await expect
    .poll(() => impostazioni(app).then(durataNotifiche), {
      timeout: 8000,
      message: 'chiudendo la scheda col cursore ancora nel campo, la durata digitata sparisce',
    })
    .toBe('42');
});

test('Preferenze: uscendo dal campo prima di chiudere, la durata resta', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await digita(page, '#notifDuration', '37');
  await page.keyboard.press('Tab');
  await expect.poll(() => impostazioni(app).then(durataNotifiche), { timeout: 8000 }).toBe('37');

  await chiudiScheda(shell, 'preferences');
});

// ─── La conferma che parla di una modifica di prima ─────────────────────────

test('Preferenze: la conferma «Salvato» si spegne appena si digita un numero nuovo', async ({ shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#showHomeMessage', { timeout: 20_000 });
  const acceso = () => page.evaluate(() => document.getElementById('savedHint').classList.contains('sn-show'));

  await page.click('#showHomeMessage');
  await expect.poll(acceso, { timeout: 6000 }).toBe(true);
  expect(await acceso(), 'la conferma era già sparita da sola: prova da rifare').toBe(true);

  await page.click('#autoArchiveIdleHours');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('29');
  await page.waitForTimeout(100);

  expect(await acceso(),
    'la conferma resta accesa mentre il numero appena digitato non è ancora salvato')
    .toBe(false);

  await chiudiScheda(shell, 'preferences');
});
