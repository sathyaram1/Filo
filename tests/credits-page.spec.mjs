// Pagina Crediti del profilo (C2): saldo + grafico a torta del consumo per tipo
// d'uso. Asserisce il SUCCESSO della feature: il saldo riflette il consumo, e la
// torta ha una fetta per ogni tipo d'uso consumato (con l'etichetta giusta).
//
// Senza il fix la pagina filo://credits/credits.html non esiste: il test fallisce
// già all'apertura. Con il fix, ma con un grafico che non legge byUsage, le
// asserzioni sulle fette diventano rosse.

import { test, expect } from './fixtures/electron.mjs';

// Il bonus giornaliero "feedback autonomo" (+10) è ON di default e viene
// applicato quando la pagina Crediti chiede il saldo: sballerebbe i saldi attesi
// di questi test (1000 → 1010, ecc.). Lo disattiviamo nel seed così i saldi sono
// deterministici e riflettono SOLO il consumo che stiamo verificando.
async function disableAutoFeedbackBonus() {
  await globalThis.SN_STORAGE.updateSettings({ security: { autoFeedback: false } });
}

test('la pagina Crediti mostra saldo e una fetta per tipo d\'uso', async ({ app, openTab }) => {
  // Seed di consumo nel motore crediti (processo main): due tipi d'uso distinti.
  // 0.08€ → 100 crediti (correttore), 0.16€ → 200 crediti (chat). Saldo 1000-300.
  await app.evaluate(disableAutoFeedbackBonus);
  await app.evaluate(async () => {
    const C = globalThis.SN_CREDITS;
    await C.recordConsumption({ action: 'spellcheck_word', costEur: 0.08 });
    await C.recordConsumption({ action: 'filo_chat', costEur: 0.16 });
  });

  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');

  // Saldo: 1000 iniziali - 300 consumati = 700.
  await expect(page.locator('#balance')).toHaveText('700');

  // Una fetta per ogni tipo d'uso consumato, con l'etichetta del gruppo.
  await expect(page.locator('#chart [data-group]')).toHaveCount(2);
  await expect(page.locator('#chart [data-group="Chat con Filo"]')).toHaveCount(1);
  await expect(page.locator('#chart [data-group="Correttore ortografico"]')).toHaveCount(1);

  // La legenda elenca gli stessi gruppi con i crediti spesi.
  await expect(page.locator('#legend li[data-group="Chat con Filo"] .sn-credits-value')).toHaveText('200');
  await expect(page.locator('#legend li[data-group="Correttore ortografico"] .sn-credits-value')).toHaveText('100');
});

test('un consumo sotto il credito resta visibile (torta + saldo), non sparisce arrotondato', async ({ app, openTab }) => {
  // Uso leggero: due tipi d'uso che costano FRAZIONI di credito (0,3 e 0,4).
  // Prima del fix la pagina arrotondava all'intero ogni gruppo → entrambi a 0 →
  // torta vuota e "Non hai ancora consumato crediti", pur avendo usato Filo.
  await app.evaluate(disableAutoFeedbackBonus);
  await app.evaluate(async () => {
    const C = globalThis.SN_CREDITS;
    // costEur/0,0008 = crediti. 0,00024€ → 0,3 crediti; 0,00032€ → 0,4 crediti.
    await C.recordConsumption({ action: 'spellcheck_word', costEur: 0.00024 });
    await C.recordConsumption({ action: 'filo_chat', costEur: 0.00032 });
  });

  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');

  // La sezione consumo è visibile e lo stato vuoto è nascosto: il consumo c'è.
  await expect(page.locator('#usageSection')).toBeVisible();
  await expect(page.locator('#usageEmpty')).toBeHidden();

  // Una fetta per ciascun tipo d'uso, anche se sotto il credito.
  await expect(page.locator('#chart [data-group]')).toHaveCount(2);

  // La legenda mostra i crediti frazionari (formato italiano con la virgola).
  await expect(page.locator('#legend li[data-group="Correttore ortografico"] .sn-credits-value')).toHaveText('0,3');
  await expect(page.locator('#legend li[data-group="Chat con Filo"] .sn-credits-value')).toHaveText('0,4');

  // Il saldo riflette il consumo frazionario: 1000 - 0,7 = 999,3.
  await expect(page.locator('#balance')).toHaveText('999,3');
});

