// Sentinella del token `motion` (#837): ogni durata di transition/animation scritta sotto src/ (CSS, <style>
// delle pagine HTML, CSS dentro i .js) passa da calc(<durata> * var(--sn-motion, 1)), così «togli le
// animazioni» arriva ovunque. Le durate delle .animate() e dei timer le scala SN_THEME_TOKENS.motionMs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

// Animazioni che misurano un tempo vero (un'attesa che scade comunque): scalarle mentirebbe.
const ECCEZIONI = [
  { file: 'src/styles/voce.css', contiene: 'var(--sn-voce-attesa', perche: "l'anello si svuota nel tempo vero per annullare la richiesta a voce" },
  { file: 'src/pages/dashboard/dashboard.css', contiene: 'var(--dash-pausa-quadrato', perche: 'il quadrato si accende nel tempo vero in cui ignora i clic (#1296)' },
];

const DECL = /(?:^|[\s;{])((?:-webkit-)?(?:transition|animation)(?:-duration|-delay)?)\s*:\s*([^;{}]*)/g;
const AVVOLTA = /calc\(\s*(?:-?\d*\.?\d+m?s|var\(\s*--[\w-]+\s*(?:,(?:[^()]|\([^()]*\))*)?\))\s*\*\s*var\(\s*--sn-motion\s*(?:,\s*1\s*)?\)\s*\)/g;
const DURATA = /(?<![\w.#-])-?\d*\.?\d+m?s(?![\w-])/g;

// Le durate scritte senza la variabile in un testo CSS: [{ riga, dichiarazione }].
export function durateSenzaMotion(css) {
  const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const fuori = [];
  for (const m of senzaCommenti.matchAll(DECL)) {
    const resto = m[2].replace(AVVOLTA, '');
    const nude = (resto.match(DURATA) || []).filter((t) => parseFloat(t) !== 0);
    if (nude.length || /var\(\s*--(?!sn-motion\b)/.test(resto)) {
      const riga = senzaCommenti.slice(0, m.index).split('\n').length;
      fuori.push({ riga, dichiarazione: `${m[1]}: ${m[2].trim().replace(/\s+/g, ' ')}` });
    }
  }
  return fuori;
}

function* fileSotto(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) yield* fileSotto(p);
    else if (/\.(css|html|m?js)$/.test(nome)) yield p;
  }
}

function cssDi(percorso) {
  return cssDiTesto(readFileSync(percorso, 'utf8'), percorso);
}

function cssDiTesto(testo, percorso) {
  if (!percorso.endsWith('.html')) return testo;
  // Fuori dagli <style> e dagli attributi style si sbianca tutto tranne gli a capo: le righe restano quelle del file.
  let out = '';
  let da = 0;
  for (const m of testo.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style>|(\sstyle\s*=\s*["'])([^"']*)/gi)) {
    const apertura = m[1] ?? m[3];
    const css = m[2] ?? m[4];
    const inizio = m.index + apertura.length;
    out += testo.slice(da, inizio).replace(/[^\n]/g, ' ') + (m[4] !== undefined ? `${css};` : css);
    da = inizio + css.length;
  }
  return out + testo.slice(da).replace(/[^\n]/g, ' ');
}

test('ogni durata di transition/animation sotto src/ passa da --sn-motion', () => {
  const rossi = [];
  let viste = 0;
  for (const p of fileSotto(SRC)) {
    const rel = relative(ROOT, p).split('\\').join('/');
    const css = cssDi(p);
    viste += [...css.matchAll(DECL)].length;
    for (const f of durateSenzaMotion(css)) {
      if (ECCEZIONI.some((e) => e.file === rel && f.dichiarazione.includes(e.contiene))) continue;
      rossi.push(`${rel}:${f.riga}  ${f.dichiarazione}`);
    }
  }
  assert.ok(viste > 150, `la sentinella vede solo ${viste} dichiarazioni: la ricerca si è rotta`);
  assert.deepEqual(rossi, [], 'Durate scritte a mano: avvolgile in calc(<durata> * var(--sn-motion, 1)).\n' + rossi.join('\n'));
});

test('le eccezioni esistono ancora (una che non serve più si toglie)', () => {
  for (const e of ECCEZIONI) {
    const css = cssDi(join(ROOT, e.file));
    assert.ok(durateSenzaMotion(css).some((f) => f.dichiarazione.includes(e.contiene)), `${e.file}: ${e.contiene} non c'è più`);
  }
});

test('la sentinella riconosce le durate nude e lascia passare quelle avvolte', () => {
  const nude = durateSenzaMotion(`
    .a { transition: opacity 0.15s ease, transform 120ms; }
    .b { animation: gira .8s linear infinite; }
    .c { animation-delay: -0.3s; }
    .d { transition: width var(--dur) ease; }
    .e {
      transition: max-height 300ms ease,
        color 160ms;
    }`);
  assert.equal(nude.length, 5);
  assert.equal(nude[4].riga, 7);
  const pagina = '<p style="transition: opacity .2s">x</p>\n<style>.a { animation: gira 1s; }</style>';
  assert.deepEqual(durateSenzaMotion(cssDiTesto(pagina, 'x.html')).map((f) => f.riga), [1, 2]);
  assert.deepEqual(durateSenzaMotion(`
    .a { transition: opacity calc(0.15s * var(--sn-motion, 1)) ease, visibility 0s linear calc(var(--dur) * var(--sn-motion, 1)); }
    .b { animation: gira calc(.8s * var(--sn-motion, 1)) cubic-bezier(.2, .8, .2, 1) infinite; }
    .c { transition: none; animation: none; transition-property: opacity; animation-name: x; }
    .d { animation: nodo 0s; } /* transition: opacity 2s */`), []);
});

test('lo scorrimento morbido passa da SN_THEME_TOKENS.scrollBehavior (a motion 0 si salta)', () => {
  const rossi = [];
  for (const p of fileSotto(SRC)) {
    const rel = relative(ROOT, p).split('\\').join('/');
    readFileSync(p, 'utf8').split('\n').forEach((riga, i) => {
      if (/behavior\s*:\s*['"`]smooth/.test(riga) || /scroll-behavior\s*:\s*smooth/.test(riga)) rossi.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(rossi, []);
});
