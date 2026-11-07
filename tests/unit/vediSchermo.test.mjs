// #778 — VEDI_SCHERMO: la finestra di Filo parte da sola, quella di un'altra app chiede alla prima occhiata della
// richiesta, e con l'impostazione spenta non si elenca e non si cattura niente. Più l'impostazione che si accende
// con un clic e quello che l'archivio delle chat tiene (il nome, mai l'immagine).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const shared = join(ROOT, 'src', 'shared');
for (const f of ['constants.js', 'preferences.js', 'themeTokens.js', 'cmdClassify.js', 'zoomPagina.js', 'autonomia.js',
  'actionLevels.js', 'actionTools.js', 'contenutoEsterno.js', 'chatArchive.js', 'filoContesto.js']) {
  require(join(shared, f));
}
const Schermo = require(join(ROOT, 'src', 'main', 'services', 'schermo.js'));
const Comandi = require(join(ROOT, 'src', 'main', 'services', 'comandiSistema.js'));

const AL = globalThis.SN_ACTION_LEVELS;
const A = globalThis.SN_AUTONOMIA;
const CA = globalThis.SN_CHAT_ARCHIVE;
const FCx = globalThis.SN_FILO_CONTESTO;
const LIVELLI = A.livelliSelezionabili().map((l) => l.id);
const ACCESA = { schermo: { guarda: true } };

function decisione(action, { livello = 'default', stato = 'pulito', origine = 'chat' } = {}) {
  const ing = AL.ingressi(action, {});
  assert.ok(ing, 'l\'azione è registrata con un costo');
  return A.decideDettaglio({
    livello, stato, costo: ing.costo, campo: ing.campo, difesa: ing.difesa, chiesta: ing.chiesta,
    origine, dentroPerimetro: ing.dentroPerimetro,
  });
}
const ogniCaso = (fn) => {
  for (const livello of LIVELLI) for (const stato of ['pulito', 'contaminato']) fn({ livello, stato });
};

const immagine = ({ colore = 200, w = 1200, h = 800 } = {}) => ({
  isEmpty: () => false,
  getSize: () => ({ width: w, height: h }),
  toBitmap: () => Buffer.alloc(w * h * 4, colore),
  resize: () => immagine({ colore, w: 600, h: 400 }),
  toJPEG: () => Buffer.from(`jpeg-${colore}`),
});

// Il sistema finto: due finestre di altre app, uno schermo, una finestra di Filo. Conta ogni cattura.
function sistemaFinto({ piattaforma = 'win32', permesso = 'granted', wayland = false, nera = false } = {}) {
  const conti = { fonti: 0, catture: 0, finestreFilo: 0, pannello: 0, domanda: 0 };
  const fonti = [
    { id: 'window:101:0', nome: 'Documento1 - Word', tipo: 'finestra', displayId: '' },
    { id: 'window:102:0', nome: 'Errore di Word', tipo: 'finestra', displayId: '' },
    { id: 'window:900:0', nome: 'Filo', tipo: 'finestra', displayId: '' },
    { id: 'screen:1:0', nome: 'Entire screen', tipo: 'schermo', displayId: '1' },
  ];
  const sistema = {
    conti,
    piattaforma: () => piattaforma,
    wayland: () => wayland,
    permessoMac: () => permesso,
    chiediPermessoMac: async () => { conti.domanda += 1; },
    apriPannello: async () => { conti.pannello += 1; },
    fonti: async ({ lato = 0 } = {}) => {
      conti.fonti += 1;
      if (lato > 0) conti.catture += 1;
      if (wayland) return [{ id: 'window:555:0', nome: 'Scelta nel selettore', tipo: 'finestra', displayId: '', immagine: immagine() }];
      return fonti.map((f) => ({ ...f, immagine: lato > 0 ? immagine({ colore: nera ? 0 : 200 }) : null }));
    },
    finestreFilo: () => {
      conti.finestreFilo += 1;
      return [{
        id: 'filo:1', tipo: 'finestra', filo: true, nome: 'Filo: Ricette', url: 'https://ricette.example/',
        wc: { capturePage: async () => { conti.catture += 1; return immagine(); } },
      }];
    },
    maniglieFilo: () => ['900'],
    schermi: () => ({ primario: '1', conFilo: '1', lato: 1920 }),
    delicata: async (url) => (/banca/.test(url) ? 'banche' : ''),
  };
  return sistema;
}

