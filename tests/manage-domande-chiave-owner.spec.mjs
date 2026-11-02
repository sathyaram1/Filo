// #2011: una risposta registrata dalla chiave owner-non-fidato (l'owner da una sede cloud non fidata) porta in Gestione
// il suo segno, distinto da quella data qui: in riga, nel dettaglio e nel turno della conversazione; e si riapre.
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
const DALLA_CHIAVE = domanda(60, {
  stato: 'chiusa', titolo: 'Caldo o freddo?', fiducia: 'non_fidato', opzioni,
  esito: { ok: true, azione: opzioni[1].azione, applicataIl: IERI },
  rispostaDaChiave: { slug: 'filo-ricerca', il: IERI, scelta: 1, archiviata: false },
  conversazione: [{ autore: { tipo: 'chiave', ruolo: 'owner-non-fidato', chiave: 'filo-ricerca', fiducia: 'non_fidato' }, tipo: 'risposta', scelta: 1, testo: 'Freddo, ma col bordo caldo.', ora: IERI }],
});
const DA_QUI = domanda(61, {
  stato: 'chiusa', titolo: 'Bordo spesso o sottile?', opzioni,
  esito: { ok: true, azione: opzioni[0].azione, applicataIl: IERI },
  conversazione: [{ autore: { tipo: 'owner', fiducia: 'fidato' }, tipo: 'risposta', scelta: 0, testo: '', ora: IERI }],
});
const ARCHIVIATA = domanda(62, {
  stato: 'chiusa', titolo: 'Ombre sì o no?', fiducia: 'non_fidato', opzioni,
  esito: { ok: true, azione: null, archiviata: true, applicataIl: IERI },
  rispostaDaChiave: { slug: 'filo-ricerca', il: IERI, scelta: null, archiviata: true },
  conversazione: [{ autore: { tipo: 'chiave', ruolo: 'owner-non-fidato', chiave: 'filo-ricerca', fiducia: 'non_fidato' }, tipo: 'esito', testo: 'Archiviata senza azioni.', ora: IERI }],
});

// Il main finto risponde a riapri come il server: aperta, senza esito e senza il segno della chiave.
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
        Object.assign(d, { stato: 'aperta', esito: null, rispostaDaChiave: null, modificataIl: Date.now() });
        return { ok: true, domanda: JSON.parse(JSON.stringify(d)) };
      }
      return sotto(event, msg);
    });
  });
}

test('la risposta della chiave owner-non-fidato si distingue da quella data qui, e si riapre', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [DALLA_CHIAVE, DA_QUI, ARCHIVIATA] });
  await riapriComeIlServer(app);
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await tab(page, 'domande-archivio').click();
  await expect(tab(page, 'domande-archivio')).toHaveText('Archivio (3)');

  // In riga, senza aprire: chi ha risposto fuori da qui. Quella data qui non ha il segno.
  await expect(riga(page, 'D-60').locator('.mg-domanda-sotto')).toHaveText('risposta da «filo-ricerca»');
  await expect(riga(page, 'D-62').locator('.mg-domanda-sotto')).toHaveText('risposta da «filo-ricerca»');
  await expect(riga(page, 'D-61').locator('.mg-domanda-sotto')).toHaveCount(0);
  // Il tasto destro sulla riga offre «Riapri» per la risposta della chiave, non per quella data qui.
  const menu = page.locator('.mg-ctxmenu, .sn-select-pop').last();
  await riga(page, 'D-60').click({ button: 'right' });
  await expect(menu).toContainText('Riapri');
  await page.keyboard.press('Escape');
  await riga(page, 'D-61').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText('Riapri');
  await page.keyboard.press('Escape');

  // Nel dettaglio: il segno sotto l'esito, il turno «Tu, da …» non fidato, e «Riapri».
  await riga(page, 'D-60').click();
  const k = dq(page, 'D-60');
  await expect(k.locator('.mg-dq-esito--chiave')).toHaveText('Risposta registrata da «filo-ricerca», non da qui.');
  await expect(k.locator('.mg-dq-esito--chiave')).toHaveAttribute('title', /Se non la ricordi, riaprila/);
  const turno = k.locator('.mg-dq-turno').first();
  await expect(turno).toHaveAttribute('data-autore', 'chiave');
  await expect(turno.locator('.mg-dq-turno-chi')).toHaveText('Tu, da «filo-ricerca»');
  await expect(turno.locator('.mg-dq-fiducia--no')).toHaveText('non fidato');
  await expect(turno.locator('.mg-dq-turno-scelta')).toHaveText('opzione 2');
  await expect(k.locator('button[data-fai="riapri"]')).toHaveAttribute('title', /la risposta da «filo-ricerca» ha applicato resta finché non rispondi/);
  await k.screenshot({ path: 'tests/.shots/manage-domande-chiave.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await k.screenshot({ path: 'tests/.shots/manage-domande-chiave-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));

  // Quella data qui: «Tu», nessun segno, nessun «Riapri» (un'azione applicata dall'owner non si annulla da qui).
  await riga(page, 'D-61').click();
  const o = dq(page, 'D-61');
  await expect(o.locator('.mg-dq-turno-chi')).toHaveText('Tu');
  await expect(o.locator('.mg-dq-esito--chiave')).toHaveCount(0);
  await expect(o.locator('button[data-fai="riapri"]')).toHaveCount(0);

  // L'archiviata dalla chiave lo dice, e si riapre come ogni archiviata.
  await riga(page, 'D-62').click();
  await expect(dq(page, 'D-62').locator('.mg-dq-esito--chiave')).toHaveText('Archiviata da «filo-ricerca», non da qui.');

  // «Riapri» sulla risposta della chiave: torna fra quelle da rispondere, senza più il segno.
  await riga(page, 'D-60').click();
  await k.locator('button[data-fai="riapri"]').click();
  await expect(k.locator('.mg-dq-msg')).toHaveText('Riaperta: ora è fra quelle da rispondere.');
  expect(await app.evaluate(() => globalThis.__mandati.at(-1))).toEqual({ type: 'domanda_riapri', id: 'D-60' });
  await expect(tab(page, 'domande')).toHaveText('Da rispondere (1)');
  await expect(k.locator('.mg-dq-esito--chiave')).toHaveCount(0);
});