test('i movimenti recenti mostrano etichette specifiche per ogni tipo di ricompensa', async ({ app, openTab }) => {
  // Seed di ricompense di ogni tipo prodotto in produzione. Senza le etichette
  // mancanti, voto/rimborso/bonus cadrebbero tutti nel generico 'Ricompensa'.
  await app.evaluate(async () => {
    const C = globalThis.SN_CREDITS;
    await C.award({ kind: 'feedback_sent', credits: 5 });
    await C.award({ kind: 'feedback_resolved', credits: 200, ref: 'fb-1' });
    await C.award({ kind: 'feedback_voted', credits: 10, ref: 'fb-board-1' });
    await C.award({ kind: 'board_reopen_refund', credits: 5, ref: 'fb-2' });
    await C.award({ kind: 'auto_feedback_bonus', credits: 10 });
  });

  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');

  const labels = page.locator('#moves .sn-credits-move-label');
  // Almeno le 5 ricompense seminate (l'ambiente di test può aggiungere il bonus
  // giornaliero della segnalazione automatica, che ha comunque la sua etichetta).
  await expect(async () => {
    expect(await labels.count()).toBeGreaterThanOrEqual(5);
  }).toPass();

  // Ogni tipo ha la sua etichetta specifica: nessuno cade nel generico 'Ricompensa'.
  const texts = await labels.allTextContents();
  expect(texts).toContain('Feedback inviato');
  expect(texts).toContain('Feedback risolto');
  expect(texts).toContain('Voto in Bacheca');
  expect(texts).toContain('Rimborso «Ancora rotto?»');
  expect(texts).toContain('Bonus segnalazione automatica');
  expect(texts).not.toContain('Ricompensa');
});

test('la frase della ricarica giornaliera segue l\'importo in vigore, non un valore fisso', async ({ app, openTab }) => {
  // Simmetria col costo di riapertura in bacheca: la frase deve leggere l'importo
  // davvero accreditato, non una cifra scritta a mano. Con il valore di default
  // (100) la frase mostra "+100"; se l'importo cambia, la frase deve seguirlo.
  await app.evaluate(disableAutoFeedbackBonus);
  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');

  // Default in vigore: la frase riflette DAILY_REFILL letto dal codice, non una
  // costante nell'HTML.
  const refill = await page.evaluate(() => window.SN_CONST.CREDIT.DAILY_REFILL);
  await expect(page.locator('#refillHint')).toHaveText(
    `Ricevi +${refill} crediti ogni giorno a mezzanotte.`,
  );

  // Ora "l'owner cambia l'importo a 250": patchiamo il valore in vigore nel
  // contesto della pagina e forziamo un re-render (una qualsiasi variazione di
  // saldo ri-scatena il caricamento della pagina). Senza il fix la frase
  // resterebbe inchiodata a +100 (era scritta a mano nell'HTML): l'assert diventa
  // rosso. Col fix la frase segue il nuovo importo.
  await page.evaluate(() => { window.SN_CONST.CREDIT.DAILY_REFILL = 250; });
  await app.evaluate(async () => {
    await globalThis.SN_CREDITS.award({ kind: 'feedback_sent', credits: 1 });
  });
  await expect(page.locator('#refillHint')).toHaveText(
    'Ricevi +250 crediti ogni giorno a mezzanotte.',
  );
});

test('senza consumo la pagina Crediti mostra lo stato vuoto', async ({ app, openTab }) => {
  await app.evaluate(disableAutoFeedbackBonus);
  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('#balance')).toHaveText('1.000');
  await expect(page.locator('#usageEmpty')).toBeVisible();
  await expect(page.locator('#usageSection')).toBeHidden();
});
