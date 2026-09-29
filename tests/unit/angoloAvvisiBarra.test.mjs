// Sentinella: tutto ciò che Filo ancora nell'angolo in basso a destra di una pagina sale sopra gli avvisi
// della barra, che il main disegna lì sopra e di cui scrive l'altezza in --filo-avvisi-barra (#588.5).
// Regola e racconto: patterns/la-shell-non-disegna-sopra-la-pagina.md (§ L'angolo si divide).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Fogli che finiscono dentro le pagine: quelli del content script e quelli delle pagine di Filo.
const CARTELLE = ['src/styles', 'src/pages'];

function fogli(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...fogli(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

// Regole fisse ancorate in basso e a destra, senza un alto: un riquadro nell'angolo, non un velo a tutta pagina.
function ancorateAllAngolo(css) {
  const pulito = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const trovate = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(pulito))) {
    const corpo = m[2];
    const val = (k) => {
      const r = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`, 'i').exec(corpo);
      return r ? r[1].trim() : null;
    };
    if (!/^fixed\b/i.test(val('position') || '')) continue;
    const basso = val('bottom');
    const destra = val('right');
    const alto = val('top');
    if (!basso || !destra || /^auto\b/.test(basso) || /^auto\b/.test(destra)) continue;
    if ((alto && !/^auto\b/.test(alto)) || val('inset')) continue;
    trovate.push({ selettore: m[1].trim().replace(/\s+/g, ' '), basso });
  }
  return trovate;
}

test('il riconoscitore prende i riquadri nell’angolo e lascia stare i veli a tutta pagina', () => {
  const css = `
    .a { position: fixed; bottom: 16px; right: 16px; }
    .b { position: fixed; top: 0; right: 0; bottom: 0; left: 0; }
    .c { position: fixed; inset: 0; bottom: 0; right: 0; }
    .d { position: absolute; bottom: 4px; right: 4px; }
    .e { position: fixed; bottom: max(20px, var(--filo-avvisi-barra, 0px)); right: 20px; }`;
  assert.deepEqual(ancorateAllAngolo(css).map((r) => r.selettore), ['.a', '.e']);
});

test('ogni riquadro di Filo ancorato in basso a destra nella pagina sale sopra gli avvisi della barra', () => {
  const trovate = [];
  for (const cartella of CARTELLE) {
    for (const f of fogli(join(ROOT, cartella))) {
      for (const r of ancorateAllAngolo(readFileSync(f, 'utf8'))) trovate.push({ file: relative(ROOT, f).replace(/\\/g, '/'), ...r });
    }
  }
  // Ci sono almeno le pile di avvisi e il riquadro Aiuto: se il riconoscitore non ne vede nessuno, è lui a essere rotto.
  assert.ok(trovate.some((r) => r.selettore.includes('.sn-sidebar')), 'il riconoscitore non vede più il riquadro Aiuto');
  const sotto = trovate.filter((r) => !/var\(\s*--filo-avvisi-barra\b/.test(r.basso));
  assert.deepEqual(sotto, [],
    'questi riquadri stanno nell’angolo degli avvisi della barra e ci finirebbero sotto: il loro bottom deve tenere conto di --filo-avvisi-barra, come max(16px, var(--filo-avvisi-barra, 0px))');
});
