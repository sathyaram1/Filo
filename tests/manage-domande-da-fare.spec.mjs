// #2229: un «da fare» dell'owner sta nella lista delle Domande col suo segno, il contatore lo conta a parte, e «Fatto»
// manda la scelta che riprende il lavoro collegato. Il main è finto: la parte del server la provano le sue prove.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ora = Date.now();
const RIF = { fb1736: { num: '#1736', priorita: 1, stato: 'design', motivo: 'locale' } };
function domanda(numero, over) {
  return Object.assign({
    id: `D-${numero}`, numero, stato: 'aperta', priorita: 'importante', fiducia: 'fidato',
    titolo: `Domanda ${numero}`, creataIl: ora - numero * 1000, modificataIl: ora - numero * 1000,
    opzioni: [], consiglio: null, conversazione: [],
  }, over);
}
const DA_DECIDERE = domanda(20, {
  titolo: 'Colore dei pulsanti',
  opzioni: [
    { testo: 'Caldo', pro: 'a', contro: 'b', azione: { tipo: 'riprendi', feedbackId: 'fb1736' } },
    { testo: 'Freddo', pro: 'c', contro: 'd', azione: { tipo: 'archivia', feedbackId: 'fb1736' } },
  ],
  consiglio: { opzione: 0, perche: 'Filo è caldo.' },
});
const DA_FARE = domanda(21, {
  tipo: 'da_fare', blocca: true, legata: 'fb1736',
  titolo: 'Permessi di Claude Code dal tuo PC',
  contesto: 'In cloud il classificatore ferma le modifiche ai permessi.',
  problema: 'Apri una sessione sul PC e approva la modifica ai permessi del repo.',
  collegamenti: [{ tipo: 'feedback', id: 'fb1736' }],
  opzioni: [
    { testo: 'L’ho fatto', azione: { tipo: 'riprendi', feedbackId: 'fb1736' } },
    { testo: 'Non serve più', azione: { tipo: 'archivia', feedbackId: 'fb1736' } },
  ],
});
const DA_FARE_SOLO = domanda(22, {
  tipo: 'da_fare', priorita: 'quando_puoi', titolo: 'Rinnova il token di GitHub',
  problema: 'Dalle impostazioni di GitHub, rigenera il token e incollalo in Automazioni.',
  opzioni: [{ testo: 'Fatto', azione: { tipo: 'nessuna' } }],
});

async function apriDomande(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [lista, RIF]);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

async function mainFinto(page) {
  await page.evaluate(() => {
    window.__domande = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (!/^domand/.test(String(t))) return orig(msg);
      window.__domande.push(msg);
      const d = window.__mgTest.domandeStato().domande.find((x) => x.id === msg.id);
      if (t === 'domanda_rispondi') {
        return { ok: true, domanda: Object.assign({}, d, { stato: 'chiusa', conversazione: [{ tipo: 'risposta', scelta: msg.scelta, autore: { tipo: 'owner' } }], esito: { ok: true, applicataIl: Date.now() } }), esito: { ok: true } };
      }
      return { ok: false, error: 'non previsto' };
    };
  });
}

test('un «da fare» sta nella stessa lista col suo segno, e il contatore lo conta a parte', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [DA_DECIDERE, DA_FARE, DA_FARE_SOLO]);
  const righe = page.locator('#mgDomandeLista .mg-domanda');
  await expect(righe).toHaveCount(3);
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"] .mg-domanda-tipo')).toHaveText('da fare');
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-id="D-22"] .mg-domanda-tipo')).toHaveText('da fare');
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-id="D-20"] .mg-domanda-tipo')).toHaveText('da decidere');
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(1 · 2 da fare)');
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveAttribute('title', /1 da decidere, 2 da fare/);
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveText('Da rispondere (1 · 2 da fare)');

  // Solo cose da fare: il numero dice che sono da fare; senza, il contatore resta quello di sempre.
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [[DA_FARE], RIF]);
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(1 da fare)');
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [[DA_DECIDERE], RIF]);
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(1)');
});

