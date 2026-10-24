// La pillola dello schermo pieno (#1526): chi nomina e quanto resta. La vista la prova tests/avviso-schermo-pieno.spec.mjs.
// Regole: patterns/un-avviso-su-una-pagina-non-sta-dentro-la-pagina.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'i18n.js'));
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'preferences.js'));
require(join(ROOT, 'src', 'shared', 'cambi.js'));
const { partiDellAvviso } = require(join(ROOT, 'src', 'main', 'avvisoSchermoPieno.js'));
const C = globalThis.SN_CONST;
const P = globalThis.SN_PREF;

// [host] è un nome scritto come sito, <tasto> il tasto: la vista li disegna come testo, mai come markup.
const frase = (pagina, chiede) => partiDellAvviso(pagina, chiede, 'Esc')
  .map((p) => (p.sito ? `[${p.t}]` : p.tasto ? `<${p.t}>` : p.t)).join('');

test('la pillola nomina l\'host di chi ha chiesto, in punycode, e l\'Esc', () => {
  assert.equal(frase('https://www.esempio.it/video?t=1', 'https://www.esempio.it/video?t=1'), '[www.esempio.it] è a schermo intero · <Esc> per uscire');
  assert.equal(frase('https://www.esempio.it/', ''), '[www.esempio.it] è a schermo intero · <Esc> per uscire');
  // Un nome con lettere di altri alfabeti si legge come lo vede la rete: un sosia non si traveste.
  assert.equal(frase('https://аpple.com/', ''), '[xn--pple-43d.com] è a schermo intero · <Esc> per uscire');
  assert.equal(frase('blob:https://video.example/1234', ''), '[video.example] è a schermo intero · <Esc> per uscire');
});

test('un riquadro di un altro sito si nomina accanto alla pagina', () => {
  assert.equal(frase('https://www.esempio.it/', 'https://player.altro.com/embed/9'),
    '[player.altro.com], dentro [www.esempio.it], è a schermo intero · <Esc> per uscire');
  // Un about: ha il sito di chi l'ha scritto: vale la pagina.
  assert.equal(frase('https://a.example/', 'about:blank'), '[a.example] è a schermo intero · <Esc> per uscire');
  assert.equal(frase('https://a.example/', 'data:text/html,x'), 'Una pagina senza indirizzo, dentro [a.example], è a schermo intero · <Esc> per uscire');
});

test('senza host la pillola dice il tipo di pagina', () => {
  assert.equal(frase('file:///home/io/pagina.html', ''), 'Un file del computer è a schermo intero · <Esc> per uscire');
  assert.equal(frase('data:text/html,<b>ciao</b>', ''), 'Una pagina senza indirizzo è a schermo intero · <Esc> per uscire');
  assert.equal(frase('about:blank', ''), 'Una pagina senza indirizzo è a schermo intero · <Esc> per uscire');
  assert.equal(frase('', ''), 'Una pagina senza indirizzo è a schermo intero · <Esc> per uscire');
  assert.equal(frase('filo://editor/editor.html', ''), 'Una pagina di Filo è a schermo intero · <Esc> per uscire');
});

test('un host fatto di markup resta un pezzo di testo', () => {
  const parti = partiDellAvviso('https://a.example/', 'https://x.example/', '<b>Esc</b>');
  assert.ok(parti.every((p) => typeof p.t === 'string' && Object.keys(p).every((k) => ['t', 'sito', 'tasto'].includes(k))));
  assert.equal(parti.find((p) => p.tasto).t, '<b>Esc</b>');
});

test('la durata: 3 secondi di serie, fuori dai limiti torna dentro, illeggibile prende il predefinito', () => {
  assert.deepEqual(C.DEFAULT_SETTINGS.avvisoSchermoPieno, { durataMs: 3000 });
  assert.deepEqual(C.opzioniAvvisoSchermoPieno(undefined), { durataMs: 3000 });
  assert.equal(C.opzioniAvvisoSchermoPieno({ durataMs: 200 }).durataMs, 1000);
  assert.equal(C.opzioniAvvisoSchermoPieno({ durataMs: '99999' }).durataMs, 10000);
  assert.equal(C.opzioniAvvisoSchermoPieno({ durataMs: 'boh' }).durataMs, 3000);
  assert.equal(C.opzioniAvvisoSchermoPieno({ durataMs: '' }).durataMs, 3000);
  assert.equal(C.opzioniAvvisoSchermoPieno({ durataMs: true }).durataMs, 3000);
  assert.equal(C.opzioniAvvisoSchermoPieno({ durataMs: 4500 }).durataMs, 4500);
});

test('a parole: la durata si scrive, e fuori dai limiti è un rifiuto col numero', () => {
  assert.deepEqual(P.buildPreferencePartial('avviso_schermo_pieno', '5 secondi').partial, { avvisoSchermoPieno: { durataMs: 5000 } });
  assert.deepEqual(P.buildPreferencePartial('avviso schermo intero', '1500 ms').partial, { avvisoSchermoPieno: { durataMs: 1500 } });
  // Un numero piccolo senza unità sono secondi: «mettilo a 8» sono otto secondi.
  assert.deepEqual(P.buildPreferencePartial('avviso_schermo_pieno', '8').partial, { avvisoSchermoPieno: { durataMs: 8000 } });
  assert.match(P.buildPreferencePartial('avviso_schermo_pieno', '20 secondi').rifiuto, /20\.000 ms.*1\.000 a 10\.000/);
  assert.match(P.buildPreferencePartial('avviso_schermo_pieno', '500 ms').rifiuto, /500 ms.*1\.000 a 10\.000/);
  const righe = P.righeDescrizione({ sistema: 'win32', shellPref: '' }).join('\n');
  assert.ok(righe.includes('• avviso_schermo_pieno: '));
  assert.equal(globalThis.SN_CAMBI.fraseCambio({ chiave: 'avvisoSchermoPieno.durataMs', prima: 3000, dopo: 5000 }),
    'durata dell\'avviso del sito a schermo intero: 3.000 ms → 5.000 ms');
});
