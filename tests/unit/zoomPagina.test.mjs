// Aritmetica dello zoom della pagina (src/shared/zoomPagina.js): è la regola
// SOLA che tiene allineati i tasti (Ctrl +/-/0), la rotella, il badge della
// modalità zoom e lo strumento della chat. Se due strade calcolassero il passo
// o i limiti per conto proprio, «ingrandisci un po'» e Ctrl+ finirebbero in due
// posti diversi, e un Ctrl+ dopo un valore scritto a mano riporterebbe indietro
// di colpo (era il caso del badge, che accettava fino al 500% mentre i tasti si
// fermavano al 250%).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'zoomPagina.js'));

const Z = globalThis.SN_ZOOM;

test('si registra su globalThis con la sua API', () => {
  assert.ok(Z);
  for (const f of ['percentuale', 'livello', 'limita', 'leggiPercentuale', 'risolvi']) {
    assert.equal(typeof Z[f], 'function', f);
  }
});

test('livello 0 è il 100%, e livello↔percentuale sono l\'una l\'inversa dell\'altra', () => {
  assert.equal(Z.percentuale(0), 100);
  for (const p of [25, 50, 75, 100, 150, 200, 300, 500]) {
    assert.equal(Z.percentuale(Z.livello(p)), p, `andata e ritorno su ${p}%`);
  }
});

test('i limiti sono quelli di un browser: dal 25% al 500%', () => {
  assert.equal(Z.MIN_PERCENTUALE, 25);
  assert.equal(Z.MAX_PERCENTUALE, 500);
  assert.equal(Z.percentuale(Z.MIN_LIVELLO), 25);
  assert.equal(Z.percentuale(Z.MAX_LIVELLO), 500);
});

test('un passo in avanti e uno indietro riportano dove si era', () => {
  const su = Z.risolvi(0, { verso: 'in' });
  assert.ok(su.percentuale > 100);
  const giu = Z.risolvi(su.livello, { verso: 'out' });
  assert.equal(giu.percentuale, 100);
});

test('reset torna al 100% da qualunque parte si arrivi', () => {
  assert.equal(Z.risolvi(3.2, { verso: 'reset' }).percentuale, 100);
  assert.equal(Z.risolvi(-4, { verso: 'reset' }).percentuale, 100);
});

test('i passi si fermano ai limiti senza uscirne', () => {
  let l = 0;
  for (let i = 0; i < 100; i += 1) l = Z.risolvi(l, { verso: 'in' }).livello;
  assert.equal(Z.percentuale(l), 500);
  for (let i = 0; i < 100; i += 1) l = Z.risolvi(l, { verso: 'out' }).livello;
  assert.equal(Z.percentuale(l), 25);
});

test('una percentuale esatta si ottiene tale e quale', () => {
  for (const p of [125, 150, 175, 200, 67]) {
    assert.equal(Z.risolvi(0, { percentuale: p }).percentuale, p, `${p}%`);
  }
});

test('una percentuale fuori scala viene limitata E dichiarata: nessun taglio muto', () => {
  const su = Z.risolvi(0, { percentuale: 900 });
  assert.equal(su.percentuale, 500);
  assert.equal(su.limitato, true);
  assert.equal(su.richiesto, 900);
  assert.equal(su.max, 500);
  const giu = Z.risolvi(0, { percentuale: 5 });
  assert.equal(giu.percentuale, 25);
  assert.equal(giu.limitato, true);
  assert.equal(giu.richiesto, 5);
  // Dentro i limiti nessuno grida al lupo.
  assert.equal(Z.risolvi(0, { percentuale: 150 }).limitato, false);
  assert.equal(Z.risolvi(0, { verso: 'in' }).limitato, false);
});

