// La scelta degli spec di finish:check su un ramo che non tocca il comportamento dell'app (#2425): un lavoro server
// che cambia solo commenti, la versione o la riga di novità corre gli unit e nessuno spec, e lo dice col motivo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { codiceSenzaCommenti, soloNeiCommenti } from '../../scripts/lib/solo-commenti.mjs';
import { cambiatiPerLaScelta, specDellaScelta, motivoDellaScelta } from '../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRANSIZIONI = readFileSync(join(ROOT, 'src', 'shared', 'feedbackTransitions.js'), 'utf8');

test('JS: commenti e spazi non contano, il codice sì, anche quando somiglia a un commento', () => {
  const js = (a, b) => soloNeiCommenti(a, b, 'x.js');
  assert.equal(js('const a = 1; // uno\n', '// prima\nconst a  =  1; /* uno, detto meglio */\n'), true);
  assert.equal(js('const a = 1;\n', 'const a = 2;\n'), false);
  assert.equal(js("const u = 'http://a';\n", "const u = 'http://b';\n"), false, 'un // dentro una stringa è testo');
  assert.equal(js('const t = `/* a */`;\n', 'const t = `/* b */`;\n'), false, 'un commento dentro un template è testo');
  assert.equal(js('const r = /[/*]a/;\n', 'const r = /[/*]b/;\n'), false, 'una regex letterale non apre un commento');
  assert.equal(js('const a = 1;\n', 'const a = ;\n'), false, 'un sorgente che non si legge conta come cambiato');
  assert.equal(js(null, 'const a = 1;\n'), false, 'un file nuovo è un cambio vero');
  assert.equal(js('const a = 1;\n', null), false, 'un file tolto è un cambio vero');
});

test('CSS: i commenti non contano, una regola sì; altri tipi di file contano sempre come cambiati', () => {
  assert.equal(soloNeiCommenti('a { color: red; } /* caldo */\n', '/* tono */\na { color: red; }\n', 's.css'), true);
  assert.equal(soloNeiCommenti('a { color: red; }\n', 'a { color: blue; }\n', 's.css'), false);
  assert.equal(soloNeiCommenti('a::after { content: "/* x */"; }\n', 'a::after { content: "/* y */"; }\n', 's.css'), false);
  assert.equal(soloNeiCommenti('<p>a</p><!-- x -->', '<p>a</p><!-- y -->', 'p.html'), false);
  assert.equal(codiceSenzaCommenti('{}', 'package.json'), null);
});

