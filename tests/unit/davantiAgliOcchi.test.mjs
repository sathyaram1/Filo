// #662.2: «davanti agli occhi» ha una regola sola, per chi prende gli avvisi in coda e per la riga del ripiego che conta
// come detta. Il giro vero, con le schede: tests/ripiego-crediti.spec.mjs (Z1-Z4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { mittenteDavanti, schedaDavanti } = require('../../src/main/services/davantiAgliOcchi.js');

function finestra({ attiva = 1, fuoco = false, distrutta = false } = {}) {
  const wc = (id) => ({ id, isDestroyed: () => false });
  return {
    isFocused: () => fuoco,
    isDestroyed: () => distrutta,
    _filoTabs: { activeId: attiva, tabs: [{ id: 1, view: { webContents: wc('home') } }, { id: 2, view: { webContents: wc('sito') } }] },
  };
}

test('la scheda attiva con la finestra davanti, o col fuoco dichiarato dalla pagina; una scheda dietro mai', () => {
  const win = finestra({ attiva: 1 });
  assert.equal(mittenteDavanti({ win, tab: { id: 1 } }, true), true, 'il fuoco sulla pagina');
  assert.equal(mittenteDavanti({ win, tab: { id: 1 } }, false), false, 'Filo dietro un’altra applicazione');
  assert.equal(mittenteDavanti({ win: finestra({ attiva: 1, fuoco: true }), tab: { id: 1 } }, false), true, 'il fuoco sulla barra delle schede');
  assert.equal(mittenteDavanti({ win, tab: { id: 2 } }, true), false, 'una scheda dietro, anche col fuoco che dice lei');
  assert.equal(mittenteDavanti({ win, tab: { id: 1 }, riserva: true }, true), false, 'la home pronta in riserva');
  assert.equal(mittenteDavanti({ win: null, tab: { id: 1 } }, true), false);
  assert.equal(mittenteDavanti(null, true), false);
});

test('la scheda davanti: l’attiva della finestra col fuoco; nessuna con Filo dietro un’altra applicazione', () => {
  assert.equal(schedaDavanti([finestra({ attiva: 2, fuoco: true })]).id, 'sito');
  assert.equal(schedaDavanti([finestra({ attiva: 2 }), finestra({ attiva: 1, fuoco: true })]).id, 'home');
  assert.equal(schedaDavanti([finestra({ attiva: 1 })]), null);
  assert.equal(schedaDavanti([finestra({ attiva: 1, fuoco: true, distrutta: true })]), null);
  assert.equal(schedaDavanti([]), null);
});

test('chi prende gli avvisi e la riga del ripiego chiedono alla stessa regola', () => {
  const ai = readFileSync(new URL('../../src/main/services/handlers/ai.js', import.meta.url), 'utf8');
  const coda = /on\(MSG\.AVVISI_IN_CODA, async \(msg, sender\) => \{([\s\S]*?)\n {2}\}\);/.exec(ai)[1];
  assert.match(coda, /mittenteDavanti\(sender, msg && msg\.fuoco\)/);
  assert.match(coda, /prendi\(id, \{ scheda: sender\.wc \}\)/, 'chi prende dice quale scheda è davanti');
  assert.doesNotMatch(coda, /isFocused|activeId/, 'niente seconda copia della regola');
  const wallet = readFileSync(new URL('../../src/main/services/handlers/wallet.js', import.meta.url), 'utf8');
  assert.match(wallet, /on\(MSG\.KEY_FALLBACK_SHOWN, async \(msg, sender\) => \(\{ ok: true, detto: rigaArrivata\(msg, sender\) \}\)\)/);
  const arrivata = /function rigaArrivata\(msg, sender\) \{([\s\S]*?)\n {2}\}/.exec(wallet)[1];
  assert.match(arrivata, /Davanti\.mittenteDavanti\(sender, msg && msg\.fuoco\)/);
  for (const f of ['src/content/popup.js', 'src/pages/dashboard/dashboard.js']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.match(src, /type: MSG\.KEY_FALLBACK_SHOWN, fuoco \}/, `${f} dice se ha il fuoco`);
  }
});
