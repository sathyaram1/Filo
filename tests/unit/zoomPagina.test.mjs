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
