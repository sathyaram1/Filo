// Barra laterale (#871): dove sta ogni icona, la migrazione di chi aveva già una disposizione, il
// tasto che la apre. Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'disposizioneIcone.js'));
require(join(ROOT, 'src', 'shared', 'tasti.js'));
const D = globalThis.SN_DISPOSIZIONE_ICONE;
const T = globalThis.SN_TASTI;

// La disposizione di chi non l'aveva mai toccata, prima della barra.
const VECCHIO_DEFAULT = {
  primary: ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab'],
  secondary: ['openOptions', 'home', 'editorApp', 'feedbackApp', 'incognito', 'screenshotCrop', 'transcribe', 'colorPicker', 'closeTab', 'fullscreen', 'back', 'forward', 'reload'],
};
const tutteDi = (l) => [...(l.primary || []), ...l.secondary, ...(l.bar || [])];

test('di serie: le globali in cima alla barra, sotto le azioni sulla pagina, il resto in «Altro…»; niente riga', () => {
  for (const id of D.GLOBALI) {
    assert.ok(D.DEFAULT.bar.includes(id), `${id} manca dalla barra`);
    assert.ok(!D.DEFAULT.secondary.includes(id), `${id} è ancora in «Altro…»`);
  }
  // In cima l'Aiuto (#1432), poi le globali, poi quelle che stavano nella riga del tasto destro (#1246).
  assert.deepEqual(D.DEFAULT.bar.slice(0, 5), ['help', 'back', 'forward', 'reload', 'home']);
  assert.deepEqual(D.DEFAULT.bar.slice(-6), ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab']);
  assert.equal(D.DEFAULT.primary, undefined, 'la riga del tasto destro non c\'è più');
  assert.deepEqual(D.ZONE, ['bar', 'secondary']);
});

test('chi aveva la riga del tasto destro la ritrova in fondo alla barra, nel suo ordine (#1246)', () => {
  const r = D.migra(VECCHIO_DEFAULT);
  assert.equal(r.scrivi, true);
  assert.equal(r.layout.primary, undefined);
  assert.deepEqual(r.layout.secondary, ['openOptions', 'editorApp', 'feedbackApp', 'screenshotCrop', 'transcribe', 'colorPicker']);
  assert.deepEqual(r.layout.bar, ['help', 'back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab',
    'translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab']);
  // Già con la barra: la riga le va sotto.
  const conBarra = D.migra({ primary: ['qrCode', 'translate'], secondary: ['share'], bar: ['help', 'back', 'screenshot'] });
  assert.deepEqual(conBarra.layout.bar.slice(0, 5), ['help', 'back', 'screenshot', 'qrCode', 'translate']);
  assert.ok(conBarra.layout.secondary.includes('share'));
});

test('chi aveva portato una globale nella riga la ritrova nella barra, e non perde niente', () => {
  const salvato = {
    primary: ['back', 'translate', 'reload'],
    secondary: ['forward', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab', 'openOptions', 'home', 'editorApp', 'feedbackApp', 'incognito', 'screenshotCrop', 'transcribe', 'colorPicker', 'closeTab', 'fullscreen'],
  };
  const { layout } = D.migra(salvato);
  assert.deepEqual(layout.bar, ['help', 'forward', 'home', 'incognito', 'fullscreen', 'closeTab', 'back', 'translate', 'reload']);
  const dopo = tutteDi(layout);
  assert.equal(dopo.length, new Set(dopo).size, 'un\'icona in due posti');
  for (const id of tutteDi(salvato)) assert.ok(dopo.includes(id), `${id} è sparita`);
});

test('una disposizione già nella forma di adesso non si tocca, e la migrazione è idempotente', () => {
  const r1 = D.migra(VECCHIO_DEFAULT);
  const r2 = D.migra(r1.layout);
  assert.equal(r2.scrivi, false);
  assert.deepEqual(r2.layout, r1.layout);
  const scelta = { secondary: ['back'], bar: ['screenshot', 'forward'] };
  const r3 = D.migra(scelta);
  // L'Aiuto, nato dopo, arriva in cima una volta; l'ordine scelto resta sotto di lui.
  assert.deepEqual(r3.layout.bar.slice(0, 3), ['help', 'screenshot', 'forward']);
  assert.ok(r3.layout.secondary.includes('back'), 'indietro messo in «Altro…» dall\'utente resta lì');
});

test('niente di salvato: la disposizione di serie, senza riscriverla', () => {
  const r = D.migra(undefined);
  assert.deepEqual(r.layout, { bar: [...D.DEFAULT.bar], secondary: [...D.DEFAULT.secondary] });
  assert.equal(r.scrivi, false);
});

test('id sconosciuti, ritirati o doppi escono dal salvato', () => {
  const { layout } = D.migra({ primary: ['translate', 'translate', 'nonEsiste'], secondary: ['openForLater', '__proto__'], bar: ['back', 'translate'] });
  const tutte = tutteDi(layout);
  assert.equal(tutte.filter((id) => id === 'translate').length, 1);
  for (const id of ['nonEsiste', 'openForLater', '__proto__']) assert.ok(!tutte.includes(id), id);
});

test('trascinare un\'icona la sposta nella barra o in «Altro…», mai in due posti; la riga non è più una zona', () => {
  const su = D.applicaPosa(D.DEFAULT, { id: 'screenshot', target: 'bar', beforeId: 'home' });
  assert.equal(su.bar.indexOf('screenshot'), su.bar.indexOf('home') - 1);
  assert.equal(su.bar.filter((x) => x === 'screenshot').length, 1);
  const via = D.applicaPosa(su, { id: 'screenshot', target: 'secondary', beforeId: null });
  assert.ok(!via.bar.includes('screenshot'));
  assert.equal(via.secondary[via.secondary.length - 1], 'screenshot');
  assert.equal(D.applicaPosa(D.DEFAULT, { id: 'screenshot', target: 'primary' }), null);
  // Davanti a sé stessa: resta dov'era.
  assert.deepEqual(D.applicaPosa(D.DEFAULT, { id: 'qrCode', target: 'bar', beforeId: 'qrCode' }).bar, [...D.DEFAULT.bar]);
});

test('una posa con un id o una zona che non esistono non scrive niente', () => {
  assert.equal(D.applicaPosa(D.DEFAULT, { id: 'nonEsiste', target: 'bar' }), null);
  assert.equal(D.applicaPosa(D.DEFAULT, { id: 'back', target: 'altrove' }), null);
  assert.equal(D.applicaPosa(D.DEFAULT, { id: '__proto__', target: 'bar' }), null);
});

test('chi si è spostato: l\'icona mossa anche fra due vicine scambiate, e la posa che la rimette (#867.1)', () => {
  const prima = D.migra(undefined).layout;
  // QR un posto più giù: fra «QR» e «Nuova scheda» il confronto da solo non sa chi è partito; chi scrive lo dice.
  const giu = D.applicaPosa(prima, { id: 'qrCode', target: 'bar', beforeId: null });
  assert.deepEqual(D.spostate(prima, giu, { mossa: 'qrCode' }), ['qrCode']);
  assert.equal(D.spostate(prima, giu).length, 1);
  // In «Altro…» e di nuovo su: una sola icona, con la zona.
  const via = D.applicaPosa(prima, { id: 'translate', target: 'secondary', beforeId: 'openOptions' });
  assert.deepEqual(D.spostate(prima, via), ['translate']);
  assert.deepEqual(D.posizione(prima, 'translate'), { zona: 'bar', davanti: 'screenshot', posto: 9 });
  assert.deepEqual(D.posizione(via, 'translate'), { zona: 'secondary', davanti: 'openOptions', posto: 1 });
  // Niente di mosso: niente.
  assert.deepEqual(D.spostate(prima, D.migra(prima).layout), []);
  assert.deepEqual(D.spostate(prima, prima, { mossa: 'qrCode' }), []);
  // Rimetterla: davanti alla stessa icona se c'è ancora, sennò allo stesso posto.
  const p = D.posizione(prima, 'translate');
  assert.deepEqual(D.applicaPosa(via, D.posaPer(via, 'translate', p)), prima);
  const senzaVicina = D.applicaPosa(via, { id: 'screenshot', target: 'secondary', beforeId: null });
  const rimessa = D.applicaPosa(senzaVicina, D.posaPer(senzaVicina, 'translate', p));
  assert.equal(rimessa.bar.indexOf('translate'), 8);
  assert.equal(D.posaPer(via, 'nonEsiste', p), null);
});

test('le azioni della pagina nella barra si chiamano e si disegnano come nel registro della pagina', () => {
  const src = readFileSync(join(ROOT, 'src', 'content', 'menuIcons.js'), 'utf8');
  for (const [id, d] of Object.entries(D.ICONE)) {
    const riga = src.split('\n').find((l) => new RegExp(`\\bid:\\s*'${id}'`).test(l));
    // Quelle della finestra e l'Aiuto le esegue il main dalla barra: nel registro della pagina non ci sono.
    if (d.tipo !== 'pagina') { assert.equal(riga, undefined, `${id} non è un'azione della pagina`); continue; }
    assert.ok(riga, `${id} non è nel registro della pagina`);
    if (id === 'translate') continue; // etichetta e icona cambiano con lo stato
    assert.ok(riga.includes(`I18n.t('${d.etichetta}')`), `${id}: nel registro l'etichetta non è ${d.etichetta}`);
    assert.ok(riga.includes(`I('${d.icona}')`), `${id}: nel registro l'icona non è ${d.icona}`);
  }
});

test('il tasto della barra è di Filo: riservato, con Cmd su Mac, e mai Ctrl+B', () => {
  assert.equal(T.riservato('Ctrl+Shift+B', 'win32'), true);
  assert.equal(T.riservato('Ctrl+Shift+B', 'linux'), true);
  assert.equal(T.riservato('Cmd+Shift+B', 'darwin'), true);
  assert.equal(T.riservato('Ctrl+B', 'win32'), false, 'Ctrl+B è il grassetto: resta alle pagine');
  assert.equal(T.etichettaBarra('darwin'), 'Cmd+Shift+B');
  assert.equal(T.etichettaBarra('win32'), 'Ctrl+Shift+B');
  assert.equal(T.comandoBarra({ type: 'keyDown', control: true, shift: true, key: 'B', code: 'KeyB' }), true);
  assert.equal(T.comandoBarra({ type: 'keyDown', meta: true, shift: true, key: 'b', code: 'KeyB' }), true);
  assert.equal(T.comandoBarra({ ctrlKey: true, shiftKey: true, key: 'B' }), true);
  assert.equal(T.comandoBarra({ control: true, key: 'b', code: 'KeyB' }), false);
  assert.equal(T.comandoBarra({ control: true, shift: true, alt: true, key: 'B', code: 'KeyB' }), false);
  assert.equal(T.comandoBarra({ shift: true, key: 'B', code: 'KeyB' }), false);
});

// ── le regolazioni della barra (Preferenze → Avanzate, IMPOSTA_PREFERENZA, tasto destro sulla striscia) ──
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'preferences.js'));
const C = globalThis.SN_CONST;
const P = globalThis.SN_PREF;

