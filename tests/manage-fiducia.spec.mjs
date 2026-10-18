// LA FIDUCIA IN GESTIONE (#1424).
//
// COSA DEVE ESSERE VERO
//   1. Non c'è una scheda «Lavori server»: un lavoro col segno del server sta «In coda» con l'etichetta «server».
//   2. Ogni pratica dice a colpo d'occhio se è fidata: bordo destro e scudo nel colore della fiducia, diversi fra
//      fidata e non fidata, nei Ricevuti, In coda e nelle Domande, nei due temi; lo scudo cambia forma, non solo colore.
//   3. «Solo non fidate» lascia solo le non fidate, e i numeri delle schede lo seguono; vale anche nelle Domande.
//   4. Un lavoro che chiede il server a chi non è fidato sta nei Ricevuti col «🤝 Rendi fidato» principale, che
//      manda al main solo `fiducia_segna`; il sì del server lo rimette In coda come lavoro server, e il suo avviso si legge.
//   5. La pagina gemella dei feedback mostra lo stesso segno e offre la stessa azione.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';
import { domanda } from './helpers/gestioneMainFinto.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq}`, name: `Pratica ${over.seq}`, text: 'Testo.', subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}

const FIDATA_IN_CODA = fb({ seq: 901, name: 'Fidata in coda', clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' });
const NON_FIDATA_IN_CODA = fb({ seq: 902, name: 'Non fidata in coda', fiducia: 'non_fidato' });
const SENZA_CAMPO_IN_CODA = fb({ seq: 903, name: 'Senza campo in coda' });
const SERVER_IN_CODA = fb({ seq: 904, name: 'Lavoro del server', clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato', localOnly: { by: 'server', at: Date.parse('2026-10-17T08:00:00Z') } });
const FIDATA_RICEVUTA = fb({ seq: 905, name: 'Fidata ricevuta', status: 'aligned', clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' });
const CHIEDE_SERVER = fb({ seq: 906, name: 'Chiede il server', status: 'design', statusReason: 'server', fiducia: 'non_fidato' });
const TUTTE = [FIDATA_IN_CODA, NON_FIDATA_IN_CODA, SENZA_CAMPO_IN_CODA, SERVER_IN_CODA, FIDATA_RICEVUTA, CHIEDE_SERVER];

async function apri(page, lista, risposta = { ok: true, fiducia: 'fidato' }) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((r) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update' || t === 'fiducia_segna') { window.__updates.push(msg); return t === 'fiducia_segna' ? r : { ok: true }; }
      return orig(msg);
    };
  }, risposta);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
}

// Il colore che un token dà a un elemento, letto come lo legge il browser: così il confronto vale in ogni tema.
const coloreDelToken = (page, token) => page.evaluate((t) => {
  const p = document.createElement('span');
  p.style.color = `var(${t})`;
  document.body.appendChild(p);
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
}, token);
const stile = (loc) => loc.evaluate((el) => {
  const s = getComputedStyle(el);
  return { color: s.color, bordoDestro: s.borderRightColor, larghezza: s.borderRightWidth };
});
const scudo = (loc) => loc.locator('.mg-fiducia-segno').evaluate((el) => {
  const p = el.querySelector('path');
  const s = getComputedStyle(p);
  return { color: getComputedStyle(el).color, fill: s.fill, tratteggio: s.strokeDasharray, titolo: el.getAttribute('title') };
});

async function controllaCoppia(page, fidata, nonFidata, tema) {
  const verde = await coloreDelToken(page, '--mg-fidata-color');
  const prugna = await coloreDelToken(page, '--mg-nonfidata-color');
  expect(verde, tema).not.toBe(prugna);
  const a = await stile(fidata);
  const b = await stile(nonFidata);
  expect(a.bordoDestro, `${tema}: bordo della fidata`).toBe(verde);
  expect(b.bordoDestro, `${tema}: bordo della non fidata`).toBe(prugna);
  expect(a.larghezza).toBe('3px');
  const sa = await scudo(fidata);
  const sb = await scudo(nonFidata);
  expect(sa.color, tema).toBe(verde);
  expect(sb.color, tema).toBe(prugna);
  // Il colore non è l'unico segnale: pieno contro vuoto e tratteggiato, e la parola sotto il puntatore.
  expect(sa.fill).toBe(verde);
  expect(sb.fill).toBe('none');
  expect(sb.tratteggio).not.toBe('none');
  expect(sa.titolo).toBe('Fidata');
  expect(sb.titolo).toBe('Non fidata');
  return { verde, prugna };
}

const riga = (page, id) => page.locator(`#mgList .mg-item[data-id="${id}"]`);
const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);

test('nessuna scheda «Lavori server»: il lavoro del server sta In coda con l’etichetta «server»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, TUTTE);
  await expect(tabBtn(page, 'local')).toHaveCount(0);
  await expect(page.locator('.mg-tab', { hasText: 'Lavori server' })).toHaveCount(0);
  await apriScheda(page, 'queue');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (4)');
  const server = riga(page, SERVER_IN_CODA._id);
  await expect(server).toBeVisible();
  await expect(server.locator('.mg-local-badge')).toHaveText('server');
  await expect(server.locator('.mg-local-badge')).toHaveAttribute('title', 'Lavoro server');
  await expect(riga(page, FIDATA_IN_CODA._id).locator('.mg-local-badge')).toHaveCount(0);
});

test('fidata e non fidata si distinguono a colpo d’occhio, In coda e nei Ricevuti, nei due temi', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, TUTTE);
  const visti = {};
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await apriScheda(page, 'queue');
    // Un campo assente vale non fidato: il segno lo dice uguale.
    visti[tema] = await controllaCoppia(page, riga(page, FIDATA_IN_CODA._id), riga(page, NON_FIDATA_IN_CODA._id), `${tema} In coda`);
    await controllaCoppia(page, riga(page, FIDATA_IN_CODA._id), riga(page, SENZA_CAMPO_IN_CODA._id), `${tema} senza campo`);
    await page.locator('#mgListCol').screenshot({ path: `tests/.shots/fiducia-in-coda-${tema}.png` });
    await apriScheda(page, 'inbox');
    await controllaCoppia(page, riga(page, FIDATA_RICEVUTA._id), riga(page, CHIEDE_SERVER._id), `${tema} Ricevuti`);
    await page.locator('#mgListCol').screenshot({ path: `tests/.shots/fiducia-ricevuti-${tema}.png` });
    await page.screenshot({ path: `tests/.shots/fiducia-pagina-${tema}.png` });
  }
  // I due temi hanno i loro toni: lo scuro più acceso.
  expect(visti.light.verde).not.toBe(visti.dark.verde);
  expect(visti.light.prugna).not.toBe(visti.dark.prugna);
});

