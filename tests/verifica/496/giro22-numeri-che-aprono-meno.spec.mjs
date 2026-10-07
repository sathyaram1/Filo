// VERIFICA #496 — giro 22. Un numero si apre su cosa ha contato
// (patterns/un-numero-si-apre-su-cosa-ha-contato.md). Quattro superfici della
// scheda dicono un numero e aprono un elenco che ne conta un altro, o non si
// aprono affatto mentre le loro gemelle sì — la
// stessa forma che il pattern descrive per «Esplorazioni lanciate»:
// «un numero che diceva cinque apriva un elenco di uno, e il tasto destro
// sopra quel cinque offriva "Mostra la segnalazione contata"».
//
//   1. «Feedback lavorati» conta anche le lavorazioni che il registro cita e
//      la lista non ha (la ripartizione le chiama «Non in questa lista»);
//      l'elenco che apre le lascia fuori.
//   2. «Lavorazioni arenate e rimesse in coda» conta ARENAMENTI (una
//      segnalazione arenata due volte vale due); l'elenco conta segnalazioni.
//   3. «Durata di una lavorazione · mediana su N» conta anche le lavorazioni
//      senza documento; l'elenco no.
//   4. «Controlli di sicurezza passati» conta segnalazioni come i due riquadri
//      accanto, ma il tasto destro sul suo numero non offre di mostrarle.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const DATI = {
  feedbacks: [
    fb({ _id: 'd1', seq: 901, status: 'done', createdAt: g(3), reviewedAt: g(2), name: 'primo', clientId: 'tester@example.com' }),
    // una sola segnalazione, arenata due volte
    fb({ _id: 'd2', seq: 902, status: 'working', createdAt: g(2), name: 'secondo', clientId: 'tester@example.com', stalls: 2 }),
  ],
  workerLog: [
    { role: 'fixer', startedAt: g(3), num: '901' },
    { role: 'verifier', startedAt: g(2), num: '901' },
    { role: 'fixer', startedAt: g(2), num: '902' },
    // 999: il registro lo cita, la lista non ce l'ha. Due istanti diversi:
    // entra anche nella mediana della durata.
    { role: 'fixer', startedAt: g(4), num: '999' },
    { role: 'verifier', startedAt: g(3), num: '999' },
  ],
};

/** Il numero grande di un riquadro e quante segnalazioni apre il suo elenco. */
async function numeroEdElenco(page, id) {
  return page.evaluate((tileId) => {
    const el = document.querySelector(`[data-fs-id="${tileId}"]`);
    if (!el) return { manca: true };
    const grande = el.querySelector('.mg-tile-n').textContent.trim();
    const sotto = (el.querySelector('.mg-tile-sub') || {}).textContent || '';
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 }));
    const voci = [...document.querySelectorAll('.mg-ctxmenu .sn-select-option')].map((o) => o.textContent.trim());
    const mostra = [...document.querySelectorAll('.mg-ctxmenu .sn-select-option')].find((o) => /^Mostra /.test(o.textContent));
    let elenco = 0;
    let titolo = '';
    if (mostra) {
      mostra.click();
      elenco = document.querySelectorAll('#mgFsDrillList li').length;
      titolo = document.getElementById('mgFsDrillTitle').textContent.trim();
    }
    document.querySelectorAll('.mg-ctxmenu').forEach((m) => m.remove());
    return { grande, sotto: sotto.trim(), voci, elenco, apre: !!mostra, titolo };
  }, id);
}

test('#496 giro22 — «Feedback lavorati» apre tutte le lavorazioni che ha contato', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  const r = await numeroEdElenco(page, 'lavorati');
  expect(
    r.elenco,
    `il riquadro «Feedback lavorati» scrive ${r.grande}, il menu del tasto destro offre «${r.voci.join(' / ')}» `
      + `e l'elenco che si apre porta ${r.elenco} righe («${r.titolo}»)`,
  ).toBe(Number(r.grande));
});