test('le regolazioni della barra: un valore fuori dai limiti torna dentro, uno mancante prende il predefinito', () => {
  assert.deepEqual(C.opzioniBarraLaterale(undefined), { spinta: true, attesaMs: 250, uscitaMs: 400, striscia: true, schede: true });
  assert.deepEqual(C.DEFAULT_SETTINGS.barraLaterale, { spinta: true, attesaMs: 250, uscitaMs: 400, striscia: true, schede: true });
  const o = C.opzioniBarraLaterale({ spinta: false, attesaMs: 5, uscitaMs: '99999', striscia: false, schede: false });
  assert.deepEqual(o, { spinta: false, attesaMs: 100, uscitaMs: 5000, striscia: false, schede: false });
  assert.equal(C.opzioniBarraLaterale({ attesaMs: 'boh' }).attesaMs, 250);
});

test('a parole: le regolazioni della barra si scrivono, e un tempo fuori dai limiti è un rifiuto col numero', () => {
  assert.deepEqual(P.buildPreferencePartial('barra_spinta', 'no').partial, { barraLaterale: { spinta: false } });
  assert.deepEqual(P.buildPreferencePartial('barra_striscia', 'nascondi').partial, { barraLaterale: { striscia: false } });
  assert.deepEqual(P.buildPreferencePartial('barra_schede', 'no').partial, { barraLaterale: { schede: false } });
  assert.deepEqual(P.buildPreferencePartial('barra_attesa', '0,5 secondi').partial, { barraLaterale: { attesaMs: 500 } });
  assert.deepEqual(P.buildPreferencePartial('barra_uscita', '800 ms').partial, { barraLaterale: { uscitaMs: 800 } });
  assert.match(P.buildPreferencePartial('barra_attesa', '10 secondi').rifiuto, /10\.000 ms.*100 a 3\.000/);
  assert.match(P.buildPreferencePartial('barra_uscita', '20').rifiuto, /20 ms/);
  // Un numero piccolo senza unità sono secondi: «metti l'attesa a 1» è un secondo, non un millisecondo.
  assert.deepEqual(P.buildPreferencePartial('barra_attesa', '1').partial, { barraLaterale: { attesaMs: 1000 } });
  // L'elenco che legge il modello le nomina tutte.
  const righe = P.righeDescrizione({ sistema: 'win32', shellPref: '' }).join('\n');
  for (const k of ['barra_spinta', 'barra_striscia', 'barra_attesa', 'barra_uscita', 'barra_schede']) assert.ok(righe.includes(`• ${k}: `), k);
});

