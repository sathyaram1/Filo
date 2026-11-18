// I tasti della home (#2372) per gli spec: la ricerca nel filo si apre dal suo tasto, Impostazioni e Profilo sono tasti
// di «altro» (il Profilo di serie sta nel «+»). Una strada sola, così uno spec non riscrive i selettori a mano.
import { expect } from '@playwright/test';

// La home intera: finché l'accoglienza non si chiude la home del primo incontro tiene solo la sinistra (#1661), e i
// tasti stanno in «altro». Va chiamata prima di aprire la home.
export async function homeIntera(app) {
  await app.evaluate(async () => { await chrome.storage.local.set({ filo_onboarding: { done: true } }); });
}

export const TASTO = (id) => `#altro .dash-altro-app[data-tasto="1"][data-id="${id}"]`;

// Il campo della ricerca, aperta col clic sul suo tasto come farebbe l'utente; se il tasto non è in vista (nel «+», o la
// home del primo incontro) la si apre come la apre «cerca nel filo» dalla chat.
export async function campoRicerca(page) {
  const campo = page.locator('#cercaInput');
  if (await campo.isVisible().catch(() => false)) return campo;
  const tasto = page.locator(`.dash-altro-griglia.vista ${TASTO('cerca').replace('#altro ', '')}`);
  if (await tasto.isVisible().catch(() => false)) await tasto.click();
  else await page.evaluate(() => window.SN_DASH_CERCA.apri());
  await expect(campo).toBeVisible({ timeout: 10_000 });
  return campo;
}

// Il tasto di un comando della shell (impostazioni, profilo): se sta nel «+» il «+» si apre prima.
export async function tastoHome(page, id) {
  const b = page.locator(TASTO(id)).first();
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  if (!(await b.isVisible().catch(() => false))) {
    await page.locator('#altroPiu').click();
    await expect(b).toBeVisible();
  }
  return b;
}
