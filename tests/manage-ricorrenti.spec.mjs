// Gestione → Routine → Compiti ricorrenti (#1153, SPEC-DOMANDE.md §4.1): una riga per ricorrente con cadenza, prossima
// istanza, attesa, ultima istanza e rapporto; si modificano, si accendono, si avviano e si tolgono da qui, e gli ambiti
// stanno in fondo. Il main è finto in pagina, come manage-compiti.spec.mjs: la porta vera la prova tests/unit/compiti.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const ORA = Date.now();
const MIN = 60 * 1000;
// Lunedì 26 ottobre 2026, le 06:00 a Roma (ora solare): il testo atteso non dipende dal giorno della prova.
const LUNEDI_6 = Date.UTC(2026, 9, 26, 5, 0);
const GIOVEDI_9 = Date.UTC(2026, 9, 29, 8, 30);

const REVISIONE = {
  id: 'rev-domande', nome: 'Revisione delle domande', testo: 'Leggi le domande <b>aperte</b>.\nRaggruppale.', giorni: [0, 1, 2, 3, 4, 5, 6],
  ora: '06:00', ambito: 'domande', urgenza: 30, modello: 'opus', sforzo: 'high', attivo: true, domandaFineTurno: 'Cosa ti è mancato?',
  prossimaIl: LUNEDI_6, creatoIl: ORA - 3000 * MIN, modificatoIl: ORA - 600 * MIN, iniziale: true, attesa: 'aspetta l’ambiente dei riservati',
  istanza: { id: 'C-12', stato: 'fatto', esito: '3 domande raggruppate', creatoIl: ORA - 300 * MIN, nonPrimaDi: ORA - 300 * MIN, chiusoIl: ORA - 250 * MIN },
  rapporto: { testo: 'Raggruppate <img src=x onerror="window.__xss=1"> tre domande.\nRiparti da D-40.', fiducia: 'non_fidato', scrittoIl: LUNEDI_6 - 24 * 60 * MIN + 41 * MIN, compitoId: 'C-12' },
};
const POTATURA = {
  id: 'potatura', nome: 'Potatura dei rami', testo: 'Pota i rami vecchi.', giorni: [1], ora: '01:00', ambito: 'rami', urgenza: 5,
  modello: 'haiku', sforzo: 'high', attivo: false, domandaFineTurno: '', prossimaIl: 0, creatoIl: ORA - 3000 * MIN, modificatoIl: 0,
  iniziale: true, attesa: '', istanza: null, rapporto: null,
};
const ISTANZA_COMPITI = {
  id: 'C-20', numero: 20, tipo: 'ricorrente', titolo: 'Revisione delle domande', ricorrenteId: 'rev-domande', stato: 'aperto', aperto: true,
  urgenza: 30, modello: 'opus', sforzo: 'high', ambito: 'domande', fiducia: 'fidato', creatoIl: ORA, nonPrimaDi: 0,
  attesa: 'aspetta l’ambiente dei riservati', biglietti: [],
};

