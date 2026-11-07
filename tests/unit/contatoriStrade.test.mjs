// I contatori delle strade (#1468): elenchi chiusi copiati dal codice, i tasti per nome, il contesto del tasto destro, le
// attese di Ctrl+Shift+T e Ctrl+L, il tempo in vista delle pagine di Filo e il documento che esce, col servizio vero su
// disco, orologio e rete finti. Un testo, un indirizzo, un sito o un tasto scritto non escono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'messages', 'tasti', 'zoomPagina', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding',
  'cambi', 'disposizioneIcone', 'contatoriGiornalieri', 'contatoriStrade']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const Misure = require(join(ROOT, 'src', 'main', 'services', 'contatoriStrade.js'));
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_STRADE;

const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');
const BASE = 'https://firestore.test/v1/projects/p/databases/(default)/documents';
const MIN = 60 * 1000;
const ORA = 60 * MIN;
const T0 = new Date(2026, 10, 1, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

const SITO = 'banca-falsa.example';
const SCRITTO = 'ricetta della nonna segreta';

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ risposta = 200 } = {}) {
  const disco = new Map();
  const per = {};
  const b = { t: T0, accesi: true, incognito: false, risposta, disco, per, n: 0 };
  b.s = Servizio.crea({
    contatori: C,
    contatoriStrade: S,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi } }),
    inIncognito: () => b.incognito,
    runNormale: (fn) => fn(),
    finestraNormale: () => true,
    adesso: () => b.t,
    versione: () => '0.2.300',
    piattaforma: 'linux',
    esclusi: async () => [],
    casuale: () => `${'7'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: BASE, API_KEY: 'K' }),
    idToken: async () => 'token-anonimo',
    fetch: async (url, opt) => {
      const coll = /documents\/([a-z-]+)\?/.exec(url)[1];
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      (per[coll] || (per[coll] = [])).push({ url, doc, body: opt.body });
      const st = typeof b.risposta === 'function' ? b.risposta(coll, doc) : b.risposta;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}) };
    },
    log: () => {},
  });
  b.m = Misure.crea({ contatori: b.s, adesso: () => b.t });
  return b;
}
const dellOra = async (b) => {
  await attendi();
  const s = await b.s.letto();
  return (s.ore[C.oraDi(b.t)] || {}).strade || {};
};
const spedisci = async (b) => {
  await attendi();
  b.t += ORA;
  return b.s.controlla();
};
const tasto = (key, mod = {}) => ({ type: 'keyDown', key, ...mod });

// ── Gli elenchi sono copie del codice ──────────────────────────────────────

test('le azioni sono le icone della barra (tranne l’incognito), le quattro di Filo, lo zoom e la barra laterale', () => {
  const D = globalThis.SN_DISPOSIZIONE_ICONE;
  assert.deepEqual([...S.ICONE].sort(), Object.keys(D.ICONE).filter((id) => !S.NON_CONTATE.includes(id)).sort());
  assert.deepEqual([...S.AZIONI_FILO], globalThis.SN_TASTI.AZIONI_FILO.map((a) => a.id));
  for (const [a, icona] of Object.entries(S.STESSA_DI)) {
    assert.ok(S.AZIONI_FILO.includes(a) && S.ICONE.includes(icona), `${a} → ${icona}`);
    assert.equal(S.chiaveAzione(a, 'scorciatoia'), `${icona}:scorciatoia`, 'una cosa sola ha un nome solo');
  }
  assert.deepEqual(Object.keys(S.ZOOM).sort(), [...globalThis.SN_ZOOM.VERSI].sort());
  assert.equal(S.chiaveAzione('incognito', 'barra'), '', 'da quale strada parte una finestra in incognito non esce');
  assert.equal(S.chiaveAzione('un-id-nuovo', 'barra'), 'altro:barra', 'un id fuori elenco esce come «altro»');
  assert.equal(S.chiaveAzione('newTab', 'tasto_magico'), '', 'una strada fuori elenco non esce');
});

test('le pagine sono quelle di FILO_TAB_LABELS più quelle del feedback, e le fasce sono quelle di oggi', () => {
  const shell = leggi('src/renderer/shell.js');
  const etichette = /const FILO_TAB_LABELS = \{([\s\S]*?)\n {2}\};/.exec(shell)[1];
  assert.deepEqual([...etichette.matchAll(/^ {4}'([^']+)':/gm)].map((m) => m[1]), [...S.ETICHETTE]);
  for (const p of S.IN_PIU) assert.ok(existsSync(join(ROOT, 'src', 'pages', p)), `manca la pagina ${p}`);
  assert.deepEqual(S.FASCE_VISTA.map(([k, v]) => [k, v]), C.FASCE.map(([k, v]) => [k, v]));
  assert.equal(S.FASCE_LISTA.at(-1)[1], Number(/const PAGINE_NEL_MENU = (\d+);/.exec(leggi('src/main/barraLaterale.js'))[1]),
    'l’ultima fascia dell’elenco è quanto ne mostra la barra');
  assert.equal(S.paginaDi('filo://options/altro.html'), 'options_altro');
  assert.equal(S.paginaDi('filo://preferences/preferences.html#sec-barra'), 'preferences');
  assert.equal(S.paginaDi('filo://newtab/?accoglienza=1'), 'newtab');
  assert.equal(S.paginaDi('filo://board/board.html#segnalazioni'), 'board');
  assert.equal(S.paginaDi('filo://redteam/redteam.html'), 'altro');
  // Senza file il protocollo carica <host>/<host>.html: l'indirizzo corto è la stessa pagina.
  assert.equal(S.paginaDi('filo://preferences/'), 'preferences');
  assert.equal(S.paginaDi('filo://options'), 'options');
  assert.equal(S.paginaDi('filo://editor/#doc'), 'editor');
  assert.equal(S.paginaDi('filo://newtab'), 'newtab');
  assert.equal(S.paginaDi('filo://newtab/newtab.html'), 'newtab');
  assert.equal(S.paginaDi('filo://downloads/'), 'downloads');
  assert.equal(S.paginaDi(`https://${SITO}/`), '', 'un sito non è una pagina di Filo');
});