function scena() {
  const dir = cartellaTemporanea('solo-commenti-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (rel, testo) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), testo); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('package.json', '{ "name": "filo", "version": "0.2.1" }\n');
  scrivi('src/shared/feedbackTransitions.js', TRANSIZIONI);
  scrivi('src/shared/patchNotes.js', "(function (g) { g.SN_PATCH_NOTES = [{ versione: '0.2.2', righe: ['a'] }]; })(globalThis);\n");
  scrivi('src/main/services/downloads.js', "const u = 'http://a';\nmodule.exports = { u };\n");
  for (const s of ['feedback-batch', 'feedback-attach-files', 'novita', 'downloads-eseguibili']) scrivi(`tests/${s}.spec.mjs`, '');
  g('add', '-A'); g('commit', '-qm', 'base');
  const ramo = (nome, cambi) => {
    g('checkout', '-q', '-b', nome, 'main');
    for (const [rel, testo] of Object.entries(cambi)) scrivi(rel, testo);
    if (Object.keys(cambi).length) { g('add', '-A'); g('commit', '-qm', nome); }
  };
  // La catena di main(): file del ramo, spec scelti, motivo stampato.
  const scegli = () => {
    const { changed } = cambiatiPerLaScelta({ base: 'main', marker: null, root: dir });
    const { specs, soloCommenti } = specDellaScelta({ changed, base: 'main', root: dir });
    return { changed, specs, motivo: motivoDellaScelta({ changed, soloCommenti, specs: specs.length }) };
  };
  return { dir, ramo, scegli };
}

test('un ramo pari a main, o che cambia solo versione e novità, non sceglie spec e dice perché', () => {
  const s = scena();
  try {
    s.ramo('vuoto', {});
    const vuoto = s.scegli();
    assert.deepEqual(vuoto.specs, []);
    assert.match(vuoto.motivo, /non cambia file rispetto alla linea principale\. Corro solo gli unit/);

    s.ramo('versione', {
      'package.json': '{ "name": "filo", "version": "0.2.2" }\n',
      'src/shared/patchNotes.js': "(function (g) { g.SN_PATCH_NOTES = [{ versione: '0.2.2', righe: ['a', 'b'] }]; })(globalThis);\n",
    });
    const versione = s.scegli();
    assert.deepEqual(versione.changed.sort(), ['package.json', 'src/shared/patchNotes.js']);
    assert.deepEqual(versione.specs, []);
    assert.match(versione.motivo, /corro solo gli unit: dei file cambiati, tutti \(2\) non li prova nessuno spec \(.*package\.json/);
  } finally {
    togliCartella(s.dir);
  }
});

test('le tabelle dei feedback ritoccate solo nei commenti (#2046) non trascinano gli spec feedback-*', () => {
  const s = scena();
  try {
    const commento = '// la fusione provata (linea principale, cita il feedback, dopo nascita e riapertura); ogni altra consegna no.';
    assert.ok(TRANSIZIONI.includes(commento), 'la scena: il commento che #2046 aveva ritoccato');
    s.ramo('commenti', {
      'src/shared/feedbackTransitions.js': TRANSIZIONI.replace(commento, '// la fusione provata (linea principale, cita il feedback, dopo nascita e riapertura; un doppione: è la fusione\n      // dell\'originale, chiuso, dopo la riapertura); ogni altra consegna no.'),
      'FEEDBACK-STATES.md': 'stati\n',
    });
    const r = s.scegli();
    assert.deepEqual(r.specs, []);
    assert.match(r.motivo, /1 cambiano solo nei commenti \(src\/shared\/feedbackTransitions\.js\); gli altri non li prova nessuno spec \(FEEDBACK-STATES\.md\)/);
  } finally {
    togliCartella(s.dir);
  }
});

test('un ramo che tocca il codice dell\'app sceglie gli spec della sua area, come prima', () => {
  const s = scena();
  try {
    s.ramo('codice', {
      'src/shared/feedbackTransitions.js': TRANSIZIONI.replace("revision_capability: ['routine']", "revision_capability: ['routine', 'owner']"),
      'src/main/services/downloads.js': "const u = 'http://b';\nmodule.exports = { u };\n",
    });
    const r = s.scegli();
    assert.deepEqual(r.specs.sort(), ['tests/downloads-eseguibili', 'tests/feedback-attach-files', 'tests/feedback-batch']);
    assert.equal(r.motivo, '');
  } finally {
    togliCartella(s.dir);
  }
});

test('con spec scelti, i file tolti perché cambiano solo nei commenti si nominano', () => {
  assert.equal(
    motivoDellaScelta({ changed: ['src/a.js', 'src/b.js'], soloCommenti: ['src/b.js'], specs: 3 }),
    '▸ Cambiano solo nei commenti, e non scelgono spec: src/b.js.',
  );
  const tanti = Array.from({ length: 10 }, (_, i) => `src/f${i}.js`);
  assert.match(motivoDellaScelta({ changed: tanti, soloCommenti: tanti, specs: 0 }), /10 cambiano solo nei commenti \(.*src\/f7\.js e altri 2\)\./);
});

test('finish:check sceglie gli spec con la stessa catena che provano questi test', () => {
  const testo = readFileSync(join(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  const main = testo.slice(testo.indexOf('async function main()'));
  assert.ok(main.includes('specDellaScelta({ changed, base, root: albero.dir })'));
  assert.ok(main.includes('motivoDellaScelta({ changed, soloCommenti, specs: specs.length })'));
  assert.ok(!/specsForChangedFiles\(/.test(main), 'nessuna seconda scelta degli spec dentro main()');
});
