// Verifica #496 — giro 7. Le porte dei sei giri passati, riprovate sulla
// scheda «Statistiche feedback» com'è oggi.
//
// Ogni prova asserisce quello che l'OWNER vede: il colore della fetta, il
// numero scritto nella tessera, la frase che dichiara cosa manca.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const ora = Date.now();
const iso = (giorniFa) => new Date(ora - giorniFa * 24 * 3600 * 1000).toISOString();

// Un verbale di verifica come lo scrive il server: `giri` critiche e poi il pass.
function conGiri(n) {
  const blocchi = [];
  for (let i = 0; i < n; i += 1) {
    blocchi.push(
      'Verifica: 1 rilievo.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo qualunque',
      '',
      `--- Aggiornamento dell'agente del 0${i + 1}/09/2026, 10:00 ---`,
      'Corretto.',
      '',
    );
  }
  blocchi.push('Verifica superata.');
  return blocchi.join('\n');
}

function lavoro(id, seq, giri, over) {
  return Object.assign({
    _id: id, seq, subSeq: 0, clientId: 'tester@example.com',
    text: 'segnalazione di prova', status: 'done',
    createdAt: iso(9), _updateTime: iso(2), notes: conGiri(giri),
  }, over || {});
}

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
}

// Il colore che l'owner vede accanto alla voce di legenda.
async function coloreDi(page, etichetta) {
  return page.evaluate((label) => {
    const li = Array.from(document.querySelectorAll('#mgStPieLegend li'))
      .find((el) => el.textContent.includes(label));
    if (!li) return null;
    const sw = li.querySelector('.mg-st-swatch');
    return sw ? getComputedStyle(sw).backgroundColor : null;
  }, etichetta);
}

test('la scala dei colori della torta dice se il numero è buono, non in che ordine è capitato', async ({ openTab }) => {
  const page = await openTab(URL);
  // Nessun lavoro passato al primo colpo: solo 2 e 5 critiche.
  await apri(page, [lavoro('a', 201, 2), lavoro('b', 202, 5)]);

  await expect(page.locator('#mgStPieLegend li')).toHaveCount(2);
  const verdeDelPass = await coloreDi(page, 'Passata subito');
  expect(verdeDelPass).toBeNull(); // quella fetta qui non esiste

  const due = await coloreDi(page, '2 critiche');
  // Ora la stessa fetta, in una finestra che contiene anche i pass immediati.
  await page.evaluate((l) => window.__mgTest.setData(l), [
    lavoro('a', 201, 2), lavoro('b', 202, 5), lavoro('c', 203, 0),
  ]);
  await page.evaluate(() => window.__mgTest.renderStats());
  await expect(page.locator('#mgStPieLegend li')).toHaveCount(3);
  const dueDopo = await coloreDi(page, '2 critiche');

  // «2 critiche» è sempre «2 critiche»: il colore non può dipendere da quali
  // altri gruppi hanno dati.
  expect(due).toBe(dueDopo);
  // E non può essere il verde che significa «passata subito».
  const verde = await coloreDi(page, 'Passata subito');
  expect(due).not.toBe(verde);
});

test('«Sempre» conta anche le segnalazioni senza una data d’arrivo, o lo dichiara', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { _id: 'd1', seq: 301, subSeq: 0, clientId: 'u@e.com', text: 'con data', status: 'todo', createdAt: iso(1) },
    { _id: 'd2', seq: 302, subSeq: 0, clientId: 'u@e.com', text: 'senza data', status: 'todo' },
    { _id: 'd3', seq: 303, subSeq: 0, clientId: 'u@e.com', text: 'data rotta', status: 'todo', createdAt: 'non-una-data' },
  ]);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));

  const valore = await page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-card-value').textContent();
  const nota = await page.locator('#mgStNote').textContent();
  const tutto = `${valore} ${nota}`;
  // O le conta tutte e tre, o dice quante ne ha lasciate fuori.
  const contateTutte = valore.trim().startsWith('3');
  const dichiarate = /senza una data|data d’arrivo|data di arrivo|non ha una data/i.test(tutto);
  expect(contateTutte || dichiarate).toBe(true);
});

