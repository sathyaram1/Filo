// #2086, #2087 — il tasto destro sulla linguetta: Blocca/Sblocca, Duplica, Muta | paese | cookie, Resta connesso,
// permessi | Chiudi. Niente «Aiuto», niente «Chiudi le altre schede» né «Riapri scheda chiusa»; i permessi una riga
// ciascuno, col nome accordato e l'azione che toglie quello solo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'menuLinguetta.js'));
const M = globalThis.SN_MENU_LINGUETTA;
const etichette = (voci) => voci.map((v) => (v.type === 'separator' ? '|' : v.label));

test('scheda qualunque: Blocca in cima, poi Duplica e Muta, e Chiudi in fondo; niente Aiuto né voci sulle altre schede', () => {
  assert.deepEqual(etichette(M.voci({ id: 1 })), ['Blocca', 'Duplica', 'Muta', '|', 'Chiudi']);
});

test('bloccata e muta: Sblocca, Riattiva audio, e «Chiudi» diventa «Sblocca e chiudi»', () => {
  const v = M.voci({ id: 1, bloccata: true, muted: true });
  assert.deepEqual(etichette(v), ['Sblocca', 'Duplica', 'Riattiva audio', '|', 'Sblocca e chiudi']);
  assert.equal(v[0].action, 'tab-sblocca');
  assert.equal(v.at(-1).action, 'tab-close-sblocca');
});

test('ordine completo: paese, poi cookie, Resta connesso e i permessi, poi Chiudi', () => {
  const v = M.voci(
    { id: 1, proxy: null, cookies: { rejected: true }, connesso: { fidato: false } },
    { proxy: { configured: true }, permessi: [{ parte: 'notifiche', si: false }, { parte: 'audio', si: true }] },
  );
  assert.deepEqual(etichette(v), ['Blocca', 'Duplica', 'Muta', '|', 'Apri da un altro paese', '|',
    'Cookie non necessari rifiutati', 'Mostra il banner dei cookie', 'Resta connesso qui',
    'Microfono: consentito', 'Notifiche: negate', '|', 'Chiudi']);
});

test('le righe dei permessi: nome accordato, icona del segno, hover «Togli», azione col nome del permesso', () => {
  assert.deepEqual(M.rigaPermesso({ parte: 'audio', si: true }),
    { label: 'Microfono: consentito', icon: 'mic', hint: 'Togli', action: 'tab-permesso-togli:audio' });
  const casi = [['video', true, 'Fotocamera: consentita'], ['notifiche', false, 'Notifiche: negate'],
    ['appunti', false, 'Appunti: negati'], ['posizione', false, 'Posizione: negata'], ['scaricamenti', true, 'Scaricamenti senza un tuo clic: consentiti']];
  for (const [parte, si, testo] of casi) assert.equal(M.rigaPermesso({ parte, si }).label, testo);
  assert.equal(M.rigaPermesso({ parte: 'sconosciuta', si: true }), null);
  assert.deepEqual(etichette(M.voci({ id: 1 }, { permessi: [{ parte: 'sconosciuta', si: true }] })), ['Blocca', 'Duplica', 'Muta', '|', 'Chiudi']);
});

test('senza fornitore di rete niente voci del paese; su una scheda già instradata Cambia paese e Torna in Italia', () => {
  assert.equal(etichette(M.voci({ id: 1 }, { proxy: { configured: false } })).includes('Apri da un altro paese'), false);
  const v = etichette(M.voci({ id: 1, proxy: { country: 'us' } }, { proxy: { configured: true } }));
  assert.deepEqual(v.slice(3, 7), ['|', 'Cambia paese', 'Torna in Italia', '|']);
});

test('ogni icona del menu esiste nel popup, e la shell compone il menu da qui', () => {
  const popup = readFileSync(join(ROOT, 'src', 'main', 'popup-menu.js'), 'utf8');
  const icone = new Set();
  for (const p of Object.values(M.PARTI)) icone.add(p.icona);
  for (const v of M.voci({ id: 1, bloccata: true })) if (v.icon) icone.add(v.icon);
  for (const v of M.voci({ id: 1 })) if (v.icon) icone.add(v.icon);
  for (const i of icone) assert.match(popup, new RegExp(`\\n  ${i}:\\n`), `manca l'icona ${i} nel popup`);
  const shell = readFileSync(join(ROOT, 'src', 'renderer', 'shell.js'), 'utf8');
  assert.match(shell, /SN_MENU_LINGUETTA\.voci\(/);
  assert.doesNotMatch(shell, /tab-help|tab-close-others|tab-permessi-azzera/);
});