test('ogni strada ha chi la conta, e le chiusure delle schede hanno la loro', () => {
  const sorgenti = ['src/main/shortcuts.js', 'src/main/tabs.js', 'src/main/tabs/tabZoom.js', 'src/main/window.js', 'src/main/menu.js',
    'src/main/barraLaterale.js', 'src/main/ipc.js', 'src/main/services/handlers.js', 'src/main/services/handlers/nav.js',
    'src/main/services/handlers/contatori.js', 'src/renderer/shell.js', 'src/content/content.js', 'src/content/actions.js',
    'src/preload/page-preload.js', 'src/pages/dashboard/dashboard-comandi.js', 'src/pages/dashboard/dashboard-carte.js',
    'src/pages/dashboard/dashboard-attivita.js', 'src/pages/dashboard/dashboard.js'].map(leggi).join('\n');
  // La riga di icone del tasto destro non c'è più (#1246): resta nell'elenco e nelle regole, e nessuno la conta.
  const morte = ['tasto_destro_riga'];
  for (const v of [...S.VIE_AZIONE, ...S.VIE_CRONOLOGIA, ...S.VIE_PAGINA, ...S.VIE_AIUTO, ...S.MOTIVI_A_VUOTO]) {
    if (morte.includes(v)) continue;
    assert.ok(sorgenti.includes(`'${v}'`), `nessuno conta la strada «${v}»`);
  }
  for (const v of S.VOCI_NATIVO) assert.ok(sorgenti.includes(`'${v}'`), `nessuno conta «${v}»`);
  const tabs = leggi('src/main/tabs.js');
  const mappa = /const STRADA_DELLA_CHIUSURA = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(tabs)[1];
  const VIE_CHIUSURA = globalThis.SN_CONTATORI_FINESTRA ? globalThis.SN_CONTATORI_FINESTRA.VIE_CHIUSURA : null;
  for (const [, chiusura, strada] of mappa.matchAll(/(\w+): '(\w+)'/g)) {
    assert.ok(S.VIE_AZIONE.includes(strada), strada);
    if (VIE_CHIUSURA) assert.ok(VIE_CHIUSURA.includes(chiusura), chiusura);
  }
});

// ── I tasti per nome ─────────────────────────────────────────────────────────

