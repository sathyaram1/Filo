// VERIFICA #496 — giro 21. «Esplorazioni lanciate» apre un elenco che non è
// quello che il suo numero conta.
//
// Il riquadro scrive in grande quante volte è partita l'esplorazione (una
// partenza, non una segnalazione) e sotto, in piccolo, quante segnalazioni
// l'esploratore ha mandato. Cliccandolo si apre l'elenco delle SEGNALAZIONI:
// un numero che ne dice dodici apre un elenco di tre, e il tasto destro sopra
// quel dodici offre «Mostra le 3 segnalazioni contate». È la regola che questo
// stesso lavoro ha scritto — un numero si apre su cosa ha contato — applicata
// al numero sbagliato, ed è il rilievo del giro 11 su una superficie nuova.
//
// Senza il fix il controllo è rosso: il numero grande e l'elenco che si apre
// dicono due cifre diverse.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'x1', seq: 401, status: 'todo', createdAt: g(2), clientId: 'routine:prober' }),
    fb({ _id: 'x2', seq: 402, status: 'todo', createdAt: g(2), clientId: 'tizio@x.it' }),
  ],
  // Cinque partenze dell'esploratore, una sola segnalazione trovata.
  workerLog: [
    { role: 'prober', startedAt: g(3) },
    { role: 'prober', startedAt: g(2.5) },
    { role: 'prober', startedAt: g(2) },
    { role: 'prober', startedAt: g(1.5) },
    { role: 'prober', startedAt: g(1) },
  ],
};

test('#496 giro21 — il numero di «Esplorazioni lanciate» e l\'elenco che apre dicono la stessa cifra', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  const numero = (await page.locator('[data-fs-id="prober"] .mg-tile-n').textContent()).trim();
  expect(numero, 'le partenze dell\'esploratore non sono cinque: controllo da riscrivere').toBe('5');

  // Il tasto destro sul numero grande: cosa promette di mostrare.
  const voci = await page.evaluate(() => {
    const n = document.querySelector('[data-fs-id="prober"] .mg-tile-n');
    n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
    const v = [...document.querySelectorAll('.mg-ctxmenu .sn-select-option')].map((o) => o.textContent);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return v;
  });
  const mostra = voci.find((v) => /Mostra/.test(v)) || '';

  // Il clic: quante segnalazioni apre davvero.
  await page.locator('[data-fs-id="prober"]').click();
  const apertoOra = !(await page.locator('#mgFsDrill').isHidden());
  const titolo = apertoOra ? (await page.locator('#mgFsDrillTitle').textContent()).trim() : '';
  const aperte = apertoOra ? Number((titolo.match(/·\s*(\d+)/) || [])[1]) : null;

  // L'invariante: o il riquadro apre esattamente quello che il suo numero
  // conta, oppure non promette di aprire niente (una partenza non è una
  // segnalazione, e la regola dice che dove non c'è niente da aprire la
  // superficie non finge).
  const coerente = !apertoOra || aperte === Number(numero);
  expect(
    coerente,
    `il riquadro scrive «${numero}», il tasto destro offre «${mostra}» e il clic apre «${titolo}»: `
      + 'il numero in grande e l\'elenco che si apre da lui non sono la stessa cosa',
  ).toBe(true);
});
