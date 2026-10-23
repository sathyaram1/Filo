// I contatori dei gesti della personalizzazione (#1471): cosa si sposta, si trascina e si rimette. La forma di quello
// che esce, il segno dei trascinamenti e il nome letto su un'icona (src/shared/gestiContati.js), la spedizione nel
// terzo documento dell'ora, e gli agganci nel codice che mandano solo nomi degli elenchi chiusi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of ['constants', 'tasti', 'modelUsage', 'wallet', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi',
  'disposizioneIcone', 'carteHome', 'themeTokens', 'tabColor', 'contatoriGiornalieri', 'gestiContati']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
require(join(ROOT, 'src', 'main', 'services', 'modelGate.js'));
const Servizio = require(join(ROOT, 'src', 'main', 'services', 'contatori.js'));
const C = globalThis.SN_CONTATORI;
const G = globalThis.SN_GESTI;
const D = globalThis.SN_DISPOSIZIONE_ICONE;
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const ORA = 60 * 60 * 1000;
const T0 = new Date(2026, 9, 15, 9, 0, 0).getTime();
const attendi = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };

function daFs(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(daFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, daFs(x)]));
  throw new Error(`tipo inatteso ${JSON.stringify(v)}`);
}

function banco({ incognito = false, accesi = true, risposta = 200 } = {}) {
  const per = { ore: [], chiamate: [], gesti: [] };
  const disco = new Map();
  const b = { t: T0, incognito, accesi, risposta, per, disco, n: 0 };
  b.s = Servizio.crea({
    contatori: C,
    storage: {
      getRaw: async (k, d) => (disco.has(k) ? JSON.parse(JSON.stringify(disco.get(k))) : d),
      setRaw: async (k, v) => { disco.set(k, JSON.parse(JSON.stringify(v))); },
    },
    impostazioni: async () => ({ contatori: { attivi: b.accesi } }),
    inIncognito: () => b.incognito,
    runNormale: (fn) => fn(),
    finestraNormale: () => true,
    adesso: () => b.t,
    versione: () => '0.2.249',
    piattaforma: 'linux',
    casuale: () => `${'7'.repeat(18)}${String(++b.n).padStart(2, '0')}`,
    rest: () => ({ FIRESTORE_BASE: 'https://firestore.test/v1/projects/p/databases/(default)/documents', API_KEY: 'K' }),
    fetch: async (url, opt) => {
      const doc = Object.fromEntries(Object.entries(JSON.parse(opt.body).fields).map(([k, v]) => [k, daFs(v)]));
      const dove = url.includes(`/${C.COLLEZIONE_GESTI}?`) ? 'gesti' : url.includes(`/${C.COLLEZIONE_CHIAMATE}?`) ? 'chiamate' : 'ore';
      per[dove].push({ url, doc });
      const st = typeof b.risposta === 'function' ? b.risposta(dove) : b.risposta;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}) };
    },
    log: () => {},
  });
  return b;
}