test('i tasti dei browser escono per nome, Cmd vale quanto Ctrl, e un tasto che scrive non esce mai', () => {
  const t = (key, mod = {}, p = 'win32') => S.tastoDaBrowser(tasto(key, mod), p);
  assert.equal(t('t', { control: true }), 'ctrl_t');
  assert.equal(t('T', { control: true, shift: true }), 'ctrl_shift_t');
  assert.equal(t('w', { meta: true }, 'darwin'), 'ctrl_w');
  assert.equal(t('l', { control: true }, 'linux'), 'ctrl_l');
  assert.equal(t('r', { control: true }), 'ctrl_r');
  for (const k of ['h', 'j', 'd', 'f']) assert.equal(t(k, { control: true }), `ctrl_${k}`);
  assert.equal(t('3', { control: true }), 'salto_scheda');
  assert.equal(t('Tab', { control: true }), 'ctrl_tab');
  assert.equal(t('Tab', { control: true, shift: true }), 'ctrl_shift_tab');
  assert.equal(t('ArrowLeft', { alt: true, code: 'ArrowLeft' }), 'alt_freccia');
  assert.equal(t('[', { meta: true, code: 'BracketLeft' }, 'darwin'), 'alt_freccia');
  for (const k of ['F5', 'F6', 'F11']) assert.equal(t(k), k.toLowerCase());
  // Mai un tasto che scrive, né AltGr (Ctrl+Alt), né Cmd+freccia su Mac, che nei campi muove il cursore.
  for (const k of ['a', 't', 'l', '3', ' ', 'Enter', SCRITTO]) assert.equal(t(k), '', k);
  assert.equal(t('l', { control: true, alt: true }), '', 'AltGr scrive');
  assert.equal(t('ArrowLeft', { meta: true, code: 'ArrowLeft' }, 'darwin'), '');
  assert.equal(t('w', { control: true, shift: true }), '');
  assert.equal(S.tastoDaBrowser({ ...tasto('t', { control: true }), isAutoRepeat: true }, 'win32'), '', 'tenuto premuto non conta');
  assert.equal(S.tastoDaBrowser({ type: 'keyUp', key: 't', control: true }, 'win32'), '');
});

test('il contesto del tasto destro: una bandiera, sette combinazioni dichiarate, il resto «misto»', () => {
  for (const b of S.BANDIERE) assert.equal(S.chiaveContesto([b]), b);
  for (const k of S.COMBINAZIONI) assert.equal(S.chiaveContesto(k.split('+').reverse()), k, 'l’ordine non conta');
  assert.equal(S.COMBINAZIONI.length, 7);
  assert.equal(S.chiaveContesto(['selezione', 'media', 'campo']), 'misto');
  assert.equal(S.chiaveContesto(['avviso', 'collegamento']), 'misto');
  assert.equal(S.chiaveContesto(['pagina', 'immagine']), 'immagine', '«pagina» è l’assenza delle altre');
  assert.equal(S.chiaveContesto({ selezione: true, collegamento: true, immagine: false }), 'selezione+collegamento');
  assert.equal(S.chiaveContesto([SITO]), '');
  assert.equal(S.chiaveContesto([]), '');
  const content = leggi('src/content/content.js');
  const bandiere = /function bandiereDelContesto\([^)]*\) \{([\s\S]*?)\n {2}\}/.exec(content)[1];
  for (const b of [...bandiere.matchAll(/b\.push\('([a-z]+)'\)/g)].map((m) => m[1])) assert.ok(S.BANDIERE.includes(b), b);
  for (const b of ['avviso', 'file', 'campo']) assert.match(content, new RegExp(`contaContesto\\(\\['${b}'\\]\\)`));
});

// ── Le registrazioni e il documento ─────────────────────────────────────────