test('il manifesto non manda più l\'utente dove le voci della barra non ci sono più', () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  const M = globalThis.SN_CAPABILITIES;
  const home = `${M.get('home-page').desc} ${M.get('home-page').invoke}`;
  assert.doesNotMatch(home, /in alto a destra ci sono le icone/i, 'la home non ha più la fila di icone in alto');
  assert.match(home, /barra laterale/);
  const errore = `${M.get('network-error-page').desc} ${M.get('network-error-page').invoke}`;
  assert.doesNotMatch(errore, /Ricarica"? dal menu/i, '«Ricarica» non sta più nel menu del tasto destro');
});

test('SPOSTA_ICONA: lo strumento elenca le icone vere col nome del menu, e dice cosa ha fatto', () => {
  require('../../src/shared/i18n.js');
  require('../../src/shared/disposizioneIcone.js');
  require('../../src/shared/actionLevels.js');
  require('../../src/shared/actionTools.js');
  const D = globalThis.SN_DISPOSIZIONE_ICONE;
  const def = globalThis.SN_ACTION_TOOLS.definitions({ sistema: 'win32' }).find((d) => d.function.name === 'SPOSTA_ICONA');
  assert.ok(def, 'strumento SPOSTA_ICONA assente');
  const p = def.function.parameters.properties;
  assert.deepEqual(p.icona.enum, Object.keys(D.ICONE));
  assert.deepEqual(p.dove.enum, Object.keys(D.DOVE));
  assert.match(p.icona.description, /screenshot \([^)]+\)/);
  assert.equal(D.nome('closeTab') !== 'closeTab', true, 'il nome del menu, non l\'id');
  const L = globalThis.SN_ACTION_LEVELS;
  assert.equal(L.costoFor({ type: 'SPOSTA_ICONA', icona: 'screenshot', dove: 'barra' }), 1);
  assert.match(L.describeDone({ type: 'SPOSTA_ICONA', icona: 'screenshot', dove: 'barra' }), /nella barra laterale/);
});

