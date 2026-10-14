// Esplorazione della verifica locale: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, inviati, aspettaAvvio, finestra } from './aiuto.mjs';

const OUT = 'C:/Users/agenti AI/Desktop/Filo/report/ruoli-invertiti-stato/ondata1/tmp-1150/vista-verifica';

function domande() {
  return [
    domanda(12, { priorita: 'bloccante', titolo: 'Fondo #813 adesso?' }),
    domanda(13, { priorita: 'importante', titolo: 'Lavoro locale?', opzioni: [{ testo: 'Approva locale', azione: { tipo: 'approva_locale', feedbackId: 'fb-902' } }, { testo: 'Archivia', azione: { tipo: 'archivia', feedbackId: 'fb-902' } }] }),
    domanda(14, { priorita: 'quando_puoi', titolo: 'Priorità?', opzioni: [{ testo: 'Priorità 3', azione: { tipo: 'priorita', feedbackId: 'fb-813', valore: 3 } }] }),
    domanda(16, { priorita: 'quando_puoi', titolo: 'Senza opzioni', opzioni: [], consiglio: null }),
  ];
}

async function sezioni(page) {
  return page.evaluate(() => ({
    sezione: document.querySelector('.mg-sezione--active')?.dataset.sezione,
    sezioni: [...document.querySelectorAll('.mg-sezione')].map((b) => b.textContent.trim()).join(' | '),
    schede: [...document.querySelectorAll('.mg-tab')].filter((b) => !b.hidden).map((b) => b.textContent.trim()).join(' | '),
    attiva: document.querySelector('.mg-tab--active')?.dataset.tab,
  }));
}

test('E4 rispondere: opzione, parole, consiglio, discutiamone, archivia', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: domande() });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await finestra(app, 1536, 864);
  const det = page.locator('#mgDomandaDettaglio');
  // Opzione 2 di D-12
  await page.locator('.mg-dq[data-id="D-12"] button[data-scelta="1"]').click();
  await page.waitForTimeout(600);
  console.log('E4 risp', JSON.stringify(await inviati(app, 'domanda_rispondi')));
  console.log('E4 dopo scelta', JSON.stringify(await sezioni(page)), '|', (await det.innerText()).slice(0, 300), '| lista', await page.locator('#mgDomandeLista').innerText());
  await page.screenshot({ path: `${OUT}/e4-dopo-scelta.png` });
  // Parole vuote su D-14
  await page.locator('.mg-domanda[data-id="D-14"]').click();
  await page.locator('.mg-dq[data-id="D-14"] button[data-fai="testo"]').click();
  console.log('E4 vuoto', await page.locator('.mg-dq[data-id="D-14"] .mg-dq-msg').innerText());
  await page.locator('.mg-dq[data-id="D-14"] .mg-dq-testo').fill('   ');
  await page.locator('.mg-dq[data-id="D-14"] button[data-fai="testo"]').click();
  console.log('E4 spazi', await page.locator('.mg-dq[data-id="D-14"] .mg-dq-msg').innerText());
  await page.locator('.mg-dq[data-id="D-14"] .mg-dq-testo').fill('Fai così 👍 <b>grassetto</b>');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(600);
  console.log('E4 parole', JSON.stringify((await inviati(app, 'domanda_rispondi')).slice(-1)), '| msg', (await det.innerText()).slice(0, 600));
  // Discutiamone su D-16
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('.mg-tab[data-tab="domande"]').click();
  await page.locator('.mg-domanda[data-id="D-16"]').click();
  await page.locator('.mg-dq[data-id="D-16"] button[data-fai="discuti"]').click();
  await page.waitForTimeout(300);
  console.log('E4 discuti', await page.locator('.mg-dq[data-id="D-16"] .mg-dq-msg').innerText(), '| clip', await app.evaluate(({ clipboard }) => clipboard.readText()));
  await page.screenshot({ path: `${OUT}/e4-d16.png` });
  // Archivia e riapri D-16
  await page.locator('.mg-dq[data-id="D-16"] button[data-fai="chiudi"]').click();
  await page.waitForTimeout(500);
  console.log('E4 archiviata', JSON.stringify(await sezioni(page)), (await det.innerText()).slice(0, 400));
  const riapri = page.locator('.mg-dq[data-id="D-16"] button[data-fai="riapri"]');
  console.log('E4 riapri visibile', await riapri.count());
  if (await riapri.count()) { await riapri.click(); await page.waitForTimeout(500); console.log('E4 riaperta', JSON.stringify(await sezioni(page))); }
});