test('«Solo non fidate»: restano le non fidate, e i numeri delle schede lo seguono', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, TUTTE);
  await apriScheda(page, 'queue');
  const filtro = page.locator('#mgFiduciaFiltro');
  await expect(filtro).toBeVisible();
  await expect(filtro).toHaveAttribute('aria-pressed', 'false');
  await expect(filtro).toContainText('Solo non fidate (2)');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(4);
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (2)');

  await filtro.click();
  await expect(filtro).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(2);
  await expect(riga(page, NON_FIDATA_IN_CODA._id)).toBeVisible();
  await expect(riga(page, SENZA_CAMPO_IN_CODA._id)).toBeVisible();
  await expect(riga(page, FIDATA_IN_CODA._id)).toHaveCount(0);
  await expect(page.locator('#mgList .mg-fiducia-segno--fidata')).toHaveCount(0);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (2)');
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(page.locator('#mgListHead')).toHaveText('In coda (2)');
  // Vale in ogni scheda dei feedback, finché non si spegne.
  await apriScheda(page, 'inbox');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(1);
  await expect(riga(page, CHIEDE_SERVER._id)).toBeVisible();
  expect(await page.evaluate(() => window.__mgTest.fiduciaFiltro())).toBe(true);
  await page.locator('#mgFiduciaFiltro').click();
  await expect(page.locator('#mgList .mg-item')).toHaveCount(2);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (4)');
});

test('Domande: le righe portano lo stesso segno, e «Solo non fidate» le filtra coi numeri', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, TUTTE);
  await page.evaluate((l) => window.__mgTest.setDomande(l), [
    domanda(31, { titolo: 'Da una sessione pulita', fiducia: 'fidato' }),
    domanda(32, { titolo: 'Ha letto testo di fuori', fiducia: 'non_fidato' }),
  ]);
  await apriScheda(page, 'domande');
  const d = (id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await controllaCoppia(page, d('D-31'), d('D-32'), `${tema} Domande`);
    await page.locator('#mgDomandeCol').screenshot({ path: `tests/.shots/fiducia-domande-${tema}.png` });
  }
  await expect(tabBtn(page, 'domande')).toHaveText('Da rispondere (2)');
  const filtro = page.locator('#mgDomandeFiduciaFiltro');
  await expect(filtro).toBeVisible();
  await expect(filtro).toContainText('Solo non fidate (1)');
  await filtro.click();
  await expect(filtro).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgDomandeLista .mg-domanda')).toHaveCount(1);
  await expect(d('D-32')).toBeVisible();
  await expect(tabBtn(page, 'domande')).toHaveText('Da rispondere (1)');
  // La sezione conta come Feedback, a filtro spento.
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(2)');
  // Uno stato solo: la lista dei feedback lo vede acceso.
  await apriScheda(page, 'queue');
  await expect(page.locator('#mgFiduciaFiltro')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(2);
});