test('ogni gesto entra nella sua misura con le voci dei suoi elenchi; quello fuori elenco no', () => {
  const o = C.oraVuota();
  const si = [
    ['icona_spostata', { icona: 'qrCode', da: 'primary', a: 'bar', via: 'trascina' }],
    ['icona_spostata', { icona: 'back', da: 'bar', a: 'secondary', via: 'rimessa_nel_menu' }],
    ['altro_del_menu', { aperto: true }],
    ['altro_del_menu', { icona: 'transcribe' }],
    ['suggerimento_letto', { icona: 'history', dove: 'barra', esito: 'clic' }],
    ['suggerimento_letto', { icona: 'share', dove: 'menu', esito: 'via' }],
    ['carta_home', { carta: 'editor', mossa: 'togli' }],
    ['carta_home', { carta: 'download:7f3a', colonna: 'sinistra', come: 'invio' }],
    ['carta_home', { carta: 'scaricamenti', colonna: 'altro', come: 'clic' }],
    ['riquadro_sistema', { voce: 'volume', come: 'comando_dato' }],
    ['modulo_editor', { modulo: 'search-replace', evento: 'usato' }],
    ['modulo_editor', { colonne: 12, righe: 4 }],
    ['modulo_editor', { impostazioni: true }],
    ['ripristino', { cosa: 'token', token: 'button.bg' }],
    ['ripristino', { cosa: 'colore_schede', parametro: 'opacita_tab' }],
    ['ripristino', { cosa: 'tutte_impostazioni', esito: 'annullato' }],
    ['ripristino', { cosa: 'avanzate_viste' }],
    ['annulla_cambio', { chiave: 'theme', via: 'chat', fascia: 'h1' }],
    ['trascinamento', { da: 'file_disco', a: 'chat_home', esito: 'posato' }],
    ['barra_aperta', { motivo: 'spinta', esito: 'a_vuoto', apertaMs: 300 }],
  ];
  for (const [m, d] of si) assert.equal(C.registraGesto(o, m, d), true, `${m} ${JSON.stringify(d)}`);
  const no = [
    ['icona_spostata', { icona: 'mario', da: 'primary', a: 'bar', via: 'trascina' }],
    ['icona_spostata', { icona: 'qrCode', da: 'primary', a: 'barra laterale', via: 'trascina' }],
    ['suggerimento_letto', { icona: 'history', dove: 'barra', esito: 'letto con calma' }],
    ['carta_home', { carta: 'Il mio editor', mossa: 'togli' }],
    ['carta_home', { carta: 'mario:rossi', colonna: 'sinistra', come: 'clic' }],
    ['riquadro_sistema', { voce: 'wifi di casa', come: 'clic' }],
    ['modulo_editor', { colonne: 20, righe: 30 }],
    ['modulo_editor', { colonne: 8.5, righe: 10 }],
    ['modulo_editor', { modulo: 'chat', evento: 'Ciao, riassumi il documento' }],
    ['ripristino', { cosa: 'token', token: '#ff0000' }],
    ['annulla_cambio', { chiave: 'https://mario.it', via: 'chat', fascia: 'h1' }],
    ['trascinamento', { da: 'carta_home', a: 'chat_home', esito: 'la relazione di Mario' }],
    ['trascinamento', { da: { testo: 'x' }, a: 'chat_home', esito: 'posato' }],
    ['barra_aperta', { motivo: 'spinta', esito: 'boh' }],
    ['disposizione_di_serie', { bar: 'si' }],
  ];
  for (const [m, d] of no) assert.equal(C.registraGesto(o, m, d), false, `${m} ${JSON.stringify(d)}`);
  const doc = C.documentoGesti({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-15T09', app: '0.2.249', os: 'win', dati: o });
  assert.equal(C.validaGesti(doc).ok, true, C.validaGesti(doc).motivo);
  assert.equal(doc.icona_spostata.qrCode, 'primary|bar|trascina|1');
  assert.equal(doc.icona_spostata.back, 'bar|secondary|rimessa_nel_menu|1');
  assert.deepEqual(doc.altro_del_menu, { aperture: '1', transcribe: '1' });
  assert.equal(doc.carta_home.download, 'sinistra|invio|1', 'di una carta di sinistra esce solo il tipo');
  assert.equal(doc.modulo_editor.griglia, '12|4|1');
  assert.equal(doc.modulo_editor.impostazioni, '1');
  assert.equal(doc.ripristino.token, 'button.bg|1');
  assert.equal(doc.ripristino.avanzate_viste, '1');
  assert.equal(doc.barra_aperta.spinta, 'a_vuoto|1|1,0,0,0,0,0,0', 'una spinta chiusa a vuoto in mezzo secondo');
  assert.equal(doc.trascinamento.file_disco, 'chat_home|posato|1');
  assert.doesNotMatch(JSON.stringify(doc), /mario|Mario|ff0000|Ciao/);
});

test('la disposizione di serie per zona, e l’annulla di un cambio con la sua via e il tempo, senza il rifai', () => {
  assert.deepEqual(C.disposizioneDiSerie(D.DEFAULT), { primary: 'si', secondary: 'si', bar: 'si' });
  const spostata = D.applicaPosa(D.DEFAULT, { id: 'qrCode', target: 'bar' });
  assert.deepEqual(C.disposizioneDiSerie(spostata), { primary: 'no', secondary: 'si', bar: 'no' });
  const rimessa = D.applicaPosa(spostata, { id: 'qrCode', target: 'primary', beforeId: 'newTab' });
  assert.deepEqual(C.disposizioneDiSerie(rimessa), { primary: 'si', secondary: 'si', bar: 'si' }, 'rimessa com’era è di nuovo di serie');
  assert.equal(C.disposizioneDiSerie({ primary: [] }), null);

  const t = Date.parse('2026-10-15T10:00:00Z');
  const cambio = (ms, extra = {}) => ({ id: 'c1', tipo: 'impostazioni', via: 'interfaccia', ts: new Date(t - ms).toISOString(),
    cambi: [{ chiave: 'theme' }, { chiave: 'themeTokens.accent' }, { chiave: 'themeTokens.font' }, { chiave: 'contatori.attivi' }], ...extra });
  assert.deepEqual(C.annullaCambio(cambio(4000), t), [
    { chiave: 'theme', via: 'interfaccia', fascia: 's10' }, { chiave: 'themeTokens.*', via: 'interfaccia', fascia: 's10' },
  ], 'una jolly toccata in due foglie è una voce, l’interruttore dei contatori non si conta');
  assert.equal(C.annullaCambio(cambio(2 * ORA), t)[0].fascia, 'oltre');
  assert.equal(C.annullaCambio(cambio(30 * 60 * 1000), t)[0].fascia, 'h1');
  assert.equal(C.annullaCambio(cambio(5 * 60 * 1000, { agg: new Date(t - 30000).toISOString() }), t)[0].fascia, 'm1', 'conta l’ultimo tocco');
  assert.deepEqual(C.annullaCambio(cambio(1000, { annulla: 'c0' }), t), [], 'il rifai non è un ripensamento');
  assert.deepEqual(C.annullaCambio({ tipo: 'zoom', via: 'pagina', ts: new Date(t - 1000).toISOString(), cambi: [{ chiave: 'zoom:mario.it' }] }, t),
    [{ chiave: 'cambio.zoom', via: 'pagina', fascia: 's10' }], 'il dominio di uno zoom non esce');
  assert.equal(C.annullaCambio({ ...cambio(1000), via: 'migrazione' }, t)[0].via, 'altro');
});

test('una mossa delle carte, da qualunque strada: il nome scritto si risolve, la chiave di sinistra resta il suo tipo', () => {
  assert.deepEqual(C.cartaDellaMossa({ tipo: 'togli', carta: 'i mazzi' }), { carta: 'mazzi', mossa: 'togli' });
  assert.deepEqual(C.cartaDellaMossa({ tipo: 'nascondi', chiave: 'download:8c1' }), { carta: 'download', mossa: 'togli' });
  assert.deepEqual(C.cartaDellaMossa({ tipo: 'ordina-sinistra', ordine: ['timer:1', 'crediti'], chiave: 'timer:1' }), { carta: 'timer', mossa: 'ordina' });
  assert.deepEqual(C.cartaDellaMossa({ tipo: 'sposta', carta: 'editor', prima: null }), { carta: 'editor', mossa: 'ordina' });
  assert.deepEqual(C.cartaDellaMossa({ tipo: 'ripristina' }), { carta: 'tutte', mossa: 'ripristina' });
  assert.equal(C.cartaDellaMossa({ tipo: 'togli', carta: 'la carta di Mario' }), null);
  assert.equal(C.cartaDellaMossa({ tipo: 'nascondi', chiave: 'Mario Rossi' }), null);
});

test('il segno dei trascinamenti: l’origine di Filo, o la classe di quello che arriva; a vuoto solo senza rilascio', () => {
  const dt = (dati) => ({ types: Object.keys(dati), getData: (t) => dati[t] || '' });
  assert.equal(G.origineDi(dt({ [G.TIPO_ORIGINE]: 'carta_home', 'text/plain': 'Editor' })), 'carta_home');
  assert.equal(G.origineDi(dt({ Files: '' })), 'file_disco');
  assert.equal(G.origineDi(dt({ Files: '', 'text/uri-list': 'https://x.it/a.png', 'text/html': '<img src="a.png">' })), 'immagine');
  assert.equal(G.origineDi(dt({ 'text/uri-list': 'https://x.it/a.png', 'text/html': '<meta charset="utf-8"><img src="a.png">' })), 'immagine');
  assert.equal(G.origineDi(dt({ 'text/plain': 'una frase della pagina', 'text/html': '<b>una</b> frase' })), 'testo_pagina');
  assert.equal(G.origineDi(dt({})), '');
  for (const o of ['testo_pagina', 'file_disco', 'immagine']) assert.ok(C.ORIGINI_TRASCINA.includes(o));
  const ev = G.rilascio(dt({ 'text/plain': 'ciao Mario' }), 'chat_home');
  assert.deepEqual(ev, { misura: 'gesto', gesto: 'trascinamento', da: 'testo_pagina', a: 'chat_home', esito: 'posato' });
  assert.equal(G.rilascio(dt({ 'text/plain': 'x' }), 'griglia_editor', false).esito, 'annullato');
  assert.deepEqual(G.fine({ dataTransfer: { dropEffect: 'none' } }, 'voce_sistema'),
    { misura: 'gesto', gesto: 'trascinamento', da: 'voce_sistema', a: 'nessuna', esito: 'annullato' });
  assert.equal(G.fine({ dataTransfer: { dropEffect: 'copy' } }, 'voce_sistema'), null, 'il rilascio preso lo conta chi lo prende');
  const segnato = {};
  G.marca({ setData: (t, v) => { segnato[t] = v; } }, 'palette_editor');
  assert.deepEqual(segnato, { [G.TIPO_ORIGINE]: 'palette_editor' });
});

test('il nome letto su un’icona: un clic entro tre secondi è «clic», dopo o lasciandola è «via», una volta sola', () => {
  let t = 0;
  const uscite = [];
  const l = G.lettore((ev) => uscite.push(`${ev.icona}:${ev.dove}:${ev.esito}`), () => t);
  l.mostrato('share', 'menu'); t = 2900; l.clic('share'); l.via();
  l.mostrato('qrCode', 'menu'); t += 3100; l.clic('qrCode');
  l.mostrato('back', 'barra'); l.via(); l.clic('back');
  l.mostrato('home', 'barra'); l.mostrato('reload', 'barra'); l.clic('home'); l.via();
  assert.deepEqual(uscite, ['share:menu:clic', 'qrCode:menu:via', 'back:barra:via', 'home:barra:via', 'reload:barra:via']);
});

test('i gesti partono nel terzo documento della stessa ora, con la disposizione; senza gesti non parte niente', async () => {
  const b = banco();
  b.s.apri(globalThis.SN_CONST.ACTIONS.FILO_CHAT).fine(true);
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per.ore.length, 1);
  assert.equal(b.per.gesti.length, 0, 'un’ora senza gesti né disposizione nota non ha il documento dei gesti');

  assert.equal(b.s.disposizioneIcone(D.applicaPosa(D.DEFAULT, { id: 'qrCode', target: 'bar' })), true);
  b.s.gesto('icona_spostata', { icona: 'qrCode', da: 'primary', a: 'bar', via: 'trascina' });
  b.s.gesto('trascinamento', { da: 'icona_menu', a: 'barra', esito: 'posato' });
  b.s.gesto('barra_aperta', { motivo: 'clic', esito: 'azione', apertaMs: 99 * 60 * 60 * 1000 });
  assert.equal(b.s.gesto('disposizione_di_serie', { bar: 'si' }), false, 'la disposizione la legge il main, non la manda nessuno');
  b.s.cambioRitirato({ id: 'c9', tipo: 'impostazioni', via: 'chat', ts: new Date(b.t - 20000).toISOString(), cambi: [{ chiave: 'theme' }] });
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per.gesti.length, 1);
  const { url, doc } = b.per.gesti[0];
  assert.equal(C.idDocumento(doc), C.idDocumento(b.per.ore[1].doc), 'lo stesso id della sua ora');
  assert.match(url, new RegExp(`/${C.COLLEZIONE_GESTI}\\?documentId=`));
  assert.deepEqual(doc.disposizione_di_serie, { primary: 'no', secondary: 'si', bar: 'no' });
  assert.equal(doc.icona_spostata.qrCode, 'primary|bar|trascina|1');
  assert.equal(doc.trascinamento.icona_menu, 'barra|posato|1');
  assert.equal(doc.barra_aperta.clic, 'azione|1|0,0,0,0,0,0,1', 'un’ora e più aperta sta nell’ultima fascia');
  assert.equal(doc.annulla_cambio.theme, 'chat|m1|1');
  assert.equal(C.validaGesti(doc).ok, true);

  // Un'ora con solo la disposizione nota la porta lo stesso: serve a sapere quante copie tengono quella di serie.
  b.s.chiesto(globalThis.SN_CONST.ACTIONS.EXPLAIN);
  await attendi();
  b.t += ORA;
  await b.s.controlla();
  assert.equal(b.per.gesti.length, 2);
  assert.deepEqual(Object.keys(b.per.gesti[1].doc.icona_spostata), []);
  assert.deepEqual(b.per.gesti[1].doc.disposizione_di_serie, { primary: 'no', secondary: 'si', bar: 'no' });
});