// ── l'icona Aiuto (#1432) ──
test('l\'Aiuto arriva in cima alla barra anche a chi aveva già la sua, e chi lo toglie non se lo ritrova', () => {
  const mia = { secondary: ['screenshot'], bar: ['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab', 'translate'] };
  const r = D.migra(mia);
  assert.equal(r.scrivi, true);
  assert.deepEqual(r.layout.bar, ['help', ...mia.bar]);
  assert.equal(D.migra(r.layout).scrivi, false, 'la seconda volta non cambia niente');
  // Messo in «Altro…» col tasto destro: lì resta, e la migrazione non lo riporta su.
  const tolto = D.applicaPosa(r.layout, { id: 'help', target: 'secondary', beforeId: null });
  assert.ok(!tolto.bar.includes('help') && tolto.secondary.includes('help'));
  const dopo = D.migra(tolto);
  assert.ok(!dopo.layout.bar.includes('help'));
  assert.equal(dopo.scrivi, false);
  // E si rimette dove lo si trascina.
  const rimesso = D.applicaPosa(tolto, { id: 'help', target: 'bar', beforeId: 'reload' });
  assert.equal(rimesso.bar.indexOf('help'), rimesso.bar.indexOf('reload') - 1);
  assert.ok(!rimesso.secondary.includes('help'));
});

