// Regression test per il feedback "la mail non è ben centrata nel suo campo;
// l'ombra dei menu finisce in maniera brusca e sembra tagliata" (menu account
// della shell).
//
// Causa:
//  1) Le voci informative (es. l'email) avevano comunque una colonna icona
//     vuota a sinistra → il testo risultava spinto a destra e "non centrato".
//  2) Il gutter trasparente attorno al menu (per l'ombra CSS) era 8px, troppo
//     stretto per un box-shadow blur 20+ px: l'ombra veniva tagliata dal bordo
//     della finestra popup.
//
// Fix: niente colonna icona vuota + centratura per le voci senza icona; gutter
// (MARGIN) dimensionato per contenere l'intera ombra.
//
// buildHTML è puro (non tocca electron a runtime), quindi lo testiamo qui senza
// avviare l'app.

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildHTML } = require('../src/main/popup-menu.js');

const ACCOUNT_ENTRIES = [
  { label: 'sathyarampontillo@gmail.com', disabled: true },
  { type: 'separator' },
  { label: 'Esci', icon: 'close', action: 'auth-signout' },
];

test('email senza icona: centrata e senza colonna icona vuota', () => {
  const html = buildHTML(ACCOUNT_ENTRIES, false, 26);

  // La voce email è centrata...
  expect(html).toContain('item disabled centered');
  // ...e NON ha una colonna icona vuota davanti al testo.
  expect(html).toContain(
    '<div class="item disabled centered"><span class="lbl">sathyarampontillo@gmail.com</span></div>',
  );
  // La regola CSS che realizza la centratura esiste.
  expect(html).toMatch(/\.item\.centered\{[^}]*justify-content:center/);
});

test('voce con icona conserva la colonna icona', () => {
  const html = buildHTML(ACCOUNT_ENTRIES, false, 26);
  // "Esci" ha un'icona: la colonna icona deve esserci.
  expect(html).toMatch(/<button class="item"[^>]*><span class="ico">/);
});

test('il gutter contiene interamente l\'ombra (niente taglio)', () => {
  const margin = 26;
  const html = buildHTML(ACCOUNT_ENTRIES, false, margin);
  // Il margine passato è applicato al box del menu.
  expect(html).toContain(`margin:${margin}px`);
  // L'ombra usata: offset Y + blur non devono superare il gutter, altrimenti
  // verrebbe tagliata dal bordo della finestra.
  const m = html.match(/box-shadow:0 (\d+)px (\d+)px/);
  expect(m, 'box-shadow non trovata').toBeTruthy();
  const offsetY = Number(m[1]);
  const blur = Number(m[2]);
  expect(offsetY + blur).toBeLessThanOrEqual(margin);
});
