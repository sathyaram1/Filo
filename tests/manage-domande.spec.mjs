// #1150 (SPEC-DOMANDE §2.1, §3): la sezione Domande. Apertura su una bloccante, elenco e domanda intera, pulsanti
// dalle azioni e non dal testo, risposte, «applica il consiglio» con l'elenco prima di partire; il main è finto.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const RICEVUTO = { ...base, _id: 'i1', seq: 11, name: 'Da guardare', status: 'unlabeled' };
const ora = Date.now();
const BLOCCANTE = { id: 'D-7', numero: 7, stato: 'aperta', priorita: 'bloccante', titolo: 'Serve una scelta sul login', creataIl: ora };
const IMPORTANTE = { id: 'D-8', numero: 8, stato: 'aperta', priorita: 'importante', titolo: 'Colore dei pulsanti', creataIl: ora };
const IN_LAVORO = { id: 'D-9', numero: 9, stato: 'in_lavorazione', priorita: 'importante', titolo: 'Già presa', creataIl: ora };

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

test('da non owner, o col server senza domande, il pannello lo dice: niente numero, niente Riprova', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  // Le prove non hanno l'account dell'owner: il main rifiuta, e non è un guasto da riprovare.
  await expect(page.locator('#mgDomandeStato')).toHaveText('Le domande le vede solo l’owner: accedi col suo account.');
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('');
  await expect(page.locator('#mgDomandeRiprova')).toBeHidden();
  await page.evaluate(() => window.__mgTest.setDomande(null, { errore: 'Le domande non sono ancora pubblicate sul server: arrivano col prossimo aggiornamento del server.' }));
  await expect(page.locator('#mgDomandeStato')).toContainText('non sono ancora disponibili');
  await expect(page.locator('#mgDomandeRiprova')).toBeHidden();
});

test('con una bloccante aperta Gestione si apre su Domande, anche con i Ricevuti pieni', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate((items) => window.__mgTest.setData(items), [RICEVUTO]);
  await page.evaluate((d) => window.__mgTest.setDomande(d), [IMPORTANTE, BLOCCANTE, IN_LAVORO]);
  const scelta = await page.evaluate(() => window.__mgTest.sceltaApertura());
  expect(scelta).toMatchObject({ sezione: 'domande', scheda: 'domande', motivo: 'bloccante' });

  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveClass(/mg-sezione--active/);
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveClass(/mg-sezione--urgente/);
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(2)');
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveText('Da rispondere (2)');
  await expect(page.locator('.mg-tab[data-tab="domande-lavoro"]')).toHaveText('In lavorazione (1)');
  await expect(page.locator('.mg-tab[data-tab="domande-archivio"]')).toHaveText('Archivio (0)');
  const righe = page.locator('#mgDomandeLista .mg-domanda');
  await expect(righe).toHaveCount(2);
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-priorita="bloccante"]')).toContainText('D-7');
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-priorita="bloccante"]')).toContainText('Serve una scelta sul login');

  await page.locator('.mg-tab[data-tab="domande-lavoro"]').click();
  await expect(righe).toHaveCount(1);
  await expect(righe.first()).toContainText('Già presa');
  await page.locator('.mg-tab[data-tab="domande-archivio"]').click();
  await expect(righe).toHaveCount(0);
  await expect(page.locator('#mgDomandeStato')).toHaveText('Nessuna domanda in archivio.');
});

test('senza bloccante si apre sui Ricevuti se non sono vuoti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.evaluate((items) => window.__mgTest.setData(items), [RICEVUTO]);
  await page.evaluate((d) => window.__mgTest.setDomande(d), [IMPORTANTE]);
  expect((await page.evaluate(() => window.__mgTest.sceltaApertura())).motivo).toBe('ricevuti');
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
});

test('dopo un clic dell’utente la scelta d’apertura non cambia sezione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.evaluate((d) => window.__mgTest.setDomande(d), [BLOCCANTE]);
  expect(await page.evaluate(() => window.__mgTest.sceltaApertura({ comeAvvio: true }))).toBeNull();
  await expect(page.locator('.mg-sezione[data-sezione="routine"]')).toHaveClass(/mg-sezione--active/);
  await expect(page.locator('#panel-automation')).toHaveClass(/mg-panel--active/);
});

test('il titolo di una domanda è testo, mai codice; un guasto si dice e si riprova', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setDomande([{
    id: 'D-3', numero: 3, stato: 'aperta', priorita: 'quando_puoi', titolo: '<img src=x onerror="window.__xss=1">', creataIl: Date.now(),
  }]));
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  const riga = page.locator('#mgDomandeLista .mg-domanda');
  await expect(riga).toContainText('<img src=x');
  await expect(riga.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  await page.evaluate(() => window.__mgTest.setDomande(null, { errore: 'rete giù' }));
  await expect(page.locator('#mgDomandeStato')).toContainText('Non riesco a leggere le domande: rete giù');
  await expect(page.locator('#mgDomandeRiprova')).toBeVisible();
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('');
});

