// Il salvataggio ritardato di una pagina: la conferma non sopravvive a una
// modifica nuova, e quello che è stato toccato parte da qualunque uscita, anche
// se il cursore non ha ancora lasciato la casella.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..', '..');

const codice = readFileSync(join(RADICE, 'src', 'shared', 'salvaRimandato.js'), 'utf8');
const finto = { setTimeout, clearTimeout };
new Function('globalThis', `return (function () { ${codice}\n return globalThis.SN_SALVA; })()`)(finto);
const Salva = finto.SN_SALVA;

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

test('la conferma si spegne appena arriva una modifica, prima ancora del salvataggio', () => {
  const spenti = [];
  const r = Salva.crea({ salva: () => {}, spegniConferma: () => spenti.push(1), attesaMs: 50 });
  r.programma();
  assert.equal(spenti.length, 1);
  r.modificato();
  assert.equal(spenti.length, 2);
});

test('il salvataggio parte una volta sola a fine attesa', async () => {
  let salvataggi = 0;
  const r = Salva.crea({ salva: () => { salvataggi += 1; }, attesaMs: 30 });
  r.programma();
  r.programma();
  r.programma();
  assert.equal(salvataggi, 0);
  await attesa(80);
  assert.equal(salvataggi, 1);
  assert.equal(r.inAttesa(), false);
});

test('un campo toccato e mai chiuso viene salvato lo stesso all\'uscita', () => {
  let salvataggi = 0;
  const r = Salva.crea({ salva: () => { salvataggi += 1; }, attesaMs: 5000 });
  // `modificato` senza `programma`: è il campo ancora sotto il cursore, che
  // nessun timer aspetta.
  r.modificato();
  assert.equal(r.inAttesa(), true);
  assert.equal(r.subito(), true);
  assert.equal(salvataggi, 1);
});

test('senza niente in sospeso l\'uscita non salva', () => {
  let salvataggi = 0;
  const r = Salva.crea({ salva: () => { salvataggi += 1; }, attesaMs: 5000 });
  assert.equal(r.subito(), false);
  assert.equal(salvataggi, 0);
});

test('l\'uscita salva PRIMA che l\'attesa finisca, e una volta sola', async () => {
  let salvataggi = 0;
  const r = Salva.crea({ salva: () => { salvataggi += 1; }, attesaMs: 30 });
  r.programma();
  r.subito();
  assert.equal(salvataggi, 1);
  await attesa(80);
  assert.equal(salvataggi, 1);
});

test('salvaTuttoSubito svuota tutte le pagine registrate', () => {
  const fatti = [];
  const a = Salva.crea({ salva: () => fatti.push('a'), attesaMs: 5000 });
  const b = Salva.crea({ salva: () => fatti.push('b'), attesaMs: 5000 });
  a.modificato();
  b.modificato();
  Salva.salvaTuttoSubito();
  assert.deepEqual(fatti.sort(), ['a', 'b']);
});

// Chi ascolta `beforeunload` non vedeva l'avviso e perdeva l'ultima modifica:
// l'Editor stava lì. L'avviso parte in tutte e due le forme.
test('l\'avviso di fine pagina arriva sia come beforeunload sia come pagehide', () => {
  const preload = readFileSync(join(RADICE, 'src', 'preload', 'internal-preload.js'), 'utf8');
  const blocco = preload.slice(preload.indexOf("filo:pagina-sparisce"));
  assert.match(blocco, /dispatchEvent\(new Event\('beforeunload'/);
  assert.match(blocco, /'pagehide'/);
});

// Una pagina che salva da sé non si riscrive la regola in casa: la chiede a
// SN_SALVA, o il giro dopo una delle tre diverge dalle altre.
test('le pagine che salvano da sole usano la regola condivisa', () => {
  for (const rel of [
    ['src', 'pages', 'options', 'options.js'],
    ['src', 'pages', 'options', 'altro.js'],
    ['src', 'pages', 'preferences', 'preferences.js'],
    ['src', 'pages', 'security', 'security.js'],
  ]) {
    const testo = readFileSync(join(RADICE, ...rel), 'utf8');
    assert.match(testo, /SN_SALVA\.crea\(/, `${rel.join('/')} non usa SN_SALVA`);
    assert.doesNotMatch(testo, /addEventListener\('pagehide'/, `${rel.join('/')} si riscrive l'uscita in casa`);
  }
});

// «Sto scrivendo» si ascolta sulla pagina intera, non campo per campo: otto
// giri di verifica hanno trovato campi rimasti fuori da quell'elenco a mano.
test('quello che si scrive conta su ogni campo della pagina', () => {
  for (const rel of [
    ['src', 'pages', 'options', 'options.js'],
    ['src', 'pages', 'options', 'altro.js'],
    ['src', 'pages', 'preferences', 'preferences.js'],
    ['src', 'pages', 'security', 'security.js'],
  ]) {
    const testo = readFileSync(join(RADICE, ...rel), 'utf8');
    assert.match(
      testo,
      /\$\('page'\)\.addEventListener\('input'/,
      `${rel.join('/')} non ascolta la scrittura sull'intera pagina: un campo nuovo resterebbe fuori`,
    );
  }
});

// L'altra metà della stessa regola: un campo che si conferma quando il cursore
// ne esce (una rinomina, la riga di un elenco) si conferma anche se la pagina
// sparisce prima. Chi ha campi così li registra in SN_SALVA.
test('i campi che si confermano al blur passano dalla regola condivisa', () => {
  for (const rel of [
    ['src', 'pages', 'editor', 'editor.js'],
    ['src', 'pages', 'spellcheck', 'spellcheck.js'],
    ['src', 'pages', 'archive', 'archive.js'],
  ]) {
    const testo = readFileSync(join(RADICE, ...rel), 'utf8');
    assert.match(testo, /SN_SALVA\.campoAlVolo\(\)/, `${rel.join('/')} non registra il campo sotto il cursore`);
    assert.match(testo, /campoAlVolo\.scrivendo\(/, `${rel.join('/')} non dice cosa confermare`);
  }
});

// Una pagina che usa la regola deve anche caricarla, o la chiamata esplode al
// primo campo scritto e la pagina resta senza salvataggio.
test('ogni pagina che usa la regola carica il modulo', () => {
  for (const [cartella, file] of [
    ['options', 'options.html'],
    ['options', 'altro.html'],
    ['preferences', 'preferences.html'],
    ['security', 'security.html'],
    ['editor', 'editor.html'],
    ['spellcheck', 'spellcheck.html'],
    ['archive', 'archive.html'],
  ]) {
    const html = readFileSync(join(RADICE, 'src', 'pages', cartella, file), 'utf8');
    assert.match(html, /shared\/salvaRimandato\.js/, `${cartella}/${file} non carica salvaRimandato`);
  }
});

test('un campo al volo si conferma da solo quando la pagina sparisce', () => {
  const fatti = [];
  const campo = Salva.campoAlVolo();
  campo.scrivendo(() => fatti.push('confermato'));
  Salva.salvaTuttoSubito();
  assert.deepEqual(fatti, ['confermato']);
  // Confermato a mano (Invio, o il cursore che esce), l'uscita non lo rifà.
  campo.scrivendo(() => fatti.push('secondo'));
  campo.confermato();
  Salva.salvaTuttoSubito();
  assert.deepEqual(fatti, ['confermato']);
});
