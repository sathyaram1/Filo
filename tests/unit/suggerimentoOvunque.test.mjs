// #2095 — il fumetto di Filo (src/shared/suggerimento.js) arriva su ogni superficie che ha dei title: le pagine
// filo:// (dal loro preload), i pezzi di Filo sui siti, lo strato dei riquadri e quello del menu. La barra in alto ha il
// suo fumetto a finestra e lì un title nativo non si scrive. Più la geometria pura del fumetto e la durata dei token.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'themeTokens.js'));
require(join(ROOT, 'src', 'shared', 'suggerimento.js'));
const S = globalThis.SN_SUGGERIMENTO;
const T = globalThis.SN_THEME_TOKENS;

const CARICA = /require\(path\.join\(SHARED(?:_DIR)?, 'suggerimento\.js'\)\)|safe\(path\.join\(SHARED, 'suggerimento\.js'\)\)/;

test('i tre preload che portano i content script caricano il fumetto', () => {
  for (const f of ['internal-preload.js', 'page-preload.js', 'riquadri-preload.js']) {
    assert.match(leggi('src', 'preload', f), CARICA, `${f} non carica suggerimento.js`);
  }
});

test('le pagine filo:// nelle schede hanno il preload interno, lo strato del menu carica il modulo da sé', () => {
  assert.match(leggi('src', 'main', 'tabs.js'), /preload: isInternal \? INTERNAL_PRELOAD :/);
  assert.match(leggi('src', 'pages', 'menu', 'menu.html'), /<script src="filo:\/\/shared\/suggerimento\.js"><\/script>/);
});

test('ogni pagina in src/pages è coperta: dal preload interno, dallo strato, o è un rimando senza contenuto', () => {
  const STRATI = { 'menu/menu.html': 'script nella pagina', 'riquadri/riquadri.html': 'riquadri-preload.js' };
  const scoperte = [];
  for (const cartella of readdirSync(join(ROOT, 'src', 'pages'))) {
    const dir = join(ROOT, 'src', 'pages', cartella);
    if (!existsSync(dir)) continue;
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.html')); } catch (_) { continue; }
    for (const f of files) {
      const rel = `${cartella}/${f}`;
      if (STRATI[rel]) continue;
      const html = leggi('src', 'pages', cartella, f);
      // Un rimando (meta refresh, corpo vuoto) non ha niente da passare col mouse.
      if (/http-equiv="refresh"/i.test(html) && /<body>\s*<\/body>/i.test(html)) continue;
      // Ogni altra pagina è una scheda filo:// (col suo pageBootstrap) e prende internal-preload, che carica il modulo.
      // Una pagina nuova che non lo è va messa fra gli strati, col modo in cui carica il fumetto.
      if (!/filo:\/\/shared\/pageBootstrap\.js/.test(html)) scoperte.push(rel);
    }
  }
  assert.deepEqual(scoperte, []);
});

test('la conferma sopra un sito carica il fumetto, con filoUi prima della conferma (lo shadow chiuso si apre da lì)', () => {
  const html = leggi('src', 'renderer', 'conferma.html');
  const pos = (f) => html.indexOf(`<script src="filo://shared/${f}"></script>`);
  for (const f of ['filoUi.js', 'suggerimento.js', 'confirmUi.js']) assert.ok(pos(f) >= 0, `conferma.html non carica ${f}`);
  assert.ok(pos('filoUi.js') < pos('confirmUi.js'), 'filoUi.js deve venire prima di confirmUi.js');
});

test('il menu del tasto destro non disegna un\'etichetta sua: le icone passano dal fumetto con data-tip', () => {
  const menu = leggi('src', 'content', 'menu.js');
  assert.doesNotMatch(menu, /sn-tooltip/);
  assert.match(menu, /setAttribute\('data-tip', text\)/);
});

