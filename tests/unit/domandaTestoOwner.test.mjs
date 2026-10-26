// #1455: il testo di una domanda per l'owner non nomina file di codice né usa lineette, e un pro vuoto non passa.
// Lo controlla la validazione comune (script e server); le note per gli agenti restano libere. I ruoli che scrivono
// domande ricevono la regola una volta sola, dal pezzo condiviso.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUOLI = join(ROOT, 'routines', 'roles');
require(join(ROOT, 'src', 'shared', 'domande.js'));
const D = globalThis.SN_DOMANDE;
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');
const { leggiDomandaJson } = await import('../../scripts/domanda.mjs');

const SEZIONE = "## Una domanda per l'owner si scrive per lui";
const piatto = (s) => s.replace(/\s+/g, ' ');

function pulita(extra) {
  return {
    titolo: 'Guasto: il clone del server viene respinto',
    priorita: 'bloccante',
    gruppo: 'guasto: strumento dispatch.mjs',
    contesto: 'Clonavo il server per il lavoro: GitHub ha risposto che il permesso manca. Il sito filo.red e claude.ai rispondono, anche https://bun.sh/docs. Serve Node.js 22 e un file .json qualunque, versione 1.2.3.',
    problema: 'Ferma il lavoro sul server. Ti chiedo di controllare il permesso del repo.',
    opzioni: [
      { testo: 'Riprendere quando il guasto è riparato', pro: 'nessun lavoro perso', contro: 'aspetta te', azione: { tipo: 'riprendi', feedbackId: 'f1' } },
      { testo: 'Archiviare il feedback', pro: 'la coda si libera', contro: 'il lavoro si perde', azione: { tipo: 'archivia', feedbackId: 'f1' } },
    ],
    consiglio: { opzione: 0, perche: 'il guasto è fuori dal codice' },
    notePerAgenti: 'scripts/dispatch.mjs — `node scripts/routine-channel.mjs git-server clone` ha detto «fatal: 403» (vedi SPEC-DOMANDE.md).',
    ...extra,
  };
}

test('una domanda pulita passa: siti, prodotti, estensioni da sole e numeri; note per gli agenti e gruppo restano liberi', () => {
  const v = D.validaDomanda(pulita(), { conOrigine: false });
  assert.ok(v.ok, `${v.errore}: ${v.dettaglio}`);
  assert.match(v.domanda.notePerAgenti, /dispatch\.mjs — /);
  assert.ok(leggiDomandaJson(JSON.stringify(pulita()), { conOrigine: false }).domanda);
});

test('un nome di file di codice in un campo per l’owner si rifiuta col campo e il nome, e dice dove va', () => {
  const casi = [
    ['contesto', { contesto: 'Il guasto sta in scripts/dispatch.mjs e in `SPEC-DOMANDE.md`.' }, ['dispatch.mjs', 'SPEC-DOMANDE.md']],
    ['titolo', { titolo: 'Guasto: package.json storto' }, ['package.json']],
    ['problema', { problema: 'Vedi https://github.com/o/r/blob/main/src/shared/domande.js#L12.' }, ['domande.js']],
    ['opzioni[1].testo', { opzioni: [pulita().opzioni[0], { ...pulita().opzioni[1], testo: 'Togliere «index.html»' }] }, ['index.html']],
    ['opzioni[0].pro', { opzioni: [{ ...pulita().opzioni[0], pro: 'il file style.css resta' }, pulita().opzioni[1]] }, ['style.css']],
    ['opzioni[0].contro', { opzioni: [{ ...pulita().opzioni[0], contro: 'tocca run.sh, deploy.yml e dell\'app.ts' }, pulita().opzioni[1]] }, ['run.sh', 'deploy.yml', 'app.ts']],
    ['consiglio.perche', { consiglio: { opzione: 0, perche: 'domanda.mjs:42 lo dice' } }, ['domanda.mjs']],
  ];
  for (const [campo, extra, nomi] of casi) {
    const r = D.validaDomanda(pulita(extra), { conOrigine: false });
    assert.equal(r.ok, false, campo);
    assert.equal(r.errore, 'testo_non_per_owner', campo);
    assert.equal(r.campo, campo);
    assert.ok(r.dettaglio.includes(`«${campo}» nomina ${nomi.join(', ')}`), `${campo}: ${r.dettaglio}`);
    assert.match(r.dettaglio, /notePerAgenti/, 'il rifiuto dice dove vanno i dettagli');
  }
});

test('una lineetta lunga, anche nella forma breve, si rifiuta col campo e il numero', () => {
  const r = D.validaDomanda(pulita({ contesto: 'Clonavo il server — e poi – niente.' }), { conOrigine: false });
  assert.equal(r.errore, 'testo_non_per_owner');
  assert.equal(r.campo, 'contesto');
  assert.match(r.dettaglio, /«contesto» ha 2 lineette/);
  assert.match(r.dettaglio, /un punto o una virgola/);
  const una = D.validaDomanda(pulita({ problema: 'Ferma il lavoro — tutto.' }), { conOrigine: false });
  assert.equal(una.campo, 'problema');
  assert.match(una.dettaglio, /«problema» ha una lineetta/);
});