// ── Fase 2: la domanda intera e le risposte ───────────────────────────────
const RIF = {
  fb902: { num: '#902', priorita: 1, stato: 'design', motivo: 'decisione' },
  fb903: { num: '#903', priorita: 2, stato: 'design', motivo: 'locale' },
};
function domanda(numero, over) {
  return Object.assign({
    id: `D-${numero}`, numero, stato: 'aperta', priorita: 'importante', fiducia: 'non_fidato',
    titolo: `Domanda ${numero}`, creataIl: ora - numero * 1000, modificataIl: ora - numero * 1000,
    opzioni: [], consiglio: null, conversazione: [],
  }, over);
}
const COMPLETA = domanda(7, {
  priorita: 'bloccante',
  titolo: 'Archiviare il vecchio login?',
  contesto: 'Il login vecchio è **ancora acceso** per due utenti.',
  problema: 'Chi lo usa vede <img src=x onerror="window.__xss=1"> una pagina rotta.',
  origine: { tipo: 'feedback', id: 'fb902' },
  opzioni: [
    // Il testo dell'opzione mente: il pulsante deve dire cosa fa l'azione.
    { testo: 'Approva tutto e fondi subito', pro: 'Più semplice', contro: 'Si perde la storia', azione: { tipo: 'archivia', feedbackId: 'fb902' } },
    { testo: 'Alza la priorità', pro: '', contro: 'Costa', azione: { tipo: 'priorita', feedbackId: 'fb902', valore: 3 } },
    { testo: 'Un ambito nuovo', azione: { tipo: 'ambito' } },
    { testo: 'Un feedback che il server non conosce', azione: { tipo: 'archivia', feedbackId: 'ignoto' } },
  ],
  consiglio: { opzione: 0, perche: 'Nessuno lo usa più.' },
  notePerAgenti: 'Il codice sta nel modulo del login.',
});

async function apriDomande(page, lista, riferimenti = RIF) {
  await apri(page);
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [lista, riferimenti]);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

// Il main finto risponde alle domande e registra cosa gli arriva.
async function mainFinto(page) {
  await page.evaluate(() => {
    window.__domande = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (!/^domand/.test(String(t))) return orig(msg);
      window.__domande.push(msg);
      const d = window.__mgTest.domandeStato().domande.find((x) => x.id === msg.id);
      if (t === 'domanda_rispondi') {
        const stato = Number.isInteger(msg.scelta) ? 'chiusa' : 'in_lavorazione';
        return { ok: true, domanda: Object.assign({}, d, { stato, esito: { ok: true, applicataIl: Date.now() } }), esito: { ok: true } };
      }
      if (t === 'domande_consiglio') return { ok: true, esiti: msg.ids.map((id) => ({ id, ok: true })) };
      if (t === 'domanda_mostra') return { ok: true, domanda: Object.assign({}, d, { stato: 'chiusa', esito: { ok: true, applicataIl: Date.now() } }), riferimenti: {} };
      return { ok: false, error: 'non previsto' };
    };
  });
}

test('la domanda si legge intera: contesto, problema, opzioni, consiglio, fiducia; il testo non diventa codice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [COMPLETA]);
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]');
  await expect(dq).toBeVisible();
  await expect(dq.locator('.mg-dq-titolo')).toHaveText('Archiviare il vecchio login?');
  await expect(dq.locator('.mg-dq-fiducia')).toHaveText('Non fidata');
  await expect(dq.locator('.mg-dq-legame')).toHaveText('#902');
  await expect(dq.locator('strong', { hasText: 'ancora acceso' })).toHaveCount(1);
  await expect(dq).toContainText('una pagina rotta');
  await expect(dq.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(dq.locator('.mg-dq-opzione')).toHaveCount(4);
  await expect(dq.locator('.mg-dq-opzione').first()).toContainText('Più semplice');
  await expect(dq.locator('.mg-dq-opzione').first()).toContainText('Si perde la storia');
  await expect(dq.locator('.mg-dq-opzione--consigliata')).toHaveAttribute('data-indice', '0');
  await expect(dq.locator('.mg-dq-consiglio')).toContainText('Nessuno lo usa più.');
  // Le note per gli agenti ci sono, chiuse in fondo.
  const note = dq.locator('details.mg-dq-note');
  await expect(note).not.toHaveAttribute('open', '');
  await expect(note.locator('summary')).toHaveText('Note per gli agenti');
  await note.locator('summary').click();
  await expect(note).toContainText('Il codice sta nel modulo del login.');
});