test('la finestra di Filo parte da sola a ogni livello, pulito o no (livello 1)', () => {
  const a = { type: 'VEDI_SCHERMO', finestra: 'Filo: Ricette', _finestra: { id: 'filo:1', nome: 'Filo: Ricette', tipo: 'finestra', filo: true } };
  ogniCaso((c) => assert.equal(decisione(a, c).risposta, 'si', JSON.stringify(c)));
});

test('la finestra di un\'altra app chiede alla prima occhiata, a ogni livello (livello 2), con il suo nome nel popup', () => {
  const a = { type: 'VEDI_SCHERMO', finestra: 'Word', _finestra: { id: 'window:101:0', nome: 'Documento1 - Word', tipo: 'finestra', filo: false } };
  ogniCaso((c) => {
    const d = decisione(a, c);
    assert.equal(d.risposta, 'chiede', JSON.stringify(c));
    assert.equal(d.digita, false, 'un clic, non la parola «conferma»');
  });
  assert.match(AL.describe(a), /Documento1 - Word/);
  assert.match(AL.ingressi(a).perchePerimetro, /prima volta/);
  // Già guardata in questa richiesta: parte da sola.
  ogniCaso((c) => assert.equal(decisione({ ...a, _approvata: true }, c).risposta, 'si', JSON.stringify(c)));
  // Da un'automazione non parte e non chiede: propone.
  assert.equal(decisione(a, { origine: 'automazione' }).risposta, 'propone');
});

test('lo schermo intero, il selettore di Wayland e una pagina delicata in Filo chiedono come una finestra esterna', () => {
  for (const f of [
    { id: 'screen:1:0', nome: 'Schermo intero', tipo: 'schermo', filo: false },
    { id: 'selettore', nome: 'Una finestra', tipo: 'selettore', filo: false },
    { id: 'filo:2', nome: 'Filo: La mia banca', tipo: 'finestra', filo: true, web: true, delicata: 'banche' },
  ]) {
    ogniCaso((c) => assert.equal(decisione({ type: 'VEDI_SCHERMO', _finestra: f }, c).risposta, 'chiede', `${f.nome} ${JSON.stringify(c)}`));
  }
});

test('impostazione spenta: nessuna cattura, e nemmeno l\'elenco delle finestre', async () => {
  const sis = sistemaFinto();
  const S = Schermo.crea({ sistema: sis });
  for (const settings of [{}, { schermo: { guarda: false } }, null]) {
    const action = { type: 'VEDI_SCHERMO', finestra: 'Word' };
    const r = await S.prepara(action, { settings, chiave: 't' });
    assert.equal(r.esito.output.spenta, true);
    assert.equal(r.esito.executed, false);
    assert.equal(action._finestra, undefined);
  }
  assert.deepEqual(sis.conti, { fonti: 0, catture: 0, finestreFilo: 0, pannello: 0, domanda: 0 });
});

test('il modello non si approva da sé: finestra e approvazione le scrive il main', async () => {
  const S = Schermo.crea({ sistema: sistemaFinto() });
  const action = { type: 'VEDI_SCHERMO', finestra: 'Documento1 - Word', _approvata: true, _finestra: { id: 'window:101:0', filo: true } };
  await S.prepara(action, { settings: ACCESA, chiave: 't' });
  assert.equal(action._approvata, false);
  assert.equal(action._finestra.filo, false);
  assert.equal(decisione(action).risposta, 'chiede');
});

test('elenco, nome esatto, nome parziale, ambiguo e assente', async () => {
  const S = Schermo.crea({ sistema: sistemaFinto() });
  const prova = async (finestra) => {
    const action = { type: 'VEDI_SCHERMO', finestra };
    return { r: await S.prepara(action, { settings: ACCESA, chiave: 't' }), action };
  };
  const elenco = (await prova('')).r.esito.output.elenco.map((v) => v.nome);
  // La finestra di Filo vista dal sistema non compare due volte, e lo schermo ha un nome che si capisce.
  assert.deepEqual(elenco, ['Documento1 - Word', 'Errore di Word', 'Schermo intero', 'Filo: Ricette']);
  assert.equal((await prova('Errore di Word')).action._finestra.id, 'window:102:0');
  assert.equal((await prova('documento1')).action._finestra.id, 'window:101:0');
  assert.equal((await prova('schermo intero')).action._finestra.tipo, 'schermo');
  const ricette = (await prova('ricette')).action._finestra;
  assert.equal(ricette.filo, true);
  assert.equal(ricette.web, true);
  const ambigua = (await prova('word')).r.esito.output;
  assert.deepEqual(ambigua.ambigue.map((v) => v.nome), ['Documento1 - Word', 'Errore di Word']);
  const assente = (await prova('Excel')).r.esito;
  assert.equal(assente.executed, false);
  assert.equal(assente.output.nessuna, true);
  assert.equal(assente.output.elenco.length, 4);
});

