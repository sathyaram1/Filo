// #2078: una domanda che il server dice fidabile (chiusa e non fidata) mostra le note per gli agenti aperte e «Segna
// fidata»; l'owner la segna, e la toglie, da qui o dal tasto destro. Una fidata dalla nascita non ha né l'uno né l'altro.
import { test, expect } from './fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './helpers/gestioneMainFinto.mjs';

const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const IERI = Date.now() - 20 * 3600 * 1000;
const NOTE = 'La parola d’ordine sta già nel registro delle chiavi: non rifarla.';

const opzioni = [
  { testo: 'Una parola per routine', pro: 'Si revoca da sola.', contro: 'Una in più.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
  { testo: 'Una parola sola', pro: 'Semplice.', contro: 'Revocarla ferma tutto.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
];
const chiusa = (numero, over) => domanda(numero, Object.assign({
  stato: 'chiusa', opzioni, esito: { ok: true, azione: opzioni[0].azione, applicataIl: IERI },
  conversazione: [{ autore: { tipo: 'biglietto', ruolo: 'sessione', fiducia: 'non_fidato' }, tipo: 'risposta', scelta: 0, testo: '', ora: IERI }],
}, over));
const NON_FIDATA = chiusa(80, { titolo: 'Parola d’ordine per la rete aperta', fiducia: 'non_fidato', fidabile: true, notePerAgenti: NOTE, registrataDa: 'sessione', rispostaDaSessione: { il: IERI, scelta: 0 } });
const FIDATA = chiusa(81, { titolo: 'Bordo spesso o sottile?', fiducia: 'fidato', notePerAgenti: 'Già provato il bordo da 2px.' });

// Il main finto risponde come il server: la fiducia cambia, col segno dell'owner quando la dà.
async function fiduciaComeIlServer(app, { rifiuta = '' } = {}) {
  await app.evaluate(({ ipcMain }, errore) => {
    const sotto = globalThis.__mgFintoOrigFiducia || ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mgFintoOrigFiducia = sotto;
    globalThis.__mandati = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      if (msg && msg.type === 'domanda_fiducia') {
        globalThis.__mandati.push(msg);
        if (errore) return { ok: false, error: errore };
        const d = (globalThis.__mgFinto.domande || []).find((x) => x.id === msg.id);
        const fidata = msg.fidata !== false;
        Object.assign(d, { fiducia: fidata ? 'fidato' : 'non_fidato', fidabile: !fidata, fidataDallOwner: fidata ? { il: Date.now() } : null, modificataIl: Date.now() });
        return { ok: true, fiducia: d.fiducia, domanda: JSON.parse(JSON.stringify(d)) };
      }
      return sotto(event, msg);
    });
  }, rifiuta);
}

async function apriArchivio(app, openTab) {
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await tab(page, 'domande-archivio').click();
  await expect(tab(page, 'domande-archivio')).toHaveText('Archivio (2)');
  return page;
}