test('l\'icona Aiuto dice cosa farà il clic: apre, detta, ferma', () => {
  assert.deepEqual(D.aspettoAiuto({ pannello: 'chiuso' }), { icona: 'help', etichetta: 'menu_help', ascolta: false });
  assert.equal(D.aspettoAiuto({ pannello: 'ridotto', voce: 'pronto' }).icona, 'help', 'ridotto, il clic lo riapre');
  assert.deepEqual(D.aspettoAiuto({ pannello: 'aperto', voce: 'pronto' }), { icona: 'mic', etichetta: 'voce_parla', ascolta: false });
  for (const voce of ['avvio', 'ascolta']) {
    assert.deepEqual(D.aspettoAiuto({ pannello: 'aperto', voce }), { icona: 'mic', etichetta: 'voce_ferma', ascolta: true }, voce);
  }
  assert.equal(D.aspettoAiuto({ pannello: 'aperto', voce: 'attesa' }).etichetta, 'voce_annulla_invio');
  // Ridotto mentre detta: il clic ferma, come il microfono.
  assert.equal(D.aspettoAiuto({ pannello: 'ridotto', voce: 'ascolta' }).etichetta, 'voce_ferma');
  assert.equal(D.aspettoAiuto({ pannello: 'chiuso', risposta: true }).etichetta, 'aiuto_leggi_risposta');
  // Uno stato che non conosce vale chiuso: il clic apre, non detta.
  assert.equal(D.aspettoAiuto({ pannello: 'boh', voce: '__proto__' }).icona, 'help');
  assert.equal(D.aspettoAiuto(undefined).icona, 'help');
  // Le chiavi esistono, e il pannello Aiuto della pagina decide il clic con la stessa funzione.
  require(join(ROOT, 'src', 'shared', 'i18n.js'));
  for (const k of ['menu_help', 'voce_parla', 'voce_ferma', 'voce_trascrivo', 'voce_annulla_invio', 'aiuto_leggi_risposta',
    'aiuto_spento_barra', 'aiuto_spento_sito', 'aiuto_spento_pagina']) {
    assert.notEqual(globalThis.SN_I18N.t(k), k, k);
  }
  const pannello = readFileSync(join(ROOT, 'src', 'content', 'sidebar.js'), 'utf8');
  assert.match(pannello, /aspettoAiuto\?\.\(/);
  require(join(ROOT, 'src', 'shared', 'icons.js'));
  for (const n of ['help', 'mic']) assert.equal(typeof globalThis.SN_ICONS[n], 'function', n);
});

test('una risposta da leggere: per scheda e per fonte, solo dalle fonti note, e il documento nuovo la porta via', () => {
  const R = require(join(ROOT, 'src', 'main', 'risposteInAttesa.js'));
  const tab = {};
  assert.equal(R.inAttesa(tab), false);
  assert.equal(R.segna(tab, 'aiuto', true), true);
  assert.equal(R.segna(tab, 'aiuto', true), false, 'già segnata: niente da ridire');
  assert.equal(R.inAttesa(tab), true);
  assert.equal(R.inAttesa(tab, 'app'), false);
  assert.equal(R.segna(tab, 'sconosciuta', true), false);
  assert.equal(R.segna(tab, '__proto__', true), false);
  assert.equal(R.segna(tab, 'app', true), true);
  assert.equal(R.segna(tab, 'aiuto', false), true);
  assert.equal(R.inAttesa(tab), true, 'resta quella dell\'app');
  assert.equal(R.dimentica(tab), true);
  assert.equal(R.inAttesa(tab), false);
  assert.equal(R.segna(null, 'aiuto', true), false);
});