// Un main finto con lo stato del server: `salva`, `togli` e `avvia` lo cambiano come ownerCompiti.
async function installa(page, { owner = true, rifiuta = '', ricorrenti = [REVISIONE, POTATURA] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_RICORRENTI && window.SN_AMBITI && window.__mgRicorrenti);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ owner, rifiuta, ricorrenti, istanza, lunedi }) => {
    window.__rc = { ricorrenti, inviati: [], letture: 0, rifiuta, compiti: [] };
    const orig = window.filo.message.bind(window.filo);
    const copia = (x) => JSON.parse(JSON.stringify(x));
    window.filo.message = async (msg) => {
      const rc = window.__rc;
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: owner, signedIn: true };
      if (msg && msg.type === 'ricorrenti_elenco') {
        rc.letture += 1;
        return { ok: true, adesso: Date.now(), ricorrenti: copia(rc.ricorrenti), ambiti: window.SN_AMBITI.elenco() };
      }
      if (msg && msg.type === 'ricorrente_salva') {
        rc.inviati.push(copia(msg));
        if (rc.rifiuta) return { ok: false, error: rc.rifiuta };
        const r = msg.ricorrente;
        const id = r.id || 'nuovo-1';
        const prima = rc.ricorrenti.find((x) => x.id === id);
        const dopo = Object.assign({ istanza: null, rapporto: null, attesa: '', creatoIl: Date.now() }, prima || {}, r, { id, modificatoIl: Date.now(), prossimaIl: r.attivo ? lunedi : 0 });
        rc.ricorrenti = prima ? rc.ricorrenti.map((x) => (x.id === id ? dopo : x)) : rc.ricorrenti.concat([dopo]);
        return { ok: true, id };
      }
      if (msg && msg.type === 'ricorrente_togli') {
        rc.inviati.push(copia(msg));
        rc.ricorrenti = rc.ricorrenti.filter((x) => x.id !== msg.id);
        return { ok: true, id: msg.id };
      }
      if (msg && msg.type === 'ricorrente_avvia') {
        rc.inviati.push(copia(msg));
        const r = rc.ricorrenti.find((x) => x.id === msg.id);
        r.istanza = { id: 'C-20', stato: 'aperto', esito: '', creatoIl: Date.now(), nonPrimaDi: 0, chiusoIl: 0 };
        rc.compiti = [istanza];
        return { ok: true, id: msg.id, compitoId: 'C-20' };
      }
      if (msg && msg.type === 'compiti_elenco') return { ok: true, aperti: copia(rc.compiti), storico: [], altri: false, adesso: Date.now(), ambiti: window.SN_AMBITI.elenco() };
      return orig(msg);
    };
  }, { owner, rifiuta, ricorrenti, istanza: ISTANZA_COMPITI, lunedi: LUNEDI_6 });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await apriScheda(page, 'ricorrenti');
  await expect(page.locator('#panel-ricorrenti')).toHaveClass(/mg-panel--active/);
}

async function apri(openTab, opzioni) {
  const page = await openTab(URL);
  await installa(page, opzioni);
  return page;
}

const riga = (page, id) => page.locator(`.mg-rc-riga[data-id="${id}"]`);
const inviati = (page, tipo) => page.evaluate((t) => window.__rc.inviati.filter((m) => m.type === t), tipo);