test('chiusa non fidata: note aperte e «Segna fidata»; segnata, è fidata da te e si toglie', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [NON_FIDATA, FIDATA] });
  await fiduciaComeIlServer(app);
  const page = await apriArchivio(app, openTab);

  await riga(page, 'D-80').click();
  const k = dq(page, 'D-80');
  await expect(k.locator('.mg-dq-meta .mg-dq-fiducia')).toHaveText('Non fidata');
  await expect(k.locator('details.mg-dq-note')).toHaveAttribute('open', '');
  await expect(k.locator('details.mg-dq-note')).toContainText(NOTE);
  const segna = k.locator('button[data-fai="fidata"]');
  await expect(segna).toHaveText('Segna fidata');
  await expect(segna).toHaveAttribute('title', /note per gli agenti comprese/);
  await expect(k.locator('button[data-fai="riapri"]')).toBeVisible();
  await k.screenshot({ path: 'tests/.shots/manage-domande-fidata.png' });

  await segna.click();
  await expect(k.locator('.mg-dq-msg')).toHaveText('Fidata: chi riprende il lavoro riceve le note senza sporcarsi.');
  expect(await app.evaluate(() => globalThis.__mandati.at(-1))).toEqual({ type: 'domanda_fiducia', id: 'D-80', fidata: true });
  await expect(k.locator('.mg-dq-meta .mg-dq-fiducia')).toHaveText('Fidata');
  await expect(k.locator('.mg-dq-meta .mg-dq-fiducia')).toHaveAttribute('title', /^Segnata fidata da te /);
  await expect(riga(page, 'D-80')).toHaveClass(/mg-fiducia--fidata/);
  await expect(k.locator('button[data-fai="fidata"]')).toHaveCount(0);
  await k.screenshot({ path: 'tests/.shots/manage-domande-fidata-segnata.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await k.screenshot({ path: 'tests/.shots/manage-domande-fidata-segnata-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));

  const togli = k.locator('button[data-fai="sfidata"]');
  await expect(togli).toHaveText('Togli fiducia');
  await togli.click();
  await expect(k.locator('.mg-dq-msg')).toHaveText('Non è più fidata.');
  expect(await app.evaluate(() => globalThis.__mandati.at(-1))).toEqual({ type: 'domanda_fiducia', id: 'D-80', fidata: false });
  await expect(k.locator('.mg-dq-meta .mg-dq-fiducia')).toHaveText('Non fidata');
  await expect(k.locator('button[data-fai="fidata"]')).toBeVisible();

  // Fidata dalla nascita: niente da segnare, niente da togliere da qui.
  await riga(page, 'D-81').click();
  await expect(dq(page, 'D-81').locator('button[data-fai="fidata"], button[data-fai="sfidata"]')).toHaveCount(0);
});

test('dal tasto destro: «Segna fidata…» apre la domanda con le note, «Togli fiducia» la toglie', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [NON_FIDATA, FIDATA] });
  await fiduciaComeIlServer(app);
  const page = await apriArchivio(app, openTab);
  const menu = page.locator('.mg-ctxmenu, .sn-select-pop').last();

  await riga(page, 'D-81').click({ button: 'right' });
  await expect(menu).not.toContainText('fidata');
  await expect(menu).not.toContainText('fiducia');
  await page.keyboard.press('Escape');

  await riga(page, 'D-80').click({ button: 'right' });
  await menu.getByText('Segna fidata…').click();
  const k = dq(page, 'D-80');
  await expect(k.locator('details.mg-dq-note')).toHaveAttribute('open', '');
  expect(await app.evaluate(() => globalThis.__mandati.length), 'dal menu la fiducia non si dà senza leggere').toBe(0);
  await k.locator('button[data-fai="fidata"]').click();
  await expect(k.locator('.mg-dq-meta .mg-dq-fiducia')).toHaveText('Fidata');

  await riga(page, 'D-80').click({ button: 'right' });
  await menu.getByText('Togli fiducia').click();
  await expect(k.locator('.mg-dq-meta .mg-dq-fiducia')).toHaveText('Non fidata');
  expect(await app.evaluate(() => globalThis.__mandati.at(-1))).toEqual({ type: 'domanda_fiducia', id: 'D-80', fidata: false });
});

test('un rifiuto del server resta scritto sotto la domanda, che resta non fidata', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [NON_FIDATA, FIDATA] });
  await fiduciaComeIlServer(app, { rifiuta: 'Il server non sa ancora dare fiducia a una domanda: arriva col prossimo aggiornamento del server.' });
  const page = await apriArchivio(app, openTab);
  await riga(page, 'D-80').click();
  const k = dq(page, 'D-80');
  await k.locator('button[data-fai="fidata"]').click();
  await expect(k.locator('.mg-dq-msg')).toHaveText(/^Non riuscito: Il server non sa ancora dare fiducia/);
  await expect(k.locator('.mg-dq-meta .mg-dq-fiducia')).toHaveText('Non fidata');
  await expect(k.locator('button[data-fai="fidata"]')).toBeEnabled();
});
