// Sentinella: i due tetti delle rivendicazioni dell'Esc non divergono.
//
// Perché conta. A schermo intero l'Esc chiude prima il riquadro aperto e solo
// dopo la modalità (#514, patterns/esc-chiude-prima-il-riquadro-aperto-poi-la-
// modalita.md). Chi rivendica il tasto lo fa a tetto: uno nel content script
// (primo filtro) e uno nel main (la garanzia contro una pagina che mente). Due
// numeri scritti in due file si scollano, e ogni scollamento è un danno vero:
//
//   • il tetto del MAIN sotto quello della PAGINA: il main smette di credere
//     mentre la pagina rivendica ancora, quindi esce con un riquadro che
//     nessuno ha chiuso — il danno di #514 fatto da noi;
//   • un tetto sotto la pila che i riquadri raggiungono davvero: con tre, il
//     quarto Esc di quattro riquadri impilati portava via la modalità (#648,
//     prova in tests/verifica/514/verify-514-g11.spec.mjs).
//
// Il tetto è la rete contro una pagina ostile, non il budget di chi usa Filo:
// costa qualche Esc in più per uscire da una pagina che mente, e non deve
// costare mai la modalità a chi i riquadri li ha aperti davvero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..', '..');

// Più dei riquadri che si impilano davvero (quattro, provati dalla suite), con
// margine: un tetto senza margine si scopre stretto dall'utente, non da noi.
const PILA_PROVATA = 4;

function numero(file, nome) {
  const src = readFileSync(join(RADICE, file), 'utf8');
  const m = src.match(new RegExp(`${nome}\\s*=\\s*(\\d+)`));
  assert.ok(m, `${nome} non si trova più in ${file}: la sentinella va aggiornata con lui`);
  return Number(m[1]);
}

test('il tetto del main non sta sotto quello della pagina', () => {
  const main = numero('src/main/tabs.js', 'ESC_RIVENDICAZIONI_MAX');
  const pagina = numero('src/content/content.js', 'TETTO_PROVE_FORTI');
  assert.ok(
    main >= pagina,
    `il main crede a ${main} rivendicazioni e la pagina ne fa ${pagina}: il main uscirebbe `
    + 'con un riquadro ancora aperto',
  );
});

test('nessuno dei due tetti sta sotto la pila di riquadri che la suite prova', () => {
  for (const [file, nome] of [
    ['src/main/tabs.js', 'ESC_RIVENDICAZIONI_MAX'],
    ['src/content/content.js', 'TETTO_PROVE_FORTI'],
  ]) {
    const tetto = numero(file, nome);
    assert.ok(
      tetto > PILA_PROVATA,
      `${nome} vale ${tetto}: con ${PILA_PROVATA} riquadri impilati l'ultimo Esc porta via la modalità`,
    );
  }
});
