// VERIFICA #496 — giro 17. I due campi della finestra scritta a mano.
//
// «Scegli tu» apre due campi data che sono i controlli di serie del browser.
// Il pattern di Filo «Controlli UI custom: tema di Filo, non default del
// browser» dice che i controlli dell'interfaccia usano palette e comportamento
// del tema di Filo, mai i default del browser.
//
// Due conseguenze che si vedono:
//   · l'ordine delle date è quello della lingua del sistema (su un computer non
//     italiano «mm/dd/yyyy»), mentre tutte le altre date della scheda sono
//     scritte 25/8/2026;
//   · il calendario che si apre cliccando l'icona è quello chiaro del browser
//     anche quando Filo è sul tema scuro, perché la pagina non dichiara mai a
//     Chromium con che tema disegnare i controlli di serie.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa, segnalazione, apriStatistiche } from './giro17-aiuto-comune.mjs';

test('#496 giro17 — sul tema scuro i due campi data aprono il calendario chiaro del browser', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const fb = segnalazione({ seq: 995, createdAt: giorniFa(1) });
  await apriStatistiche(page, { feedbacks: [fb], workerLog: [] }, [fb]);

  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.locator('[data-fs-range="custom"]').click();
  await expect(page.locator('#mgFsCustom')).toBeVisible();

  // Il riquadro del campo segue il tema (fondo scuro): quello è a posto.
  const stile = await page.evaluate(() => {
    const i = document.getElementById('mgFsFrom');
    const s = getComputedStyle(i);
    return { colorScheme: s.colorScheme, bg: s.backgroundColor };
  });
  expect(stile.bg, 'il fondo del campo non segue il tema').not.toMatch(/rgb\(255, 255, 255\)/);

  // Quello che resta chiaro è ciò che disegna il browser: l'icona del
  // calendario e il calendario stesso. Su tema scuro vanno chiesti scuri.
  expect(stile.colorScheme, 'il calendario di serie resta quello chiaro sul tema scuro').toBe('dark');
});
