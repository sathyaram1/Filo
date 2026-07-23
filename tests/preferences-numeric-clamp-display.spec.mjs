// Spec "Preferenze: valori numerici fuori scala riallineati al blur" (#232).
//
// Bug: nei campi 'Archivia dopo … (ore)' e 'Durata notifiche (secondi)' un
// numero fuori scala (999, o negativo -5) veniva SALVATO clampato ma il campo
// continuava a mostrare il numero digitato: l'utente credeva di aver impostato
// un valore diverso da quello in uso. Atteso: appena si lascia il campo, mostra
// il valore realmente salvato (clampato al range).
//
// Criterio di fatto: dopo il blur, (1) lo storage contiene il valore clampato e
// (2) il campo a schermo MOSTRA quel valore clampato, non il numero fuori scala.
// Il secondo assert è ciò che diventa rosso senza il fix.

import { test, expect } from './fixtures/electron.mjs';

const storedAutoArchive = (page) =>
  page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    return (r && r.settings && r.settings.autoArchive) || {};
  });

const storedNotifications = (page) =>
  page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    return (r && r.settings && r.settings.notifications) || {};
  });

test("'Archivia dopo … (ore)': 999 viene salvato come 168 e il campo mostra 168 al blur", async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#autoArchiveIdleHours');

  await page.fill('#autoArchiveIdleHours', '999');
  await page.locator('#autoArchiveIdleHours').blur();

  // Salvato clampato al massimo (168)…
  await expect.poll(() => storedAutoArchive(page).then((a) => a.idleHours)).toBe(168);
  // …e il campo NON mostra più 999 ma il valore realmente in uso.
  await expect(page.locator('#autoArchiveIdleHours')).toHaveValue('168');
});

test("'Durata' notifiche: -5 viene salvato come 5 e il campo mostra 5 al blur", async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#notifDuration');

  // -5 è fuori range (min 0): la logica di salvataggio ripiega sul predefinito 5.
  await page.fill('#notifDuration', '-5');
  await page.locator('#notifDuration').blur();

  await expect.poll(() => storedNotifications(page).then((n) => n.durationSec)).toBe(5);
  await expect(page.locator('#notifDuration')).toHaveValue('5');
});

test("'Durata' notifiche: 999 viene salvato come 120 e il campo mostra 120 al blur", async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#notifDuration');

  await page.fill('#notifDuration', '999');
  await page.locator('#notifDuration').blur();

  await expect.poll(() => storedNotifications(page).then((n) => n.durationSec)).toBe(120);
  await expect(page.locator('#notifDuration')).toHaveValue('120');
});

test("valore valido resta invariato al blur (nessun clamp spurio)", async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#autoArchiveIdleHours');

  await page.fill('#autoArchiveIdleHours', '48');
  await page.locator('#autoArchiveIdleHours').blur();
  await expect.poll(() => storedAutoArchive(page).then((a) => a.idleHours)).toBe(48);
  await expect(page.locator('#autoArchiveIdleHours')).toHaveValue('48');

  // 0 secondi è valido per le notifiche (= resta finché non la chiudi): non
  // deve essere trasformato nel predefinito.
  await page.fill('#notifDuration', '0');
  await page.locator('#notifDuration').blur();
  await expect.poll(() => storedNotifications(page).then((n) => n.durationSec)).toBe(0);
  await expect(page.locator('#notifDuration')).toHaveValue('0');
});