test('la percentuale si legge anche come la scrive un modello', () => {
  assert.equal(Z.leggiPercentuale(150), 150);
  assert.equal(Z.leggiPercentuale('150'), 150);
  assert.equal(Z.leggiPercentuale('150%'), 150);
  assert.equal(Z.leggiPercentuale(' 150 % '), 150);
  assert.equal(Z.leggiPercentuale('87,5'), 87.5);
});

test('quello che non è una percentuale non diventa uno zoom a caso', () => {
  for (const v of ['', '   ', 'grande', '🔍', '<b>150</b>', '0', '-50', 'NaN', null, undefined, {}, [], '1e400']) {
    assert.equal(Z.leggiPercentuale(v), null, JSON.stringify(v));
  }
});

test('una richiesta che non dice niente non muove lo zoom', () => {
  for (const r of [null, undefined, {}, { verso: '' }, { verso: 'grande' }, { percentuale: 'x' }]) {
    assert.equal(Z.risolvi(0, r), null, JSON.stringify(r));
  }
});

test('la percentuale vince sul verso: chi dice un numero vuole quel numero', () => {
  assert.equal(Z.risolvi(0, { percentuale: 150, verso: 'out' }).percentuale, 150);
});

test('un livello corrente illeggibile vale come 100%', () => {
  assert.equal(Z.risolvi(undefined, { verso: 'reset' }).percentuale, 100);
  assert.equal(Z.risolvi(NaN, { verso: 'in' }).percentuale, Z.risolvi(0, { verso: 'in' }).percentuale);
});

// #686, primo giro di verifica — Filo diceva al modello che lo zoom di un sito
// «resta anche dopo il riavvio». Non resta: alla riapertura le pagine tornano
// al 100%, perché nessuno salva il livello su disco. Chi chiedeva «resta così?»
// si sentiva dire di sì. Finché il livello non si salva davvero, nessuno dei
// testi con cui Filo si descrive può prometterlo.
test('nessun testo promette che lo zoom sopravviva alla chiusura di Filo', () => {
  require(join(__dirname, '..', '..', 'src', 'shared', 'actionTools.js'));
  require(join(__dirname, '..', '..', 'src', 'shared', 'capabilities.js'));

  const strumento = globalThis.SN_ACTION_TOOLS.TOOLS.ZOOM_PAGINA.description;
  const voce = globalThis.SN_CAPABILITIES.all().find((c) => c.id === 'page-zoom');
  assert.ok(voce, 'la voce page-zoom del manifesto esiste');

  for (const [dove, testo] of [['strumento', strumento], ['manifesto', `${voce.desc} ${voce.invoke}`]]) {
    assert.match(testo, /riavvi|riapr|chiud/i, `${dove}: dice cosa succede quando Filo si chiude`);
    assert.doesNotMatch(
      testo,
      /(resta|rimane|dura|si mantiene)[^.]{0,60}anche dopo il riavvio/i,
      `${dove}: promette una persistenza che non c'è`,
    );
  }
});

// #686 (secondo e terzo giro) — LO ZOOM SI MUOVE PER I GESTI VERI DELL'UTENTE,
// E FILO LI SENTE PER PRIMO.
// Gli eventi che una pagina si scrive da sola arrivano agli stessi listener di
// tastiera e rotella: un sito li usava per rimettersi la misura che voleva. E
// registrandosi sulla finestra in cattura li zittiva prima che Filo li vedesse,
// lasciando morti tasti, rotella e clic centrale. Le due regole valgono anche
// per i listener che verranno aggiunti dopo.
test('ogni gesto che muove lo zoom della pagina è filtrato da gestoVero', () => {
  const { readFileSync } = require('node:fs');
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'wheel-zoom.js'), 'utf8');
  const pezzi = src.split(/function (on(?:MouseDown|Wheel|KeyDown|Paste))\(e\)/);
  assert.ok(pezzi.length >= 15, 'i listener dei gesti esistono, nel frame principale e nei riquadri');
  for (let i = 1; i < pezzi.length; i += 2) {
    const nome = pezzi[i];
    const testa = pezzi[i + 1].slice(0, 120);
    assert.match(testa, /gestoVero\(e\)/, `il listener '${nome}' non filtra i gesti finti`);
  }
});