test('i gesti in incognito e a contatori spenti non si contano; quelli che il server non accetta ancora si riprovano', async () => {
  const inc = banco({ incognito: true });
  inc.s.gesto('trascinamento', { da: 'scheda', a: 'striscia_schede', esito: 'posato' });
  inc.s.cambioRitirato({ tipo: 'impostazioni', via: 'chat', ts: new Date(inc.t).toISOString(), cambi: [{ chiave: 'theme' }] });
  await attendi();
  inc.incognito = false;
  inc.t += ORA;
  await inc.s.controlla();
  assert.equal(inc.per.gesti.length + inc.per.ore.length, 0);

  const sp = banco({ accesi: false });
  sp.s.gesto('trascinamento', { da: 'scheda', a: 'striscia_schede', esito: 'posato' });
  await attendi();
  sp.t += ORA;
  assert.equal(await sp.s.controlla(), 'spenti');
  assert.equal(sp.per.gesti.length, 0);

  // Le regole dei gesti non ancora pubblicate: l'ora resta e riparte il giorno dopo, senza contarsi due volte.
  const b = banco({ risposta: (dove) => (dove === 'gesti' ? 403 : 200) });
  b.s.gesto('trascinamento', { da: 'scheda', a: 'striscia_schede', esito: 'posato' });
  await attendi();
  b.t += ORA;
  assert.equal(await b.s.controlla(), 'fallito');
  assert.equal(b.per.ore.length, 1);
  b.risposta = (dove) => (dove === 'gesti' ? 200 : 409);
  b.t += 24 * ORA;
  assert.equal(await b.s.controlla(), 'inviati');
  assert.equal(b.per.gesti.length, 2);
  assert.equal(b.per.gesti[1].doc.trascinamento.scheda, 'striscia_schede|posato|1');
});

