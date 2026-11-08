// #2294 — più file scaricati da una pagina senza un clic: come in Chrome il primo passa, dal secondo vicino si chiede nella
// cornice, e la risposta resta per il sito. Logica di src/main/services/permessiPagine.js; il cammino vero (file nella
// cartella Download, domanda, Consenti e Blocca) sta in tests/download-piu-file-2294.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const P = require('../../src/main/services/permessiPagine.js');

const ADESSO = Date.parse('2026-11-08T02:00:00Z');

function sessione() {
  const ses = { avvisi: [] };
  ses.setPermissionRequestHandler = () => {};
  ses.setPermissionCheckHandler = () => {};
  P.installa(ses, { schedaDi: () => ({ tabId: 't1', avvisa: (evento, dati) => ses.avvisi.push({ evento, dati }) }) });
  return ses;
}
function pagina(ses, url) {
  const ascolti = {};
  return {
    session: ses,
    getURL: () => url,
    isDestroyed: () => false,
    on: (ev, fn) => { (ascolti[ev] ||= []).push(fn); },
    once: (ev, fn) => { (ascolti[ev] ||= []).push(fn); },
    emetti: (ev, ...a) => { for (const fn of ascolti[ev] || []) fn(...a); },
  };
}
const esito = (wc, gesto, t) => P.scaricamentoSenzaGesto(wc, gesto, t).esito;

test('il primo file senza clic passa, il secondo entro dieci minuti chiede; dopo dieci minuti si riparte da capo', () => {
  const wc = pagina(sessione(), 'https://scarica.example/pagina');
  assert.equal(esito(wc, false, ADESSO), 'via');
  assert.equal(esito(wc, false, ADESSO + 1000), 'chiedi');
  assert.equal(esito(wc, false, ADESSO + 2000), 'chiedi');
  assert.equal(esito(wc, false, ADESSO + 2000 + P.SCARICAMENTI_FINESTRA_MS), 'via');
});

test('un clic dell\'utente passa sempre e vale per un file; le pagine di Filo e i download senza pagina non contano', () => {
  const ses = sessione();
  const wc = pagina(ses, 'https://galleria.example/');
  assert.equal(esito(wc, false, ADESSO), 'via');
  assert.equal(esito(wc, true, ADESSO + 500), 'via');
  assert.equal(esito(wc, false, ADESSO + 1000), 'chiedi', 'dopo il file del clic, uno senza clic chiede');
  wc._filoGestoVeroAlle = ADESSO + 1500;
  assert.equal(esito(wc, false, ADESSO + 9000), 'via', 'un clic nuovo vale per il file dopo, anche se arriva tardi');
  const filo = pagina(ses, 'filo://downloads/downloads.html');
  for (let i = 0; i < 3; i++) assert.equal(esito(filo, false, ADESSO + i), 'via');
  for (let i = 0; i < 3; i++) assert.equal(esito(null, false, ADESSO + i), 'via', 'Riprova parte dalla sessione, senza pagina');
  // Due siti hanno ognuno il suo primo.
  const altro = pagina(ses, 'https://altro.example/');
  assert.equal(esito(altro, false, ADESSO + 1500), 'via');
});

test('un clic solo non fa passare la raffica che la pagina fa partire dopo, nemmeno se Chromium la dà col gesto', () => {
  const wc = pagina(sessione(), 'https://modulo.example/');
  wc._filoGestoVeroAlle = ADESSO - 100;
  assert.equal(esito(wc, true, ADESSO), 'via');
  for (let i = 1; i <= 5; i++) assert.equal(esito(wc, true, ADESSO + i * 400), 'chiedi', `file ${i + 1} della raffica`);
  assert.equal(esito(wc, true, ADESSO + 60_000), 'via', 'un gesto che qui non si vede, a raffica finita, vale');
});