test('#496 giro22 — «Lavorazioni arenate» non promette segnalazioni che non ha', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  const r = await numeroEdElenco(page, 'arenati');
  // Il numero grande conta ARENAMENTI, non segnalazioni: o apre quello che ha
  // contato, o — come «Esplorazioni lanciate» — non si apre affatto e lascia
  // aprire la riga piccola, che le segnalazioni le conta davvero.
  expect(
    r.apre && r.elenco !== Number(r.grande),
    `il riquadro scrive ${r.grande} in grande e «${r.sotto}» sotto; il tasto destro sul numero grande offre `
      + `«${r.voci.join(' / ')}» e apre un elenco di ${r.elenco}`,
  ).toBe(false);
});

test('#496 giro22 — «Durata di una lavorazione» apre tutte le lavorazioni che ha misurato', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  await apriStatistiche(page, DATI, DATI.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  const r = await numeroEdElenco(page, 'durata');
  const quante = Number((r.sotto.match(/mediana su (\d+)/) || [])[1] || 0);
  expect(
    r.elenco,
    `il riquadro «Durata di una lavorazione» dichiara «${r.sotto}» e l'elenco che apre porta ${r.elenco} righe`,
  ).toBe(quante);
});

test('#496 giro22 — «Controlli di sicurezza passati» si apre su cosa ha contato', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const dati = {
    feedbacks: [
      fb({ _id: 'e1', seq: 911, status: 'done', createdAt: g(3), name: 'primo', clientId: 'tester@example.com', livelli: { l4: { esito: 'pass' } } }),
      fb({ _id: 'e2', seq: 912, status: 'done', createdAt: g(3), name: 'secondo', clientId: 'tester@example.com', livelli: { l4: { esito: 'saltato' } } }),
    ],
    workerLog: [
      { role: 'fixer', startedAt: g(3), num: '911' },
      { role: 'verifier', startedAt: g(3), num: '911' },
      { role: 'fixer', startedAt: g(3), num: '912' },
      { role: 'verifier', startedAt: g(3), num: '912' },
    ],
  };
  await apriStatistiche(page, dati, dati.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  // Il metro: il riquadro gemello «Feedback ricevuti», che come questo si
  // espande, offre ANCHE di mostrare le segnalazioni che ha contato.
  const metro = await numeroEdElenco(page, 'ricevuti');
  const r = await numeroEdElenco(page, 'audit');
  expect(
    r.apre,
    `«Controlli di sicurezza passati» scrive ${r.grande} e al tasto destro offre «${r.voci.join(' / ')}»; `
      + `il riquadro gemello «Feedback ricevuti», che conta segnalazioni come lui, offre «${metro.voci.join(' / ')}»`,
  ).toBe(true);
});

test('#496 giro22 — i lavori che la torta lascia fuori si possono vedere', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);
  const dati = {
    feedbacks: [
      // passato, ma nel registro non c'è nessuna sua verifica: la torta lo
      // lascia fuori e lo dichiara in una frase.
      fb({ _id: 'f1', seq: 921, status: 'done', createdAt: g(4), name: 'vecchio', clientId: 'tester@example.com' }),
      fb({ _id: 'f2', seq: 922, status: 'done', createdAt: g(3), name: 'recente', clientId: 'tester@example.com' }),
    ],
    workerLog: [
      { role: 'fixer', startedAt: g(4), num: '921' },
      { role: 'fixer', startedAt: g(3), num: '922' },
      { role: 'verifier', startedAt: g(3), num: '922' },
    ],
  };
  await apriStatistiche(page, dati, dati.feedbacks);
  await page.locator('[data-fs-range="tutto"]').click();

  const r = await page.evaluate(() => {
    const el = document.getElementById('mgFsPieHint');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 30 }));
    const voci = [...document.querySelectorAll('.mg-ctxmenu .sn-select-option')].map((o) => o.textContent.trim());
    document.querySelectorAll('.mg-ctxmenu').forEach((m) => m.remove());
    return { frase: el.textContent.replace(/\s+/g, ' ').trim(), voci };
  });
  expect(r.frase).toContain('più vecchie del registro');
  expect(
    r.voci.some((v) => /^Mostra /.test(v)),
    `la frase sotto il titolo dice «${r.frase.slice(-120)}» e non porta da nessuna parte: `
      + `il tasto destro offre «${r.voci.join(' / ') || 'niente di suo: esce il menu generale della pagina'}», `
      + 'mentre i tre numeri subito sotto la torta aprono tutti l\'elenco di quello che hanno contato',
  ).toBe(true);
});