test('ogni misura: un testo, un indirizzo, un sito o un nome inventato non escono in nessuna forma', async () => {
  const b = banco();
  assert.equal(b.m.azione('newTab', 'pulsante_scheda'), true);
  b.m.azione('open-help-sidebar', 'menu_app');
  b.m.azione(SITO, 'chat');
  b.m.azione('incognito', 'barra');
  b.m.azione('reload', SITO);
  assert.equal(b.m.tasto(tasto('f', { control: true })), 'ctrl_f');
  assert.equal(b.m.tasto(tasto('x')), '');
  b.m.aVuoto('explain-selection', 'filo_spento_sul_sito');
  b.m.aVuoto(SCRITTO, 'avviso_sito');
  b.m.nativo('shift_tasto_destro');
  b.m.nativo(`menu_del_sito:${SITO}`);
  b.m.contesto(['collegamento', 'immagine', 'livelli']);
  b.m.contesto([SITO]);
  b.m.cronologia('indietro', 'tasto_mouse');
  b.m.cronologia('avanti', 'barra_lista', { posizione: 5 });
  b.m.cronologia('avanti', 'barra_lista', { posizione: 40 });
  b.m.pagina('filo://editor/editor.html', 'carta_home');
  b.m.pagina(`https://${SITO}/`, 'barra');
  b.m.pagina('filo://preferences/preferences.html', SITO);
  b.m.aiuto('avviso_sito');
  b.m.aiuto(SITO);
  const d = await dellOra(b);
  assert.deepEqual(d.via_azione, { 'newTab:pulsante_scheda': 1, 'help:menu_app': 1, 'altro:chat': 1, 'back:tasto_mouse': 1 });
  assert.deepEqual(d.tasto_da_browser, { ctrl_f: 1 });
  assert.deepEqual(d.scorciatoia_a_vuoto, { 'explain-selection:filo_spento_sul_sito': 1 });
  assert.deepEqual(d.menu_nativo_scelto, { shift_tasto_destro: 1 });
  assert.deepEqual(d.contesto_box, { 'collegamento+immagine+livelli': 1 });
  assert.deepEqual(d.navigazione_cronologia, { 'indietro:tasto_mouse': 1, 'avanti:barra_lista:p4_6': 1 });
  assert.deepEqual(d.pagina_di_filo_aperta, { 'editor:carta_home': 1 });
  assert.deepEqual(d.aiuto_aperto, { avviso_sito: 1 });

  assert.equal(await spedisci(b), 'inviati');
  const [st] = b.per[S.COLLEZIONE];
  assert.equal(S.valida(st.doc).ok, true, S.valida(st.doc).motivo);
  assert.equal(C.idDocumento(st.doc), C.idDocumento(b.per[C.COLLEZIONE][0].doc), 'lo stesso id dell’ora');
  for (const lista of Object.values(b.per)) {
    for (const x of lista) for (const ago of [SITO, SCRITTO, 'nonna', 'https']) assert.ok(!x.body.includes(ago), `«${ago}» è uscito`);
  }
});

test('lo stesso gesto visto da due porte nello stesso istante conta una volta; due gesti veri due', async () => {
  const b = banco();
  b.m.azione('newTab', 'scorciatoia');
  b.m.azione('newTab', 'scorciatoia');
  b.m.tastoNome('ctrl_t');
  b.m.tasto(tasto('t', { control: true }));
  b.t += 1000;
  b.m.azione('newTab', 'scorciatoia');
  b.m.tasto(tasto('t', { control: true }));
  const d = await dellOra(b);
  assert.deepEqual(d.via_azione, { 'newTab:scorciatoia': 2 });
  assert.deepEqual(d.tasto_da_browser, { ctrl_t: 2 });
});

test('in incognito e a contatori spenti non si conta niente, e un’ora senza questi conti non ha il suo documento', async () => {
  const b = banco();
  b.m.azione('reload', 'barra', { incognito: true });
  b.m.pagina('filo://editor/editor.html', 'barra', { incognito: true });
  b.incognito = true;
  b.m.aiuto('scorciatoia');
  b.m.contesto(['pagina']);
  b.incognito = false;
  b.accesi = false;
  b.m.tasto(tasto('F5'));
  await attendi();
  b.accesi = true;
  await b.s.strade(() => true);
  assert.ok(Object.values(await dellOra(b)).every((m) => !Object.keys(m).length));
  assert.equal(await spedisci(b), 'inviati');
  assert.equal(b.per[S.COLLEZIONE], undefined);
});

test('il documento rifiutato (regole non ancora pubblicate) tiene l’ora in attesa, e il giorno dopo parte', async () => {
  const b = banco({ risposta: (coll) => (coll === S.COLLEZIONE ? 403 : 200) });
  b.m.aiuto('barra');
  assert.equal(await spedisci(b), 'fallito');
  b.risposta = (coll) => (coll === C.COLLEZIONE ? 409 : 200);
  b.t += 24 * ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per[S.COLLEZIONE].length, 2);
  assert.deepEqual(b.per[S.COLLEZIONE][1].doc.aiuto_aperto, { barra: '1' });
});

// ── Le attese dei tasti e il tempo in vista ─────────────────────────────────

test('Ctrl+Shift+T: la scheda data chiusa entro dieci secondi senza navigare conta; navigata o tenuta no', async () => {
  const b = banco();
  const finestra = {};
  const presto = { url: 'https://uno.example/' };
  b.m.attesa(presto, 'ctrl_shift_t');
  b.m.navigata(presto);
  b.m.caricata(presto);
  b.t += 4000;
  b.m.chiusa(finestra, presto);
  const navigata = { url: 'https://due.example/' };
  b.m.attesa(navigata, 'ctrl_shift_t');
  b.m.caricata(navigata);
  b.m.navigata(navigata);
  b.m.chiusa(finestra, navigata);
  const tenuta = { url: 'https://tre.example/' };
  b.m.attesa(tenuta, 'ctrl_shift_t');
  b.t += 11_000;
  b.m.chiusa(finestra, tenuta);
  assert.deepEqual((await dellOra(b)).tasto_da_browser, { 'aspettativa_mancata:ctrl_shift_t': 1 });
});

