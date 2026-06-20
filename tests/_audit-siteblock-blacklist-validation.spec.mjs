// AUDIT: il campo "blacklist" del blocco siti accetta voci non valide in
// silenzio, mentre il campo "siti fidati" (fix #218) le valida e avvisa.
// Un nome nudo come "facebook" (senza estensione) viene salvato ma non
// bloccherà mai un host reale: l'utente crede di aver bloccato il sito ma non
// è così, e non riceve alcun feedback. Questo spec dimostra l'asimmetria.

import { test, expect } from './fixtures/electron.mjs';

test('AUDIT blacklist accetta voci non valide senza feedback (asimmetria con siti fidati)', async ({ openTab }) => {
  const page = await openTab('filo://security/');
  await expect(page.locator('#sec-siteblock')).toBeAttached({ timeout: 8_000 });

  // Assicura che il blocco siti sia acceso così il campo blacklist è abilitato.
  const enabled = await page.locator('#sec-siteblock').isChecked();
  if (!enabled) await page.locator('#sec-siteblock').check();

  // 1) BLACKLIST: scrivo una voce palesemente non valida (nome nudo, senza
  //    estensione) + una valida. La voce non valida NON bloccherà nulla.
  const ta = page.locator('#sec-siteblock-blacklist');
  await ta.fill('facebook\nesempio-bloccato.com');
  await ta.blur(); // 'change' → save()
  await page.waitForTimeout(300);

  // Riapro la pagina: la voce non valida è persistita tale e quale, senza che
  // l'utente sia mai stato avvisato che "facebook" non bloccherà facebook.com.
  const page2 = await openTab('filo://security/');
  await expect(page2.locator('#sec-siteblock-blacklist')).toBeAttached({ timeout: 8_000 });
  const stored = await page2.locator('#sec-siteblock-blacklist').inputValue();
  expect(stored).toContain('facebook'); // accettata in silenzio
  // Non esiste alcun elemento d'avviso accanto al campo blacklist.
  const hasBlacklistError = await page2.locator('#sec-siteblock-blacklist-error').count();
  expect(hasBlacklistError).toBe(0);

  // 2) CONTRASTO — SITI FIDATI: la stessa voce non valida viene RIFIUTATA con
  //    un avviso inline (comportamento corretto, fix #218).
  const wlInput = page2.locator('#cookie-wl-input');
  await wlInput.fill('facebook');
  await page2.locator('#cookie-wl-add-btn').click();
  const err = page2.locator('#cookie-wl-error');
  await expect(err).toBeVisible();
  await expect(err).toContainText(/dominio valido/i);

  await page2.screenshot({ path: 'tests/.shots/audit-siteblock-blacklist-validation.png' });
});
