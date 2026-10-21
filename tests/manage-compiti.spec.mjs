// Gestione → Routine → Compiti (#1196, SPEC-DOMANDE.md §6.5): aperti nell'ordine del server, in corso, storico, con
// modello, costo ed esito di ogni chiamata; un compito senza feedback si crea e si annulla da qui. Il main è finto in
// pagina, come manage-crediti.spec.mjs: la porta vera la prova tests/unit/compiti.test.mjs, il server le sue prove.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const ORA = Date.now();
const MIN = 60 * 1000;

const P3 = {
  id: 'C-5', numero: 5, tipo: 'fase', stato: 'aperto', aperto: true, feedbackId: 'fb-1196', feedbackNum: '#1196', fase: 'primo',
  ruolo: 'new-work', priorita: 3, urgenza: 53, modello: 'opus', sforzo: 'xhigh', ambito: 'lavoro', fiducia: 'fidato', figlio: false,
  creatoIl: ORA - 30 * MIN, biglietti: [],
};
const MANUALE = {
  id: 'C-7', numero: 7, tipo: 'manuale', stato: 'aperto', aperto: true, urgenza: 45, modello: '', sforzo: '', ambito: 'lavoro',
  fiducia: 'fidato', creatoIl: ORA - 5 * MIN, titolo: 'Guarda i log <b>di ieri</b>', istruzioni: 'Tutti\ne due', biglietti: [],
};
const IN_CORSO = {
  id: 'C-4', numero: 4, tipo: 'fase', stato: 'in_corso', aperto: true, feedbackId: 'fb-813', feedbackNum: '#813', fase: 'verifica',
  ruolo: 'verifier', priorita: 2, urgenza: 38, modello: 'opus', sforzo: 'high', ambito: 'lavoro', fiducia: 'fidato', figlio: false,
  creatoIl: ORA - 90 * MIN,
  biglietti: [
    { id: 'ab12cd34', ruolo: 'verifier', modello: 'opus', sforzo: 'high', inizio: ORA - 80 * MIN, fine: ORA - 70 * MIN, costo: 1.2, consegne: 0, guasto: 'clone rotto', esito: 'guasto' },
    { id: 'ef56ab12', ruolo: 'verifier', modello: 'opus', sforzo: 'high', inizio: ORA - 12 * MIN, fine: 0, vivo: true, costo: 0.4, consegne: 0, guasto: '', esito: '' },
  ],
};
const FATTO = {
  id: 'C-2', numero: 2, tipo: 'fase', stato: 'fatto', aperto: false, feedbackId: 'fb-700', feedbackNum: '#700.2', fase: 'controllo',
  ruolo: 'secaudit', priorita: 1, urgenza: 30, modello: '', sforzo: '', fiducia: 'non_fidato', figlio: true, creatoIl: ORA - 300 * MIN,
  chiusoIl: ORA - 200 * MIN, esito: 'aspetta la fusione',
  biglietti: [{ id: '99aa88bb', ruolo: 'secaudit', modello: '', sforzo: '', inizio: ORA - 260 * MIN, fine: ORA - 210 * MIN, costo: 0.8, consegne: 1, guasto: '', esito: 'aspetta la fusione' }],
};
const VECCHIO = { ...FATTO, id: 'C-1', numero: 1, feedbackNum: '#650', stato: 'superato', esito: 'risolto', chiusoIl: ORA - 900 * MIN, biglietti: [] };

