// Modulo condiviso della cronologia appunti (#256): la chiave di una voce,
// come si legge e cosa dice la conferma prima di svuotare.
//
// Le due strade che mostrano la cronologia (il menu "Incolla" del tasto destro
// e Impostazioni → Sicurezza) avevano ognuna la sua copia di queste regole.
// Qui c'è la regola sola: se diverge, questi test diventano rossi.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Carica i due moduli IIFE su un globalThis vero (si auto-registrano lì).
function carica() {
  const g = globalThis;
  if (!g.SN_I18N) new Function(readFileSync(resolve(ROOT, 'src/shared/i18n.js'), 'utf8')).call(g);
  new Function(readFileSync(resolve(ROOT, 'src/shared/clipboardHistory.js'), 'utf8')).call(g);
  return g.SN_CLIPBOARD;
}

const Clip = carica();

test('la chiave riconosce la stessa voce anche con spazi diversi', () => {
  assert.equal(
    Clip.chiave({ type: 'text', text: 'ciao   mondo' }),
    Clip.chiave({ type: 'text', text: ' ciao\nmondo ' }),
  );
  assert.notEqual(
    Clip.chiave({ type: 'text', text: 'ciao mondo' }),
    Clip.chiave({ type: 'text', text: 'ciao mondi' }),
  );
  assert.equal(Clip.chiave({ type: 'image', dataUrl: 'data:image/png;base64,AAA' }), 'i:data:image/png;base64,AAA');
  assert.equal(Clip.chiave(null), '');
  // Un'immagine e un testo non si confondono mai fra loro.
  assert.notEqual(
    Clip.chiave({ type: 'image', dataUrl: 'x' }),
    Clip.chiave({ type: 'text', text: 'x' }),
  );
});

test('una voce di soli spazi si legge, non resta una riga vuota', () => {
  const etichetta = Clip.etichetta({ type: 'text', text: '   \n\t  ' });
  assert.match(etichetta, /spazi/i);
  assert.match(etichetta, /7/); // dice quanto è lunga
  assert.equal(Clip.etichetta({ type: 'text', text: '' }), 'Voce vuota');
  assert.equal(Clip.etichetta({ type: 'text', text: '  ciao   mondo ' }), 'ciao mondo');
  assert.equal(Clip.etichetta({ type: 'image', description: 'schermata' }), 'schermata');
  assert.equal(Clip.etichetta({ type: 'image' }), 'Immagine');
});

test('la conferma prima di svuotare dice quante voci spariscono', () => {
  const tante = Clip.testoConferma(31, 31);
  assert.match(tante, /31/);
  // Senza il numero l'utente non sa cosa sta per perdere.
  const una = Clip.testoConferma(1, 1);
  assert.match(una, /unica/i);
  assert.doesNotMatch(una, /\b1 le voci\b/);
});

test('con una ricerca attiva la conferma dichiara che sparisce anche il nascosto', () => {
  // L'utente cerca "password", a schermo resta una riga sola, ma lo svuotamento
  // porta via tutte e 31: la conferma deve dirlo, altrimenti la lista sotto gli
  // occhi e l'azione si contraddicono.
  const conFiltro = Clip.testoConferma(31, 1);
  assert.match(conFiltro, /31/);
  assert.match(conFiltro, /ricerca/i);
  assert.match(conFiltro, /\b1\b/);
  // Senza filtro (tutte visibili) la frase in più non compare.
  assert.doesNotMatch(Clip.testoConferma(31, 31), /ricerca/i);
  // Numeri assurdi non inventano la frase in più.
  assert.doesNotMatch(Clip.testoConferma(3, 9), /ricerca/i);
});
