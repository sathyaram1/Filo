// VERIFICA #496 — giro 21. Il giro di aggiornamento butta via il fuoco.
//
// La pagina di gestione si rimette in pari da sola ogni minuto, e da quando la
// scheda delle statistiche segue quel giro (giri 16, 18 e 20) si ridisegna
// anche lei — sempre, anche quando non è cambiato niente, perché il registro
// delle routine può essere cresciuto per conto suo. Il ridisegno riscrive
// dall'inizio le pasticche, i riquadri, la legenda e l'elenco aperto: chi sta
// navigando la scheda da tastiera si ritrova il fuoco sul nulla, e il tasto
// TAB riparte dall'inizio della pagina. Succede una volta al minuto, senza che
// niente lo annunci.
//
// La stessa scheda già si guarda da questo, ma su una superficie sola: i due
// campi della finestra scritta a mano non vengono riscritti mentre ci si sta
// scrivendo dentro. E il resto della pagina fa lo stesso: la lista a sinistra
// si tiene il suo scorrimento e la conversazione aperta non si ridisegna
// mentre la si sta scrivendo.
//
// Senza il fix il controllo è rosso: dopo un ridisegno il fuoco è sul corpo
// della pagina, su tutte e cinque le superfici.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const molti = [];
for (let i = 0; i < 40; i++) {
  molti.push(fb({ _id: 'f' + i, seq: 600 + i, status: i % 3 ? 'done' : 'design', createdAt: g(3), reviewedAt: g(2) }));
}
const DATI = {
  feedbacks: molti,
  workerLog: molti.map((f) => ({ role: 'verifier', startedAt: g(2), num: String(f.seq) })),
};

test('#496 giro21 — il giro di aggiornamento non porta via il fuoco della tastiera', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.evaluate((d) => { window.__D496 = d; }, DATI);
  await page.locator('[data-fs-range="tutto"]').click();

  // L'elenco dietro un numero, aperto: è la superficie con più righe.
  await page.evaluate(() => {
    const n = document.querySelector('[data-fs-id="ricevuti"] .mg-tile-n');
    n.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
    document.querySelector('.mg-ctxmenu .sn-select-option').click();
  });
  await expect(page.locator('#mgFsDrill')).toBeVisible();

  const porte = [
    ['[data-fs-range="7g"]', 'una pasticca della finestra'],
    ['[data-fs-creator="__routine"]', 'una pasticca del creatore'],
    ['[data-fs-tile="ricevuti"]', 'un riquadro'],
    ['#mgFsLegend li[data-group]', 'una voce di legenda'],
    ['.mg-fs-drill-row:not([disabled])', 'una riga dell\'elenco aperto'],
  ];

  // Il nodo, dopo il ridisegno, non è più lo stesso oggetto: quello che deve
  // restare è il POSTO, cioè che il fuoco sia ancora sulla stessa superficie.
  const persi = await page.evaluate((lista) => {
    const out = [];
    for (const [sel, nome] of lista) {
      const el = document.querySelector(sel);
      if (!el) { out.push(nome + ' (non trovata)'); continue; }
      el.focus();
      if (document.activeElement !== el) { out.push(nome + ' (non prende il fuoco)'); continue; }
      // Il giro della pagina: gli stessi dati di prima, ridisegnati.
      window.__mgTest.setFsData(window.__D496);
      const dopo = document.activeElement;
      if (!dopo || dopo === document.body || !dopo.matches(sel)) {
        out.push(`${nome} (il fuoco è finito su ${dopo ? dopo.tagName.toLowerCase() : 'niente'})`);
      }
    }
    return out;
  }, porte);

  expect(
    persi,
    `dopo un giro di aggiornamento il fuoco della tastiera se n'è andato da: ${persi.join(', ')}`,
  ).toEqual([]);
});