test('una richiesta nuova torna a chiedere; nella stessa la finestra già guardata parte da sola', async () => {
  const sis = sistemaFinto();
  const S = Schermo.crea({ sistema: sis });
  const letture = [];
  const leggi = async (x) => { letture.push(x); return 'C\'è scritto: Salvare le modifiche?'; };
  const prima = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word' };
  await S.prepara(prima, { settings: ACCESA, chiave: 'scheda-1' });
  assert.equal(decisione(prima).risposta, 'chiede');
  const r = await S.guarda(prima, { chiave: 'scheda-1', domanda: 'cosa mi chiede?', leggi });
  assert.equal(r.executed, true);
  assert.equal(r.output.testo, 'C\'è scritto: Salvare le modifiche?');
  assert.equal(r.output.finestra, 'Errore di Word');
  assert.match(letture[0].dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(letture[0].domanda, 'cosa mi chiede?');

  const seconda = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word' };
  await S.prepara(seconda, { settings: ACCESA, chiave: 'scheda-1' });
  assert.equal(decisione(seconda).risposta, 'si', 'stessa finestra, stessa richiesta: niente popup');
  const altraScheda = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word' };
  await S.prepara(altraScheda, { settings: ACCESA, chiave: 'scheda-2' });
  assert.equal(decisione(altraScheda).risposta, 'chiede', 'l\'OK vale per la chat che l\'ha dato');
  const altra = { type: 'VEDI_SCHERMO', finestra: 'Documento1 - Word' };
  await S.prepara(altra, { settings: ACCESA, chiave: 'scheda-1' });
  assert.equal(decisione(altra).risposta, 'chiede', 'un\'altra finestra chiede la sua prima volta');

  S.nuovoTurno('scheda-1');
  const dopo = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word' };
  await S.prepara(dopo, { settings: ACCESA, chiave: 'scheda-1' });
  assert.equal(decisione(dopo).risposta, 'chiede');
});

test('all\'OK vale la finestra che il popup ha mostrato; se si è chiusa lo dice', async () => {
  const S = Schermo.crea({ sistema: sistemaFinto() });
  const action = { type: 'VEDI_SCHERMO', finestra: 'word' };
  const r = await S.prepara(action, { settings: ACCESA, chiave: 't', mostrata: { id: 'window:102:0', nome: 'Errore di Word' } });
  assert.equal(r.voce.id, 'window:102:0');
  const chiusa = await S.prepara({ type: 'VEDI_SCHERMO', finestra: 'x' }, { settings: ACCESA, chiave: 't', mostrata: { id: 'window:7:0', nome: 'Vecchia' } });
  assert.equal(chiusa.esito.executed, false);
  assert.match(chiusa.esito.output.errore, /non è più aperta/);
});

test('Mac senza permesso: le altre app non si elencano, e chiederne una apre il pannello invece di dare un\'immagine nera', async () => {
  const sis = sistemaFinto({ piattaforma: 'darwin', permesso: 'denied' });
  const S = Schermo.crea({ sistema: sis });
  // L'elenco è il primo passo del modello: porta già al permesso, col tasto del pannello.
  const elenco = await S.prepara({ type: 'VEDI_SCHERMO' }, { settings: ACCESA, chiave: 't' });
  assert.deepEqual(elenco.esito.output.elenco.map((v) => v.nome), ['Filo: Ricette']);
  assert.equal(elenco.esito.executed, false);
  assert.equal(elenco.esito.output.permesso, 'mac');
  assert.equal(elenco.esito.output.apri, Schermo.PANNELLO_MAC);
  assert.equal(sis.conti.pannello, 1);
  const r = await S.prepara({ type: 'VEDI_SCHERMO', finestra: 'Word' }, { settings: ACCESA, chiave: 't' });
  assert.equal(r.esito.executed, false);
  assert.equal(r.esito.output.permesso, 'mac');
  assert.match(r.esito.output.frase, /Registrazione schermo/);
  assert.match(Comandi.uriImpostazioni(r.esito.output.apri), /^x-apple\.systempreferences:.*Privacy_ScreenCapture$/);
  await S.prepara({ type: 'VEDI_SCHERMO', finestra: 'Word' }, { settings: ACCESA, chiave: 't' });
  assert.equal(sis.conti.pannello, 1, 'il pannello si apre una volta per richiesta');
  assert.equal(sis.conti.fonti, 0, 'senza permesso non si chiede niente al sistema');
  // La finestra di Filo si guarda lo stesso: non passa dal permesso.
  const filo = { type: 'VEDI_SCHERMO', finestra: 'Ricette' };
  await S.prepara(filo, { settings: ACCESA, chiave: 't' });
  assert.equal(filo._finestra.filo, true);

  const nuovo = sistemaFinto({ piattaforma: 'darwin', permesso: 'not-determined' });
  await Schermo.crea({ sistema: nuovo }).prepara({ type: 'VEDI_SCHERMO', finestra: 'Word' }, { settings: ACCESA, chiave: 't' });
  assert.equal(nuovo.conti.domanda, 1, 'la prima volta chiede macOS, che mette Filo nell\'elenco');
  assert.equal(nuovo.conti.pannello, 0);
  const daElenco = sistemaFinto({ piattaforma: 'darwin', permesso: 'not-determined' });
  const r2 = await Schermo.crea({ sistema: daElenco }).prepara({ type: 'VEDI_SCHERMO' }, { settings: ACCESA, chiave: 't' });
  assert.equal(daElenco.conti.domanda, 1, 'anche chiedendo l\'elenco');
  assert.equal(r2.esito.output.permesso, 'mac');
});

test('l\'elenco segna in primo piano la prima finestra esterna che dà il sistema: è «questa finestra»', async () => {
  const S = Schermo.crea({ sistema: sistemaFinto() });
  const r = await S.prepara({ type: 'VEDI_SCHERMO' }, { settings: ACCESA, chiave: 't' });
  const davanti = r.esito.output.elenco.filter((v) => v.davanti);
  assert.deepEqual(davanti.map((v) => v.nome), ['Documento1 - Word']);
  const wl = await Schermo.crea({ sistema: sistemaFinto({ wayland: true }) }).prepara({ type: 'VEDI_SCHERMO' }, { settings: ACCESA, chiave: 't' });
  assert.equal(wl.esito.output.elenco.some((v) => v.davanti), false, 'col selettore di Wayland non c\'è un ordine da dire');
});

test('un\'immagine nera o vuota non va al modello', async () => {
  const sis = sistemaFinto({ nera: true });
  const S = Schermo.crea({ sistema: sis });
  const action = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word' };
  await S.prepara(action, { settings: ACCESA, chiave: 't' });
  let letta = false;
  const r = await S.guarda(action, { chiave: 't', leggi: async () => { letta = true; return 'x'; } });
  assert.equal(r.executed, false);
  assert.equal(letta, false);
  assert.match(r.output.errore, /nera/);
  const macNero = Schermo.crea({ sistema: sistemaFinto({ piattaforma: 'darwin', nera: true }) });
  const m = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word' };
  await macNero.prepara(m, { settings: ACCESA, chiave: 't' });
  const rm = await macNero.guarda(m, { chiave: 't', leggi: async () => 'x' });
  assert.equal(rm.output.permesso, 'mac', 'su Mac una cattura nera è il permesso che manca');
});

test('un errore del modello torna come frase, senza testo inventato', async () => {
  const S = Schermo.crea({ sistema: sistemaFinto() });
  const action = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word' };
  await S.prepara(action, { settings: ACCESA, chiave: 't' });
  const r = await S.guarda(action, { chiave: 't', leggi: async () => { throw new Error('402'); }, fraseErrore: () => 'crediti finiti' });
  assert.equal(r.executed, false);
  assert.equal(r.output.errore, 'crediti finiti');
  assert.equal(r.output.testo, undefined);
});

test('Wayland: niente elenco delle altre app, si passa dal selettore del sistema', async () => {
  const sis = sistemaFinto({ wayland: true });
  const S = Schermo.crea({ sistema: sis });
  const elenco = await S.prepara({ type: 'VEDI_SCHERMO' }, { settings: ACCESA, chiave: 't' });
  assert.equal(sis.conti.fonti, 0, 'elencare non apre il selettore');
  const voce = elenco.esito.output.elenco.find((v) => v.tipo === 'selettore');
  assert.ok(voce);
  const action = { type: 'VEDI_SCHERMO', finestra: voce.nome };
  await S.prepara(action, { settings: ACCESA, chiave: 't' });
  assert.equal(decisione(action).risposta, 'chiede');
  assert.match(AL.describe(action), /selettore del sistema/);
  const r = await S.guarda(action, { chiave: 't', leggi: async () => 'testo' });
  assert.equal(r.executed, true);
  assert.equal(r.output.finestra, 'Scelta nel selettore');
  assert.equal(sis.conti.fonti, 1);
  assert.equal(Schermo.sessioneWayland({ XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), true);
  assert.equal(Schermo.sessioneWayland({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, 'linux'), false);
  assert.equal(Schermo.sessioneWayland({ XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }, 'darwin'), false);
});

test('l\'impostazione si accende con un OK a ogni livello (la parola solo dove la tabella la vuole per il costo 2), e si spegne da sola', () => {
  const on = { type: 'IMPOSTA_PREFERENZA', chiave: 'guarda_schermo', valore: 'on' };
  const built = globalThis.SN_PREF.buildPreferencePartial('guarda_schermo', 'on');
  assert.equal(built.costo, 2);
  assert.equal(built.chiede, true);
  assert.equal(built.allenta, false);
  assert.ok(built.risk.length > 20);
  assert.deepEqual(built.partial, { schermo: { guarda: true } });
  ogniCaso((c) => {
    const d = decisione(on, c);
    // Conservativo dopo una lettura vuole «conferma» per ogni costo 2 (tabella del 30/09, #1312): non è un freno tolto.
    const parola = c.livello === 'conservativo' && c.stato === 'contaminato';
    assert.ok(d.risposta === (parola ? 'conferma' : 'chiede'), JSON.stringify(c));
    assert.equal(d.digita, parola);
    assert.notEqual(d.regola, 'difesa');
  });
  assert.match(AL.describe(on), /guardare lo schermo/i);
  assert.equal(decisione({ type: 'IMPOSTA_PREFERENZA', chiave: 'guarda_schermo', valore: 'off' }).risposta, 'si');
  assert.equal(globalThis.SN_CONST.DEFAULT_SETTINGS.schermo.guarda, false, 'spenta all\'installazione');
});

test('l\'archivio della chat tiene il nome della finestra guardata, mai l\'immagine né quello che c\'era', () => {
  const turno = {
    role: 'filo', text: 'Ti chiede se salvare.',
    actions: [{
      type: 'VEDI_SCHERMO', _executed: true,
      _output: { finestra: 'Errore di Word', testo: 'TESTO-RISERVATO-DELLA-FINESTRA', immagine: 'data:image/jpeg;base64,AAAA' },
    }],
  };
  const m = CA.toStoredMessage(turno);
  assert.deepEqual(m.guardate, ['Errore di Word']);
  assert.deepEqual(m.actions, ['VEDI_SCHERMO']);
  const json = JSON.stringify(m);
  assert.ok(!json.includes('TESTO-RISERVATO'));
  assert.ok(!json.includes('data:image'));
  // Una conferma data dopo il turno arriva col solo nome.
  assert.deepEqual(CA.toStoredMessage({ role: 'filo', text: '', actions: [{ type: 'VEDI_SCHERMO' }], guardate: ['Schermo intero'] }).guardate, ['Schermo intero']);
  // Riaperta, il modello sa che l'aveva guardata e che il contenuto non c'è più.
  const ora = Date.parse('2026-10-15T12:00:00.000Z');
  const f = FCx.finestra([{ ...m, ts: new Date(ora - 60_000).toISOString(), chat: 'c1' }], { ora, giorni: 3, token: 100000 });
  assert.match(f.messaggi[0].content, /Errore di Word.*non è conservato/);
});

test('ogni azione di sola lettura del registro ha uno strumento, e VEDI_SCHERMO è fra le letture', () => {
  assert.ok(AL.LETTURE.includes('VEDI_SCHERMO'));
  assert.ok(globalThis.SN_ACTION_TOOLS.NAMES.includes('VEDI_SCHERMO'));
  assert.equal(AL.costoFor({ type: 'VEDI_SCHERMO' }), 0);
});