// ── Gli agganci nel codice ──────────────────────────────────────────────
const sorgenti = () => {
  const out = [];
  const giu = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) giu(p);
      else if (e.name.endsWith('.js')) out.push([p, leggi(p)]);
    }
  };
  for (const d of ['src/main', 'src/pages', 'src/content', 'src/renderer']) giu(d);
  return out;
};

test('ogni gesto nominato nel codice è una misura, ogni origine e destinazione sta negli elenchi', () => {
  const tutti = sorgenti();
  let nomi = 0;
  for (const [f, s] of tutti) {
    for (const m of s.matchAll(/gesto: '([a-z_]+)'/g)) { nomi += 1; assert.ok(C.MISURE_GESTI.includes(m[1]), `${f}: «${m[1]}»`); }
    for (const m of s.matchAll(/[gG]esto\('([a-z_]+)'/g)) { nomi += 1; assert.ok(C.MISURE_GESTI.includes(m[1]), `${f}: «${m[1]}»`); }
    for (const m of s.matchAll(/marca\([^,]+, '([a-z_]+)'\)|fine\(e, '([a-z_]+)'\)|contaFineTrascinamento\(e, '([a-z_]+)'\)/g)) {
      const o = m[1] || m[2] || m[3];
      assert.ok(C.ORIGINI_TRASCINA.includes(o), `${f}: origine «${o}»`);
    }
    for (const m of s.matchAll(/rilascio\([^,]+, '([a-z_]+)'|contaRilascio\(e, '([a-z_]+)'\)/g)) {
      const a = m[1] || m[2];
      assert.ok(C.DESTINAZIONI_TRASCINA.includes(a), `${f}: destinazione «${a}»`);
    }
    for (const m of s.matchAll(/\{ da: '([a-z_]+)', a: '([a-z_]+)'/g)) {
      assert.ok(C.ORIGINI_TRASCINA.includes(m[1]) && C.DESTINAZIONI_TRASCINA.includes(m[2]), `${f}: ${m[1]} → ${m[2]}`);
    }
  }
  assert.ok(nomi >= 15, 'i gesti si nominano davvero');
  // Ogni origine di Filo ha chi la segna, ogni destinazione chi la conta.
  const testo = tutti.map(([, s]) => s).join('\n');
  for (const o of C.ORIGINI_TRASCINA.filter((x) => !['testo_pagina', 'file_disco', 'immagine'].includes(x))) {
    assert.ok(testo.includes(`'${o}'`), `l’origine «${o}» non la segna nessuno`);
  }
  for (const a of C.DESTINAZIONI_TRASCINA) assert.ok(testo.includes(`'${a}'`) || a === 'nessuna', `la destinazione «${a}» non la conta nessuno`);
  // Quelli che nascono nel main non li accetta da una pagina.
  for (const m of ['icona_spostata', 'disposizione_di_serie', 'barra_aperta', 'annulla_cambio']) assert.ok(!C.GESTI_DALLE_PAGINE.includes(m), m);
  assert.match(leggi('src/main/services/handlers/contatori.js'), /case 'gesto': ok = C\.GESTI_DALLE_PAGINE\.includes\(testo\(m\.gesto\)\) && contatori\.gesto\(/);
});

test('i tipi dei moduli dell’Editor sono quelli che i contatori conoscono', () => {
  const editor = leggi('src/pages/editor/editor.js');
  const blocco = /const MODULE_TYPES = \{([\s\S]*?)\n  \};/.exec(editor);
  assert.ok(blocco, 'MODULE_TYPES si legge');
  const tipi = [...blocco[1].matchAll(/^ {4}'?([a-z-]+)'?:\s+\{/gm)].map((m) => m[1]);
  assert.deepEqual(tipi, [...C.MODULI_EDITOR]);
  const g = /GRID_MIN_COLS = (\d+), GRID_MAX_COLS = (\d+)/.exec(editor) || /GRID_MIN_COLS = (\d+)[\s\S]*?GRID_MAX_COLS = (\d+)/.exec(editor);
  const r = /GRID_MIN_ROWS = (\d+)[\s\S]*?GRID_MAX_ROWS = (\d+)/.exec(editor);
  assert.deepEqual([C.COLONNE_GRIGLIA[0], C.COLONNE_GRIGLIA[C.COLONNE_GRIGLIA.length - 1]], [g[1], g[2]]);
  assert.deepEqual([C.RIGHE_GRIGLIA[0], C.RIGHE_GRIGLIA[C.RIGHE_GRIGLIA.length - 1]], [r[1], r[2]]);
  assert.deepEqual([...C.VOCI_SISTEMA], JSON.parse(/const ORDINE = (\[[^\]]*\]);/.exec(leggi('src/pages/dashboard/dashboard-sistema.js'))[1].replace(/'/g, '"')));
  assert.deepEqual([...C.VOCI_BARRA].sort(), ['account', 'apps', 'history', 'redteam', 'settings']);
});

test('ogni posa delle icone passa da una porta sola, e ognuna dice la sua via', () => {
  const posa = [...sorgenti()].flatMap(([f, s]) => [...s.matchAll(/(?:Layout|require\('\.\/layoutIcone'\))\.posa\(([\s\S]*?)\)\.catch|(?:Layout|require\('\.\/layoutIcone'\))\.posa\(\s*([\s\S]*?\}[^)]*)\);/g)].map((m) => [f, m[1] || m[2]]));
  assert.ok(posa.length >= 5, `le pose si trovano (${posa.length})`);
  const testo = posa.map(([, x]) => x).join('\n');
  assert.match(testo, /via: 'rimessa_nel_menu'/);
  assert.match(testo, /via: 'chat'/);
  assert.match(testo, /origine: 'icona_menu'/);
  assert.match(testo, /origine: 'icona_barra'/);
  assert.match(leggi('src/main/services/handlers/barra.js'), /msg\?\.source === 'bar' \? 'icona_barra' : 'icona_menu'/);
  assert.match(leggi('src/content/menuIcons.js'), /source: source === 'bar' \? 'bar' : 'menu'/);
});
