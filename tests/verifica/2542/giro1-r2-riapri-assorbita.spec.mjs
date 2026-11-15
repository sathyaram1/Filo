// Verifica #2542 giro 1: una domanda assorbita per sbaglio dalla revisione l'owner la riporta fra quelle da rispondere,
// come riapre una risposta automatica. Le foto della domanda che assorbe e dell'assorbita, chiaro e scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const IERI = Date.now() - 20 * 3600 * 1000;

const ASSORBE = domanda(80, { titolo: 'Il bordo freddo in tutta la Gestione: ripensiamo i colori?', assorbite: ['D-81', 'D-82'] });
const ASSORBITA = domanda(81, {
  stato: 'superata', titolo: 'Le notifiche arrivano due volte',
  esito: { azione: null, ok: true, applicataIl: IERI, superata: 'assorbita in D-80', superataDa: 'D-80' },
});
const ALTRA = domanda(82, {
  stato: 'superata', titolo: 'Il bordo delle schede è freddo',
  esito: { azione: null, ok: true, applicataIl: IERI, superata: 'assorbita in D-80', superataDa: 'D-80' },
});

test('r2 l’owner riporta fra quelle da rispondere una domanda assorbita per sbaglio', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [ASSORBE, ASSORBITA, ALTRA] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-80').click();
  const k = dq(page, 'D-80');
  await expect(k.locator('.mg-dq-assorbite-sez')).toContainText('D-81');
  await k.screenshot({ path: 'tests/.shots/verifica-2542-assorbe.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await k.screenshot({ path: 'tests/.shots/verifica-2542-assorbe-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));

  await k.locator('.mg-dq-assorbite-sez button[data-domanda="D-81"]').click();
  await expect(tab(page, 'domande-archivio')).toHaveClass(/active|attiva|sel/);
  const s = dq(page, 'D-81');
  await expect(s).toContainText('Assorbita in');
  await s.screenshot({ path: 'tests/.shots/verifica-2542-assorbita.png' });
  await expect(s.locator('button[data-fai="riapri"]'), 'nessun modo di riportarla fra quelle da rispondere').toHaveCount(1);
});
