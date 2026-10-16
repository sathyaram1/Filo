// I contatti del motore (Electron, Chromium) che nessun indirizzo nel codice rivela, spenti di serie (#1084): ognuno legato
// al punto che lo spegne e alla frase del documento sulla privacy. I servizi che Filo contatta, aggiornamenti compresi,
// stanno nell'elenco dei servizi esterni, che serviziEsterni.test.mjs confronta col codice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const privacy = leggi('transparency', 'privacy.md').replace(/\s+/g, ' ');

function sorgenti(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sorgenti(p));
    else if (/\.(js|html)$/.test(n) && !/^(transparency|patchNotes)\.js$/.test(n)) out.push(p);
  }
  return out;
}
const codice = sorgenti(join(ROOT, 'src')).map((f) => ({ f: relative(ROOT, f).replace(/\\/g, '/'), s: readFileSync(f, 'utf8') }));
const dove = (re) => codice.filter((x) => re.test(x.s)).map((x) => x.f);

test('i dizionari del correttore non si scaricano da Google: la base è file://, fissata prima che nasca una sessione', () => {
  // Chromium li scarica da redirector.gvt1.com appena una sessione ha una lingua senza dizionario: un indirizzo che
  // nel codice non compare. La difesa vive in un posto solo, e il main la chiama prima di qualsiasi sessione.
  assert.deepEqual(dove(/setSpellCheckerDictionaryDownloadURL/), ['src/main/services/dizionari.js']);
  const main = leggi('src', 'main', 'main.js');
  const chiamata = main.search(/^try \{ require\('\.\/services\/dizionari'\)\.prepara\(app\); \} catch \(_\) \{\}$/m);
  assert.ok(chiamata > 0, 'main.js non prepara più i dizionari, a livello del modulo');
  for (const dopo of [/app\.whenReady\(/, /session\.(defaultSession|fromPartition)/, /require\('\.\/services\/loader'\)/]) {
    const i = main.search(dopo);
    assert.ok(i < 0 || chiamata < i, `i dizionari vanno preparati prima di ${dopo}`);
  }
  const D = require('../../src/main/services/dizionari.js');
  assert.match(leggi('src', 'main', 'services', 'dizionari.js'), /app\.on\('session-created'/);
  assert.equal(new URL(D.indirizzo()).protocol, 'file:');
  assert.ok(D.lingue().includes('it-IT') && D.lingue().some((l) => l.startsWith('en-')), 'italiano e inglese viaggiano con Filo');
  assert.ok(privacy.includes('Filo ha con sé i dizionari di italiano e inglese, li mette nella sua cartella dei dati e non lascia scaricare niente'));
});

test('i servizi del motore che vogliono una chiave Google (posizione, riconoscimento vocale) restano spenti', () => {
  assert.deepEqual(dove(/GOOGLE_API_KEY|GOOGLE_DEFAULT_CLIENT/), [],
    'con una chiave Google il motore manda posizione e voce a Google: va scritto nel documento sulla privacy');
});

test('nessun crash parte da solo, e il documento lo dice', () => {
  assert.deepEqual(dove(/crashReporter\s*\.\s*start/), [], 'un crash reporter acceso va raccontato nel documento sulla privacy');
  assert.ok(privacy.includes('Filo non ha un sistema che segnala i crash da solo'));
});
