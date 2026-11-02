// #1924: una risposta registrata da una sessione locale con la sua parola d'ordine porta in Gestione il suo segno,
// distinto da quella data qui, in riga e nel dettaglio; e si riapre.
import { test, expect } from './fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './helpers/gestioneMainFinto.mjs';

const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const IERI = Date.now() - 20 * 3600 * 1000;

const opzioni = [
  { testo: 'Caldo', pro: 'È Filo.', contro: 'Meno contrasto.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
  { testo: 'Freddo', pro: 'Più contrasto.', contro: 'Non è Filo.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
];
const DALLA_SESSIONE = domanda(70, {
  stato: 'chiusa', titolo: 'Caldo o freddo?', opzioni,
  esito: { ok: true, azione: opzioni[0].azione, applicataIl: IERI },
  registrataDa: 'sessione', rispostaDaSessione: { il: IERI, scelta: 0 },
  conversazione: [{ autore: { tipo: 'biglietto', ruolo: 'sessione', fiducia: 'fidato' }, tipo: 'risposta', scelta: 0, testo: 'Caldo, come ha detto in chat.', ora: IERI }],
});
const DA_QUI = domanda(71, {
  stato: 'chiusa', titolo: 'Bordo spesso o sottile?', opzioni,
  esito: { ok: true, azione: opzioni[0].azione, applicataIl: IERI },
  conversazione: [{ autore: { tipo: 'owner', fiducia: 'fidato' }, tipo: 'risposta', scelta: 0, testo: '', ora: IERI }],
});

// Il main finto risponde a riapri come il server: aperta, senza esito e senza il segno della sessione.
async function riapriComeIlServer(app) {
  await app.evaluate(({ ipcMain }) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mandati = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const s = globalThis.__mgFinto;
      if (msg && msg.type === 'domanda_riapri') {
        globalThis.__mandati.push(msg);
        const d = (s.domande || []).find((x) => x.id === msg.id);
        Object.assign(d, { stato: 'aperta', esito: null, registrataDa: '', rispostaDaSessione: null, modificataIl: Date.now() });
        return { ok: true, domanda: JSON.parse(JSON.stringify(d)) };
      }
      return sotto(event, msg);
    });
  });
}

test('la risposta registrata da una sessione locale si distingue da quella data qui, e si riapre', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [DALLA_SESSIONE, DA_QUI] });
  await riapriComeIlServer(app);
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await tab(page, 'domande-archivio').click();
  await expect(tab(page, 'domande-archivio')).toHaveText('Archivio (2)');

  await expect(riga(page, 'D-70').locator('.mg-domanda-sotto')).toHaveText('risposta da una sessione');
  await expect(riga(page, 'D-71').locator('.mg-domanda-sotto')).toHaveCount(0);
  const menu = page.locator('.mg-ctxmenu, .sn-select-pop').last();
  await riga(page, 'D-70').click({ button: 'right' });
  await expect(menu).toContainText('Riapri');
  await page.keyboard.press('Escape');

  await riga(page, 'D-70').click();
  const k = dq(page, 'D-70');
  await expect(k.locator('.mg-dq-esito--chiave')).toHaveText('Risposta registrata da una sessione locale, non da qui.');
  await expect(k.locator('button[data-fai="riapri"]')).toHaveAttribute('title', /torna fermo finché non rispondi/);
  await k.screenshot({ path: 'tests/.shots/manage-domande-sessione.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await k.screenshot({ path: 'tests/.shots/manage-domande-sessione-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));

  await riga(page, 'D-71').click();
  await expect(dq(page, 'D-71').locator('.mg-dq-esito--chiave')).toHaveCount(0);
  await expect(dq(page, 'D-71').locator('button[data-fai="riapri"]')).toHaveCount(0);

  await riga(page, 'D-70').click();
  await k.locator('button[data-fai="riapri"]').click();
  await expect(k.locator('.mg-dq-msg')).toHaveText('Riaperta: ora è fra quelle da rispondere.');
  expect(await app.evaluate(() => globalThis.__mandati.at(-1))).toEqual({ type: 'domanda_riapri', id: 'D-70' });
  await expect(tab(page, 'domande')).toHaveText('Da rispondere (1)');
  await expect(k.locator('.mg-dq-esito--chiave')).toHaveCount(0);
});
