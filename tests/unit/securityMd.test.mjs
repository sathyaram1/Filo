// SECURITY.md è la politica di sicurezza pubblica del progetto: ogni affermazione cita il file che la rende vera (#784).
// Qui: i file citati esistono ancora, e l'«In breve» non torna a promettere quello che il codice non mantiene.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sec = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8');
const breve = sec.slice(sec.indexOf('## In breve'), sec.indexOf('## 1.'));

test('ogni file citato in SECURITY.md esiste', () => {
  const citati = [...sec.matchAll(/`([^`\s]+)`/g)].map((m) => m[1])
    .filter((p) => /^(src|tests|scripts|transparency)\//.test(p) || /^[\w.-]+\.(md|rules|json)$/.test(p));
  assert.ok(citati.length >= 20, `troppo pochi file citati (${citati.length}): la regex non li vede più?`);
  const mancanti = [...new Set(citati)].filter((p) => !existsSync(join(ROOT, p)));
  assert.deepEqual(mancanti, [], 'file citati che non esistono più: aggiorna SECURITY.md');
});

test("l'«In breve» dice cosa esce, verso chi, e chi legge i feedback", () => {
  assert.match(breve, /accesso è facoltativo/);
  assert.match(breve, /identità anonima/);
  assert.match(breve, /OpenRouter/);
  assert.match(breve, /Il server di Filo riceve/);
  assert.match(breve, /giudici automatici/);
  // Memorie e appunti entrano nei messaggi ai modelli (renderMemoryForPrompt): «nessuno può vederli» non è vero.
  assert.doesNotMatch(breve, /nemmeno noi\s+possiamo vederli/);
  assert.doesNotMatch(breve, /esattamente/);
});

// Non tutte le porte del proprietario passano dal controllo di provenienza (#784.2): finché è così il §3 promette solo quelle dei feedback.
test('il §3 non promette che ogni funzione di amministrazione risponda solo a Filo', () => {
  const isolamento = sec.slice(sec.indexOf('## 3.'), sec.indexOf('## 4.'));
  assert.doesNotMatch(isolamento, /funzioni di amministrazione\s+rispondono solo/);
  assert.match(isolamento, /funzioni che leggono e gestiscono i feedback\s+rispondono solo alle pagine di\s+Filo/);
});

test("l'«In breve» non fa passare per completo un elenco più corto di quello che esce", () => {
  const voceModelli = breve.slice(breve.indexOf('Memorie, appunti e cronologia'), breve.indexOf('Il server di Filo riceve'));
  assert.match(voceModelli, /per esempio/);
  assert.match(voceModelli, /terminale/);
  assert.match(voceModelli, /Safe\s+Browsing/);
  assert.match(voceModelli, /transparency\/privacy\.md/);
});

// «Scrivi al maintainer» senza un indirizzo non è un canale (#1421); chi non usa Filo non ha quello dei feedback.
// Chi valuta il progetto cerca qui chi risponde della sicurezza, con nome e indirizzo (#1559).
test('una vulnerabilità ha i suoi canali privati, gli stessi nei due documenti di sicurezza', () => {
  const sezione = sec.slice(sec.indexOf('## Come segnalare un problema di sicurezza'));
  assert.match(sezione, /maintainer del progetto, \*\*Sathyaram\s+Pontillo\*\*/);
  assert.match(sezione, /email\*\* a Sathyaram Pontillo,\s+\[hello@filo\.red\]/);
  const trasparenza = readFileSync(join(ROOT, 'transparency', 'security.md'), 'utf8');
  for (const canale of ['https://github.com/sathyaram1/Filo/security/advisories/new', 'hello@filo.red']) {
    assert.ok(sezione.includes(canale), `SECURITY.md, «Come segnalare»: manca ${canale}`);
    assert.ok(trasparenza.includes(canale), `transparency/security.md: manca ${canale}`);
  }
  assert.doesNotMatch(sezione, /direttamente al maintainer/);
});
