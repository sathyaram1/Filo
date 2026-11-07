// Gli avvisi all'owner fra le notifiche della home (#855): casi, soglie e marcatori ricavati dalla vista del server,
// e cosa ne viene sulle notifiche (src/shared/wallet.js). La pagina a cui porta la carta: src/shared/carteHome.js.
// Le prove in Electron stanno in tests/wallet-owner-avvisi.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/wallet.js');
require('../../src/shared/carteHome.js');
const W = globalThis.SN_WALLET;
const C = globalThis.SN_CARTE_HOME;

const vista = ({ dati = 1000, tetto = 100000, inviti = 9, rifiutate, segnati = [], riassunto } = {}) => ({
  config: { invitesRemaining: inviti },
  totals: { grantedCredits: dati, maxGrantCredits: tetto },
  ...(rifiutate === undefined ? {} : { daily: { lastRunAt: '2026-10-16T03:00:00.000Z', summary: { granted: 4, refused: rifiutate } } }),
  ...(riassunto === undefined ? {} : { reconcile: { lastRunAt: '2026-10-16T09:00:00.000Z', summary: { flagged: riassunto } } }),
  users: ['aaaa000000000001', 'bbbb000000000002', 'cccc000000000003', 'dddd000000000004', 'eeee000000000005']
    .map((p) => ({ pseudonym: p, reconcile: { flagged: segnati.includes(p), driftUsd: segnati.includes(p) ? 0.4 : 0 } })),
});
const caso = (casi, nome) => casi.find((c) => c.caso === nome);

// Le notifiche come le tiene SN_FILO_MEMORY: le nuove davanti, chiuse ma conservate, testo riscritto solo se cambia.
function memoria() {
  const lista = [];
  let n = 0;
  return {
    lista,
    vive: () => lista.filter((x) => !x.dismissed),
    async listNotifications() { return lista.filter((x) => !x.dismissed).map((x) => JSON.parse(JSON.stringify(x))); },
    async addNotification({ kind, text, action }) { const e = { id: `n${++n}`, kind, text, action, dismissed: false }; lista.unshift(e); return e; },
    async dismissNotification(id) { const x = lista.find((y) => y.id === id); if (x) x.dismissed = true; return lista; },
    async setNotificationText(id, text) {
      const x = lista.find((y) => y.id === id);
      if (!x || x.dismissed || x.text === text) return false;
      x.text = text;
      return true;
    },
  };
}
// Un controllo come lo fa il main: marcatori dal disco, notifiche, marcatori sul disco.
async function controllo(mem, disco, overview) {
  const esito = await W.applicaAvvisiOwner(mem, disco.detti, overview);
  disco.detti = esito.detti;
  return esito;
}

test('il tetto: niente sotto l’80%, un marcatore oltre l’80% e due oltre il 95%; il numero e cosa fare nel testo', () => {
  assert.deepEqual(caso(W.avvisiOwner(vista({ dati: 79999 })), 'tetto').marcatori, []);
  const ottanta = caso(W.avvisiOwner(vista({ dati: 87000 })), 'tetto');
  assert.deepEqual(ottanta.marcatori, ['tetto:80']);
  assert.equal(ottanta.testo, "I crediti regalati sono all'87% del tetto, 87.000 su 100.000. Alza il tetto in Gestione, sezione Utenti, o il server rifiuterà la quota del giorno e i nuovi ingressi.");
  const novanta = caso(W.avvisiOwner(vista({ dati: 96000 })), 'tetto');
  assert.deepEqual(novanta.marcatori, ['tetto:80', 'tetto:95']);
  assert.match(novanta.testo, /^I crediti regalati sono al 96% del tetto, 96\.000 su 100\.000\./);
  // Esatto sulla soglia conta, e un 29% non diventa 28 per l'arrotondamento dei decimali.
  assert.deepEqual(caso(W.avvisiOwner(vista({ dati: 80000 })), 'tetto').marcatori, ['tetto:80']);
  assert.equal(caso(W.avvisiOwner(vista({ dati: 29, tetto: 100 })), 'tetto').numero, 29);
});

