// #1790 (#1640): ogni rilievo col «?» porta la sua domanda in JSON, con almeno due opzioni, dentro la critica: il server
// la adotta com'è e non compone più «Da decidere: …», e senza «blocca» (#1202.2). Qui le regole condivise (verifierRound)
// e lo strumento (dispatch).

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

test('«blocca» su una domanda di rilievo si rifiuta col numero: se il lavoro si ferma lo decidono livello e segno (#1202.2)', async () => {
  const f = V.parseFindings('Provato.\n[3i?] A o B? Consiglio A.\n[1i?] Bordo caldo?\n[2i?!] Formato salvato: vecchio o nuovo?').findings;
  const dir = cartellaTemporanea('filo-rilievi-blocca-');
  try {
    const file = join(dir, 'domande.json');
    writeFileSync(file, JSON.stringify([{ ...domanda('A o B?'), blocca: false }, domanda('Bordo caldo?'), { ...domanda('Formato?'), blocca: false }]));
    const lette = await leggiDomandeDaFile(file, { elenco: true });
    assert.equal(lette.ok, true, lette.errore);
    const r = rilieviConDomanda(f, lette.domande);
    assert.equal(r.ok, false, 'un [3i?] che non blocca andava a correggere sul server, e la pulizia credeva che si fermasse');
    assert.match(r.errore, /la domanda dei rilievi 1, 3 porta «blocca»/);
    assert.match(r.errore, /Non ho registrato niente/);
    // Il testo della regola è uno, quello che dice anche il server: niente copie a mano che divergono.
    assert.ok(r.errore.startsWith(V.bloccaSuUnRilievo('la domanda dei rilievi 1, 3')), r.errore);
    const vera = rilieviConDomanda(f, [{ ...domanda('A o B?'), blocca: true }, domanda('Bordo caldo?'), domanda('Formato?')]);
    assert.match(vera.errore, /la domanda del rilievo 1 porta «blocca»/, 'anche true: il segno basta');
    const senza = rilieviConDomanda(f, [domanda('A o B?'), domanda('Bordo caldo?'), domanda('Formato?')]);
    assert.equal(senza.ok, true, senza.errore);
    assert.ok(senza.findings.every((x) => !x.domanda || !('blocca' in x.domanda)));
  } finally {
    togliCartella(dir);
  }
});

test('il ruolo di chi verifica non spiega «blocca» come una scelta sua senza dire che sul rilievo non si scrive', async () => {
  const { readFileSync } = await import('node:fs');
  const { espandiInclusioni } = await import('../../scripts/lib/role-text.mjs');
  const dir = join(ROOT, 'routines', 'roles');
  for (const nome of ['verifier.md', 'verifier-chiusura.md', 'verifier-riallineamento.md']) {
    // Come lo consegna dispatch: il ruolo e, in coda, il contratto comune dei worker.
    const ruolo = espandiInclusioni(`${readFileSync(join(dir, nome), 'utf8')}\n\n${readFileSync(join(dir, '_contratto-worker.md'), 'utf8')}`, dir);
    // Ogni paragrafo che insegna a scegliere «blocca» porta con sé l'eccezione del rilievo.
    const paragrafi = ruolo.split(/\n\s*\n/).filter((p) => /senza `blocca` blocca|lo decidi tu quando un'opzione lo riprende/.test(p));
    assert.ok(paragrafi.length >= 2, `${nome}: le due regole generali su «blocca» ci sono`);
    for (const p of paragrafi) assert.match(p.replace(/\s+/g, ' '), /rilievo[^.]*`blocca` non|`blocca` non si scrive/, `${nome}: «${p.slice(0, 80)}…»`);
  }
});
