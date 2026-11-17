// Sentinella di src/shared/formaAvviso.js (#2390): un avviso solo, con la forma che dice dove sta l'utente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'formaAvviso.js'));
const F = globalThis.SN_FORMA_AVVISO;

test('con Filo non davanti un avviso è una notifica del sistema, dovunque sia la scheda', () => {
  assert.equal(F.forma({ davanti: false }), 'sistema');
  assert.equal(F.forma({ davanti: false, home: true, haCarta: true }), 'sistema');
});

test('Filo davanti su una pagina: l\'angolo in basso a destra, anche per il timer che ha la sua carta', () => {
  assert.equal(F.forma({ davanti: true, home: false }), 'angolo');
  assert.equal(F.forma({ davanti: true, home: false, haCarta: true }), 'angolo');
});

test('nella home la carta che c\'è già si fa notare al posto dell\'avviso', () => {
  assert.equal(F.forma({ davanti: true, home: true, haCarta: true }), 'carta');
  assert.equal(F.forma({ davanti: true, home: true, haCarta: true, riduciMovimento: true }), 'carta');
});

test('nella home senza carta: angolo e poi volo, o subito nella colonna col movimento ridotto', () => {
  assert.equal(F.forma({ davanti: true, home: true }), 'angolo');
  assert.equal(F.forma({ davanti: true, home: true, riduciMovimento: true }), 'colonna');
  assert.equal(F.allaScadenza({ home: true }), 'vola');
  assert.equal(F.allaScadenza({ home: false }), 'chiudi');
});

test('nella home nessun avviso resta nell\'angolo: anche quelli senza durata ci stanno il tempo di leggerli', () => {
  assert.equal(F.tempoNellAngolo(0, { home: true, letturaMs: 7000 }), 7000);
  assert.equal(F.tempoNellAngolo(0, { home: true, letturaMs: 0 }), 5000);
  assert.equal(F.tempoNellAngolo(3000, { home: true, letturaMs: 7000 }), 3000);
  assert.equal(F.tempoNellAngolo(0, { home: false, letturaMs: 7000 }), 0);
});

test('l\'icona: quella chiesta se è fra le note, se no dalla cosa che racconta', () => {
  assert.equal(F.icona({ icona: 'alarm' }), 'alarm');
  assert.equal(F.icona({ icona: '<img src=x>' }), 'bell');
  assert.equal(F.icona({ errore: true }), 'warning');
  assert.equal(F.icona({ carta: 'download:abc' }), 'download');
  assert.equal(F.icona({}), 'bell');
});

test('le icone dell\'elenco esistono nella libreria', () => {
  require(join(ROOT, 'src', 'shared', 'icons.js'));
  for (const n of F.ICONE) assert.equal(typeof globalThis.SN_ICONS[n], 'function', n);
});

test('la shell carica il modulo e sceglie la forma solo da lì', () => {
  const html = readFileSync(join(ROOT, 'src', 'renderer', 'shell.html'), 'utf8');
  assert.match(html, /filo:\/\/shared\/formaAvviso\.js/);
  const shell = readFileSync(join(ROOT, 'src', 'renderer', 'shell.js'), 'utf8');
  assert.match(shell, /const FORMA = window\.SN_FORMA_AVVISO;/);
  assert.match(shell, /FORMA\.forma\(/);
});

test('la notifica del sistema nasce in un posto solo: avvisoSistema.js', () => {
  const trovate = [];
  const giro = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) giro(p);
      else if (p.endsWith('.js') && /new Notification\(|new (?:electron\.)?Notification\b/.test(readFileSync(p, 'utf8'))) trovate.push(relative(ROOT, p).split('\\').join('/'));
    }
  };
  giro(join(ROOT, 'src'));
  assert.deepEqual(trovate, ['src/main/services/avvisoSistema.js']);
});