test('il pulsante dice cosa fa l’azione, mai il testo dell’opzione; senza dati del server nessun pulsante', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [COMPLETA]);
  const ops = page.locator('#mgDomandaDettaglio .mg-dq-opzione');
  await expect(ops.nth(0).locator('.mg-dq-azione')).toHaveText('Archivia #902');
  await expect(ops.nth(0).locator('.mg-dq-azione')).not.toContainText('fondi');
  await expect(ops.nth(1).locator('.mg-dq-azione')).toHaveText('Priorità di #902: 1 → 3');
  for (const i of [2, 3]) {
    await expect(ops.nth(i).locator('button')).toHaveCount(0);
    await expect(ops.nth(i).locator('.mg-dq-senza-azione')).toBeVisible();
  }
  await expect(page.locator('#mgDomandaDettaglio .mg-dq-applica')).toHaveText('Applica il consiglio: Archivia #902');
});

test('rispondere: un’opzione manda la scelta, le parole mandano il testo, «Discutiamone» copia la riga', async ({ app, openTab }) => {
  const page = await openTab(MANAGE);
  const altra = domanda(8, { opzioni: [], consiglio: null });
  await apriDomande(page, [COMPLETA, altra]);
  await mainFinto(page);

  await page.locator('#mgDomandaDettaglio .mg-dq-opzione').nth(0).locator('.mg-dq-azione').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq-msg')).toHaveText('Fatto.');
  expect(await page.evaluate(() => window.__domande)).toEqual([{ type: 'domanda_rispondi', id: 'D-7', scelta: 0 }]);
  // La domanda risposta lascia «Da rispondere» ma resta a schermo col suo esito.
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveText('Da rispondere (1)');
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"] .mg-dq-azione')).toHaveCount(0);

  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-8"]').click();
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-8"]');
  await dq.locator('button', { hasText: 'Discutiamone' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Discutiamo la domanda D-8');
  await expect(dq.locator('.mg-dq-msg')).toHaveText('Copiato: «Discutiamo la domanda D-8»');

  await dq.locator('.mg-dq-testo').fill('Facciamolo la settimana prossima');
  await dq.locator('button', { hasText: 'Rispondi' }).click();
  await expect(dq.locator('.mg-dq-msg')).toHaveText('Mandata: la prende un agente.');
  expect((await page.evaluate(() => window.__domande)).at(-1)).toEqual({ type: 'domanda_rispondi', id: 'D-8', testo: 'Facciamolo la settimana prossima' });
  await expect(page.locator('.mg-tab[data-tab="domande-lavoro"]')).toHaveText('In lavorazione (1)');
});

test('applica il consiglio sulla scelta: prima l’elenco delle etichette, le una-per-una restano fuori, poi una chiamata', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lista = [
    domanda(1, { opzioni: [{ testo: 'Ok', azione: { tipo: 'archivia', feedbackId: 'fb902' } }], consiglio: { opzione: 0, perche: 'Sì.' } }),
    domanda(2, { opzioni: [{ testo: 'Locale', azione: { tipo: 'approva_locale', feedbackId: 'fb903' } }], consiglio: { opzione: 0, perche: 'Sì.' } }),
    domanda(3),
  ];
  await apriDomande(page, lista);
  await mainFinto(page);

  await page.locator('#mgDomandeTutte').check();
  const btn = page.locator('#mgDomandeConsiglioSel');
  await expect(btn).toHaveText('Applica il consiglio (3)');
  await btn.click();
  const box = page.locator('#mgDomandeConferma');
  await expect(box).toBeVisible();
  await expect(box).toContainText('Applico il consiglio a una domanda:');
  await expect(box.locator('li').first()).toContainText('D-1');
  await expect(box.locator('li').first()).toContainText('Archivia #902');
  await expect(box).toContainText('una per una: Affida #903 ai lavori server');
  await expect(box).toContainText('nessun consiglio');
  // Niente è partito prima del sì.
  expect(await page.evaluate(() => window.__domande)).toEqual([]);

  await box.locator('button', { hasText: 'Applica' }).click();
  await expect(box).toContainText('Applicato a una domanda:');
  expect(await page.evaluate(() => window.__domande)).toEqual([{ type: 'domande_consiglio', ids: ['D-1'] }]);
  await expect(btn).toHaveText('Applica il consiglio (2)');
});

test('un gruppo si apre come un blocco solo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [
    domanda(4, { gruppo: 'Login' }), domanda(5, { gruppo: 'login' }), domanda(6, { priorita: 'bloccante' }),
  ]);
  // La bloccante sta in cima e si apre da sola.
  await expect(page.locator('#mgDomandeLista .mg-domanda').first()).toHaveAttribute('data-id', 'D-6');
  await expect(page.locator('#mgDomandaDettaglio .mg-dq')).toHaveAttribute('data-id', 'D-6');
  const gruppo = page.locator('#mgDomandeLista .mg-domande-gruppo');
  await expect(gruppo).toHaveCount(1);
  await expect(gruppo).toContainText('2');
  await gruppo.click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq')).toHaveCount(2);
  await expect(page.locator('#mgDomandaDettaglio .mg-dq').nth(0)).toHaveAttribute('data-id', 'D-5');
});
