// Esplorazione del giro 5 (#2229): filtro fiducia, testo trascinato, testi lunghi e HTML, tasto destro, aspetto.
import { test, expect } from '../../fixtures/electron.mjs';

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
const VERA = domanda(20, {
  titolo: 'Colore dei pulsanti',
  opzioni: [
    { testo: 'Caldo', pro: 'a', contro: 'b', azione: { tipo: 'riprendi', feedbackId: 'fb1736' } },
    { testo: 'Freddo', pro: 'c', contro: 'd', azione: { tipo: 'archivia', feedbackId: 'fb1736' } },
  ],
  consiglio: { opzione: 0, perche: 'Filo è caldo.' },
});
const FARE_NF = domanda(21, {
  tipo: 'da_fare', blocca: true, legata: 'fb1736', fiducia: 'non_fidato',
  titolo: '<img src=x onerror="window.__xss=1"> Permessi di Claude Code dal tuo PC lunghissimi davvero',
  contesto: 'In cloud il classificatore ferma le modifiche ai permessi. '.repeat(30),
  problema: '1. Apri una sessione sul PC\n2. Approva <b>la modifica</b> ai permessi del repo.',
  collegamenti: [{ tipo: 'feedback', id: 'fb1736' }],
  opzioni: [
    { testo: 'L’ho fatto', azione: { tipo: 'riprendi', feedbackId: 'fb1736' } },
    { testo: 'Non serve più', azione: { tipo: 'archivia', feedbackId: 'fb1736' } },
  ],
});
const FARE_CHIUSA = domanda(23, {
  tipo: 'da_fare', stato: 'chiusa', titolo: 'Token rinnovato',
  opzioni: [{ testo: 'Fatto', azione: { tipo: 'nessuna' } }],
  conversazione: [{ tipo: 'risposta', scelta: 0, autore: { tipo: 'owner' } }], esito: { ok: true, applicataIl: ora },
});

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [lista, RIF]);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

test('filtro non fidate: la scheda conta a parte i da fare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [VERA, FARE_NF, FARE_CHIUSA]);
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveText('Da rispondere (1 · 1 da fare)');
  await page.locator('#mgDomandeFiduciaFiltro').click();
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveText('Da rispondere (1 da fare)');
  await expect(page.locator('#mgDomandeLista .mg-domanda')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/g5-filtro.png' });
});

test('testo trascinato e HTML nel titolo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [VERA, FARE_NF]);
  const riga = page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"]');
  await expect(riga.locator('.mg-domanda-titolo')).toContainText('<img');
  const testo = await page.evaluate(() => {
    const li = document.querySelector('#mgDomandeLista .mg-domanda[data-id="D-21"]');
    const dt = new DataTransfer();
    li.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    return dt.getData('text/plain');
  });
  console.log('TRASCINATO\n' + testo);
  expect(testo).toContain('da fare');
  expect(testo).toContain('Cosa fare:');
  await riga.click();
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-21"]');
  await expect(dq).toContainText('Cosa fare');
  await page.screenshot({ path: 'tests/.shots/g5-lungo.png' });
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/g5-lungo-scuro.png' });
  await riga.click({ button: 'right' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/g5-destro.png' });
});

test('archivio: un da fare chiuso porta il segno e la scelta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [VERA, FARE_CHIUSA]);
  await page.locator('.mg-tab[data-tab="domande-archivio"]').click();
  const riga = page.locator('#mgDomandeLista .mg-domanda[data-id="D-23"]');
  await expect(riga.locator('.mg-domanda-tipo')).toHaveText('da fare');
  await riga.click();
  await page.screenshot({ path: 'tests/.shots/g5-archivio.png' });
});
