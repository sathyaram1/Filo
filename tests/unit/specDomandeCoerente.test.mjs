// SPEC-DOMANDE.md resta coerente con sé stessa (#1249): rimandi a sezioni che esistono, ordine di lavoro numerato
// di fila, ambiti e azioni nominati che stanno nelle loro tabelle, urgenze dei ricorrenti uguali a quelle dei compiti.
// Ogni feedback che la realizza la legge per pezzi: un rimando rotto lo manda nel posto sbagliato.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const testo = readFileSync(join(ROOT, 'SPEC-DOMANDE.md'), 'utf8').replace(/\r\n/g, '\n');
const piatto = testo.replace(/\s+/g, ' ');

function sezione(titolo) {
  const i = testo.indexOf(`\n${titolo}`);
  assert.ok(i >= 0, `sezione assente: ${titolo}`);
  const resto = testo.slice(i + titolo.length + 1);
  const livello = titolo.match(/^#+/)[0].length;
  const fine = resto.search(new RegExp(`\\n#{1,${livello}} `));
  return fine < 0 ? resto : resto.slice(0, fine);
}

const righe = (s) => s.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l));
const celle = (riga) => riga.split('|').slice(1, -1).map((c) => c.trim());
const nomiFraApici = (s) => [...s.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

const sezioni = new Set([...testo.matchAll(/^#{2,3} (\d+(?:\.\d+)?)[. ]/gm)].map((m) => m[1]));
const ambiti = new Set(righe(sezione('### 5.2')).slice(1).flatMap((r) => nomiFraApici(celle(r)[0])));
const azioni = new Set([...sezione('### 3.3').matchAll(/^- `([a-z_]+)`/gm)].map((m) => m[1]));

test('ogni rimando «§ n» porta a una sezione che esiste', () => {
  const rotti = [];
  for (const m of testo.matchAll(/§\s*(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?/g)) {
    for (const n of [m[1], m[2]].filter(Boolean)) if (!sezioni.has(n)) rotti.push(m[0]);
  }
  assert.deepEqual(rotti, []);
});

test('l\'ordine di lavoro è numerato di fila e ogni «punto n» ci sta dentro', () => {
  const punti = [...sezione('## 13. Ordine di lavoro').matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.ok(punti.length > 0);
  assert.deepEqual(punti, punti.map((_, i) => i + 1));
  const citati = [...piatto.matchAll(/punt[oi] (\d+)(?:\s*(?:e|–|-)\s*(\d+))?/g)].flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number));
  assert.ok(citati.length > 0);
  for (const n of citati) assert.ok(n >= 1 && n <= punti.length, `punto ${n} fuori dall'ordine di lavoro (1–${punti.length})`);
});

test('gli ambiti nominati nel testo e nei ricorrenti stanno nella tabella degli ambiti', () => {
  assert.ok(ambiti.has('lavoro') && ambiti.size >= 5, 'tabella degli ambiti non letta');
  const nominati = [...piatto.matchAll(/ambit[oi] ((?:`[a-z_]+`\s*(?:\/|,|e|o)?\s*)+)/g)].flatMap((m) => nomiFraApici(m[1]));
  const ricorrenti = righe(sezione('### 4.1')).slice(1).flatMap((r) => nomiFraApici(celle(r)[2]));
  assert.ok(ricorrenti.length > 0);
  for (const a of [...nominati, ...ricorrenti]) assert.ok(ambiti.has(a), `ambito \`${a}\` assente dalla tabella del § 5.2`);
});

test('le azioni nominate nel testo sono tipi ammessi del § 3.3', () => {
  assert.ok(azioni.has('riprendi') && azioni.has('compito'), 'elenco delle azioni non letto');
  const nominate = [...piatto.matchAll(/azion[ei] ((?:`[a-z_]+`\s*(?:\/|,|e|o)?\s*)+)/g)].flatMap((m) => nomiFraApici(m[1]));
  assert.ok(nominate.length > 0);
  for (const a of nominate) assert.ok(azioni.has(a), `azione \`${a}\` assente dal § 3.3`);
});

test('ogni ricorrente ha la stessa urgenza nella tabella dei compiti senza feedback', () => {
  const senzaFeedback = righe(sezione('### 6.3')).map(celle).filter((c) => c.length === 2 && /^\d+$/.test(c[1]));
  assert.ok(senzaFeedback.length > 0);
  for (const r of righe(sezione('### 4.1')).slice(1).map(celle)) {
    const nome = r[1].split(/\s*[(:]/)[0].toLowerCase();
    const compito = senzaFeedback.find((c) => c[0].toLowerCase().includes(nome));
    assert.ok(compito, `il ricorrente «${nome}» manca fra i compiti senza feedback del § 6.3`);
    assert.equal(Number(r[3]), Number(compito[1]), `urgenza di «${nome}»`);
  }
});
