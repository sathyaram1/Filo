// LE RADICI SU UNA DOMANDA NON FIDATA (#1918, SPEC-DOMANDE.md §1.8): accanto a «Non fidata» i testi da cui viene, coi
// chip dei feedback; un clic timbra la radice (al main va la radice) e il messaggio dice quante cose hanno cambiato
// fiducia. Una domanda fidata non chiede niente.
import { test, expect } from './fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './helpers/gestioneMainFinto.mjs';

const UTENTE = { radice: 'feedback:1916', tipo: 'feedback', valore: '1916', timbrata: false, testoUtente: true, daLeggere: true, timbrabile: true };
const LEGACY = { radice: 'legacy', tipo: 'legacy', valore: '', timbrata: false, testoUtente: false, daLeggere: false, timbrabile: true };

async function radiciComeIlServer(app, lista = [UTENTE, LEGACY], fiducia = 'non_fidato') {
  await app.evaluate(({ ipcMain }, [radici, fiducia]) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mandati = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const t = msg && msg.type;
      if (t === 'fiducia_radici') { globalThis.__mandati.push(msg); return { ok: true, fiducia, radici }; }
      if (t === 'fiducia_segna') { globalThis.__mandati.push(msg); return { ok: true, radice: msg.radice, timbrata: true, cambiati: { domande: 2, feedback: 1 } }; }
      return sotto(event, msg);
    });
  }, [lista, fiducia]);
}

async function apri(app, openTab, domande) {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande });
  await radiciComeIlServer(app);
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  return page;
}

test('una domanda non fidata mostra le sue radici, e un clic timbra la radice', async ({ app, openTab }) => {
  const page = await apri(app, openTab, [domanda(90, { titolo: 'Il riquadro si chiude da solo: quale strada?', fiducia: 'non_fidato' })]);
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-90"]').click();
  const k = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-90"]');
  const utente = k.getByRole('button', { name: '#1916' });
  await expect(utente).toBeVisible();
  await expect(utente).toHaveAttribute('title', /testo dell’utente di #1916: leggilo prima/);
  await expect(k.getByRole('button', { name: 'nato prima' })).toBeVisible();
  expect(await app.evaluate(() => globalThis.__mandati.find((m) => m.type === 'fiducia_radici'))).toEqual({ type: 'fiducia_radici', domandaId: 'D-90' });
  await k.screenshot({ path: 'tests/.shots/manage-domande-radici.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await k.screenshot({ path: 'tests/.shots/manage-domande-radici-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));
  await utente.click();
  await expect.poll(() => app.evaluate(() => globalThis.__mandati.filter((m) => m.type === 'fiducia_segna'))).toEqual([{ type: 'fiducia_segna', radice: 'feedback:1916' }]);
  await expect(k.locator('.mg-dq-msg')).toHaveText('«#1916» timbrata: 3 cose hanno cambiato fiducia.');
});

test('una domanda fidata non chiede le radici e non ha il cartellino', async ({ app, openTab }) => {
  const page = await apri(app, openTab, [domanda(91, { titolo: 'Bordo spesso o sottile?', fiducia: 'fidato' })]);
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-91"]').click();
  const k = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-91"]');
  await expect(k).toBeVisible();
  await expect(k.locator('.mg-radice')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__mandati.filter((m) => m.type === 'fiducia_radici'))).toEqual([]);
});

test('una domanda fidata per un timbro mostra la radice timbrata, e un clic toglie il timbro', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [domanda(92, { titolo: 'Nata prima, timbrata', fiducia: 'fidato', radici: ['legacy'] })] });
  await radiciComeIlServer(app, [Object.assign({}, LEGACY, { timbrata: true })], 'fidato');
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-92"]').click();
  const k = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-92"]');
  const chip = k.getByRole('button', { name: '✓ nato prima' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect.poll(() => app.evaluate(() => globalThis.__mandati.filter((m) => m.type === 'fiducia_segna'))).toEqual([{ type: 'fiducia_segna', radice: 'legacy', fidato: false }]);
});