test('una conversazione tagliata non fa sparire i giri di verifica in silenzio', async ({ openTab }) => {
  const page = await openTab(URL);
  const TRIM = '--- (i turni più vecchi sono stati rimossi: conversazione troppo lunga) ---';
  const intera = lavoro('t1', 401, 3);
  const tagliata = lavoro('t2', 402, 3, {
    // La forma in cui la conversazione è DAVVERO salvata quando supera il tetto.
    notes: `${TRIM}\n\n${conGiri(3).split('\n').slice(-1).join('\n')}`,
  });

  await apri(page, [intera]);
  const mediaIntera = await page.locator('#mgStPieNote').textContent();
  expect(mediaIntera).toContain('Media: 3');

  await page.evaluate((l) => window.__mgTest.setData(l), [tagliata]);
  await page.evaluate(() => window.__mgTest.renderStats());
  const dopo = await page.locator('#mgStPieNote').textContent();
  const nota = await page.locator('#mgStNote').textContent();
  // Con la conversazione tagliata il lavoro non può risultare «passato subito»
  // senza che da nessuna parte si dica che dei giri mancano.
  const dichiara = /taglia|rimoss|conversazione troppo lunga|incomplet/i.test(`${dopo} ${nota}`);
  const nonSiSpaccia = !/Media: 0,0/.test(dopo);
  expect(dichiara || nonSiSpaccia).toBe(true);
});

test('una frase dentro un rilievo non cambia l’esito del giro', async ({ openTab }) => {
  const page = await openTab(URL);
  const sano = lavoro('s1', 501, 1);
  // Stesso giro, ma il verificatore ha scritto «il lavoro si ferma» DENTRO il
  // rilievo: è italiano normale, non un verdetto.
  const conFrase = lavoro('s2', 502, 1, {
    notes: [
      'Verifica: 1 rilievo.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Quando il registro non risponde il lavoro si ferma e la scheda non lo dice',
      '',
      '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---',
      'Corretto.',
      '',
      'Verifica superata.',
    ].join('\n'),
  });

  await apri(page, [sano]);
  const attesa = await page.locator('#mgStPieNote').textContent();

  await page.evaluate((l) => window.__mgTest.setData(l), [conFrase]);
  await page.evaluate(() => window.__mgTest.renderStats());
  const ottenuta = await page.locator('#mgStPieNote').textContent();

  expect(ottenuta).toBe(attesa);
});

test('da un numero si arriva alle segnalazioni che ha contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { _id: 'q1', seq: 601, subSeq: 0, clientId: 'u@e.com', text: 'a', status: 'todo', createdAt: iso(1) },
    { _id: 'q2', seq: 602, subSeq: 0, clientId: 'u@e.com', text: 'b', status: 'attack', createdAt: iso(1) },
  ]);
  // La ripartizione per categoria è aperta di suo.
  const riga = page.locator('.mg-st-card[data-card="ricevuti"] .mg-st-row').filter({ hasText: 'Attacchi' });
  await expect(riga).toHaveCount(1);

  await riga.click();
  await page.waitForTimeout(300);
  // Il clic ha portato da qualche parte? (un elenco aperto, o la lista filtrata)
  const cambiato = await page.evaluate(() => ({
    elenco: !!document.querySelector('#panel-fbstats [data-elenco], #panel-fbstats .mg-st-drill'),
    listaAttiva: !!document.querySelector('#panel-list.mg-panel--active'),
  }));

  await riga.click({ button: 'right' });
  await page.waitForTimeout(300);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.mg-ctxmenu, .sn-select-pop');
    return m ? m.textContent : '';
  });

  const portaDaQualchePartre = cambiato.elenco || cambiato.listaAttiva
    || /segnalazioni contate|mostra|filtra/i.test(menu);
  expect(portaDaQualchePartre).toBe(true);
});

test('la finestra scritta a mano non manda in bianco il grafico degli arrivi', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    { _id: 'g1', seq: 701, subSeq: 0, clientId: 'u@e.com', text: 'a', status: 'todo', createdAt: iso(1) },
    { _id: 'g2', seq: 702, subSeq: 0, clientId: 'u@e.com', text: 'b', status: 'todo', createdAt: iso(2) },
  ]);
  const oggi = new Date(ora);
  const p = (n) => String(n).padStart(2, '0');
  const fine = `${oggi.getFullYear()}-${p(oggi.getMonth() + 1)}-${p(oggi.getDate())}`;
  await page.evaluate(([f]) => window.__mgTest.setStatsWindow('custom', '1900-01-01', f), [fine]);

  const barre = await page.locator('#mgStBars rect.mg-st-bar').count();
  const nota = await page.locator('#mgStBarsNote').textContent();
  const asse = await page.locator('#mgStBars text').allTextContents();
  // Due segnalazioni ci sono: o si vedono, o la pagina dice perché non si vedono.
  expect(barre > 0 || /non|nessuna/i.test(nota)).toBe(true);
  // E l'asse non può fermarsi a un anno in cui non è successo niente.
  expect(asse.join(' ')).not.toMatch(/0[0-9]$/);
});