test('il lavoro che chiede il server: «🤝 Rendi fidato» principale, manda solo fiducia_segna, e riparte In coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const avviso = 'Il testo della pratica viene da fuori: la routine del server lo legge imbustato.';
  await apri(page, TUTTE, { ok: true, fiducia: 'fidato', ripartito: true, avviso });
  await apriScheda(page, 'inbox');
  const pratica = riga(page, CHIEDE_SERVER._id);
  const rombo = pratica.locator('.mg-segno-fermata');
  await expect(rombo).toHaveAttribute('data-forma', 'rombo');
  await expect(rombo).toHaveAttribute('title', /Chiede di diventare fidato/);
  expect(await rombo.evaluate((el) => getComputedStyle(el).color)).toBe(await coloreDelToken(page, '--mg-nonfidata-color'));
  await pratica.click();
  // Il rombo del dettaglio ha lo stesso colore e, aperto, dice perché.
  const romboL3 = page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]');
  await expect(romboL3).toHaveClass(/mg-forma--nonfidata/);
  await romboL3.click();
  await expect(page.locator('#mgSideTitle')).toHaveText('Il lavoro chiede il server');
  await expect(page.locator('#mgSideBody')).toContainText('Chiede di diventare fidato: il lavoro ha bisogno del server');
  const tasto = page.locator('#mgAcceptServerBtn');
  await expect(tasto).toHaveText('🤝 Rendi fidato');
  await expect(tasto).not.toHaveClass(/sn-btn-secondary/);
  await expect(page.locator('#mgAcceptBtn')).toHaveClass(/sn-btn-secondary/);
  await expect(page.locator('#mgAcceptLocalBtn')).toHaveCount(0);
  // Lo stesso sì non compare due volte nella riga.
  await expect(page.locator('#mgFiduciaBtn')).toBeHidden();
  await page.locator('#mgOwnerBar').screenshot({ path: 'tests/.shots/fiducia-rendi-fidato.png' });

  await tasto.click();
  await expect(page.locator('#mgToast')).toContainText('è fidato e riparte');
  await expect(page.locator('#mgToast')).toContainText(avviso);
  expect(await page.evaluate(() => window.__updates)).toEqual([{ type: 'fiducia_segna', feedbackId: CHIEDE_SERVER._id }]);
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
  await apriScheda(page, 'queue');
  const ripartita = riga(page, CHIEDE_SERVER._id);
  await expect(ripartita.locator('.mg-local-badge')).toHaveText('server');
  await expect(ripartita.locator('.mg-fiducia-segno')).toHaveAttribute('title', 'Fidata');
});

test('dal tasto destro: la stessa azione, al posto di «Segna fidato»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, TUTTE, { ok: true, fiducia: 'fidato', ripartito: true });
  await apriScheda(page, 'inbox');
  await riga(page, CHIEDE_SERVER._id).click({ button: 'right' });
  const menu = page.locator('.mg-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText('Segna fidato');
  await menu.locator('.sn-select-option', { hasText: '🤝 Rendi fidato' }).click();
  await expect.poll(() => page.evaluate(() => window.__updates)).toEqual([{ type: 'fiducia_segna', feedbackId: CHIEDE_SERVER._id }]);
  await expect(tabBtn(page, 'inbox')).toHaveText('Ricevuti (1)');
});

test('la pagina gemella dei feedback: lo stesso scudo e lo stesso «🤝 Rendi fidato»', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update' || t === 'fiducia_segna') { window.__updates.push(msg); return { ok: true, fiducia: 'fidato', ripartito: true }; }
      return orig(msg);
    };
  });
  await page.evaluate((items) => { window.__fbTest.setAdmin(true); window.__fbTest.setData(items); window.__fbTest.setTab('inbox'); },
    [FIDATA_RICEVUTA, CHIEDE_SERVER]);
  const carta = (id) => page.locator(`.fb-card[data-id="${id}"]`);
  await expect(carta(FIDATA_RICEVUTA._id).locator('.fb-scudo')).toHaveAttribute('title', 'Fidata');
  await expect(carta(CHIEDE_SERVER._id).locator('.fb-scudo')).toHaveAttribute('title', 'Non fidata');
  const bordo = (id) => carta(id).evaluate((el) => getComputedStyle(el).borderRightColor);
  expect(await bordo(FIDATA_RICEVUTA._id)).not.toBe(await bordo(CHIEDE_SERVER._id));
  await page.locator('.fb-list').screenshot({ path: 'tests/.shots/fiducia-feedback.png' });
  const tasto = carta(CHIEDE_SERVER._id).locator('.fb-act-fiducia');
  await expect(tasto).toHaveText('🤝 Rendi fidato');
  await tasto.click();
  await expect(carta(CHIEDE_SERVER._id).locator('.fb-esito')).toContainText('In coda');
  expect(await page.evaluate(() => window.__updates)).toEqual([{ type: 'fiducia_segna', feedbackId: CHIEDE_SERVER._id }]);
});