test('saltare da un sottodominio all\'altro dello stesso sito non azzera il conto; un altro sito ha il suo primo', () => {
  const ses = sessione();
  assert.equal(esito(pagina(ses, 'https://a.scarica.example/'), false, ADESSO), 'via');
  assert.equal(esito(pagina(ses, 'https://b.scarica.example/'), false, ADESSO + 1500), 'chiedi');
  assert.equal(esito(pagina(ses, 'https://c.scarica.example:8443/'), false, ADESSO + 3000), 'chiedi');
  assert.equal(esito(pagina(ses, 'https://altro.example/'), false, ADESSO + 3500), 'via');
});

test('la scheda che salta da sola su siti di domini diversi non riparte da capo; un clic dell\'utente sulla scheda sì', () => {
  const ses = sessione();
  let url = 'https://primo.example/';
  const wc = pagina(ses, url);
  wc.getURL = () => url;
  assert.equal(esito(wc, false, ADESSO), 'via');
  for (const [i, dove] of ['https://secondo.example/', 'https://a.github.io/', 'https://b.github.io/', 'http://203.0.113.7/'].entries()) {
    url = dove;
    assert.equal(esito(wc, false, ADESSO + (i + 1) * 1500), 'chiedi', dove);
  }
  wc._filoGestoVeroAlle = ADESSO + 9000;
  url = 'https://cliccato.example/';
  assert.equal(esito(wc, false, ADESSO + 10_000), 'via', 'il sito raggiunto dopo un clic dell\'utente ha il suo primo');
  url = 'https://dopo-il-clic.example/';
  assert.equal(esito(wc, false, ADESSO + 11_000), 'chiedi');
  // L'indirizzo scritto nella barra di Filo vale come un clic: il sito dove porta ha il suo primo.
  url = 'https://scritto.example/';
  P.navigazioneDiFilo(wc);
  assert.equal(esito(wc, false, Date.now() + 1000), 'via');
  const tabs = readFileSync(new URL('../../src/main/tabs.js', import.meta.url), 'utf8');
  assert.match(tabs, /navigazioneDiFilo\(tab\.view\.webContents\);\s*if \(caduta \|\| this\._needsRecreate\(tab, target\)\)/, 'la barra degli indirizzi lo segna, anche quando la vista rinasce');
});