test('la barra in alto non scrive title nativi: i suoi suggerimenti sono data-tip', () => {
  const shell = leggi('src', 'renderer', 'shell.js');
  const titoli = shell.split('\n').map((r, i) => [i + 1, r]).filter(([, r]) => /\.title\s*=|setAttribute\(\s*'title'/.test(r));
  assert.deepEqual(titoli, []);
  assert.doesNotMatch(leggi('src', 'renderer', 'shell.css'), /\.shell-tooltip/);
});

test('il fumetto sta sotto il controllo, centrato, e dentro la vista', () => {
  const p = S.posiziona({ ancora: { left: 100, right: 140, top: 50, bottom: 70 }, w: 80, h: 20, vw: 800, vh: 600 });
  assert.deepEqual(p, { x: 80, y: 76, sotto: true });
  const destra = S.posiziona({ ancora: { left: 780, right: 800, top: 50, bottom: 70 }, w: 120, h: 20, vw: 800, vh: 600 });
  assert.equal(destra.x, 800 - 120 - 4);
  const sinistra = S.posiziona({ ancora: { left: 0, right: 10, top: 50, bottom: 70 }, w: 120, h: 20, vw: 800, vh: 600 });
  assert.equal(sinistra.x, 4);
});

test('in fondo alla vista il fumetto si capovolge sopra il controllo', () => {
  const p = S.posiziona({ ancora: { left: 100, right: 140, top: 570, bottom: 590 }, w: 80, h: 40, vw: 800, vh: 600 });
  assert.equal(p.sotto, false);
  assert.equal(p.y, 570 - 6 - 40);
  // Né sotto né sopra: resta tutto dentro, appoggiato in fondo.
  const alto = S.posiziona({ ancora: { left: 100, right: 140, top: 10, bottom: 590 }, w: 80, h: 300, vw: 800, vh: 600 });
  assert.equal(alto.y, 600 - 300 - 4);
});

test('il nome di un tasto si mostra solo se il tasto non ha già parole scritte', () => {
  for (const s of ['×', '↵', '↑', '', '  ', '✕', '▾']) assert.equal(S.senzaParole(s), true, JSON.stringify(s));
  for (const s of ['Copia', 'OK', '2', 'Invia ↵']) assert.equal(S.senzaParole(s), false, s);
});

test('il fumetto della barra prende gli stessi token, per tema, e ignora un valore non valido', () => {
  const movimento = require(join(ROOT, 'src', 'main', 'movimento.js'));
  movimento.segui({ themeTokens: {} });
  assert.equal(movimento.fumetto(false)['--bg'], '#fdf6ec');
  assert.equal(movimento.fumetto(true)['--fg'], '#f1e7d6');
  movimento.segui({ themeTokens: { 'fumetto.sfondo': '#203040', 'fumetto.bordo': 'url(x)' } });
  assert.equal(movimento.fumetto(false)['--bg'], '#203040');
  assert.equal(movimento.fumetto(true)['--bg'], '#203040');
  assert.equal(movimento.fumetto(false)['--border'], '#e2d3b5');
  movimento.segui({ themeTokens: {} });
});

test('i token del fumetto: colori per tema, attesa in millisecondi letta da JS', () => {
  assert.equal(T.defaultValue('fumetto.sfondo', 'light'), '#fdf6ec');
  assert.equal(T.defaultValue('fumetto.sfondo', 'dark'), '#1d1a16');
  assert.equal(T.durataMs(T.defaultValue('fumetto.ritardo')), 350);
  assert.equal(T.durataMs('0.8s'), 800);
  assert.equal(T.durataMs('0ms'), 0);
  assert.ok(Number.isNaN(T.durataMs('20s')));
  assert.ok(Number.isNaN(T.durataMs('lento')));
  assert.equal(T.validate('fumetto.ritardo', '1200ms'), true);
  assert.equal(T.validate('fumetto.bordo', 'red; x'), false);
  // Testo uguale allo sfondo: la modifica chiesta in chat sale di livello come per il testo delle pagine.
  assert.equal(T.illegibleAfter('fumetto.testo', '#fdf6ec', {}, 'light'), true);
});
