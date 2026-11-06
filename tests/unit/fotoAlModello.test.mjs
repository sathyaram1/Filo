// #1721 — ogni foto di una pagina che va a un modello passa da un punto solo, services/fotoDellaPagina.js, che la copre
// (campi segreti, testo che li ripete, riquadri di altre origini). Una strada nuova che fotografa una pagina chiama lui,
// o si scrive qui col perché la sua foto non va a un modello che può riportarne il contenuto al sito.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = fileURLToPath(new URL('../../', import.meta.url));

const AMMESSI = {
  'src/main/services/fotoDellaPagina.js': 'il punto unico: la foto coperta per un modello, e quella intera per chi la tiene',
  'src/main/services/miniature.js': 'la miniatura di una pagina salvata, che vede solo l’utente',
  'src/main/tabs/anteprime.js': 'le anteprime delle schede, che vede solo l’utente',
  'src/main/shim/chrome-api.js': 'chrome.tabs.captureVisibleTab dei moduli portati: nessuno la manda a un modello',
  'src/main/main.js': 'le foto della prova smoke',
  'src/main/services/riquadriRotti.js': 'il solo riquadro di terzi rotto (#760), a un modello che dà un verdetto e non scrive al sito',
};

function sorgenti(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) sorgenti(p, out);
    else if (nome.endsWith('.js')) out.push(p);
  }
  return out;
}

test('capturePage() si chiama solo dai file che fotografano per un modello attraverso il punto unico, o per l’utente', () => {
  const fuori = [];
  for (const p of sorgenti(join(RADICE, 'src'))) {
    const rel = relative(RADICE, p).split('\\').join('/');
    if (/\bcapturePage\s*\(/.test(readFileSync(p, 'utf8')) && !AMMESSI[rel]) fuori.push(rel);
  }
  assert.deepEqual(fuori, [], 'una foto di pagina fuori da fotoDellaPagina.js: per un modello va presa da Foto.fotoPerModello');
});

test('Aiuto, finestra guardata dalla chat e nome dello Screenshot prendono la foto dal punto unico', () => {
  const leggi = (f) => readFileSync(join(RADICE, f), 'utf8');
  assert.match(leggi('src/main/services/schermo.js'), /Foto\.fotoPerModello\(/);
  const misc = leggi('src/main/services/handlers/misc.js');
  assert.equal((misc.match(/Foto\.fotoPerModello\(/g) || []).length, 2, 'perModello (Aiuto) e copiaPerModello (Screenshot)');
  assert.match(leggi('src/content/aiutoPagina.js'), /perModello: true/);
  assert.match(leggi('src/content/actions.js'), /copiaPerModello: true/);
  for (const f of ['src/content/aiutoPagina.js', 'src/content/actions.js', 'src/content/extractContext.js']) {
    assert.doesNotMatch(leggi(f), /fotoCoperta|campiSegretiInVista/, `${f}: la copertura non si rifà nella pagina`);
  }
});

// La foto intera resta chiamabile solo da chi risponde alle richieste delle pagine, che la dà a chi non chiede la copia
// coperta: una seconda strada verso di lei è una cattura scoperta con un altro nome.
test('la foto intera e quella della barra si chiedono solo dal gestore delle richieste di foto', () => {
  const chi = {};
  for (const p of sorgenti(join(RADICE, 'src'))) {
    const rel = relative(RADICE, p).split('\\').join('/');
    if (rel === 'src/main/services/fotoDellaPagina.js') continue;
    const t = readFileSync(p, 'utf8');
    const n = (t.match(/\bfotoPiena\s*\(/g) || []).length + (t.match(/\bfotoDellaBarra\s*\(/g) || []).length;
    if (n) chi[rel] = n;
  }
  assert.deepEqual(chi, { 'src/main/services/handlers/misc.js': 2 });
});

// Chi chiede alla pagina la foto senza la copia coperta la riceve intera: lo fa solo chi non la manda a un modello né
// fuori dal computer. Lo screenshot del feedback va all'owner e chiede `coperta` (#2116).
const RICHIESTE_INTERE = {
  'src/preload/internal-preload.js': 'chrome.tabs.captureVisibleTab delle pagine di Filo: nessuna la manda a un modello',
};
test('una richiesta di foto della pagina senza la copia coperta sta solo dove la foto non va a un modello', () => {
  const fuori = [];
  for (const dir of ['src/content', 'src/preload', 'src/pages', 'src/renderer']) {
    for (const p of sorgenti(join(RADICE, dir))) {
      const rel = relative(RADICE, p).split('\\').join('/');
      const t = readFileSync(p, 'utf8');
      for (const m of t.matchAll(/\{\s*type:\s*(?:MSG\.CAPTURE_VISIBLE_TAB|'capture_visible_tab')([^}]*)\}/g)) {
        if (!/\b(?:perModello|copiaPerModello|coperta):\s*true/.test(m[1]) && !RICHIESTE_INTERE[rel]) fuori.push(rel);
      }
    }
  }
  assert.deepEqual(fuori, [], 'per un modello si chiede perModello (foto coperta) o copiaPerModello (intera più copia coperta)');
});

// Con copiaPerModello la pagina riceve anche la foto intera: verso un modello parte solo la copia coperta. L'eccezione
// aperta è la Trascrizione di una zona, la cui scelta (coprire anche lì o no) aspetta l'owner (#1721, giro 1).
const INTERE_A_UN_MODELLO = { 'src/content/actions.js': 1 };
test('la foto intera di una pagina non entra in una richiesta a un modello, fuori dall’eccezione scritta', () => {
  const chi = {};
  for (const p of sorgenti(join(RADICE, 'src/content'))) {
    const rel = relative(RADICE, p).split('\\').join('/');
    const n = (readFileSync(p, 'utf8').match(/payload:\s*\{[^}]*\b(?:cap|region|regione|scatto)\.dataUrl/g) || []).length;
    if (n) chi[rel] = n;
  }
  assert.deepEqual(chi, INTERE_A_UN_MODELLO);
});