test('tetto raggiunto o superato, e tetto a zero: il testo dice che i rifiuti ci sono già', () => {
  for (const v of [vista({ dati: 100000 }), vista({ dati: 120000 }), vista({ dati: 0, tetto: 0 })]) {
    const t = caso(W.avvisiOwner(v), 'tetto');
    assert.deepEqual(t.marcatori, ['tetto:80', 'tetto:95']);
    assert.match(t.testo, /^I crediti regalati hanno raggiunto il tetto, .*\. Il server rifiuta la quota del giorno e i nuovi ingressi finché non alzi il tetto in Gestione, sezione Utenti\.$/);
  }
});

test('gli ingressi con invito: oltre due niente, due o meno un avviso col numero, a zero «finiti»', () => {
  assert.deepEqual(caso(W.avvisiOwner(vista({ inviti: 3 })), 'inviti').marcatori, []);
  const due = caso(W.avvisiOwner(vista({ inviti: 2 })), 'inviti');
  assert.deepEqual(due.marcatori, ['inviti:2']);
  assert.equal(due.testo, 'Restano 2 ingressi con invito, poi chi riceve un invito non riesce più a entrare. Aggiungine in Gestione, sezione Utenti.');
  assert.match(caso(W.avvisiOwner(vista({ inviti: 1 })), 'inviti').testo, /^Resta 1 ingresso con invito,/);
  assert.match(caso(W.avvisiOwner(vista({ inviti: 0 })), 'inviti').testo, /^Gli ingressi con invito sono finiti/);
  assert.deepEqual(caso(W.avvisiOwner(vista({ inviti: 0 })), 'inviti').marcatori, ['inviti:2']);
});

test('la giornaliera che ha rifiutato delle quote, e lo scarto della riconciliazione con chi è segnato', () => {
  assert.deepEqual(caso(W.avvisiOwner(vista({ rifiutate: 0 })), 'giornaliera').marcatori, []);
  const g = caso(W.avvisiOwner(vista({ rifiutate: 3 })), 'giornaliera');
  assert.deepEqual(g.marcatori, ['giornaliera:rifiuti']);
  assert.equal(g.testo, "L'ultima quota del giorno non è arrivata a 3 persone perché il tetto dei crediti elargibili era pieno. Alza il tetto in Gestione, sezione Utenti.");
  assert.match(caso(W.avvisiOwner(vista({ rifiutate: 1 })), 'giornaliera').testo, /a 1 persona perché/);

  assert.deepEqual(caso(W.avvisiOwner(vista()), 'scarto').marcatori, []);
  const s = caso(W.avvisiOwner(vista({ segnati: ['bbbb000000000002', 'aaaa000000000001'] })), 'scarto');
  assert.deepEqual(s.marcatori, ['scarto:aaaa000000000001', 'scarto:bbbb000000000002']);
  assert.equal(s.testo, "La riconciliazione ha trovato uno scarto su 2 portafogli (aaaa000000000001, bbbb000000000002). Qualcuno consuma senza scrivere il registro d'uso, e trovi le righe segnate in Gestione, sezione Utenti.");
  const tanti = caso(W.avvisiOwner(vista({ segnati: ['aaaa000000000001', 'bbbb000000000002', 'cccc000000000003', 'dddd000000000004', 'eeee000000000005'] })), 'scarto');
  assert.match(tanti.testo, /su 5 portafogli \(aaaa000000000001, bbbb000000000002, cccc000000000003 e altri 2\)/);
  // Senza le righe per persona vale il conto del riassunto.
  const soloRiassunto = caso(W.avvisiOwner({ reconcile: { summary: { flagged: 1 } } }), 'scarto');
  assert.deepEqual(soloRiassunto.marcatori, ['scarto:?']);
  // Il riassunto non dice perché (#1520): la frase non indovina il motivo.
  assert.equal(soloRiassunto.testo, 'La riconciliazione ha segnato 1 portafoglio. Trovi le righe segnate in Gestione, sezione Utenti.');
});

