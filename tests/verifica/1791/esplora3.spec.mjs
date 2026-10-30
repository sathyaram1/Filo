import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);

async function pronta(page) {
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}
async function incolla(locator, nome, tipo, b64) {
  await locator.evaluate((el, [nome, tipo, b64]) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], nome, { type: tipo }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [nome, tipo, b64]);
}

test('scrivendo, una rilettura non toglie il fuoco alla casella', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await pronta(page);
  const base = [domanda(52, { titolo: 'Colore del bordo' }), domanda(54, { titolo: 'Altra' })];
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), base);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-52').click();
  const ta = dq(page, 'D-52').locator('.mg-dq-testo');
  await ta.click();
  await page.keyboard.type('Caldo ma');
  // arrivo sopra
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [domanda(40, { titolo: 'Nuova' }), ...base]);
  await expect(riga(page, 'D-40')).toHaveCount(1);
  console.log('dopo arrivo focus:', await page.evaluate(() => document.activeElement && document.activeElement.className));
  await page.keyboard.type(' senza');
  console.log('valore1:', await ta.inputValue());
  // la domanda aperta stessa cambia (un turno dell'agente)
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [domanda(40, { titolo: 'Nuova' }),
    { ...base[0], modificataIl: Date.now(), conversazione: [{ autore: { tipo: 'biglietto', ruolo: 'x', fiducia: 'fidato' }, testo: 'Aggiunta.', ora: Date.now() }] }, base[1]]);
  await expect(dq(page, 'D-52')).toContainText('Aggiunta.');
  console.log('dopo cambio focus:', await page.evaluate(() => document.activeElement && document.activeElement.className));
  await page.keyboard.type(' esagerare');
  console.log('valore2:', await dq(page, 'D-52').locator('.mg-dq-testo').inputValue());
});

test('allegato incollato: resta a una rilettura e cambiando domanda', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(52), domanda(54)] });
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.evaluate(() => {
    let n = 0;
    window.SN_FEEDBACK.uploadAttachment = async (file, name) => ({ kind: /^image\//.test(file.type) ? 'img' : 'file', url: `https://firebasestorage.googleapis.com/v0/b/x/o/${++n}`, name, type: file.type });
  });
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-52').click();
  await incolla(dq(page, 'D-52').locator('.mg-dq-testo'), 's.png', 'image/png', PNG);
  await expect(dq(page, 'D-52').locator('.mg-dq-allegato')).toHaveCount(1);
  await page.evaluate(() => window.SN_MG_DOMANDE.carica());
  await page.waitForTimeout(500);
  console.log('dopo carica:', await dq(page, 'D-52').locator('.mg-dq-allegato').count());
  await riga(page, 'D-54').click();
  await riga(page, 'D-52').click();
  console.log('dopo cambio:', await dq(page, 'D-52').locator('.mg-dq-allegato').count());
  // solo allegato, senza testo, Rispondi
  await dq(page, 'D-52').locator('button[data-fai="testo"]').click();
  await page.waitForTimeout(800);
  console.log('msg:', await dq(page, 'D-52').locator('.mg-dq-msg').textContent());
  const mandati = await app.evaluate(() => globalThis.__mgFinto.domande.find((d) => d.id === 'D-52'));
  console.log('stato D-52:', mandati.stato);
  await page.screenshot({ path: 'tests/.shots/v3-allegato.png' });
});

test('tasto destro su automatica e in lavorazione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await pronta(page);
  const AUTO = domanda(50, {
    stato: 'chiusa', titolo: 'Automatica', esito: { ok: true, automatica: true, principio: 'D-41', applicataIl: Date.now() },
    conversazione: [{ autore: { tipo: 'biglietto', ruolo: 'smistamento' }, scelta: 0, testo: 'D-41', ora: Date.now() }],
  });
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [[AUTO, domanda(41, { stato: 'chiusa', principio: 'P', esito: { ok: true } }),
    domanda(70, { titolo: '<img src=x onerror="window.__xss=1">' + 'parola '.repeat(60), contesto: '<script>window.__xss=2</script>' })], RIFERIMENTI]);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('.mg-tab[data-tab="domande-automatiche"]').click();
  await riga(page, 'D-50').click({ button: 'right' });
  console.log('menu auto:', await page.locator('.mg-ctxmenu, .sn-select-pop').last().textContent());
  await page.keyboard.press('Escape');
  await page.locator('.mg-tab[data-tab="domande"]').click();
  await riga(page, 'D-70').click();
  console.log('xss:', await page.evaluate(() => window.__xss));
  await page.screenshot({ path: 'tests/.shots/v3-lungo.png' });
});

test('finestra stretta: dettaglio con segni e testo originale', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    if (w) w.setContentSize(720, 800);
  });
  const page = await openTab(MANAGE);
  await page.setViewportSize({ width: 720, height: 800 });
  await pronta(page);
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [[
    domanda(60, { titolo: 'Uscita com’era con un titolo abbastanza lungo da andare a capo', smistamento: 'fallito', blocca: true, legata: 'fb-813', notePerAgenti: 'n' }),
    domanda(61, { titolo: 'Riscritta', notePerAgenti: 'Testo vero.', blocca: true, legata: 'fb-813',
      opzioni: [{ testo: 'A', pro: 'p', contro: 'c', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } }, { testo: 'B', pro: 'p', contro: 'c', azione: { tipo: 'archivia', feedbackId: 'fb-813' } }] }),
  ], RIFERIMENTI]);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await riga(page, 'D-60').click();
  await page.screenshot({ path: 'tests/.shots/v3-stretta-60.png' });
  await riga(page, 'D-61').click();
  await dq(page, 'D-61').locator('.mg-dq-originale-btn').click();
  await page.screenshot({ path: 'tests/.shots/v3-stretta-61.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.screenshot({ path: 'tests/.shots/v3-stretta-61-scuro.png' });
});