test('la scheda che rinasce in una vista nuova (Privacy fra siti) tiene il conto e il no; un indirizzo dell\'utente la azzera', () => {
  let url = 'https://primo.example/';
  const vecchia = pagina(sessione(), url);
  vecchia.getURL = () => url;
  assert.equal(esito(vecchia, false, Date.now()), 'via');
  // La pagina salta da sola su un altro sito: in Privacy la vista e la sessione sono nuove.
  const nuova = pagina(sessione(), 'https://secondo.example/');
  P.passaScheda(vecchia, nuova);
  assert.equal(esito(nuova, false, Date.now() + 1500), 'chiedi', 'il conto della scheda non riparte da capo');

  const ferma = pagina(sessione(), 'https://terzo.example/');
  P.chiediScaricamenti(ferma, () => {});
  P.rispondi(ferma.session.avvisi.findLast((a) => a.evento === 'chiedi').dati.id, false);
  const dopoIlNo = pagina(sessione(), 'https://quarto.example/');
  P.passaScheda(ferma, dopoIlNo);
  assert.equal(esito(dopoIlNo, false, Date.now()), 'no', 'il no dato sulla scheda resta con la vista nuova');
  assert.deepEqual(P.scelteDi(dopoIlNo).scelte.map((s) => [s.parte, s.si]), [['scaricamenti', false]], 'e si vede nel menu della scheda');

  // Un indirizzo scritto dall'utente segna la vista vecchia prima che rinasca: la nuova parte pulita.
  const scritta = pagina(sessione(), 'https://scritto.example/');
  P.navigazioneDiFilo(dopoIlNo);
  P.passaScheda(dopoIlNo, scritta);
  assert.equal(esito(scritta, false, Date.now() + 1), 'via');
  const tabs = readFileSync(new URL('../../src/main/tabs.js', import.meta.url), 'utf8');
  assert.match(tabs, /_recreateView\(tab, url, opts = \{\}\) \{[\s\S]{0,1200}?Permessi\.passaScheda\(vecchia, view\.webContents\)/, 'ogni vista che rinasce lo passa');
});

test('la chat e lo strumento che il modello legge nominano gli stessi permessi, e la chat li capisce tutti', () => {
  const strumenti = readFileSync(new URL('../../src/shared/actionTools.js', import.meta.url), 'utf8');
  const riga = strumenti.slice(strumenti.indexOf('TOGLI_PERMESSO_SITO'), strumenti.indexOf('LEGGI_TRASPARENZA'));
  for (const nome of P.PERMESSI_DA_CHAT) {
    assert.match(riga, new RegExp(`"${nome}"`), `lo strumento offre «${nome}» al modello`);
    assert.equal(P.togliPerChat('nessuno.example', nome).errore, undefined, `la chat capisce «${nome}»`);
  }
});

test('il no dato sulla scheda ferma i salti dopo su altri siti, senza domanda; il menu della scheda lo toglie', () => {
  const ses = sessione();
  let url = 'https://uno.example/';
  const wc = pagina(ses, url);
  wc.getURL = () => url;
  P.chiediScaricamenti(wc, () => {});
  P.rispondi(ses.avvisi.findLast((a) => a.evento === 'chiedi').dati.id, false);
  url = 'https://due.example/';
  const prima = ses.avvisi.filter((a) => a.evento === 'chiedi').length;
  assert.equal(esito(wc, false, Date.now()), 'no');
  assert.equal(ses.avvisi.filter((a) => a.evento === 'chiedi').length, prima, 'nessuna domanda nuova');
  assert.deepEqual(P.scelteDi(wc).scelte.map((s) => [s.parte, s.si]), [['scaricamenti', false]], 'il menu della scheda lo mostra');
  assert.equal(P.dimentica(wc).tolte, 1);
  assert.notEqual(esito(wc, false, Date.now() + 1), 'no', 'tolto dal menu, la scheda non è più ferma');
  assert.equal(esito(pagina(ses, 'https://uno.example/'), false, Date.now()), 'no', 'il no al primo sito resta');
});

test('la domanda sta nella cornice col sito; Consenti vale per il sito, e le domande ritirate non sono una scelta', () => {
  const ses = sessione();
  const wc = pagina(ses, 'https://scarica.example/pagina');
  const risposte = [];
  P.chiediScaricamenti(wc, (si, _f, decisa) => risposte.push([si, decisa]));
  P.chiediScaricamenti(wc, (si, _f, decisa) => risposte.push([si, decisa]));
  const domande = ses.avvisi.filter((a) => a.evento === 'chiedi');
  assert.equal(domande.length, 1, 'più file della stessa pagina fanno una domanda sola');
  assert.equal(domande[0].dati.tipo, 'scaricamenti');
  assert.equal(domande[0].dati.dominio, 'scarica.example');
  P.rispondi(domande[0].dati.id, true);
  assert.deepEqual(risposte, [[true, true], [true, true]]);
  assert.equal(esito(wc, false, ADESSO), 'via');
  assert.equal(esito(wc, false, ADESSO + 1), 'via', 'col sì il sito non chiede più');

  // La pagina se ne va prima della risposta: chi aspettava sa che nessuno ha scelto.
  const via = pagina(ses, 'https://altrove.example/');
  const ritirate = [];
  P.chiediScaricamenti(via, (si, _f, decisa) => ritirate.push([si, decisa]));
  via.emetti('destroyed');
  assert.deepEqual(ritirate, [[false, false]]);
});

function bloccato(ses, url) {
  const wc = pagina(ses, url);
  const risposte = [];
  P.chiediScaricamenti(wc, (si, _f, decisa) => risposte.push([si, decisa]));
  const d = ses.avvisi.findLast((a) => a.evento === 'chiedi');
  P.rispondi(d.dati.id, false);
  assert.deepEqual(risposte, [[false, true]]);
  return wc;
}

test('Blocca vale per il sito: i file dopo si fermano senza domanda e la scheda ne porta il segno; il menu lo toglie', () => {
  const ses = sessione();
  const wc = bloccato(ses, 'https://spam.example/');
  assert.equal(esito(wc, false, ADESSO), 'no');
  assert.deepEqual(P.segniDi(wc).negati, ['scaricamenti']);
  assert.equal(esito(wc, true, ADESSO + 1), 'via', 'un clic dell\'utente scarica lo stesso');
  const subito = [];
  P.chiediScaricamenti(wc, (si, _f, decisa) => subito.push([si, decisa]));
  assert.deepEqual(subito, [[false, true]], 'con la risposta data non si richiede');
  assert.equal(P.dimentica(wc).tolte, 1, 'il menu della scheda la toglie come gli altri permessi');
  assert.equal(esito(wc, false, ADESSO + 2), 'chiedi', 'tolto il no, il file dopo quello del clic torna a chiedere');
});

test('la risposta vale per tutto il sito come il conto: il no dato a un sottodominio ferma gli altri, chiude le loro domande e si toglie da ognuno', () => {
  const ses = sessione();
  const c = pagina(ses, 'https://c.salta.example/');
  const attese = [];
  P.chiediScaricamenti(c, (si, _f, decisa) => attese.push([si, decisa]));
  bloccato(ses, 'https://b.salta.example/');
  assert.deepEqual(attese, [[false, true]], 'la domanda aperta su un altro sottodominio si chiude col no');
  const d = pagina(ses, 'https://d.salta.example/');
  assert.equal(esito(d, false, ADESSO), 'no', 'un sottodominio nuovo non torna a chiedere');
  const subito = [];
  P.chiediScaricamenti(d, (si, _f, decisa) => subito.push([si, decisa]));
  assert.deepEqual(subito, [[false, true]]);
  assert.equal(esito(pagina(ses, 'https://altro.example/'), false, ADESSO), 'via', 'un altro sito non ne risente');
  assert.equal(P.dimentica(d).tolte, 1, 'il menu della scheda sul sottodominio nuovo toglie il no del sito');
  assert.notEqual(esito(d, false, ADESSO + 1), 'no');

  // Il sì vale per il sito allo stesso modo.
  const ses2 = sessione();
  const a = pagina(ses2, 'https://a.consenti.example/');
  P.chiediScaricamenti(a, () => {});
  P.rispondi(ses2.avvisi.findLast((x) => x.evento === 'chiedi').dati.id, true);
  const e = pagina(ses2, 'https://e.consenti.example/');
  assert.equal(esito(e, false, ADESSO), 'via');
  assert.equal(esito(e, false, ADESSO + 1), 'via');
});

test('la chat toglie il no ai download automatici di un sito, con le parole che annuncia', () => {
  P._usaDisco({ get: async () => ({}), set: async () => {} });
  const ses = sessione();
  ses.isPersistent = () => true;
  for (const parole of ['download automatici', 'scaricare più file', 'scaricamenti']) {
    const wc = bloccato(ses, 'https://www.spam-chat.example/');
    assert.equal(esito(wc, false, ADESSO), 'no');
    const r = P.togliPerChat('spam-chat.example', parole);
    assert.equal(r.tolte.length, 1, `«${parole}»: ${JSON.stringify(r)}`);
    assert.match(r.tolte[0], /spam-chat\.example/);
    assert.notEqual(esito(wc, false, ADESSO + 1), 'no', `«${parole}»: tolto il no, il sito non è più bloccato`);
  }
  // Il no dato su a.salta-chat.example si toglie anche chiedendolo per b.salta-chat.example, come dal menu della scheda.
  bloccato(ses, 'https://a.salta-chat.example/');
  const b = pagina(ses, 'https://b.salta-chat.example/');
  assert.equal(esito(b, false, ADESSO), 'no');
  const r = P.togliPerChat('b.salta-chat.example', 'download automatici');
  assert.equal(r.tolte.length, 1, JSON.stringify(r));
  assert.notEqual(esito(b, false, ADESSO + 1), 'no');
});

test('il file fatto ripartire confermando l\'avviso di sicurezza conta come scaricato con un clic: non riapre la domanda', () => {
  const wc = pagina(sessione(), 'https://avviso.example/');
  assert.equal(esito(wc, false, ADESSO), 'via');
  assert.equal(esito(wc, false, ADESSO + 1000), 'chiedi');
  P.gestoSulloStrato(wc);
  assert.equal(esito(wc, false, Date.now()), 'via', 'la conferma sull\'avviso vale come un clic');
  const sb = readFileSync(new URL('../../src/main/tabs/tabSafebrowse.js', import.meta.url), 'utf8');
  const ripartenze = sb.split('segna(tab);').slice(1).filter((t) => t.slice(0, 400).includes('downloadURL'));
  assert.ok(ripartenze.length >= 2, 'le due ripartenze da avviso (link e file costruito) ci sono ancora');
  for (const tratto of ripartenze) {
    assert.match(tratto.slice(0, tratto.indexOf('downloadURL')), /Permessi\.gestoSulloStrato\(wc\)/, 'ogni ripartenza da avviso segna il clic prima di riscaricare');
  }
});

test('i file trattenuti dalla domanda sui file multipli non entrano nel conto dei programmi scaricati o rifiutati', () => {
  const DL = require('../../src/main/services/downloads.js');
  const eventi = [];
  globalThis.SN_CONTATORI = { NAV: { programma: (classe, evento) => ({ classe, evento }), scaricamento: () => ({}) } };
  globalThis.SN_CONTATORI_MAIN = { navigazione: (x) => { if (x && x.evento) eventi.push(x.evento); } };
  try {
    const base = { filename: 'setup.exe', url: 'https://x.example/setup.exe', state: 'pending', savePath: '', startedAt: new Date().toISOString() };
    DL._records.set('piu', { ...base, id: 'piu', _piuFile: 'https://x.example' });
    DL._records.set('exe', { ...base, id: 'exe', _piuFile: '' });
    DL.confirmDownload('piu', false);
    assert.deepEqual(eventi, [], 'un file trattenuto per i file multipli non è un programma rifiutato');
    DL.confirmDownload('exe', false);
    assert.deepEqual(eventi, ['rifiutato'], 'un programma vero sì');
  } finally {
    DL._records.delete('piu');
    DL._records.delete('exe');
    delete globalThis.SN_CONTATORI;
    delete globalThis.SN_CONTATORI_MAIN;
  }
});

// Il testo di cosa sa fare Filo nomina la finestra e il tetto del freno: cambiati qui, la frase va riscritta.
test('il manifesto dice la finestra e il tetto che il freno usa davvero', async () => {
  await import('../../src/shared/constants.js');
  await import('../../src/shared/capabilities.js');
  const DL = require('../../src/main/services/downloads.js');
  const A_PAROLE = { 10: 'dieci', 100: 'cento' };
  const caps = JSON.stringify(globalThis.SN_CAPABILITIES || {});
  const minuti = P.SCARICAMENTI_FINESTRA_MS / 60_000;
  assert.ok(A_PAROLE[minuti], `manca il nome a parole di ${minuti} minuti in questa prova`);
  assert.ok(caps.includes(`dal secondo (entro ${A_PAROLE[minuti]} minuti)`), 'il manifesto nomina la finestra');
  assert.ok(A_PAROLE[DL.PIU_FILE_IN_ATTESA], `manca il nome a parole di ${DL.PIU_FILE_IN_ATTESA} in questa prova`);
  assert.ok(caps.includes(`superano ${A_PAROLE[DL.PIU_FILE_IN_ATTESA]}`), 'il manifesto nomina il tetto');
});
