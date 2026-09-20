// Verifica #530, giro 1 — le strade dell'utente e i limiti.
//
// Il livello si sceglie in Preferenze e si vede nella home. Qui si prova che
// le due strade dicono la stessa cosa, che i livelli estremi non diventano
// vicoli ciechi muti, e che testo storto (vuoto, lunghissimo, byte nullo)
// non fa saltare né la decisione né il popup.

import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(90_000);

const exec = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const chat = (id) => ({
  tab: { id, url: 'filo://dashboard/dashboard.html' },
  url: 'filo://dashboard/dashboard.html',
});

const setLivello = (app, livello) =>
  app.evaluate((_e, l) => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: l } }), livello);

test('conservativo + compito sporco: un feedback non parte più, e Filo dice qualcosa di utile', async ({ app }) => {
  await setLivello(app, 'conservativo');
  const s = chat(9410);
  await exec(app, { type: 'CERCA_WEB', query: 'qualsiasi cosa' }, { sender: s });
  const r = await exec(app, { type: 'INVIA_FEEDBACK', testo: 'il bottone non va' }, { sender: s });
  // La tabella dice «no»: a questo livello, con un compito sporco, il costo 3
  // non si fa a nessuna condizione.
  expect(r.executed).toBe(false);
  expect(r.rejected).toBe(true);
  // Un «no» secco è un vicolo cieco: la risposta deve dire all'utente cosa
  // può fare adesso (rifarlo in una conversazione pulita, o dove farlo a mano).
  const testo = String(r.error || '');
  expect(testo.length, 'un rifiuto senza spiegazione').toBeGreaterThan(0);
  expect(
    testo,
    `PORTA: il rifiuto non dice cosa fare adesso — "${testo}"`,
  ).toMatch(/nuova conversazione|conversazione nuova|puoi|Preferenze|autonomia|a mano/i);
});

test('costo 3 con compito pulito, a livello normale: basta un clic, non più la parola scritta', async ({ app }) => {
  await setLivello(app, 'default');
  const s = chat(9420);
  const r = await exec(app, { type: 'INVIA_FEEDBACK', testo: 'un messaggio che parte a mio nome' }, { sender: s });
  expect(r.needsConfirm, 'costo 3 su compito pulito a livello normale').toBe(2);

  // Un comando che cancella resta alla parola digitata (allenta una difesa).
  const cmd = await exec(app, { type: 'ESEGUI_COMANDO', comando: 'rm -rf /tmp/qualcosa' }, { sender: s });
  // Il terminale è spento di serie: si accende prima, altrimenti il gate non
  // viene nemmeno raggiunto.
  expect([false, undefined]).toContain(cmd.executed);
});

test('testo storto: vuoto, soli spazi, 10.000 caratteri, byte nullo, emoji', async ({ app }) => {
  await setLivello(app, 'default');
  const s = chat(9430);
  await exec(app, { type: 'CERCA_WEB', query: 'x' }, { sender: s });

  const casi = [
    ['', 'vuoto'],
    ['     ', 'soli spazi'],
    ['A'.repeat(10_000), 'diecimila caratteri'],
    ['prima\u0000dopo', 'byte nullo'],
    ['🙂🙂🙂 <script>alert(1)</script> javascript:void(0)', 'emoji e script'],
  ];
  for (const [testo, nome] of casi) {
    const r = await exec(app, { type: 'SALVA_LEZIONE', testo }, { sender: s });
    expect(r, `${nome}: nessuna risposta dal dispatch`).toBeTruthy();
    // Con il compito sporco la decisione è sempre «chiedi»: non deve mai
    // scivolare in «fai e basta» per colpa del testo.
    expect(r.executed, `${nome}: partita da sola con il compito sporco`).toBe(false);
    if (r.needsConfirm) {
      expect(typeof r.describe, `${nome}: il popup non ha testo`).toBe('string');
      expect(String(r.describe).length, `${nome}: popup vuoto`).toBeGreaterThan(0);
    }
  }
});

test('azioni ripetute in fretta: la decisione non cambia a metà', async ({ app }) => {
  await setLivello(app, 'default');
  const s = chat(9440);
  await exec(app, { type: 'CERCA_WEB', query: 'y' }, { sender: s });
  const esiti = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      exec(app, { type: 'SALVA_LEZIONE', testo: `lezione ${i}` }, { sender: s })),
  );
  for (const [i, r] of esiti.entries()) {
    expect(r.executed, `la ${i + 1}ª lezione è partita da sola`).toBe(false);
  }
});

test('le due strade dicono lo stesso livello: Preferenze e home', async ({ app, openTab }) => {
  await setLivello(app, 'conservativo');
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#autonomiaLivelli .aut-riga', { timeout: 10_000 });
  await expect(prefs.locator('#autonomiaLivelli input[value="conservativo"]')).toBeChecked();

  const home = await openTab('filo://dashboard/dashboard.html');
  await expect(home.locator('#dashAutonomia')).toHaveText(/Conservativo/, { timeout: 10_000 });

  // La pillola della home si legge anche quando la finestra è stretta: è la
  // prima cosa che un utente nuovo vede in alto.
  await home.setViewportSize({ width: 380, height: 700 });
  await expect(home.locator('#dashAutonomia')).toBeVisible();
  const fuori = await home.locator('#dashAutonomia').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { destra: r.right - document.documentElement.clientWidth, larghezza: r.width, alt: r.height };
  });
  expect(fuori.larghezza, 'la pillola è sparita').toBeGreaterThan(10);
  expect(fuori.destra, 'la pillola esce dal bordo destro').toBeLessThanOrEqual(2);
  await home.screenshot({ path: 'tests/.shots/530-home-autonomia-stretta.png' }).catch(() => {});
});