test('un uso fuori politica si dice col suo motivo, anche su un portafoglio già segnato per lo scarto (#1520)', () => {
  const con = (reconcile) => caso(W.avvisiOwner({ users: [{ pseudonym: 'aaaa000000000001', reconcile }] }), 'scarto');
  const scarto = con({ flagged: true, driftUsd: 0.4 });
  const fuori = con({ flagged: true, driftUsd: 0, reasons: ['off_policy'], offPolicy: [{ model: 'openai/gpt-5', provider: 'Azure', usd: 1, violation: 'model' }] });
  assert.deepEqual(fuori.marcatori, ['scarto:aaaa000000000001:off_policy']);
  assert.equal(fuori.testo, 'La riconciliazione ha segnato 1 portafoglio (aaaa000000000001): la chiave dei crediti ha pagato modelli o fornitori fuori dalla politica sui modelli. Trovi le righe segnate in Gestione, sezione Utenti.');
  const entrambi = con({ flagged: true, driftUsd: 0.4, reasons: ['unrecorded', 'off_policy'] });
  assert.deepEqual(entrambi.marcatori, ['scarto:aaaa000000000001', 'scarto:aaaa000000000001:off_policy']);
  const piano = W.avvisiOwnerPiano(scarto.marcatori, [entrambi]);
  assert.deepEqual(piano.scrivi.map((c) => c.caso), ['scarto'], 'il motivo nuovo scrive una carta nuova');
  const eccesso = con({ flagged: true, driftUsd: -1, reasons: ['excess_rows'] });
  assert.match(eccesso.testo, /: il registro d'uso conta più di quanto il router ha fatto pagare\./);
});

test('i motivi di un segno coi loro dollari, e il consumo del router che non si è letto non è zero (#1520)', () => {
  assert.deepEqual(W.motiviScarto({ flagged: false, driftUsd: 3 }), []);
  assert.deepEqual(W.motiviScarto({ flagged: true, driftUsd: 0.42 }), [{ chiave: 'unrecorded', testo: 'non registrato', usd: 0.42 }]);
  assert.deepEqual(W.motiviScarto({ flagged: true, driftUsd: -1, reasons: ['excess_rows'] }), [{ chiave: 'excess_rows', testo: 'righe in eccesso', usd: 1 }]);
  const fuori = W.motiviScarto({ flagged: true, reasons: ['off_policy'], offPolicy: [
    { model: 'openai/gpt-5', provider: 'Azure', usd: 1, violation: 'model' },
    { model: 'deepseek/deepseek-v4-pro', provider: 'DeepSeek', usd: 0.5, violation: 'excluded' },
    { model: 'deepseek/deepseek-v4-pro', provider: 'DeepInfra', usd: 9, violation: '' },
  ] });
  assert.deepEqual(fuori, [{ chiave: 'off_policy', testo: 'fuori politica', usd: 1.5 }]);
  assert.deepEqual(W.motiviScarto({ flagged: true, reasons: ['nuovo'] }), [{ chiave: 'nuovo', testo: 'segnato', usd: null }]);
  assert.deepEqual(W.consumoRouter(undefined), { letto: false, errore: '', righe: [] });
  assert.equal(W.consumoRouter({ error: 'HTTP 401' }).errore, 'HTTP 401');
  const r = W.consumoRouter({ rows: [
    { model: 'deepseek/deepseek-v4-pro', provider: 'DeepInfra', usd: 0.2, requests: 4 },
    { model: 'openai/gpt-5', provider: 'Azure', usd: 1, requests: 2, violation: 'model' },
    { model: '', provider: 'X', usd: 5 },
  ] });
  assert.equal(r.letto, true);
  assert.deepEqual(r.righe.map((x) => [x.model, x.fuori]), [['openai/gpt-5', 'modello fuori politica'], ['deepseek/deepseek-v4-pro', '']]);
});

test('quello che la vista non dice non è un caso, e una vista che non c’è non dà avvisi', () => {
  assert.deepEqual(W.avvisiOwner(null), []);
  assert.deepEqual(W.avvisiOwner('rotta'), []);
  assert.deepEqual(W.avvisiOwner({}), []);
  assert.deepEqual(W.avvisiOwner(vista()).map((c) => c.caso), ['tetto', 'inviti', 'scarto']);
  assert.deepEqual(W.avvisiOwner(vista({ rifiutate: 0 })).map((c) => c.caso), ['tetto', 'giornaliera', 'inviti', 'scarto']);
  assert.deepEqual(W.avvisiOwner({ totals: { grantedCredits: 5 } }), [], 'senza tetto non si sa a che punto si è');
});

test('la sequenza della segnalazione: 85% una carta, riletta uguale nessuna in più, 96% una nuova al posto della vecchia', async () => {
  const mem = memoria();
  const disco = { detti: [] };
  const e1 = await controllo(mem, disco, vista({ dati: 85000 }));
  assert.equal(e1.cambiato, true);
  assert.equal(mem.vive().length, 1);
  const prima = mem.vive()[0];
  assert.equal(prima.kind, 'alert');
  assert.deepEqual(prima.action, {
    tipo: 'crediti-owner', caso: 'tetto', marcatori: ['tetto:80'], titolo: 'Tetto dei regali',
    apri: 'filo://manage/manage.html#utenti', etichetta: 'Apri Inviti e utenti',
  });
  assert.match(prima.text, /all'85% del tetto/);

  // Un riavvio: stessi marcatori su disco, stessa situazione.
  const e2 = await controllo(mem, disco, vista({ dati: 85000 }));
  assert.equal(e2.cambiato, false);
  assert.equal(mem.lista.length, 1);

  // Sale ma resta sotto il 95%: la carta dice il numero nuovo, non se ne aggiunge una.
  await controllo(mem, disco, vista({ dati: 90000 }));
  assert.equal(mem.lista.length, 1);
  assert.match(mem.vive()[0].text, /al 90% del tetto/);

  await controllo(mem, disco, vista({ dati: 96000 }));
  assert.equal(mem.vive().length, 1, 'una carta per caso');
  assert.notEqual(mem.vive()[0].id, prima.id);
  assert.match(mem.vive()[0].text, /al 96% del tetto/);
  assert.equal(mem.lista.find((x) => x.id === prima.id).dismissed, true);
});

test('chiusa dall’owner non torna finché la situazione resta quella; rientrata se ne va, e quando si ripresenta torna', async () => {
  const mem = memoria();
  const disco = { detti: [] };
  await controllo(mem, disco, vista({ dati: 85000 }));
  await mem.dismissNotification(mem.vive()[0].id);
  await controllo(mem, disco, vista({ dati: 86000 }));
  assert.equal(mem.vive().length, 0);

  // Rientra (tetto alzato): i marcatori si scordano.
  await controllo(mem, disco, vista({ dati: 86000, tetto: 200000 }));
  assert.deepEqual(disco.detti.filter((k) => k.startsWith('tetto:')), []);
  await controllo(mem, disco, vista({ dati: 170000, tetto: 200000 }));
  assert.equal(mem.vive().length, 1);
  assert.match(mem.vive()[0].text, /all'85% del tetto/);

  // Rientra con la carta ancora lì: la carta se ne va da sola, perché dice una cosa non più vera.
  await controllo(mem, disco, vista({ dati: 1000, tetto: 200000 }));
  assert.equal(mem.vive().length, 0);
});

test('i quattro casi insieme sono quattro carte; un portafoglio segnato in più ne rifà una sola', async () => {
  const mem = memoria();
  const disco = { detti: [] };
  await controllo(mem, disco, vista({ dati: 97000, inviti: 1, rifiutate: 2, segnati: ['aaaa000000000001'] }));
  // Il più grave in cima, ognuno col suo titolo.
  assert.deepEqual(mem.vive().map((n) => n.action.caso), ['tetto', 'giornaliera', 'inviti', 'scarto']);
  assert.deepEqual(mem.vive().map((n) => n.action.titolo), ['Tetto dei regali', 'Quota del giorno', 'Ingressi con invito', 'Registro d’uso']);
  const scarto = mem.vive().find((n) => n.action.caso === 'scarto');

  await controllo(mem, disco, vista({ dati: 97000, inviti: 1, rifiutate: 2, segnati: ['aaaa000000000001', 'cccc000000000003'] }));
  assert.equal(mem.vive().length, 4);
  const nuova = mem.vive().find((n) => n.action.caso === 'scarto');
  assert.notEqual(nuova.id, scarto.id);
  assert.match(nuova.text, /su 2 portafogli \(aaaa000000000001, cccc000000000003\)/);

  // Uno dei due torna a posto: niente carta nuova, il testo si accorcia.
  await controllo(mem, disco, vista({ dati: 97000, inviti: 1, rifiutate: 2, segnati: ['cccc000000000003'] }));
  assert.equal(mem.vive().find((n) => n.action.caso === 'scarto').id, nuova.id);
  assert.match(mem.vive().find((n) => n.action.caso === 'scarto').text, /su 1 portafoglio \(cccc000000000003\)/);
});

test('una vista che non arriva, o un caso che la vista non dice più, lasciano carte e marcatori come stavano', async () => {
  const mem = memoria();
  const disco = { detti: [] };
  await controllo(mem, disco, vista({ dati: 85000, rifiutate: 4 }));
  const prima = JSON.stringify(mem.lista);
  const detti = disco.detti.slice();
  const e = await controllo(mem, disco, null);
  assert.equal(e.cambiato, false);
  assert.equal(JSON.stringify(mem.lista), prima);
  assert.deepEqual(disco.detti, detti);

  // La giornaliera sparisce dalla vista: non vuol dire che non rifiuti più.
  await controllo(mem, disco, vista({ dati: 85000 }));
  assert.equal(mem.vive().filter((n) => n.action.caso === 'giornaliera').length, 1);
  assert.ok(disco.detti.includes('giornaliera:rifiuti'));
});

test('gli avvisi che non sono dell’owner non si toccano', async () => {
  const mem = memoria();
  await mem.addNotification({ kind: 'alert', text: 'Il backup delle foto è finito.', action: null });
  await mem.addNotification({ kind: 'alert', text: 'C’è la versione 9.9.9.', action: { tipo: 'aggiornamento-linux', versione: '9.9.9' } });
  await controllo(mem, { detti: [] }, vista({ dati: 1000 }));
  assert.equal(mem.vive().length, 2);
});

test('la carta di un avviso apre solo una pagina di Filo; senza indirizzo resta com’era', () => {
  assert.deepEqual(C.paginaDiAvviso({ action: { apri: 'filo://credits/owner.html', etichetta: 'Apri Inviti e utenti' } }),
    { url: 'filo://credits/owner.html', etichetta: 'Apri Inviti e utenti' });
  assert.deepEqual(C.paginaDiAvviso({ action: { apri: 'filo://credits/owner.html' } }), { url: 'filo://credits/owner.html', etichetta: 'Apri' });
  for (const apri of ['https://example.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'filo://', 'filo://credits/owner.html x', 42, '']) {
    assert.equal(C.paginaDiAvviso({ action: { apri } }), null, String(apri));
  }
  assert.equal(C.paginaDiAvviso({ action: null }), null);
  assert.equal(C.paginaDiAvviso({ action: { tipo: 'aggiornamento-mac', versione: '1.0.0' } }), null);
  assert.equal(C.paginaDiAvviso(null), null);
});