test('aperto, un «da fare» dice cosa fare e perché; «Fatto» manda la scelta che riprende il lavoro collegato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [DA_FARE, DA_DECIDERE]);
  await mainFinto(page);
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"]').click();
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-21"]');
  await expect(dq.locator('.mg-dq-tipo')).toHaveText('da fare');
  await expect(dq).toContainText('Cosa fare');
  await expect(dq).toContainText('Perché serve');
  await expect(dq).toContainText('Quando hai finito');
  await expect(dq.locator('.mg-dq-consiglio')).toHaveCount(0);
  const pulsanti = dq.locator('.mg-dq-azione');
  await expect(pulsanti).toHaveText(['Fatto: riprendi #1736', 'Non lo faccio: archivia #1736']);
  await expect(dq.locator('.mg-dq-ferma')).toHaveText('ferma #1736');
  await page.screenshot({ path: 'tests/.shots/domande-da-fare.png' });

  await pulsanti.first().click();
  await expect.poll(() => page.evaluate(() => window.__domande.filter((m) => m.type === 'domanda_rispondi'))).toEqual([
    expect.objectContaining({ id: 'D-21', scelta: 0 }),
  ]);
  await expect(dq.locator('.mg-dq-opzione[data-indice="0"] .mg-dq-badge--scelta')).toHaveText('Scelta');
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(1)');

  // La domanda vera accanto resta com'era: consiglio, opzioni e segno «da decidere».
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-20"]').click();
  const vera = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-20"]');
  await expect(vera.locator('.mg-dq-tipo')).toHaveText('da decidere');
  await expect(vera.locator('.mg-dq-consiglio')).toContainText('Filo è caldo.');
  await expect(vera.locator('.mg-dq-azione').first()).toHaveText('Riprendi #1736 con questa scelta');
});

test('un «da fare» senza lavoro collegato ha il solo «Fatto»; «Applica il consiglio» non lo segna fatto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [DA_FARE_SOLO, DA_DECIDERE]);
  await mainFinto(page);
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-22"]').click();
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-22"]');
  await expect(dq.locator('.mg-dq-azione')).toHaveText(['Fatto']);
  await expect(dq.locator('.mg-dq-applica')).toHaveCount(0);

  await page.locator('#mgDomandeTutte').check();
  await page.locator('#mgDomandeConsiglioSel').click();
  const conferma = page.locator('#mgDomandeConferma');
  await expect(conferma).toContainText('D-22');
  await expect(conferma).toContainText('la segni tu, con «Fatto»');
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-22"]').click();
  await page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-22"] .mg-dq-azione').click();
  await expect.poll(() => page.evaluate(() => window.__domande.map((m) => [m.type, m.id, m.scelta]))).toContainEqual(['domanda_rispondi', 'D-22', 0]);
});

test('il tasto destro su un «da fare» offre «Fatto» e «Non lo faccio», e mandano la stessa scelta dei pulsanti (#2229.1)', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [DA_FARE, DA_FARE_SOLO, DA_DECIDERE]);
  await mainFinto(page);
  // A icone (#2555): il testo di tutte le voci, icone e varianti nei loro menu.
  const menu = menuDi(page);
  const testo = async () => { await expect(menu.principale).toBeVisible(); return (await menu.vociScritte()).join('\n'); };
  const chiudi = () => expect.poll(async () => { await page.keyboard.press('Escape'); return menu.pannelli.count(); }).toBe(0);

  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-22"]').click({ button: 'right' });
  let t = await testo();
  expect(t).toContain('Fatto');
  expect(t).not.toContain('Applica il consiglio');
  await chiudi();

  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"]').click({ button: 'right' });
  t = await testo();
  expect(t).toContain('Fatto: riprendi #1736');
  expect(t).toContain('Non lo faccio: archivia #1736');
  await page.screenshot({ path: 'tests/.shots/domande-da-fare-tasto-destro.png' });
  await menu.scegli('Fatto: riprendi #1736');
  await expect.poll(() => page.evaluate(() => window.__domande.filter((m) => m.type === 'domanda_rispondi'))).toEqual([
    expect.objectContaining({ id: 'D-21', scelta: 0 }),
  ]);
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-21"]');
  await expect(dq.locator('.mg-dq-opzione[data-indice="0"] .mg-dq-badge--scelta')).toHaveText('Scelta');

  // Una volta segnato, il menu non lo offre più; una domanda vera tiene il suo consiglio.
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-20"]').click({ button: 'right' });
  await expect(menu).toContainText('Applica il consiglio: Riprendi #1736');
  await expect(menu).not.toContainText('Fatto');
});