test('i gesti dello zoom si ascoltano sulla finestra, dove la pagina non arriva prima', () => {
  const { readFileSync } = require('node:fs');
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'wheel-zoom.js'), 'utf8');
  // Nessun gesto resta sul documento: lì un listener della pagina, registrato
  // sulla finestra in cattura, scatta prima e può fermare tutto.
  assert.doesNotMatch(
    src,
    /document\.addEventListener\(\s*'(mousedown|wheel|keydown|contextmenu)'/,
    'un gesto dello zoom ascolta ancora sul documento',
  );
  assert.match(src, /window\.addEventListener\(tipo, fn/, '`ascolta` non registra sulla finestra');
});

// #686.1 — I TASTI DELLO ZOOM LI PRENDE IL MAIN, E IL CAMPO VALE I TASTI BATTUTI.
// Un sito che riscriveva il proprio documento cancellava gli ascoltatori del
// preload, e un clic dentro un riquadro incorporato portava i tasti dove il
// preload non c'era: Ctrl +/-/0 morti. Il main li vede prima di qualunque
// documento. E il numero del riquadro lo scriveva anche il sito, col comando
// di inserimento testo che il browser conta come battuto.
test('il tasto dello zoom si riconosce uguale da un keydown e da un before-input-event', () => {
  for (const t of [
    { key: '=', ctrlKey: true }, { key: '+', control: true }, { code: 'NumpadAdd', meta: true },
  ]) assert.equal(Z.tastoZoom(t), 'in', JSON.stringify(t));
  for (const t of [{ key: '-', ctrlKey: true }, { key: '_', metaKey: true }, { code: 'NumpadSubtract', control: true }]) {
    assert.equal(Z.tastoZoom(t), 'out', JSON.stringify(t));
  }
  for (const t of [{ key: '0', control: true }, { code: 'Numpad0', ctrlKey: true }]) {
    assert.equal(Z.tastoZoom(t), 'reset', JSON.stringify(t));
  }
  // Senza Ctrl/Cmd è un carattere; con Alt è AltGr, che scrive.
  for (const t of [{ key: '=' }, { key: '0' }, { key: '=', control: true, alt: true }, { key: 'a', control: true }, null]) {
    assert.equal(Z.tastoZoom(t), null, JSON.stringify(t));
  }
});

test('un riquadro incorporato passa solo gesti di forma nota', () => {
  assert.deepEqual(Z.gestoValido({ tipo: 'medio', extra: 'x' }), { tipo: 'medio' });
  assert.deepEqual(Z.gestoValido({ tipo: 'rotella', dy: -100 }), { tipo: 'rotella', dy: -100 });
  assert.deepEqual(Z.gestoValido({ tipo: 'ctrl', dy: 1e9 }), { tipo: 'ctrl', dy: 1000 });
  for (const g of [null, 'medio', { tipo: 'percentuale', dy: 5 }, { tipo: 'rotella' }, { tipo: 'ctrl', dy: 'x' }, { tipo: 'rotella', dy: 0 }]) {
    assert.equal(Z.gestoValido(g), null, JSON.stringify(g));
  }
});

test('il campo della percentuale: il primo tasto sostituisce, poi si accoda; Invio applica, Esc annulla', () => {
  let s = { valore: '200', fresco: true };
  s = Z.tastoCampo(s, '5');
  assert.deepEqual(s, { valore: '5', fresco: false, azione: null });
  s = Z.tastoCampo(s, '0');
  assert.equal(s.valore, '50');
  s = Z.tastoCampo(s, 'x');
  assert.equal(s.valore, '50', 'una lettera non entra nel numero');
  s = Z.tastoCampo(s, 'Backspace');
  assert.equal(s.valore, '5');
  assert.equal(Z.tastoCampo(s, 'Enter').azione, 'applica');
  assert.equal(Z.tastoCampo(s, 'Tab').azione, 'applica');
  assert.equal(Z.tastoCampo(s, 'Escape').azione, 'annulla');
  assert.equal(Z.tastoCampo({ valore: '200', fresco: true }, 'Backspace').valore, '');
  assert.equal(Z.tastoCampo({ valore: '123', fresco: false }, 'Delete').valore, '');
});