// Un main finto con lo stato del server: `crea` e `annulla` lo cambiano come ownerCompiti.
async function apri(openTab, { owner = true, elenco = null, falliscono = false } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_COMPITI && window.__mgCompiti);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ owner, elenco, falliscono, base }) => {
    window.__cp = { aperti: base.aperti, storico: base.storico, vecchi: base.vecchi, inviati: [], letture: 0, falliscono };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const cp = window.__cp;
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: owner, signedIn: true };
      if (msg && msg.type === 'compiti_elenco') {
        cp.letture += 1;
        cp.inviati.push(msg);
        // Una lettura lenta vede lo stato di quando è partita, come quella vera.
        const fotografia = JSON.parse(JSON.stringify({ aperti: cp.aperti, storico: cp.storico }));
        if (cp.lento) {
          await new Promise((r) => setTimeout(r, cp.lento));
          return { ok: true, aperti: fotografia.aperti, storico: fotografia.storico, altri: true, adesso: Date.now() };
        }
        if (cp.falliscono) return { ok: false, error: 'Il server non risponde.' };
        if (msg.prima) return { ok: true, aperti: cp.aperti, storico: cp.vecchi, altri: false, adesso: Date.now() };
        return JSON.parse(JSON.stringify(elenco || { ok: true, aperti: cp.aperti, storico: cp.storico, altri: true, adesso: Date.now() }));
      }
      if (msg && msg.type === 'compito_crea') {
        cp.inviati.push(msg);
        const c = Object.assign({ id: 'C-9', numero: 9, tipo: 'manuale', stato: 'aperto', aperto: true, fiducia: 'fidato', creatoIl: Date.now(), biglietti: [] }, msg.compito);
        cp.aperti = cp.aperti.concat([c]).sort((a, b) => b.urgenza - a.urgenza);
        return { ok: true, id: 'C-9' };
      }
      if (msg && msg.type === 'compito_annulla') {
        cp.inviati.push(msg);
        const c = cp.aperti.find((x) => x.id === msg.id);
        cp.aperti = cp.aperti.filter((x) => x.id !== msg.id);
        cp.storico = [Object.assign({}, c, { stato: 'annullato', aperto: false, chiusoIl: Date.now(), esito: 'annullato' })].concat(cp.storico);
        return { ok: true, id: msg.id };
      }
      return orig(msg);
    };
  }, { owner, elenco, falliscono, base: { aperti: [P3, IN_CORSO, MANUALE], storico: [FATTO], vecchi: [VECCHIO] } });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await apriScheda(page, 'compiti');
  await expect(page.locator('#panel-compiti')).toHaveClass(/mg-panel--active/);
  return page;
}

const parte = (page, nome) => page.locator(`.mg-cp-parte[data-parte="${nome}"]`);
const righe = (page, nome) => parte(page, nome).locator('.mg-cp-riga');

test('la scheda Compiti sta fra le Routine: aperti nell\'ordine del server, in corso, storico con l\'esito', async ({ openTab }) => {
  const page = await apri(openTab);
  await expect(righe(page, 'inAttesa')).toHaveCount(2);
  await expect(righe(page, 'inAttesa').locator('.mg-cp-nome')).toHaveText(['#1196 · primo lavoro', 'C-7 · Guarda i log <b>di ieri</b>']);
  await expect(page.locator('#panel-compiti b')).toHaveCount(0, { timeout: 1000 });
  await expect(righe(page, 'inAttesa').first().locator('.mg-cp-urg')).toHaveText('u 53');
  await expect(righe(page, 'inAttesa').first().locator('.mg-cp-urg')).toHaveAttribute('title', 'Urgenza 53: priorità 3, primo lavoro, fidato');
  await expect(righe(page, 'inAttesa').first()).toContainText('opus · xhigh');
  await expect(righe(page, 'inAttesa').first()).toContainText('in attesa da 30 min');

  const inCorso = righe(page, 'inCorso');
  await expect(inCorso).toHaveCount(1);
  await expect(inCorso.locator('.mg-cp-nome')).toHaveText('#813 · verifica');
  await expect(inCorso).toContainText('2 chiamate');
  await expect(inCorso).toContainText('1,60 $');
  await expect(inCorso).toContainText('in corso da 12 min');
  await expect(inCorso).toHaveAttribute('data-stato', 'in_corso');

  await expect(righe(page, 'storico').locator('.mg-cp-nome')).toHaveText(['#700.2 · controllo cieco']);
  await expect(righe(page, 'storico')).toContainText('fatto: aspetta la fusione');
  await expect(parte(page, 'storico').locator('.mg-cp-n')).toHaveText('1+', { timeout: 1000 });
  await expect(page.locator('#mgCpAltri')).toBeVisible();
  await expect(page.locator('#mgCpNegato')).toBeHidden();
  await expect(page.locator('#mgCpCarica')).toBeHidden();
});