test('col filtro delle sole non fidate, «Da rispondere» conta a parte i «da fare» che restano; la sezione conta tutto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const nonFidata = (d, numero, titolo) => ({ ...d, id: `D-${numero}`, numero, titolo, fiducia: 'non_fidato' });
  await apriDomande(page, [DA_DECIDERE, DA_FARE, DA_FARE_SOLO, nonFidata(DA_DECIDERE, 30, 'Forma dei bordi'), nonFidata(DA_FARE_SOLO, 31, 'Rinnova la chiave')]);
  const tab = page.locator('.mg-tab[data-tab="domande"]');
  await expect(tab).toHaveText('Da rispondere (2 · 3 da fare)');
  await page.locator('#mgDomandeFiduciaFiltro').click();
  await expect(page.locator('#mgDomandeFiduciaFiltro')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgDomandeLista .mg-domanda')).toHaveCount(2);
  await expect(tab).toHaveText('Da rispondere (1 · 1 da fare)');
  await expect(tab).toHaveAttribute('title', '1 da decidere, 1 da fare');
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(2 · 3 da fare)');
  // Restano solo cose da decidere: il numero torna quello di sempre.
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [[DA_FARE, nonFidata(DA_DECIDERE, 30, 'Forma dei bordi')], RIF]);
  await expect(tab).toHaveText('Da rispondere (1)');
  await expect(tab).toHaveAttribute('title', '1 da rispondere');
});

test('trascinata in una chat, la riga di un «da fare» porta il segno e le sue sezioni: perché, cosa fare, quando hai finito', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [DA_FARE, DA_DECIDERE]);
  const testoTrascinato = (id) => page.evaluate((i) => {
    const dt = new DataTransfer();
    const riga = document.querySelector(`#mgDomandeLista .mg-domanda[data-id="${i}"]`);
    riga.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  }, id);
  const fare = await testoTrascinato('D-21');
  expect(fare.split('\n')[0]).toBe('D-21 Permessi di Claude Code dal tuo PC');
  expect(fare).toContain('Domanda D-21 (da fare, ');
  expect(fare).toContain('Perché serve:\nIn cloud il classificatore ferma le modifiche ai permessi.');
  expect(fare).toContain('Cosa fare:\nApri una sessione sul PC e approva la modifica ai permessi del repo.');
  expect(fare).toContain('Quando hai finito:\n1. L’ho fatto\n2. Non serve più');
  expect(fare).not.toContain('Contesto:');
  // La domanda vera tiene i nomi di sempre.
  const vera = await testoTrascinato('D-20');
  expect(vera).toContain('Domanda D-20 (da decidere, ');
  expect(vera).toContain('Opzioni:\n1. Caldo (consigliata)');
  expect(vera).not.toContain('Quando hai finito');
});

test('in tema scuro il segno «da fare» si legge', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.emulateMedia({ colorScheme: 'dark' });
  await apriDomande(page, [DA_DECIDERE, DA_FARE]);
  const segno = page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"] .mg-domanda-tipo');
  await expect(segno).toBeVisible();
  const [colore, sfondo] = await page.evaluate(() => {
    const s = document.querySelector('#mgDomandeLista .mg-domanda[data-id="D-21"] .mg-domanda-tipo');
    return [getComputedStyle(s).color, getComputedStyle(document.body).backgroundColor];
  });
  expect(colore).not.toBe(sfondo);
  await page.screenshot({ path: 'tests/.shots/domande-da-fare-scuro.png' });
});