test('la scheda sta fra le Routine: cadenza, ambito, urgenza, modello, prossima, attesa, istanza; testi come testo', async ({ openTab }) => {
  const page = await apri(openTab);
  await expect(page.locator('.mg-tab[data-tab="ricorrenti"]')).toHaveText('Compiti ricorrenti');
  await expect(page.locator('.mg-rc-riga')).toHaveCount(2);
  const r = riga(page, 'rev-domande');
  await expect(r.locator('.mg-cp-nome')).toHaveText('Revisione delle domande');
  for (const t of ['ogni giorno alle 06:00', 'ambito domande', 'urgenza 30', 'opus · high', 'prossima lun 26/10 06:00', 'aspetta l’ambiente dei riservati', 'ultima istanza C-12, fatto: 3 domande raggruppate']) {
    await expect(r, t).toContainText(t);
  }
  await expect(r.locator('.mg-rc-attesa')).toHaveText('aspetta l’ambiente dei riservati');
  await expect(r.locator('input[data-azione="attivo"]')).toBeChecked();
  const p = riga(page, 'potatura');
  await expect(p).toContainText('il lunedì alle 01:00');
  await expect(p).toContainText('spento: non parte');
  await expect(p).not.toContainText('prossima');
  await expect(p.locator('input[data-azione="attivo"]')).not.toBeChecked();
  await expect(p.locator('.mg-rc-rapporto')).toHaveCount(0);

  // Il rapporto si apre sul posto; il suo testo si legge com'è, tag compresi, e non diventa HTML.
  const rap = r.locator('.mg-rc-rapporto');
  await expect(rap.locator('.mg-dq-fiducia--no')).toHaveText('non fidato');
  await expect(rap.locator('.mg-rc-rapporto-testo')).toBeHidden();
  await rap.getByRole('button', { name: /Rapporto di C-12 · dom 25\/10 06:41/ }).click();
  await expect(rap.locator('.mg-rc-rapporto-testo')).toBeVisible();
  await expect(rap.locator('.mg-rc-rapporto-testo')).toHaveText('Raggruppate <img src=x onerror="window.__xss=1"> tre domande.\nRiparti da D-40.');
  await expect(page.locator('#panel-ricorrenti img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  // Gli ambiti in fondo: l'elenco chiuso, coi limiti e con quello che il server non fa ancora.
  const ambiti = page.locator('.mg-rc-ambito');
  await expect(ambiti).toHaveCount(await page.evaluate(() => window.SN_AMBITI.elenco().length));
  const posta = page.locator('.mg-rc-ambito[data-nome="posta"]');
  await expect(posta).toHaveAttribute('data-attivo', 'false');
  await expect(posta.locator('.mg-rc-tag')).toContainText(['non ancora attivo', 'ambiente dei riservati']);
  await expect(posta).toContainText('Non può: uscire in rete; mandare mail; vedere le credenziali della casella');
  await expect(posta.locator('.mg-rc-op--spenta').first()).toContainText('non ancora');
  await expect(page.locator('.mg-rc-ambito[data-nome="domande"]')).toContainText('Lo usa: Revisione delle domande');
  await expect(page.locator('#mgRcCarica')).toBeHidden();
  await expect(page.locator('#mgRcNegato')).toBeHidden();
  await page.screenshot({ path: 'tests/.shots/manage-ricorrenti.png', fullPage: true });
});

test('Modifica e Salva mandano i campi ripuliti, solo i toccati cambiano, e la riga si rilegge', async ({ openTab }) => {
  const page = await apri(openTab);
  const r = riga(page, 'rev-domande');
  await r.getByRole('button', { name: 'Modifica' }).click();
  const form = r.locator('form.mg-rc-form');
  await expect(form).toBeVisible();
  await expect(form.locator('[data-campo="nome"]')).toBeFocused();
  await expect(form.locator('[data-campo="testo"]')).toHaveValue(REVISIONE.testo);
  await expect(form.locator('[data-campo="ora"]')).toHaveValue('06:00');
  await expect(form.locator('[data-campo="ambito"]')).toHaveValue('domande');
  await expect(form.locator('.mg-rc-giorni .mg-chip')).toHaveText(['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']);
  await expect(form.locator('[data-campo="ambito"] option[value="domande"]')).toHaveText('domande (ambiente dei riservati)');

  await form.locator('[data-campo="nome"]').fill('  Revisione serale  ');
  await form.locator('[data-giorno="0"]').click();
  await expect(form.locator('[data-giorno="0"]')).toHaveAttribute('aria-pressed', 'false');
  await form.locator('[data-campo="ora"]').fill('21:15');
  await expect(form.locator('.mg-rc-anteprima')).toContainText('lunedì, martedì, mercoledì, giovedì, venerdì e sabato alle 21:15');
  await form.locator('[data-campo="ambito"]').selectOption('coda');
  await form.locator('[data-campo="urgenza"]').fill('46');
  await form.locator('[data-campo="modello"]').selectOption('sonnet');
  await form.locator('[data-campo="sforzo"]').selectOption('xhigh');
  await page.screenshot({ path: 'tests/.shots/manage-ricorrenti-modifica.png', fullPage: true });
  await form.getByRole('button', { name: 'Salva' }).click();

  await expect(form).toHaveCount(0);
  const [salva] = await inviati(page, 'ricorrente_salva');
  expect(salva.ricorrente).toEqual({
    id: 'rev-domande', nome: 'Revisione serale', testo: REVISIONE.testo, giorni: [1, 2, 3, 4, 5, 6], ora: '21:15', ambito: 'coda',
    urgenza: 46, modello: 'sonnet', sforzo: 'xhigh', attivo: true, domandaFineTurno: 'Cosa ti è mancato?',
  });
  await expect(r.locator('.mg-cp-nome')).toHaveText('Revisione serale');
  await expect(r).toContainText('lunedì, martedì, mercoledì, giovedì, venerdì e sabato alle 21:15');
  await expect(r).toContainText('ambito coda');
  await expect(r).toContainText('sonnet · xhigh');
  await expect(r.locator('.mg-rc-esito')).toHaveText('Salvato.');
  await expect(r.getByRole('button', { name: 'Modifica' })).toBeFocused();
});

test('un rifiuto del server si legge accanto al modulo col suo dettaglio, e quello scritto resta', async ({ openTab }) => {
  const page = await apri(openTab, { rifiuta: 'il nome «Potatura dei rami» è già di un altro ricorrente' });
  const r = riga(page, 'rev-domande');
  await r.getByRole('button', { name: 'Modifica' }).click();
  const form = r.locator('form.mg-rc-form');
  // Prima del server le regole condivise: niente parte, e il motivo sta sotto i tasti.
  await form.locator('[data-campo="nome"]').fill('   ');
  await form.getByRole('button', { name: 'Salva' }).click();
  await expect(form.locator('.mg-rc-form-msg')).toHaveText('Il ricorrente vuole un nome.');
  for (const g of ['1', '2', '3', '4', '5', '6', '0']) await form.locator(`[data-giorno="${g}"]`).click();
  await expect(form.locator('.mg-rc-anteprima')).toHaveText('La cadenza ha almeno un giorno.');
  await form.locator('[data-campo="nome"]').fill('Potatura dei rami');
  await form.locator('[data-campo="nome"]').press('Control+Enter');
  await expect(form.locator('.mg-rc-form-msg')).toHaveText('La cadenza ha almeno un giorno.');
  expect(await inviati(page, 'ricorrente_salva')).toHaveLength(0);
  await form.locator('[data-giorno="3"]').click();
  await form.locator('[data-campo="testo"]').fill('x'.repeat(40001));
  await form.getByRole('button', { name: 'Salva' }).click();
  await expect(form.locator('.mg-rc-form-msg')).toHaveText('Il testo ha 40001 caratteri, il massimo è 40000.');
  await form.locator('[data-campo="testo"]').fill('Testo nuovo');

  await form.getByRole('button', { name: 'Salva' }).click();
  await expect(form.locator('.mg-rc-form-msg')).toHaveText('Il nome «Potatura dei rami» è già di un altro ricorrente.');
  await expect(form.locator('.mg-rc-form-msg')).toHaveClass(/mg-err/);
  await expect(form.locator('[data-campo="nome"]')).toHaveValue('Potatura dei rami');
  await expect(form.locator('[data-campo="testo"]')).toHaveValue('Testo nuovo');
  expect(await inviati(page, 'ricorrente_salva')).toHaveLength(1);
});

test('l\'interruttore accende e spegne mandando solo «attivo», anche con una bozza aperta', async ({ openTab }) => {
  const page = await apri(openTab);
  const p = riga(page, 'potatura');
  await p.getByRole('button', { name: 'Modifica' }).click();
  await p.locator('[data-campo="testo"]').fill('Bozza da non mandare');
  await p.locator('label.mg-rc-leva').click();
  await expect(p.locator('input[data-azione="attivo"]')).toBeChecked();
  await expect(p).toContainText('prossima lun 26/10 06:00');
  const [salva] = await inviati(page, 'ricorrente_salva');
  expect(salva.ricorrente).toEqual({
    id: 'potatura', nome: 'Potatura dei rami', testo: 'Pota i rami vecchi.', giorni: [1], ora: '01:00', ambito: 'rami', urgenza: 5,
    modello: 'haiku', sforzo: 'high', attivo: true, domandaFineTurno: '',
  });
  await expect(p.locator('[data-campo="testo"]')).toHaveValue('Bozza da non mandare');
  await expect(p.locator('[data-campo="attivo"]'), 'una levetta sola per un ricorrente che c’è già').toHaveCount(0);

  const r = riga(page, 'rev-domande');
  await r.locator('label.mg-rc-leva').click();
  await expect(r.locator('input[data-azione="attivo"]')).not.toBeChecked();
  await expect(r).toContainText('spento: non parte');
  await expect(r).toHaveClass(/mg-rc-riga--spento/);
  expect((await inviati(page, 'ricorrente_salva')).pop().ricorrente.attivo).toBe(false);
});

test('Avvia adesso crea un\'istanza, la nomina, e porta ai Compiti e ritorno', async ({ openTab }) => {
  const page = await apri(openTab);
  const r = riga(page, 'rev-domande');
  await r.getByRole('button', { name: 'Avvia adesso' }).click();
  await expect(r.locator('.mg-rc-esito')).toContainText('Avviato: C-20 è in coda.');
  expect(await inviati(page, 'ricorrente_avvia')).toEqual([{ type: 'ricorrente_avvia', id: 'rev-domande' }]);
  await expect(r).toContainText('ultima istanza C-20, in attesa');

  await r.getByRole('button', { name: 'Vedi C-20' }).click();
  await expect(page.locator('#panel-compiti')).toHaveClass(/mg-panel--active/);
  const c = page.locator('.mg-cp-riga[data-id="C-20"]');
  await expect(c.locator('.mg-cp-nome')).toHaveText('C-20 · Revisione delle domande');
  await expect(c).toBeFocused();
  await expect(c).toContainText('aspetta l’ambiente dei riservati');
  await c.getByRole('button', { name: 'Apri il ricorrente' }).click();
  await expect(page.locator('#panel-ricorrenti')).toHaveClass(/mg-panel--active/);
  await expect(r.getByRole('button', { name: 'Modifica' })).toBeFocused();
});

test('Togli chiede conferma sul posto, la coda di un doppio clic non conferma, e il sì lo toglie', async ({ openTab }) => {
  const page = await apri(openTab);
  const r = riga(page, 'potatura');
  const togli = r.locator('button[data-azione="togli"]');
  const prima = await togli.boundingBox();
  await togli.dblclick();
  await expect(togli).toHaveText('Sì, toglilo');
  expect(await inviati(page, 'ricorrente_togli')).toHaveLength(0);
  const armato = await togli.boundingBox();
  expect(Math.round(armato.x)).toBe(Math.round(prima.x));
  expect(armato.width).toBeGreaterThanOrEqual(prima.width);
  // Un clic altrove disarma.
  await page.locator('#mgRcStato').click();
  await expect(togli).toHaveText('Togli');
  await togli.click();
  await togli.click({ delay: 20 });
  await expect(riga(page, 'potatura')).toHaveCount(0);
  expect(await inviati(page, 'ricorrente_togli')).toEqual([{ type: 'ricorrente_togli', id: 'potatura' }]);
  await expect(page.locator('#mgRcStato')).toHaveText('Tolto «Potatura dei rami».');
});

test('nuovo compito ricorrente: parte coi valori iniziali, rifiuta prima di mandare, si crea e compare', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('#mgRcNuovoApri').click();
  const form = page.locator('#mgRcNuovo form.mg-rc-form');
  await expect(form).toBeVisible();
  await expect(form.locator('[data-campo="nome"]')).toBeFocused();
  await expect(form.locator('.mg-rc-anteprima')).toContainText('ogni giorno alle 06:00 · la prossima');
  await expect(form.getByRole('button', { name: 'Crea' })).toBeVisible();
  await form.getByRole('button', { name: 'Crea' }).click();
  await expect(form.locator('.mg-rc-form-msg')).toHaveText('Il ricorrente vuole un nome.');
  await form.locator('[data-campo="nome"]').fill('Guarda i <b>log</b>');
  await expect(form.locator('[data-campo="nome"]')).toBeFocused();
  await form.locator('[data-campo="testo"]').fill('Leggi i log della notte.');
  await form.getByRole('button', { name: 'Crea' }).click();
  expect((await inviati(page, 'ricorrente_salva')).length).toBe(1);
  await expect(page.locator('#mgRcNuovo')).toBeHidden();
  const [salva] = await inviati(page, 'ricorrente_salva');
  expect(salva.ricorrente).toEqual({
    nome: 'Guarda i <b>log</b>', testo: 'Leggi i log della notte.', giorni: [0, 1, 2, 3, 4, 5, 6], ora: '06:00', ambito: 'lavoro',
    urgenza: 45, modello: 'opus', sforzo: 'high', attivo: true, domandaFineTurno: '',
  });
  const nuova = riga(page, 'nuovo-1');
  await expect(nuova.locator('.mg-cp-nome')).toHaveText('Guarda i <b>log</b>');
  await expect(nuova.locator('b')).toHaveCount(0);
  await expect(nuova.locator('.mg-rc-esito')).toHaveText('Creato.');
  // Esc nasconde il modulo senza buttare quello che c'era scritto; «Annulla» lo butta.
  await page.locator('#mgRcNuovoApri').click();
  await form.locator('[data-campo="nome"]').fill('Da riprendere');
  await form.locator('[data-campo="nome"]').press('Escape');
  await expect(page.locator('#mgRcNuovo')).toBeHidden();
  await expect(page.locator('#mgRcNuovoApri')).toBeFocused();
  await page.locator('#mgRcNuovoApri').click();
  await expect(form.locator('[data-campo="nome"]')).toHaveValue('Da riprendere');
  await form.getByRole('button', { name: 'Annulla' }).click();
  await page.locator('#mgRcNuovoApri').click();
  await expect(form.locator('[data-campo="nome"]')).toHaveValue('');
});

test('una bozza resta sotto una rilettura che cambia la riga, e alla riapertura di Gestione', async ({ openTab }) => {
  const page = await apri(openTab);
  const r = riga(page, 'rev-domande');
  await r.getByRole('button', { name: 'Modifica' }).click();
  const testo = r.locator('[data-campo="testo"]');
  await testo.fill('Bozza lunga');
  await testo.press('End');
  // Il server cambia il ricorrente mentre l'owner scrive: la riga si rifà, la bozza e il cursore no.
  await page.evaluate(() => { window.__rc.ricorrenti[0].modificatoIl = Date.now(); window.__rc.ricorrenti[0].urgenza = 31; });
  await page.evaluate(() => window.__mgRicorrenti.carica());
  await expect(r).toContainText('urgenza 31');
  await expect(testo).toHaveValue('Bozza lunga');
  await expect(testo).toBeFocused();
  await expect(r.locator('[data-campo="urgenza"]')).toHaveValue('31');
  await page.keyboard.type(', continua');
  await expect(testo).toHaveValue('Bozza lunga, continua');

  await page.waitForTimeout(400);
  await page.reload();
  await installa(page);
  await expect(riga(page, 'rev-domande').locator('[data-campo="testo"]')).toHaveValue('Bozza lunga, continua');
  await riga(page, 'rev-domande').getByRole('button', { name: 'Annulla' }).click();
  await expect(riga(page, 'rev-domande').getByRole('button', { name: 'Modifica' })).toBeVisible();
  expect(await inviati(page, 'ricorrente_salva')).toHaveLength(0);
});

test('tasto destro: le azioni della riga, più nuovo ricorrente e rilettura', async ({ openTab }) => {
  const page = await apri(openTab);
  await riga(page, 'rev-domande').locator('.mg-cp-nome').click({ button: 'right' });
  const voci = page.locator('.mg-ctxmenu .sn-select-option');
  await expect(voci).toHaveText(['Modifica', 'Avvia adesso', 'Spegni', 'Togli', 'Apri C-12 nei Compiti', 'Copia il rapporto', 'Copia il nome', 'Nuovo compito ricorrente', 'Rileggi dal server']);
  await voci.filter({ hasText: 'Togli' }).click();
  await expect(riga(page, 'rev-domande').locator('button[data-azione="togli"]')).toHaveText('Sì, toglilo');
});

test('senza l\'account dell\'owner la scheda lo dice, senza righe e senza «Nuovo»', async ({ openTab }) => {
  const page = await apri(openTab, { owner: false });
  await expect(page.locator('#mgRcNegato')).toBeVisible();
  await expect(page.locator('#mgRcCorpo')).toBeHidden();
  await expect(page.locator('#mgRcCarica')).toBeHidden();
  await expect(page.locator('#mgRcNuovoApri')).toBeDisabled();
  expect(await page.evaluate(() => window.__rc.letture)).toBe(0);
});

test('tema scuro: la scheda si legge come in chiaro', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  const r = riga(page, 'rev-domande');
  await r.locator('.mg-rc-rapporto-apri').click();
  await r.getByRole('button', { name: 'Modifica' }).click();
  await page.evaluate(() => { window.__rc.ricorrenti[1].attesa = 'l’ambito posta non è ancora attivo'; window.__rc.ricorrenti[1].prossimaIl = 0; });
  await page.evaluate((g) => { Object.assign(window.__rc.ricorrenti[1], { attivo: true, prossimaIl: g }); }, GIOVEDI_9);
  await page.evaluate(() => window.__mgRicorrenti.carica());
  await expect(riga(page, 'potatura')).toContainText('l’ambito posta non è ancora attivo');
  const colori = await page.evaluate(() => {
    const nome = document.querySelector('.mg-rc-riga .mg-cp-nome');
    return { testo: getComputedStyle(nome).color, fondo: getComputedStyle(document.body).backgroundColor };
  });
  expect(colori.testo).not.toBe(colori.fondo);
  await page.screenshot({ path: 'tests/.shots/manage-ricorrenti-scuro.png', fullPage: true });
});
