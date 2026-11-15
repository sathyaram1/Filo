// Verifica #2229 giro 3: un «da fare» con testi ostili e finestra stretta, in chiaro e in scuro (esplorazione).
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ora = Date.now();
const RIF = { fb1736: { num: '#1736', priorita: 1, stato: 'design', motivo: 'locale' } };
const base = (numero, over) => Object.assign({
  id: `D-${numero}`, numero, stato: 'aperta', priorita: 'importante', fiducia: 'fidato',
  titolo: `Domanda ${numero}`, creataIl: ora - numero * 1000, modificataIl: ora - numero * 1000,
  opzioni: [], consiglio: null, conversazione: [],
}, over);
const OSTILE = base(31, {
  tipo: 'da_fare', blocca: true, legata: 'fb1736',
  titolo: '<img src=x onerror="window.__x=1"> Rinnova 🔑 il segreto lunghissimo lunghissimo lunghissimo',
  problema: 'Passo 1 '.repeat(200),
  collegamenti: [{ tipo: 'feedback', id: 'fb1736' }],
  opzioni: [{ testo: '<b>fatto</b>', azione: { tipo: 'riprendi', feedbackId: 'fb1736' } }],
});
const CHIUSO = base(32, {
  tipo: 'da_fare', stato: 'chiusa', titolo: 'Token rinnovato',
  opzioni: [{ testo: 'Fatto', azione: { tipo: 'nessuna' } }],
  conversazione: [{ tipo: 'risposta', scelta: 0, autore: { tipo: 'owner' } }], esito: { ok: true, applicataIl: ora },
});

for (const tema of ['light', 'dark']) {
  test(`un «da fare» ostile in finestra stretta, tema ${tema}`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await page.emulateMedia({ colorScheme: tema });
    await page.setViewportSize({ width: 520, height: 700 });
    await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [[OSTILE, CHIUSO], RIF]);
    await page.locator('.mg-sezione[data-sezione="domande"]').click();
    const riga = page.locator('#mgDomandeLista .mg-domanda[data-id="D-31"]');
    await expect(riga.locator('.mg-domanda-tipo')).toHaveText('da fare');
    await riga.click();
    const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-31"]');
    await expect(dq.locator('.mg-dq-azione')).toHaveText(['Fatto: riprendi #1736']);
    expect(await page.evaluate(() => window.__x)).toBeUndefined();
    await page.screenshot({ path: `tests/.shots/v2229-g3-${tema}.png` });
    await page.locator('.mg-tab[data-tab="domande-archivio"]').click().catch(() => {});
    await page.screenshot({ path: `tests/.shots/v2229-g3-archivio-${tema}.png` });
  });
}
