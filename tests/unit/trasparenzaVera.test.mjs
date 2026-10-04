// I documenti Privacy e Sicurezza dicono com'è Filo OGGI: ogni frase qui sotto è legata al codice che la rende vera.
// Cambia il codice e il test diventa rosso finché il documento in transparency/ non dice la cosa nuova (#951).
// Il documento si rigenera con `node scripts/build-transparency.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const unaRiga = (s) => s.replace(/\s+/g, ' ');
const privacy = unaRiga(leggi('transparency', 'privacy.md'));
const sicurezza = unaRiga(leggi('transparency', 'security.md'));

// Il codice dice `vero`: il documento deve contenere la frase. Il codice dice altro: la frase deve sparire.
function legame(vero, doc, frase, cosa) {
  assert.equal(doc.includes(frase), vero, vero
    ? `${cosa}: il documento non lo dice più («${frase}»)`
    : `${cosa} non è più vero: togli o riscrivi «${frase}»`);
}

test('la raccolta dei percorsi dell\'Aiuto è spenta, e il documento lo dice', () => {
  const spenta = /const RACCOLTA_ACCESA = false;/.test(leggi('src', 'main', 'services', 'pathsCollector.js'));
  legame(spenta, privacy, 'ma la raccolta è spenta', 'percorsi spenti');
});

test('il terminale è acceso di serie, e i due documenti lo dicono', () => {
  const acceso = /terminal:\s*\{\s*enabled:\s*true/.test(leggi('src', 'shared', 'constants.js'));
  legame(acceso, privacy, 'Il terminale è acceso di serie', 'terminale acceso di serie');
  legame(acceso, sicurezza, 'è acceso di serie', 'terminale acceso di serie');
});

test('Safe Browsing riceve l\'indirizzo intero, ed è fra i punti deboli', () => {
  const intero = /threatEntries:\s*\[\{\s*url:\s*rawUrl\s*\}\]/.test(leggi('src', 'main', 'services', 'safebrowse', 'net.js'));
  legame(intero, privacy, 'Safe Browsing riceve l\'indirizzo completo delle pagine che apri', 'indirizzo intero a Safe Browsing');
});

test('le richieste ai modelli non chiedono la ritenzione zero, ed è fra i punti deboli', () => {
  const chiede = /\bzdr\b|data_collection/.test(leggi('src', 'main', 'services', 'providers', 'openrouter.js'));
  legame(!chiede, privacy, 'non chiede ancora la ritenzione zero', 'ritenzione zero non richiesta');
});

test('del feedback restano in chiaro titolo della pagina e browser, e il documento lo dice', () => {
  const fb = leggi('src', 'shared', 'feedback.js');
  const chiaro = /title: toFsValue\(title \|\| ''\)/.test(fb) && /userAgent: toFsValue\(userAgent \|\| ''\)/.test(fb);
  const cifrati = /maybeEncrypt\(text \|\| ''\)/.test(fb) && /maybeEncrypt\(url \|\| ''\)/.test(fb);
  assert.ok(cifrati, 'testo e indirizzo del feedback non risultano più cifrati: il documento sulla privacy dice che lo sono');
  legame(chiaro, privacy, 'Restano in chiaro il titolo della pagina, browser e sistema', 'titolo e browser in chiaro');
});

test('l\'installer non è firmato con un certificato, e il documento sulla sicurezza lo dice', () => {
  const build = JSON.parse(leggi('package.json')).build || {};
  const firmato = Boolean((build.win && (build.win.certificateFile || build.win.certificateSubjectName || build.win.azureSignOptions))
    || (build.mac && build.mac.identity));
  legame(!firmato, sicurezza, 'l\'installer non è firmato con un certificato', 'installer senza firma');
});