test('un clic apre le chiamate: modello, durata, costo, esito, guasto; il compito di un feedback apre il feedback', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [{ clientId: 'x', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x', _id: 'fb-813', seq: 813, name: 'Verifica in corso', status: 'revision_capability', branch: 'worker/x' }]);
  const r = righe(page, 'inCorso').first();
  await r.click();
  await expect(r).toHaveAttribute('aria-expanded', 'true');
  const chiamate = r.locator('.mg-cp-chiamata');
  await expect(chiamate).toHaveCount(2);
  await expect(chiamate.nth(0)).toContainText('Verifica');
  await expect(chiamate.nth(0)).toContainText('10 min');
  await expect(chiamate.nth(0)).toContainText('1,20 $');
  await expect(chiamate.nth(0).locator('.mg-cp-guasto')).toHaveText('clone rotto');
  await expect(chiamate.nth(1)).toContainText('al lavoro da 12 min');
  await expect(r.getByRole('button', { name: 'Annulla il compito' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/manage-compiti-dettaglio.png' });

  await r.getByRole('button', { name: 'Apri il feedback' }).click();
  await expect(page.locator('.mg-item--selected')).toHaveAttribute('data-id', 'fb-813');
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('nuovo compito: si rifiuta prima di mandare, si crea con le scelte, compare aperto e si annulla con conferma', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('#mgCpNuovoApri').click();
  await expect(page.locator('#mgCpNuovo')).toBeVisible();
  await expect(page.locator('#mgCpTitolo')).toBeFocused();
  await page.locator('#mgCpCrea').click();
  await expect(page.locator('#mgCpMsg')).toHaveText('Scrivi un titolo.');
  await page.locator('#mgCpTitolo').fill('   ');
  await page.locator('#mgCpCrea').click();
  await expect(page.locator('#mgCpMsg')).toHaveText('Scrivi un titolo.');
  await page.locator('#mgCpUrgenza').fill('150');
  await page.locator('#mgCpTitolo').fill('Rifai #813 con Sonnet 🙂');
  await page.locator('#mgCpCrea').click();
  await expect(page.locator('#mgCpMsg')).toContainText('da 0 a 99');
  expect(await page.evaluate(() => window.__cp.inviati.filter((m) => m.type === 'compito_crea').length)).toBe(0);

  await page.locator('#mgCpUrgenza').fill('46');
  await page.locator('#mgCpIstruzioni').fill('Stesso feedback, modello diverso.');
  await page.locator('#mgCpModello').selectOption('sonnet');
  await page.locator('#mgCpSforzo').selectOption('high');
  await page.screenshot({ path: 'tests/.shots/manage-compiti-nuovo.png' });
  await page.locator('#mgCpTitolo').press('Control+Enter');
  await expect(page.locator('#mgCpNuovo')).toBeHidden();
  const crea = await page.evaluate(() => window.__cp.inviati.find((m) => m.type === 'compito_crea'));
  expect(crea.compito).toEqual({ titolo: 'Rifai #813 con Sonnet 🙂', istruzioni: 'Stesso feedback, modello diverso.', urgenza: 46, modello: 'sonnet', sforzo: 'high', ambito: 'lavoro' });
  const nuovo = page.locator('.mg-cp-riga[data-id="C-9"]');
  await expect(nuovo.locator('.mg-cp-nome')).toHaveText('C-9 · Rifai #813 con Sonnet 🙂');
  await expect(nuovo).toBeFocused();
  await expect(nuovo).toHaveAttribute('aria-expanded', 'true');
  await expect(nuovo).toContainText('Nessuna chiamata: aspetta il ruolo che esegue i compiti senza feedback.');
  await expect(righe(page, 'inAttesa').locator('.mg-cp-nome')).toHaveText(['#1196 · primo lavoro', 'C-9 · Rifai #813 con Sonnet 🙂', 'C-7 · Guarda i log <b>di ieri</b>']);

  await nuovo.getByRole('button', { name: 'Annulla il compito' }).click();
  expect(await page.evaluate(() => window.__cp.inviati.filter((m) => m.type === 'compito_annulla').length)).toBe(0);
  await nuovo.getByRole('button', { name: 'Sì, annullalo' }).click();
  await expect(page.locator('.mg-cp-parte[data-parte="inAttesa"] .mg-cp-riga[data-id="C-9"]')).toHaveCount(0);
  await expect(page.locator('.mg-cp-parte[data-parte="storico"] .mg-cp-riga[data-id="C-9"]')).toContainText('annullato');
});

test('tasto destro: le stesse azioni della riga, più nuovo compito e rilettura; Esc chiude il modulo', async ({ openTab }) => {
  const page = await apri(openTab);
  await righe(page, 'inAttesa').nth(1).click({ button: 'right' });
  const voci = page.locator('.mg-ctxmenu .sn-select-option');
  await expect(voci).toHaveText(['Mostra le chiamate', 'Annulla il compito', 'Copia il nome', 'Nuovo compito', 'Rileggi dal server']);
  const prima = await page.evaluate(() => window.__cp.letture);
  await voci.filter({ hasText: 'Rileggi dal server' }).click();
  await expect.poll(() => page.evaluate(() => window.__cp.letture)).toBe(prima + 1);
  await righe(page, 'inAttesa').first().click({ button: 'right' });
  await expect(voci.first()).toHaveText('Apri il feedback');
  await page.keyboard.press('Escape');
  await page.locator('#mgCpNuovoApri').click();
  await page.locator('#mgCpTitolo').press('Escape');
  await expect(page.locator('#mgCpNuovo')).toBeHidden();
  await expect(page.locator('#mgCpNuovoApri')).toBeFocused();
});

test('i più vecchi si chiedono a pagine e si aggiungono sotto; tastiera: Invio apre e chiude', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('#mgCpAltri').click();
  await expect(righe(page, 'storico').locator('.mg-cp-nome')).toHaveText(['#700.2 · controllo cieco', '#650 · controllo cieco']);
  await expect(page.locator('#mgCpAltri')).toBeHidden();
  const chiesta = await page.evaluate(() => window.__cp.inviati.filter((m) => m.type === 'compiti_elenco').pop());
  expect(chiesta.prima).toBe(FATTO.chiusoIl);
  // Una rilettura della prima pagina non toglie i più vecchi già chiesti.
  await page.evaluate(() => window.__mgCompiti.carica());
  await expect(righe(page, 'storico')).toHaveCount(2);
  const r = righe(page, 'storico').first();
  await r.focus();
  await page.keyboard.press('Enter');
  await expect(r).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(r).toHaveAttribute('aria-expanded', 'false');
});

test('senza l\'account dell\'owner la scheda lo dice, senza righe e senza «Nuovo compito»', async ({ openTab }) => {
  const page = await apri(openTab, { owner: false });
  await expect(page.locator('#mgCpNegato')).toBeVisible();
  await expect(page.locator('#mgCpParti')).toBeHidden();
  await expect(page.locator('#mgCpCarica')).toBeHidden();
  await expect(page.locator('#mgCpNuovoApri')).toBeDisabled();
});

test('una lettura fallita lo dice e non cancella le righe già lette', async ({ openTab }) => {
  const page = await apri(openTab);
  await expect(righe(page, 'inAttesa')).toHaveCount(2);
  await page.evaluate(() => { window.__cp.falliscono = true; });
  await page.evaluate(() => window.__mgCompiti.carica());
  await expect(page.locator('#mgCpStato')).toHaveText('Non riesco ad aggiornare: Il server non risponde.');
  await expect(righe(page, 'inAttesa')).toHaveCount(2);
  await page.evaluate(() => { window.__cp.falliscono = false; });
  await page.evaluate(() => window.__mgCompiti.carica());
  await expect(page.locator('#mgCpStato')).toHaveText(/^Aggiornati alle \d\d:\d\d$/);
});

test('a server vuoto ogni parte dice che è vuota, senza inventare numeri', async ({ openTab }) => {
  const page = await apri(openTab, { elenco: { ok: true, aperti: [], storico: [], altri: false, adesso: Date.now() } });
  await expect(parte(page, 'inAttesa').locator('.mg-cp-vuoto')).toBeVisible();
  await expect(parte(page, 'inCorso').locator('.mg-cp-vuoto')).toHaveText('Nessun agente al lavoro.');
  await expect(parte(page, 'storico').locator('.mg-cp-vuoto')).toBeVisible();
  await expect(parte(page, 'storico').locator('.mg-cp-n')).toHaveText('');
  await expect(page.locator('#mgCpAltri')).toBeHidden();
});

test('tema scuro: la scheda si legge come in chiaro', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await righe(page, 'inCorso').first().click();
  const colori = await page.evaluate(() => {
    const nome = document.querySelector('.mg-cp-nome');
    return { testo: getComputedStyle(nome).color, fondo: getComputedStyle(document.body).backgroundColor };
  });
  expect(colori.testo).not.toBe(colori.fondo);
  await page.screenshot({ path: 'tests/.shots/manage-compiti-scuro.png' });
});

test('creato mentre una rilettura è in volo, il compito compare lo stesso, e la tastiera conferma l\'annullamento', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => { window.__cp.lento = 800; window.__mgCompiti.carica(); });
  await page.locator('#mgCpNuovoApri').click();
  await page.locator('#mgCpTitolo').fill('Durante la rilettura');
  await page.locator('#mgCpAmbito').selectOption('server');
  await page.locator('#mgCpCrea').click();
  const nuovo = page.locator('.mg-cp-parte[data-parte="inAttesa"] .mg-cp-riga[data-id="C-9"]');
  await expect(nuovo).toBeVisible();
  await expect(nuovo).toBeFocused();
  const crea = await page.evaluate(() => window.__cp.inviati.find((m) => m.type === 'compito_crea'));
  expect(crea.compito.ambito).toBe('server');
  await page.evaluate(() => { window.__cp.lento = 0; });

  await nuovo.getByRole('button', { name: 'Annulla il compito' }).focus();
  await page.keyboard.press('Enter');
  await expect(nuovo.getByRole('button', { name: 'Sì, annullalo' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.mg-cp-parte[data-parte="storico"] .mg-cp-riga[data-id="C-9"]')).toContainText('annullato');
});

test('chi ha scritto un compito a mano si vede; un titolo troppo lungo si rifiuta col numero, non si taglia', async ({ openTab }) => {
  const sessione = { ...MANUALE, id: 'C-8', numero: 8, titolo: 'Da una sessione', creatoDa: 'sessione', fiducia: 'non_fidato' };
  const page = await apri(openTab, { elenco: { ok: true, aperti: [MANUALE, sessione], storico: [], altri: false, adesso: Date.now() } });
  await expect(page.locator('.mg-cp-riga[data-id="C-8"] .mg-cp-non-fidato')).toHaveText('da una sessione · non fidato');
  await expect(page.locator('.mg-cp-riga[data-id="C-7"] .mg-cp-non-fidato')).toHaveCount(0);
  await page.locator('#mgCpNuovoApri').click();
  await page.locator('#mgCpTitolo').fill('x'.repeat(320));
  await page.locator('#mgCpCrea').click();
  await expect(page.locator('#mgCpMsg')).toHaveText('Il titolo ha 320 caratteri: il massimo è 300.');
});

test('«Apri il feedback» su un feedback che la pagina non ha lo dice, invece di non fare niente', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.setData([]));
  const r = righe(page, 'inAttesa').first();
  await r.click();
  await r.getByRole('button', { name: 'Apri il feedback' }).click();
  await expect(page.locator('#mgCpStato')).toHaveText('#1196 non è fra i feedback caricati in questa pagina.');
});