test('Ctrl+L: la home lasciata entro dieci secondi senza scrivere conta, una volta; scritta o tenuta no', async () => {
  const b = banco();
  const finestra = {};
  const home = { url: 'filo://newtab/' };
  const altra = { url: 'https://altra.example/' };
  b.m.inVista(finestra, home, home.url);
  b.m.attesa(home, 'ctrl_l');
  b.t += 2000;
  b.m.inVista(finestra, altra, altra.url);
  b.m.inVista(finestra, home, home.url);
  b.m.inVista(finestra, altra, altra.url);
  // Scritta: anche solo Invio o un incolla.
  b.m.inVista(finestra, home, home.url);
  b.m.attesa(home, 'ctrl_l');
  b.m.inputScheda(home, tasto('v', { control: true }));
  b.m.inVista(finestra, altra, altra.url);
  // Tenuta oltre i dieci secondi, poi chiusa.
  b.m.inVista(finestra, home, home.url);
  b.m.attesa(home, 'ctrl_l');
  b.t += 12_000;
  b.m.chiusa(finestra, home);
  // Lasciata navigando altrove nella stessa scheda, senza scrivere.
  const stessa = { url: 'filo://newtab/' };
  b.m.inVista(finestra, stessa, stessa.url);
  b.m.attesa(stessa, 'ctrl_l');
  b.m.inputScheda(stessa, tasto('Control', { control: true }));
  b.m.inVista(finestra, stessa, 'https://indietro.example/');
  assert.deepEqual((await dellOra(b)).tasto_da_browser, { 'aspettativa_mancata:ctrl_l': 2 });
});

test('il tempo in vista vale per la pagina appena aperta, la prima volta che sta davanti, fino a quando se ne va', async () => {
  const b = banco();
  const finestra = {};
  const pref = { url: 'filo://preferences/preferences.html' };
  const sito = { url: 'https://sito.example/' };
  b.m.inVista(finestra, sito, sito.url);
  b.m.pagina(pref.url, 'menu_app', { finestra });
  b.t += 200;
  b.m.inVista(finestra, pref, pref.url);
  b.t += 1500;
  b.m.inVista(finestra, sito, sito.url);
  // Tornarci non è un'altra apertura.
  b.m.inVista(finestra, pref, pref.url);
  b.t += 60_000;
  b.m.inVista(finestra, sito, sito.url);
  // Aperta e lasciata davanti a lungo, poi chiusa; un'apertura che non arriva davanti entro tre secondi non ha tempo.
  const editor = { url: 'filo://editor/editor.html' };
  b.m.pagina(editor.url, 'barra', { finestra });
  b.m.inVista(finestra, editor, editor.url);
  b.t += 45_000;
  b.m.chiusa(finestra, editor);
  b.m.pagina('filo://credits/credits.html', 'comando_slash', { finestra });
  b.t += 5000;
  b.m.inVista(finestra, { url: 'filo://credits/credits.html' }, 'filo://credits/credits.html');
  b.m.inVista(finestra, sito, sito.url);
  const d = (await dellOra(b)).pagina_di_filo_aperta;
  assert.deepEqual(d, {
    'preferences:menu_app': 1, 'vista:preferences:s2': 1, 'editor:barra': 1, 'vista:editor:oltre': 1, 'credits:comando_slash': 1,
  });
});

test('le pagine e il main mandano solo nomi: nessun campo porta un indirizzo, un testo o un host', () => {
  const content = leggi('src/content/content.js') + leggi('src/content/actions.js') + leggi('src/preload/page-preload.js');
  for (const m of content.matchAll(/misura: '(strada|a-vuoto|menu-nativo|contesto-box)'([^}]*)\}/g)) {
    const campi = [...m[2].matchAll(/(\w+): /g)].map((x) => x[1]);
    for (const c of campi) assert.ok(['id', 'via', 'comando', 'motivo', 'voce', 'bandiere'].includes(c), `${m[1]}: ${c}`);
  }
  const handler = leggi('src/main/services/handlers/contatori.js');
  assert.match(handler, /STRADE_DELLE_PAGINE\.vie\.includes\(via\)/, 'da una pagina web non arriva una strada qualunque');
  assert.match(handler, /daTastoDaPoco\(testo\(m\.comando\)\)/, 'una scorciatoia muta conta solo dopo un tasto vero');
});
