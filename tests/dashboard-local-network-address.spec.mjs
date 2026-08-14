// #433 — Dal campo "nuova scheda" della dashboard:
//
//  (A) "/nas.lan" (un nome della RETE DI CASA: .lan, .local, .home, .box…) deve
//      APRIRSI. Il controllo "questo indirizzo esiste?" interroga il DNS
//      pubblico, che questi nomi non li conosce per definizione: li dichiarava
//      inesistenti, l'input diventava rosso e premendo invio non succedeva
//      NIENTE. localhost e gli IP privati erano già esclusi dal controllo:
//      mancava la simmetria per i nomi con il punto.
//
//  (B) quando l'indirizzo davvero non esiste (errore di battitura), l'invio non
//      deve restare in SILENZIO: Filo lo dice e offre di aprire lo stesso.
//      Prima non compariva nulla — indistinguibile da un tasto invio rotto.
//
// Entrambi ASSERISCONO il successo (scheda aperta / risposta visibile a schermo),
// non l'assenza di un errore. Senza il fix (A) nessuna scheda nas.lan compare e
// (B) la chat resta vuota.

import { test, expect } from './fixtures/electron.mjs';

const FAKE = 'nonesistedavvero-xyz-433.io'; // non registrato: il DNS risponde ENOTFOUND

// Il controllo esistenza ha senso solo dove il DNS funziona davvero. Se la
// macchina di test non ha risoluzione DNS, ogni host risulta "in dubbio → esiste"
// e questi spec non proverebbero niente: meglio saltarli che essere verdi a caso.
async function dnsWorks(dash) {
  const r = await dash.evaluate((h) => window.filo.siteResolves({ host: h }), FAKE);
  return !!(r && r.resolves === false);
}

async function findPage(app, needle, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = app.windows().find((w) => {
      try { return w.url().includes(needle); } catch (_) { return false; }
    });
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('#433 "/nas.lan" apre l’indirizzo della rete di casa invece di non fare nulla', async ({ app, openTab }) => {
  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  test.skip(!(await dnsWorks(dash)), 'nessuna risoluzione DNS su questa macchina');

  // (1) Il controllo esistenza NON deve più bocciare i nomi di rete locale.
  //     Prima del fix ognuno di questi tornava resolves:false.
  for (const host of ['nas.lan', 'raspberrypi.local', 'stampante.home', 'fritz.box']) {
    const r = await dash.evaluate((h) => window.filo.siteResolves({ host: h }), host);
    expect(r && r.resolves, `${host} deve poter essere aperto`).toBe(true);
  }

  // (2) End-to-end: si scrive e si preme invio → la scheda si apre DAVVERO.
  await input.fill('/nas.lan:8080');
  await input.press('Enter');

  // La scheda esiste: o è sull'indirizzo, o (se in questa rete nas.lan non
  // risponde) sulla pagina d'errore di Filo, che porta l'indirizzo con sé.
  // In entrambi i casi qualcosa è successo — che è esattamente ciò che mancava.
  const page = await findPage(app, 'nas.lan');
  expect(page, 'premendo invio deve aprirsi una scheda su nas.lan').toBeTruthy();

  // Il campo si è svuotato (comando eseguito) e l'indirizzo non è finito in chat.
  await expect(input).toHaveValue('');
});

test('#433 un indirizzo inesistente riceve una risposta (e si può aprire lo stesso)', async ({ app, openTab }) => {
  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  test.skip(!(await dnsWorks(dash)), 'nessuna risoluzione DNS su questa macchina');

  await input.fill(`/${FAKE}`);
  await input.press('Enter');

  // (1) Filo risponde: prima qui non compariva NULLA.
  const bubble = dash.locator('.dash-bubble-filo', { hasText: FAKE });
  await expect(bubble).toBeVisible({ timeout: 8000 });

  // (2) Il testo resta nel campo: se era un errore di battitura si corregge
  //     senza doverlo riscrivere.
  await expect(input).toHaveValue(`/${FAKE}`);

  // (3) L'utente può insistere: "Apri comunque" apre davvero la scheda.
  const openAnyway = bubble.locator('.dash-action-btn', { hasText: 'Apri comunque' });
  await expect(openAnyway).toBeVisible();
  await openAnyway.click();

  const page = await findPage(app, FAKE);
  expect(page, '"Apri comunque" deve aprire la scheda').toBeTruthy();
  await expect(input).toHaveValue('');
});
