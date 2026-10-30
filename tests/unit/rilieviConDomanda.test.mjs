// #1790 (#1640): ogni rilievo col «?» porta la sua domanda in JSON, con almeno due opzioni, dentro la critica: il server
// la adotta com'è e non compone più «Da decidere: …». Qui le regole condivise (verifierRound) e lo strumento (dispatch).

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'verifierRound.js'));
const V = globalThis.SN_VERIFIER_ROUND;
const { rilieviConDomanda, leggiDomandeDaFile } = await import('../../scripts/dispatch.mjs');

const domanda = (titolo) => ({
  titolo, priorita: 'quando_puoi',
  opzioni: [
    { testo: 'Caldo', pro: 'Come il resto.', contro: 'Un giro.', azione: { tipo: 'riprendi', feedbackId: 'f1' } },
    { testo: 'Tenere', pro: 'Niente lavoro.', contro: 'Stona.', azione: { tipo: 'archivia', feedbackId: 'f1' } },
  ],
  consiglio: { opzione: 0, perche: 'Filo è caldo.' },
});
const CRITICA = 'Provato tutto.\n[2i] Non salva.\n[1i?] Il bordo è grigio freddo: caldo come il resto?\n[1e?] Il menu delle schede è lento: un indice?';

test('ogni rilievo col «?» prende la sua domanda nell\'ordine della critica; gli altri restano senza', () => {
  const f = V.parseFindings(CRITICA).findings;
  const r = rilieviConDomanda(f, [domanda('Bordo caldo o freddo?'), domanda('Indice per il menu?')]);
  assert.equal(r.ok, true, r.errore);
  assert.deepEqual(r.findings.map((x) => x.domanda?.titolo || null), [null, 'Bordo caldo o freddo?', 'Indice per il menu?']);
  assert.equal(f[1].domanda, undefined, 'l\'elenco di partenza non si tocca');
  assert.deepEqual(V.domandeMancanti(r.findings), []);
});

test('un rilievo «?» senza domanda, o una domanda di troppo, fermano prima del server col numero del rilievo', () => {
  const f = V.parseFindings(CRITICA).findings;
  const manca = rilieviConDomanda(f, [domanda('Bordo caldo o freddo?')]);
  assert.equal(manca.ok, false);
  assert.match(manca.errore, /il rilievo 3 col «\?» non ha la sua domanda \(\[1e\?\] Il menu delle schede è lento: un indice\?\)/);
  assert.match(manca.errore, /con più rilievi un elenco, uno per rilievo nell'ordine della critica/);
  assert.match(rilieviConDomanda(f, []).errore, /i rilievi 2, 3 col «\?» non hanno la sua domanda/);
  const troppe = rilieviConDomanda(V.parseFindings('Provato.\n[2i] Non salva.').findings, [domanda('Altro?')]);
  assert.match(troppe.errore, /1 domanda per 0 rilievi col «\?»/);
  assert.equal(rilieviConDomanda(V.parseFindings('Provato tutto, funziona.').findings, []).ok, true, 'senza rilievi «?» niente da attaccare');
});

test('verifierRound: la domanda viaggia col rilievo strutturato, il campo mancante si nomina, il derivato prende il titolo', () => {
  const norm = V.normalizeFindings([
    { level: 1, sede: 'i', text: 'Bordo freddo', decision: true, domanda: domanda('Bordo caldo o freddo?') },
    { level: 2, sede: 'i', text: 'Non salva', decision: false, domanda: domanda('Non serve') },
    { level: 1, sede: 'e', text: 'Menu lento', decision: true },
    { level: 1, sede: 'i', text: 'Elenco storto', decision: true, domanda: [domanda('x')] },
  ]);
  assert.equal(norm[0].domanda.titolo, 'Bordo caldo o freddo?');
  assert.equal('domanda' in norm[1], false, 'un rilievo senza «?» non porta domande');
  assert.equal('domanda' in norm[3], false, 'un elenco non è una domanda');
  assert.deepEqual(V.domandeMancanti(norm), ['findings[2].domanda', 'findings[3].domanda']);
  const gruppi = V.derivedGroups(norm.slice(0, 1));
  assert.equal(gruppi[0].tipo, 'decisione');
  assert.equal(V.titoloDelDerivato(gruppi[0]), 'Bordo caldo o freddo?');
  assert.equal(V.titoloDelDerivato(V.derivedGroups([norm[1]])[0]), '', 'i rimasti hanno il loro titolo di sempre');
  // La decisione del giro porta la domanda con sé fino ai derivati.
  const d = V.decideRound({ findings: norm.slice(0, 1), caps: { cap3: 1, cap2: 1, cap1: 1, cap0: 0 }, counts: {} });
  assert.equal([...(d.derived || []), ...(d.external || [])][0]?.domanda?.titolo, 'Bordo caldo o freddo?');
});

test('--domanda della critica: una domanda o un elenco, ognuna controllata con la forma comune', async () => {
  const dir = cartellaTemporanea('filo-rilievi-domanda-');
  try {
    const uno = join(dir, 'uno.json');
    const due = join(dir, 'due.json');
    const sola = join(dir, 'sola.json');
    writeFileSync(uno, JSON.stringify(domanda('Bordo caldo o freddo?')), 'utf8');
    writeFileSync(due, JSON.stringify([domanda('Primo?'), domanda('Secondo?')]), 'utf8');
    writeFileSync(sola, JSON.stringify([domanda('Buona?'), { ...domanda('Una sola strada?'), opzioni: [domanda('x').opzioni[0]] }]), 'utf8');
    assert.deepEqual((await leggiDomandeDaFile(uno, { elenco: true })).domande.map((d) => d.titolo), ['Bordo caldo o freddo?']);
    assert.deepEqual((await leggiDomandeDaFile(due, { elenco: true })).domande.map((d) => d.titolo), ['Primo?', 'Secondo?']);
    const storta = await leggiDomandeDaFile(sola, { elenco: true });
    assert.equal(storta.ok, false);
    assert.match(storta.errore, /domanda 2 di .*sola\.json: opzioni_insufficienti \(campo «opzioni»\)/);
    assert.match((await leggiDomandeDaFile(due)).errore, /qui ne va una sola/, 'chi corregge manda una domanda per consegna');
    assert.match((await leggiDomandeDaFile(join(dir, 'manca.json'))).errore, /Non leggo/);
  } finally { togliCartella(dir); }
});

// La sentinella della spec: il ruolo di chi verifica descrive il JSON della domanda di un rilievo col «?».
test('chi verifica, in ogni giro, legge che un rilievo col «?» porta la sua domanda in JSON, e come si passa', async () => {
  const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');
  for (const scope of ['pieno', 'chiusura', 'riallineamento']) {
    const t = readRoleInstructions('verifier', { scope }).replace(/\s+/g, ' ');
    assert.match(t, /Ogni rilievo col `\?` porta la sua domanda\*\*, lo stesso JSON di `domanda\.mjs chiedi` con almeno due opzioni/, scope);
    assert.match(t, /con più rilievi `\?` ha un elenco JSON di domande, una per rilievo, nell'ordine in cui stanno nella critica/, scope);
    assert.match(t, /--record-verifier <id> "Provato: …/, scope);
    assert.doesNotMatch(t, /--segnala|la fa nascere dal server/, scope);
  }
});
