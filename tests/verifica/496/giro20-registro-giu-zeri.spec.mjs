// VERIFICA #496 — giro 20. Il registro non si legge: tre zeri sicuri.
//
// Quando la lettura del registro delle esecuzioni fallisce (rete giù, errore
// del server, sessione dell'owner scaduta) i tre riquadri che si nutrono di
// quel registro — «Feedback lavorati», «Esplorazioni lanciate», «Lanci delle
// routine» — scrivono uno 0 grande, che si legge «non è partito niente»: il
// contrario di «non lo so». Nella stessa schermata, davanti a un dato che
// manca, «Attesa prima che tu lo prendessi in mano» e «Durata di una
// lavorazione» scrivono un trattino: due risposte diverse alla stessa domanda.
//
// È la porta del giro 3 (strada 1: «il registro non si legge, per la rete o
// per un errore del server»), che allora era stata chiusa.
//
// Senza il fix il controllo è rosso: i tre riquadri scrivono «0» e non c'è
// niente, sul riquadro, che dica che quel numero non si conosce.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'z1', seq: 901, status: 'done',    createdAt: g(3) }),
    fb({ _id: 'z2', seq: 902, status: 'working', createdAt: g(2) }),
  ],
  // Il registro NON si è letto: nessuna voce, e `logOk` falso.
  workerLog: [],
};

// Il numero e il sottotitolo di un riquadro.
const tile = async (page, id) => page.evaluate((k) => {
  const el = document.querySelector(`[data-fs-id="${k}"]`);
  if (!el) return null;
  const n = el.querySelector('.mg-tile-n');
  const s = el.querySelector('.mg-tile-sub');
  return { n: n ? n.textContent.trim() : '', sub: s ? s.textContent.trim() : '' };
}, id);

test('#496 giro20 — col registro irraggiungibile i suoi numeri non sono zeri sicuri', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.evaluate(() => window.__mgTest.setFsRange('30g'));
  await page.evaluate((d) => window.__mgTest.setFsData(Object.assign({}, d, { logOk: false })), DATI);

  // Le due tessere che NON dipendono dal registro fanno la cosa giusta: davanti
  // a un dato che non c'è scrivono un trattino. È il metro di questa scheda.
  const attesa = await tile(page, 'attesa');
  expect(attesa.n, 'la tessera «Attesa» non scrive più un trattino: cambiato il metro, questo controllo va riscritto').toBe('—');

  // «Non lo so» si può dire in due modi: col trattino, come le vicine, oppure
  // scrivendolo sul riquadro. Quello che non si può fare è uno 0 muto.
  for (const [id, nome] of [['lavorati', 'Feedback lavorati'], ['prober', 'Esplorazioni lanciate'], ['lanci', 'Lanci delle routine']]) {
    const t = await tile(page, id);
    const zeroMuto = t.n === '0' && !/non |—|sconosciut|nessun dato|non si sa|non letto|non arriv/i.test(t.sub);
    expect(zeroMuto, `«${nome}» scrive «${t.n}»${t.sub ? ` · «${t.sub}»` : ''} mentre il registro non si è letto: è un numero non conosciuto scritto come un dato`).toBe(false);
  }

  // E la sezione della torta non può affermare che nessun lavoro è stato
  // verificato: quello che è successo non l'ha letto nessuno.
  const sezione = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('#mgFsBody h3')).find((x) => /Quanto è costato/.test(x.textContent));
    return h ? h.closest('section').innerText.replace(/\s+/g, ' ') : '';
  });
  expect(sezione, 'la sezione della torta non si trova: controllo da riscrivere').not.toBe('');
  expect(
    /Nessun lavoro verificato/i.test(sezione),
    `la sezione della torta scrive «Nessun lavoro verificato» mentre il registro non si è letto: «${sezione}»`,
  ).toBe(false);
  expect(
    /non si sa|non si è letto|non letto|non raggiungibile|non arriv/i.test(sezione),
    `la sezione della torta non dice che il registro non si è letto: «${sezione}»`,
  ).toBe(true);
});
