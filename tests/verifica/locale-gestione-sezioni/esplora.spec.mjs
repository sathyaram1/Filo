// Esplorazione della verifica locale: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, inviati, aspettaAvvio, finestra, fb } from './aiuto.mjs';

const OUT = 'C:/Users/agenti AI/Desktop/Filo/report/ruoli-invertiti-stato/ondata1/tmp-1150/vista-verifica';

async function stato(page) {
  return page.evaluate(() => ({
    sezione: document.querySelector('.mg-sezione--active')?.dataset.sezione,
    sezioni: [...document.querySelectorAll('.mg-sezione')].filter((b) => !b.hidden).map((b) => b.textContent.trim()),
    schede: [...document.querySelectorAll('.mg-tab')].filter((b) => !b.hidden).map((b) => b.textContent.trim()),
    attiva: document.querySelector('.mg-tab--active')?.dataset.tab,
  }));
}

test('E1 apertura con bloccante e dettaglio', async ({ app, openTab }) => {
  await mainFinto(app, {
    feedbacks: PRATICHE,
    riferimenti: RIFERIMENTI,
    domande: [
      domanda(12, { priorita: 'bloccante', titolo: 'Fondo #813 adesso?', gruppo: 'Fusioni' }),
      domanda(13, { priorita: 'importante', fiducia: 'non_fidato', gruppo: 'Fusioni', titolo: '<img src=x onerror="window.__xss=1">Titolo HTML',
        contesto: 'Testo <script>window.__xss2=1</script> <img src=x onerror="window.__xss3=1"> e [link](javascript:alert(1))',
        opzioni: [{ testo: 'Approva locale', pro: 'p', contro: 'c', azione: { tipo: 'approva_locale', feedbackId: 'fb-902' } }, { testo: 'Archivia', azione: { tipo: 'archivia', feedbackId: 'fb-902' } }] }),
      domanda(14, { priorita: 'quando_puoi', opzioni: [{ testo: 'Priorità 3', azione: { tipo: 'priorita', feedbackId: 'fb-813', valore: 3 } }], consiglio: { opzione: 0, perche: 'Serve.' } }),
      domanda(10, { stato: 'in_lavorazione' }),
      domanda(9, { stato: 'chiusa', esito: { ok: true, applicataIl: Date.now() } }),
      domanda(8, { stato: 'superata' }),
    ],
  });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await finestra(app, 1536, 864);
  console.log('E1 stato', JSON.stringify(await stato(page)));
  await page.waitForTimeout(500);
  console.log('E1 dettaglio', (await page.locator('#mgDomandaDettaglio').innerText()).slice(0, 2000));
  console.log('E1 lista', await page.locator('#mgDomandeLista').innerText());
  console.log('E1 note open', await page.locator('details.mg-dq-note').first().evaluate((d) => d.open));
  await page.screenshot({ path: `${OUT}/e1-domande.png` });
  // La 13 con HTML
  await page.locator('.mg-domanda[data-id="D-13"]').click();
  await page.waitForTimeout(300);
  console.log('E1 xss', JSON.stringify(await page.evaluate(() => [window.__xss, window.__xss2, window.__xss3, document.querySelector('#mgDomandaDettaglio').innerHTML.slice(0, 1500)])));
  await page.screenshot({ path: `${OUT}/e1-d13.png` });
  // Gruppo
  const g = page.locator('.mg-domande-gruppo');
  console.log('E1 gruppi', await g.count());
  if (await g.count()) { await g.first().click(); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/e1-gruppo.png` }); }
  // Le altre schede
  for (const t of ['domande-lavoro', 'domande-archivio']) {
    await page.locator(`.mg-tab[data-tab="${t}"]`).click();
    await page.waitForTimeout(300);
    console.log('E1', t, await page.locator('#mgDomandeLista').innerText(), '|', (await page.locator('#mgDomandaDettaglio').innerText()).slice(0, 400));
  }
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  console.log('E1 feedback', JSON.stringify(await stato(page)));
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  console.log('E1 routine', JSON.stringify(await stato(page)));
  await page.screenshot({ path: `${OUT}/e1-routine.png` });
});

test('E2 apertura sui Ricevuti senza bloccante, filtro livelli', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(12)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await finestra(app, 1536, 864);
  console.log('E2 stato', JSON.stringify(await stato(page)));
  const livelli = page.locator('.mg-livello-btn');
  console.log('E2 livelli', JSON.stringify(await livelli.allInnerTexts()));
  const nums = async () => (await page.locator('.mg-item').allInnerTexts()).map((x) => (x.match(/#\d+/) || [''])[0]).join(' ');
  console.log('E2 tutti', await nums());
  for (const l of ['l1', 'l2', 'l3', 'l4', 'l5']) {
    await page.locator(`.mg-livello-btn[data-livello="${l}"]`).click();
    console.log('E2', l, await nums(), '| head', await page.locator('#mgListHead').innerText(), '| tab', await page.locator('.mg-tab[data-tab="inbox"]').innerText(), '| sez', await page.locator('.mg-sezione[data-sezione="feedback"]').innerText());
    await page.locator(`.mg-livello-btn[data-livello="${l}"]`).click();
  }
  await page.locator('.mg-livello-btn[data-livello="l1"]').click();
  await page.locator('.mg-livello-btn[data-livello="l4"]').click();
  console.log('E2 l1+l4', await nums());
  await page.screenshot({ path: `${OUT}/e2-ricevuti-l1l4.png` });
  await page.locator('.mg-livello-btn[data-livello="l1"]').click();
  await page.locator('.mg-livello-btn[data-livello="l4"]').click();
  console.log('E2 spenti', await nums());
});

test('E3 ultima sezione usata', async ({ app, openTab }) => {
  const senzaRicevuti = PRATICHE.filter((f) => f.status === 'todo');
  await mainFinto(app, { feedbacks: senzaRicevuti, riferimenti: RIFERIMENTI, domande: [domanda(12)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  console.log('E3 primo', JSON.stringify(await stato(page)));
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.locator('.mg-tab[data-tab="log"]').click();
  await page.reload();
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  console.log('E3 dopo reload routine/log', JSON.stringify(await stato(page)));
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('.mg-tab[data-tab="domande-archivio"]').click();
  await page.reload();
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  console.log('E3 dopo reload domande/archivio', JSON.stringify(await stato(page)));
  // Ora arriva una bloccante: vince sull'ultima
  await mainFinto(app, { feedbacks: senzaRicevuti, riferimenti: RIFERIMENTI, domande: [domanda(12), domanda(15, { priorita: 'bloccante' })] });
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.reload();
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  console.log('E3 bloccante dopo routine', JSON.stringify(await stato(page)));
  // Domande guaste: niente numeri
  await mainFinto(app, { feedbacks: senzaRicevuti, riferimenti: RIFERIMENTI, domandeErr: 'Il server non risponde: controlla la connessione e riprova.' });
  await page.reload();
  await aspettaAvvio(page);
  await page.waitForTimeout(500);
  console.log('E3 guasto', JSON.stringify(await stato(page)));
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  console.log('E3 guasto domande', await page.locator('#panel-domande').innerText());
});
