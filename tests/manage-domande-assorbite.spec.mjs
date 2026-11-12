// #1154 (SPEC-DOMANDE §3.6): le domande che la revisione assorbe in un'altra restano visibili dentro di lei e
// collegate nei due versi; l'owner ne riapre una che non è lo stesso caso, e quella esce dalla madre.
import { test, expect } from './fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from './helpers/gestioneMainFinto.mjs';

const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);

const assorbita = (n, titolo) => domanda(n, {
  stato: 'superata', titolo,
  esito: { azione: null, ok: true, applicataIl: Date.now(), superata: 'assorbita in D-70', superataDa: 'D-70', assorbita: true },
});
const MADRE = domanda(70, { titolo: 'Ripensare le barre delle schede', assorbite: ['D-71', 'D-72'] });
const LARGA = assorbita(71, 'Barra della scheda larga?');
const STRETTA = assorbita(72, 'Barra del riquadro stretta?');
// Sostituita da una domanda nuova sul suo lavoro: dice da quale, ma non si riapre.
const SOSTITUITA = domanda(73, {
  stato: 'superata', titolo: 'Attesa di prima',
  esito: { azione: null, ok: true, applicataIl: Date.now(), superataDa: 'D-70' },
});

// Il main finto risponde a riapri come il server: l'assorbita torna aperta e la madre non la porta più.
async function riapriComeIlServer(app) {
  await app.evaluate(({ ipcMain }) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mandati = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const s = globalThis.__mgFinto;
      const d = (s.domande || []).find((x) => x.id === msg.id);
      if (msg && msg.type === 'domanda_riapri' && d) {
        globalThis.__mandati.push(msg);
        const madre = (s.domande || []).find((x) => x.id === d.esito.superataDa);
        if (madre) madre.assorbite = madre.assorbite.filter((x) => x !== d.id);
        Object.assign(d, { stato: 'aperta', esito: null, modificataIl: Date.now() });
        return { ok: true, domanda: JSON.parse(JSON.stringify(d)) };
      }
      return sotto(event, msg);
    });
  });
}

test('la madre mostra le assorbite, l’assorbita porta alla madre, e «Riapri» la stacca', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [MADRE, LARGA, STRETTA, SOSTITUITA] });
  await riapriComeIlServer(app);
  const page = await openTab(MANAGE);
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(tab(page, 'domande')).toHaveText('Da rispondere (1)');
  await expect(tab(page, 'domande-archivio')).toHaveText('Archivio (3)');

  // La madre, da rispondere: le assorbite col numero e il titolo, ognuna si apre.
  await riga(page, 'D-70').click();
  const m = dq(page, 'D-70');
  await expect(m.locator('.mg-dq-assorbite-sez .mg-dq-h')).toHaveText('Domande assorbite');
  await expect(m.locator('.mg-dq-assorbite li')).toHaveText(['D-71Barra della scheda larga?', 'D-72Barra del riquadro stretta?']);
  await m.screenshot({ path: 'tests/.shots/manage-domande-madre.png' });
  await m.locator('.mg-dq-assorbite [data-domanda="D-71"]').click();

  // L'assorbita, nell'archivio: dice dov'è finita, il legame riporta alla madre, e si riapre.
  await expect(tab(page, 'domande-archivio')).toHaveClass(/mg-tab--active|active/);
  const a = dq(page, 'D-71');
  await expect(a.locator('.mg-dq-esito').first()).toHaveText('Assorbita in D-70: è un caso dello stesso problema, e la risposta lì vale anche per questa.');
  await a.screenshot({ path: 'tests/.shots/manage-domande-assorbita.png' });
  await expect(a.locator('button[data-fai="riapri"]')).toHaveAttribute('title', /Non è un caso di D-70/);
  await a.locator('button[data-fai="riapri"]').click();
  await expect(a.locator('.mg-dq-msg')).toHaveText('Riaperta: ora è fra quelle da rispondere.');
  expect(await app.evaluate(() => globalThis.__mandati.at(-1))).toEqual({ type: 'domanda_riapri', id: 'D-71' });
  await expect(tab(page, 'domande')).toHaveText('Da rispondere (2)');
  await expect(tab(page, 'domande-archivio')).toHaveText('Archivio (2)');

  // Quella sostituita da una domanda nuova dice da quale, ma non si riapre da qui.
  await riga(page, 'D-73').click();
  const s = dq(page, 'D-73');
  await expect(s.locator('.mg-dq-esito').first()).toHaveText('Superata da D-70.');
  await expect(s.locator('button[data-fai="riapri"]')).toHaveCount(0);

  // Ricaricata la lista, la madre porta solo quella che è ancora dentro.
  await page.evaluate(() => window.SN_MG_DOMANDE.carica());
  await tab(page, 'domande').click();
  await riga(page, 'D-70').click();
  await expect(dq(page, 'D-70').locator('.mg-dq-assorbite li')).toHaveText(['D-72Barra del riquadro stretta?']);
});