test('un pro vuoto come «Nessuno» si rifiuta; un pro assente resta ammesso', () => {
  for (const vuoto of ['Nessuno', 'nessuno.', ' niente ', 'N/A', '-']) {
    const r = D.validaDomanda(pulita({ opzioni: [pulita().opzioni[0], { ...pulita().opzioni[1], pro: vuoto }] }), { conOrigine: false });
    assert.equal(r.errore, 'testo_non_per_owner', vuoto);
    assert.equal(r.campo, 'opzioni[1].pro');
    assert.match(r.dettaglio, /senza un pro vero si toglie/);
  }
  const { pro: _p, ...senzaPro } = pulita().opzioni[1];
  assert.ok(D.validaDomanda(pulita({ opzioni: [pulita().opzioni[0], senzaPro] }), { conOrigine: false }).ok);
  assert.ok(D.validaDomanda(pulita({ opzioni: [{ ...pulita().opzioni[0], contro: 'Nessuno' }, pulita().opzioni[1]] }), { conOrigine: false }).ok,
    'il contro non è il pro');
});

test('più campi sporchi: un rifiuto solo li elenca tutti, così si correggono insieme', () => {
  const r = D.validaDomanda(pulita({ titolo: 'Guasto — clone', contesto: 'Vedi dispatch.mjs.' }), { conOrigine: false });
  assert.equal(r.campo, 'titolo');
  assert.deepEqual(r.campi, ['titolo', 'contesto']);
  assert.match(r.dettaglio, /«titolo» ha una lineetta.*«contesto» nomina dispatch\.mjs/);
  const tanti = Array.from({ length: 9 }, (_, i) => `f${i}.js`).join(' ');
  assert.match(D.validaDomanda(pulita({ contesto: tanti }), { conOrigine: false }).dettaglio, /f5\.js e altri 3/, 'oltre i primi si dice quanti');
});

test('ogni ruolo che lavora riceve la regola una volta sola, dal pezzo condiviso, e chi scrive domande la richiama', () => {
  const ruoli = [['new-work', {}], ['fixer', {}], ['fixer', { caso: 'ripresa' }], ['fixer', { caso: 'riallineamento' }],
    ['verifier', { scope: 'pieno' }], ['verifier', { scope: 'chiusura' }], ['verifier', { scope: 'riallineamento' }], ['secaudit', {}], ['risposta', {}]];
  for (const [ruolo, opts] of ruoli) {
    const t = readRoleInstructions(ruolo, opts);
    assert.equal(t.split(SEZIONE).length - 1, 1, `${ruolo} ${JSON.stringify(opts)}: la regola una volta sola`);
    const regola = piatto(t.slice(t.indexOf(SEZIONE)));
    assert.match(regola, /unslop\/SKILL\.md` a titolo, contesto, problema, opzioni \(testo, pro, contro\) e consiglio/);
    assert.match(regola, /non ci siano nomi di file, funzioni, rami, commit o comandi/);
    assert.match(regola, /I dettagli tecnici e i messaggi esatti vanno in `notePerAgenti`/);
  }
  const dove = readdirSync(RUOLI).filter((f) => f.endsWith('.md') && /unslop/.test(readFileSync(join(RUOLI, f), 'utf8')));
  assert.deepEqual(dove, ['_domanda-per-owner.md'], 'la regola vive in un pezzo solo');
  for (const f of ['_guasto-con-domanda.md', '_guasto-in-attesa.md']) {
    assert.ok(piatto(readFileSync(join(RUOLI, f), 'utf8')).includes('«Una domanda per l\'owner si scrive per lui»'), `${f} la richiama`);
  }
  assert.match(readFileSync(join(RUOLI, '_guasto-con-domanda.md'), 'utf8'), /<!-- includi: _domanda-per-owner\.md -->/);
});

test('il modello della domanda di guasto: errore in parole, cosa fa l’owner, strade che sbloccano, la riparazione a parte, il messaggio nelle note', () => {
  const pezzo = readFileSync(join(RUOLI, '_guasto-in-attesa.md'), 'utf8');
  const d = JSON.parse(/```json\n([\s\S]*?)\n\s*```/.exec(pezzo)[1]);
  assert.match(d.contesto, /cosa vuol dire l'errore, in parole tue/);
  assert.doesNotMatch(d.contesto, /messaggio|esatto/i, 'il messaggio esatto non sta nel testo per l’owner');
  assert.match(d.problema, /<cosa deve fare l'owner>/);
  // In una fermata ogni strada sblocca il lavoro (#1577): la riparazione da un agente va in una domanda a parte.
  assert.ok(d.opzioni.every((o) => ['riprendi', 'archivia'].includes(o.azione.tipo)), 'ogni strada riprende o archivia');
  assert.match(piatto(pezzo), /Una riparazione che un agente col repo può fare la proponi in una domanda a parte \(`domanda\.mjs chiedi`, azione `compito`, senza `blocca`\)/);
  assert.ok(d.opzioni.every((o) => !/^nessuno$/i.test(o.pro)), 'nessun «Nessuno» nel modello');
  assert.match(d.notePerAgenti, /il messaggio esatto/);
  assert.match(piatto(pezzo), /tieni quelle che per questo guasto hanno un pro vero/);
});
