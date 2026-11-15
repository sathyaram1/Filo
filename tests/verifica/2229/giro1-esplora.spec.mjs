// #2229 giro 1: esplorazione della lista Domande con i «da fare» (tema, tasto destro, testi strani).
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
  titolo: 'Permessi di Claude Code dal tuo PC <b>x</b> 🧵',
  contesto: 'In cloud il classificatore ferma le modifiche ai permessi.',
  problema: '1. Apri una sessione sul PC\n2. Approva la modifica ai permessi del repo.',
  collegamenti: [{ tipo: 'feedback', id: 'fb1736' }],
  opzioni: [
    { testo: 'L’ho fatto', azione: { tipo: 'riprendi', feedbackId: 'fb1736' } },
    { testo: 'Non serve più', azione: { tipo: 'archivia', feedbackId: 'fb1736' } },
  ],
});

async function apriDomande(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [lista, RIF]);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

for (const tema of ['light', 'dark']) {
  test(`esplora ${tema}`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await page.emulateMedia({ colorScheme: tema });
    await apriDomande(page, [DA_DECIDERE, DA_FARE]);
    if (tema === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
    await page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"]').click();
    await page.screenshot({ path: `tests/.shots/v2229-${tema}.png` });
    await page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"]').click({ button: 'right' });
    await page.screenshot({ path: `tests/.shots/v2229-${tema}-menu.png` });
    const voci = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((e) => e.offsetParent && /Apri|Archivia|Discut|Applica|Fatto/.test(e.textContent || '') && e.children.length === 0)
      .map((e) => e.textContent.trim()));
    console.log('VOCI', JSON.stringify(voci));
  });
}