test('il campo ha un tetto largo, e oltre non cambia in silenzio quello che c\'è', () => {
  let s = { valore: '', fresco: false };
  for (let i = 0; i < Z.CIFRE_CAMPO + 3; i++) s = Z.tastoCampo(s, '9');
  assert.equal(s.valore.length, Z.CIFRE_CAMPO);
  // Qualunque numero che ci sta viene poi limitato e DETTO dal riquadro.
  assert.ok(Z.CIFRE_CAMPO >= String(Z.MAX_PERCENTUALE).length + 1);
});

test('ogni scheda e ogni finestra di login passano i tasti dello zoom dal main', () => {
  const { readFileSync } = require('node:fs');
  const tabs = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'tabs.js'), 'utf8');
  const cablaggi = tabs.match(/installZoom\((wc|pwc)\)/g) || [];
  assert.deepEqual(cablaggi.sort(), ['installZoom(pwc)', 'installZoom(wc)'], 'schede e finestre di login');
  const zoom = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'tabs', 'tabZoom.js'), 'utf8');
  assert.match(zoom, /before-input-event[\s\S]{0,200}tastoZoom\(input\)[\s\S]{0,120}preventDefault\(\)/);
  // Un gesto di un riquadro vale solo se viene da un riquadro, e solo in forma nota.
  assert.match(zoom, /'filo:zoom-gesto'[\s\S]{0,120}principale\(e\)[\s\S]{0,80}gestoValido/);
});

test('col campo aperto i tasti li prende il main: le cifre e i tasti del campo sì, le scorciatoie no', () => {
  for (const key of ['1', '0', 'Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'a', 'ArrowLeft']) {
    assert.equal(Z.tastoPerCampo({ key }), 'tasto', key);
  }
  assert.equal(Z.tastoPerCampo({ key: 'v', control: true }), 'incolla');
  assert.equal(Z.tastoPerCampo({ key: 'V', meta: true }), 'incolla', 'Cmd+V su Mac');
  for (const t of [{ key: 't', control: true }, { key: 'Tab', control: true }, { key: '1', alt: true }, { key: 'v', control: true, alt: true }, { key: 'F5' }, { key: 'F11' }, { key: '' }, {}]) {
    assert.equal(Z.tastoPerCampo(t), null, JSON.stringify(t));
  }
});

test('un riquadro passa al campo un tasto solo in forma nota', () => {
  assert.deepEqual(Z.gestoValido({ tipo: 'tasto', key: '5', altro: 1 }), { tipo: 'tasto', key: '5' });
  for (const g of [{ tipo: 'tasto' }, { tipo: 'tasto', key: 5 }, { tipo: 'tasto', key: '' }, { tipo: 'tasto', key: 'x'.repeat(21) }]) {
    assert.equal(Z.gestoValido(g), null, JSON.stringify(g));
  }
});

test('una pagina che si riscrive non spegne Filo: il preload si segna gli ascoltatori prima di metterne uno', () => {
  const { readFileSync } = require('node:fs');
  const preload = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'page-preload.js'), 'utf8');
  const installa = preload.indexOf("require('./riscrittura.js')");
  assert.ok(installa > 0, 'il preload non installa la regola della riscrittura');
  assert.ok(installa < preload.indexOf('addEventListener('), 'un ascoltatore messo prima della regola sparisce alla riscrittura');
});