test('E5 applica il consiglio a più domande', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: domande() });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await finestra(app, 1536, 864);
  await page.locator('#mgDomandeTutte').check();
  console.log('E5 bottone', await page.locator('#mgDomandeConsiglioSel').innerText());
  await page.locator('#mgDomandeConsiglioSel').click();
  console.log('E5 conferma', await page.locator('#mgDomandeConferma').innerText());
  await page.screenshot({ path: `${OUT}/e5-conferma.png` });
  await page.locator('#mgDomandeConferma [data-conferma="si"]').click();
  await page.waitForTimeout(800);
  console.log('E5 inviato', JSON.stringify(await inviati(app, 'domande_consiglio')));
  console.log('E5 esito', await page.locator('#mgDomandeConferma').innerText(), '|', JSON.stringify(await sezioni(page)));
  await page.screenshot({ path: `${OUT}/e5-esito.png` });
  // Consiglio da una sola, quella non in blocco
  await page.locator('.mg-domanda[data-id="D-13"]').click();
  const b = page.locator('.mg-dq[data-id="D-13"] button[data-fai="consiglio"]');
  console.log('E5 D-13 bottone', await b.count() ? await b.innerText() : 'assente');
  // tasto destro sulla riga
  await page.locator('.mg-domanda[data-id="D-13"]').click({ button: 'right' });
  await page.waitForTimeout(300);
  console.log('E5 menu', await page.evaluate(() => [...document.querySelectorAll('.mg-ctxmenu .sn-select-option, [role="menuitem"]')].map((x) => x.textContent.trim()).join(' | ')));
  await page.screenshot({ path: `${OUT}/e5-menu.png` });
});

test('E6 legami, ricerca e strade che accendono la sezione', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: domande() });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await finestra(app, 1536, 864);
  await page.locator('.mg-dq[data-id="D-12"] [data-feedback="#813"]').first().click();
  await page.waitForTimeout(500);
  console.log('E6 legame', JSON.stringify(await sezioni(page)), '| det', (await page.locator('#mgDetail').innerText()).slice(0, 200));
  // Lente da Domande
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(300);
  console.log('E6 lente', JSON.stringify(await sezioni(page)), '| barra', await page.locator('#mgSearchBar').isVisible());
  await page.screenshot({ path: `${OUT}/e6-lente.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log('E6 lente chiusa', JSON.stringify(await sezioni(page)));
  // Routine e ritorno: ogni sezione ricorda la sua scheda
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await page.locator('.mg-tab[data-tab="resolved"]').click();
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.locator('.mg-tab[data-tab="log"]').click();
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  console.log('E6 ricorda feedback', JSON.stringify(await sezioni(page)));
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  console.log('E6 ricorda routine', JSON.stringify(await sezioni(page)));
  // Tastiera sulla barra delle sezioni
  await page.locator('.mg-sezione[data-sezione="routine"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  console.log('E6 tastiera', JSON.stringify(await sezioni(page)), await page.evaluate(() => document.activeElement?.textContent?.trim()));
  // Finestra stretta
  await finestra(app, 700, 800);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/e6-stretta-domande.png` });
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/e6-stretta-feedback.png` });
});

test('E7 un clic dell’utente durante il caricamento vince sull’apertura', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: domande(), domandeLente: 4000 });
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && document.querySelector('.mg-sezione'));
  await page.waitForTimeout(800);
  console.log('E7 prima', JSON.stringify(await sezioni(page)));
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  console.log('E7 dopo', JSON.stringify(await sezioni(page)));
});

test('E8 una bloccante che arriva a pagina aperta', async ({ app, openTab }) => {
  test.setTimeout(150000);
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(14, { priorita: 'quando_puoi' })] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  console.log('E8 prima', JSON.stringify(await sezioni(page)));
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(14, { priorita: 'quando_puoi' }), domanda(20, { priorita: 'bloccante' })] });
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await page.waitForTimeout(65000);
  console.log('E8 dopo 65 s', JSON.stringify(await sezioni(page)), JSON.stringify((await inviati(app, 'domande_elenco')).length));
});
