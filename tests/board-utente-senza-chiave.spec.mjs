// Spec: la bacheca di chi NON ha la chiave privata (#478).
//
// IL CASO. Dal 25 giugno 2026 lo `status` di un feedback viaggia cifrato
// (#476): protegge chi ci lavora dal far sapere a un attaccante se il suo
// tentativo è stato riconosciuto. Chi apre la bacheca — l'owner compreso,
// perché quella pagina la chiave non ce l'ha — vede al posto dello stato un
// blob. Finché la bacheca decideva cosa mostrare leggendo QUEL campo, la
// classificazione non poteva mai rispondere «risolto», e la pagina diceva
// «Nessun miglioramento da verificare per ora» anche con decine di fix usciti:
// vuota per tutti, per costruzione, e col giro dei voti fermo.
//
// LA STRADA GIUSTA (che il fix ha preso) non è decifrare in pagina né togliere
// la cifratura allo stato: è leggere la SCHEDA pubblica che il backend prepara
// per ogni fix chiuso e pulito (`feedback-public/{id}`: titolo già ripulito,
// stato in chiaro, niente testo grezzo). La collezione vera, per un utente,
// non si apre nemmeno.
//
// COSA ASSERISCE, dal punto di vista dell'utente: apro la bacheca senza
// chiave, come un utente qualunque, e i miglioramenti rilasciati CI SONO, con
// i pulsanti per dire se funzionano. E ci arrivano dalla scheda: alla
// collezione dei feedback la pagina non bussa proprio.
//
// Esercita il cammino REALE — loadData → SN_FEEDBACK.listAllPublic → fetch
// verso Firestore — con un doppio della rete che risponde come risponde il
// server a chi non è owner: la scheda sì, la collezione vera 403.
//
// Senza il fix è ROSSO: la pagina chiederebbe i documenti veri (403 → stato
// d'errore) oppure, avendoli, leggerebbe uno stato cifrato e mostrerebbe lo
// stato vuoto.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

// La scheda pubblica di un fix chiuso e già uscito, esattamente com'è scritta
// in `feedback-public`: titolo breve, stato in CHIARO, versione di rilascio.
const SCHEDA = {
  _id: 'fb-senza-chiave',
  name: 'Cattura schermo più rapida',
  seq: 478,
  subSeq: 0,
  status: 'done',
  statusPublic: 'closed',
  resolvedInVersion: '0.2.70',
  createdAt: '2026-08-17T07:33:44.390Z',
  resolvedAt: '2026-09-01T10:00:00.000Z',
};

// Il documento VERO dello stesso feedback, come lo vedrebbe chi non ha la
// chiave: stato e testo sono blob. Non lo serviamo a nessuno — sta qui perché
// la prova controlla anche che di questa roba in pagina non ne arrivi niente.
const CIFRATO = 'FENC1:v6Kk0Z9Wd2Q8n1xTESTO-CIFRATO';

function fsDoc(card) {
  const fields = {};
  for (const [k, v] of Object.entries(card)) {
    if (k.startsWith('_')) continue;
    fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
  }
  return {
    name: `projects/p/databases/(default)/documents/feedback-public/${card._id}`,
    fields,
    createTime: '2026-09-01T10:00:00Z',
    updateTime: '2026-09-01T10:00:00Z',
  };
}

// Il doppio della rete, installato NELLA pagina: `feedback-public` risponde con
// le schede passate, `feedback` risponde 403 come fanno le regole con chi non è
// owner. Tiene anche il registro delle collezioni interrogate.
async function reteDaUtente(page, schede) {
  await page.evaluate(({ docs }) => {
    window.__collezioniChieste = [];
    const vera = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String((input && input.url) || input || '');
      if (!url.includes('firestore.googleapis.com')) return vera(input, init);
      let collezione = '';
      try {
        const body = JSON.parse((init && init.body) || '{}');
        collezione = body?.structuredQuery?.from?.[0]?.collectionId || '';
      } catch (_) { /* non è una query: la registriamo come ignota */ }
      window.__collezioniChieste.push(collezione || url);
      if (collezione === 'feedback-public') {
        const arr = docs.map((d) => ({ document: d }));
        return new Response(JSON.stringify(arr), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      // La collezione vera non si legge senza credenziali (#583).
      return new Response(
        JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    };
  }, { docs: schede.map(fsDoc) });
}

async function pronta(page) {
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW,
    null,
    { timeout: 15_000 },
  );
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
}

// Versione in esecuzione: il gate "già in produzione" (DB3) confronta con
// questa, e senza fissarla la prova dipenderebbe dalla versione del pacchetto.
async function caricaDaUtente(page, schede) {
  await pronta(page);
  await reteDaUtente(page, schede);
  await page.evaluate(() => window.__boardTest.setReleasedVersion('0.2.71'));
  await page.evaluate(() => window.__boardTest.reload());
}

test('senza chiave privata la bacheca mostra i miglioramenti rilasciati, votabili', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await caricaDaUtente(page, [SCHEDA]);

  // Il fix c'è: è il risultato che il giro dei voti aspettava.
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Cattura schermo più rapida');
  await expect(page.locator('.bd-card-sub')).toHaveText('#478');

  // «Nessun miglioramento da verificare per ora» era proprio il sintomo.
  await expect(page.locator('#bdEmpty')).toBeHidden();
  await expect(page.locator('#bdError')).toBeHidden();

  // E si può dire se funziona: è il giro per cui la bacheca esiste.
  await expect(page.locator('.bd-card .bd-vote-works')).toHaveCount(1);
  await expect(page.locator('.bd-card .bd-vote-broken')).toHaveCount(1);

  // Niente blob in pagina: quello che si legge viene dalla scheda ripulita.
  const testo = await page.locator('body').innerText();
  expect(testo).not.toContain(CIFRATO.slice(0, 5));
});

test('la bacheca legge la scheda pubblica, mai la collezione dei feedback', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await caricaDaUtente(page, [SCHEDA]);
  await expect(page.locator('.bd-card')).toHaveCount(1);

  const chieste = await page.evaluate(() => window.__collezioniChieste);
  expect(chieste).toContain('feedback-public');
  expect(chieste).not.toContain('feedback');
});

// Il vuoto resta vuoto quando è vero: nessuna scheda pubblicata → il messaggio
// «nessun miglioramento» è un'affermazione corretta, non il sintomo di #478.
test('nessuna scheda pubblicata: la bacheca dice il vuoto, senza errore', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await caricaDaUtente(page, []);

  await expect(page.locator('#bdEmpty')).toBeVisible();
  await expect(page.locator('#bdError')).toBeHidden();
  await expect(page.locator('.bd-card')).toHaveCount(0);
});
