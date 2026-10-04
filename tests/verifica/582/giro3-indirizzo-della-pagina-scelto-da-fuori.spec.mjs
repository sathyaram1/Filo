// Verifica #582, giro 3 — la TERZA porta della stessa causa.
//
// La causa, trovata al giro 1 e ripresa al giro 2: dentro una segnalazione ci
// sono indirizzi che NON li sceglie Filo. Li scrive chi manda la segnalazione,
// e una segnalazione la manda chiunque, anche senza account e senza avere Filo
// installato (le regole del database controllano la forma dei campi, non dove
// puntano). Il giro 1 ha chiuso la porta della credenziale dell'owner; il giro
// 2 ha chiuso la pillola dell'allegato, che diventava un collegamento verso
// l'indirizzo scritto da chi mandava.
//
// Nella stessa scheda, due righe sopra la pillola, c'è l'indirizzo della PAGINA
// da cui la segnalazione è partita. Quello è ancora un collegamento cliccabile
// verso un indirizzo scelto da chi manda — e qui c'è qualcosa in più: la scritta
// del collegamento era l'indirizzo TAGLIATO agli 80 caratteri, senza puntini né
// altro segno che dicesse che continuava. Chi lo costruisce apposta sceglie cosa
// cade dentro quegli 80 caratteri.
//
// ⚠️ Nota per chi legge la critica del giro 3: l'indirizzo d'esempio scritto lì
// (la chiocciola DOPO la prima barra) non è un'esca — la chiocciola finisce nel
// percorso e il sito resta filo.app. Le due forme che funzionano davvero sono
// quelle provate qui sotto, e sono quelle che la correzione chiude.
//
// Cosa deve restare vero: quello che si legge dice dove si va.

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';
const VERO_POSTO = 'sito-di-un-estraneo.invalid';

// Due modi di riempire gli 80 caratteri che si leggono, tutti e due veri.
const ESCHE = [
  // 1. Sottodomini: il sito è davvero quello scritto in fondo, ma in fondo non
  //    ci si arriva. I primi 80 caratteri dicono «filo.app.guida…».
  ['sottodomini', `https://filo.app.guida.aggiornamento-obbligatorio.per-i-tester.settembre-2026.${VERO_POSTO}/accedi`],
  // 2. Credenziali davanti alla chiocciola: non sono il sito, e riempiono la
  //    scritta fino a nascondere anche la chiocciola.
  ['chiocciola', `https://filo.app-aggiornamento-obbligatorio-per-i-tester-di-settembre-2026-okay@${VERO_POSTO}/accedi`],
];

async function schedaCon(page, url) {
  await page.evaluate((u) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'esca-pagina-582',
      status: 'open',
      text: 'la pagina non si apre',
      url: u,
      images: [],
      files: [],
      createdAt: new Date().toISOString(),
    }];
  }, url);
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });
}

for (const [nome, esca] of ESCHE) {
  test(`l’indirizzo della pagina (esca «${nome}») non diventa un collegamento che mente sulla destinazione`, async ({ openTab }) => {
    const page = await openTab(FEEDBACK_URL);
    await schedaCon(page, esca);
    await page.screenshot({ path: `tests/.shots/582-giro3-esca-${nome}.png` });

    const link = page.locator('.fb-meta a[href^="http"]');
    if ((await link.count()) === 0) return; // nessun collegamento: porta chiusa.

    const scritta = (await link.first().textContent()) || '';
    const href = (await link.first().getAttribute('href')) || '';
    const dove = new URL(href).host;

    expect(
      scritta,
      `il riquadro dei feedback porta su «${dove}» mostrando la scritta «${scritta}», che quel posto non lo nomina`,
    ).toContain(VERO_POSTO);
    // E le credenziali, che servono solo a mentire, non si mostrano mai.
    expect(scritta, `la scritta mostra ancora l’esca: «${scritta}»`).not.toContain('filo.app');
  });
}

// La seconda metà: non è solo una scritta che mente, il clic ci porta davvero.
test('il clic su quel collegamento porta Filo sul sito dell’estraneo', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await schedaCon(page, ESCHE[0][1]);

  const link = page.locator('.fb-meta a[href^="http"]');
  if ((await link.count()) === 0) return; // porta chiusa: niente da misurare.

  // Il collegamento resta (serve: è il posto dove il problema è successo). Qui
  // si misura solo che chi lo preme sa dove sta andando: la scritta lo dice.
  const scritta = (await link.first().textContent()) || '';
  await link.first().click();
  await page.waitForTimeout(2500);
  const aperte = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().map((w) => {
    try { return w.getURL(); } catch (_) { return ''; }
  }));
  const andata = aperte.some((u) => u.includes(VERO_POSTO));
  if (!andata) return; // non ci ha portato: niente da dire.
  expect(
    scritta,
    `Filo è andato su «${VERO_POSTO}» e la scritta su cui si è cliccato («${scritta}») non lo nominava`,
  ).toContain(VERO_POSTO);
});
