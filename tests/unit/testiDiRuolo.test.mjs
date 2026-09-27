// Unit test dei testi che i ruoli delle routine ricevono.
//
// PERCHÉ CONTA
//   Un ruolo consegnato con un buco dentro lavora senza una parte delle regole
//   e nessuno se ne accorge: il pezzo condiviso che manca già fermava, ma un
//   richiamo che lo strumento non sa espandere (annidato, o in coda a una riga)
//   passava intatto nel testo consegnato, al posto delle regole che doveva
//   portare. E una regola copiata in due testi di ruolo diventa due regole
//   diverse alla prima correzione: è il motivo per cui i pezzi condivisi
//   esistono.
//   I criteri con cui si giudica un lavoro stanno in un file solo e valgono
//   per chi lo fa e per chi lo verifica: il documento comune del progetto, che
//   guida i giri locali, deve rimandare lì invece di tenerne una copia più
//   corta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUOLI = join(ROOT, 'routines', 'roles');
const { espandiInclusioni } = await import('../../scripts/lib/role-text.mjs');
const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');

function cartellaConPezzi() {
  const d = cartellaTemporanea('testi-ruolo');
  writeFileSync(join(d, '_esterno.md'), 'inizio\n<!-- includi: _interno.md -->\nfine');
  writeFileSync(join(d, '_interno.md'), 'LE REGOLE CHE CONTANO');
  return d;
}

test('ogni ruolo riceve un testo intero, senza richiami rimasti dentro', () => {
  for (const ruolo of ['new-work', 'fixer', 'verifier', 'secaudit', 'prober', 'halt']) {
    const testo = readRoleInstructions(ruolo);
    assert.ok(testo.length > 400, `il ruolo ${ruolo} riceve un testo vuoto`);
    assert.ok(!/<!--\s*includi:/i.test(testo), `richiamo non espanso nel testo del ruolo ${ruolo}`);
  }
});

// I giri stretti (chiusura, riallineamento) cambiano il PERIMETRO, non il metro:
// livelli, formato della critica, registrazione e seguito sono gli stessi del
// giro pieno, parola per parola, o tre verificatori danno tre livelli diversi.
test('i tre ambiti della verifica condividono livelli, critica e registrazione', () => {
  const pieno = readRoleInstructions('verifier');
  const coda = (t) => t.slice(t.indexOf('## Il livello e la sede di ogni rilievo'));
  assert.ok(coda(pieno).includes('--record-verifier') && coda(pieno).includes('## Dopo la registrazione'));
  for (const scope of ['chiusura', 'riallineamento']) {
    const t = readRoleInstructions('verifier', { scope });
    assert.ok(t.length > 400 && !/<!--\s*includi:/i.test(t), `testo dell'ambito ${scope} vuoto o con un richiamo dentro`);
    assert.notEqual(t, pieno, `l'ambito ${scope} riceve il testo del giro pieno`);
    assert.equal(coda(t), coda(pieno), `l'ambito ${scope} ha un metro suo`);
    assert.match(t, /Perimetro di questo giro/, 'il testo dice dove trovare il perimetro');
    // La sede non abbassa il livello: un rilievo fuori dal perimetro è
    // esterno, col livello che ha (decisione dell'owner del 2026-09-22).
    assert.doesNotMatch(t, /massimo livello 1/, 'fuori perimetro non vale più «al massimo 1»');
    assert.match(t, /\[2e\]/, 'il testo spiega la sede esterna');
  }
  assert.equal(readRoleInstructions('verifier', { scope: 'inventato' }), pieno, 'un ambito sconosciuto vale pieno');
});

// Chi verifica dà i livelli con misura solo se non sa cosa ne seguirà: che poi
// correggerà lui, o quanti giri restano, non deve leggerlo da nessuna parte.
test('nessun testo di verifica anticipa il seguito del giro', () => {
  for (const scope of ['pieno', 'chiusura', 'riallineamento']) {
    const t = readRoleInstructions('verifier', { scope });
    for (const spia of [/correggerai/i, /sarai tu a corregg/i, /giri (che )?resta/i, /bilanci/i, /cap[012]\b/]) {
      assert.ok(!spia.test(t), `ambito ${scope}: il testo anticipa il seguito (${spia})`);
    }
  }
});

test('un pezzo condiviso dentro un altro viene espanso', () => {
  const d = cartellaConPezzi();
  try {
    assert.match(espandiInclusioni('<!-- includi: _esterno.md -->', d), /LE REGOLE CHE CONTANO/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('un richiamo che non si sa espandere ferma, invece di passare intatto', () => {
  const d = cartellaConPezzi();
  try {
    assert.throws(() => espandiInclusioni('coda della riga <!-- includi: _interno.md -->', d), /non espanso/);
    // Un anello fra due pezzi non gira all'infinito: si ferma come gli altri.
    writeFileSync(join(d, '_interno.md'), '<!-- includi: _esterno.md -->');
    assert.throws(() => espandiInclusioni('<!-- includi: _esterno.md -->', d), /non espanso/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('un pezzo condiviso che manca ferma', () => {
  const d = cartellaConPezzi();
  try {
    assert.throws(() => espandiInclusioni('<!-- includi: _assente.md -->', d), /manca il pezzo condiviso/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('nessuna regola scritta due volte in due testi di ruolo', () => {
  const doppie = [];
  const visto = new Map();
  for (const f of readdirSync(RUOLI).filter((n) => n.endsWith('.md'))) {
    const t = readFileSync(join(RUOLI, f), 'utf8').replace(/\r/g, '');
    for (const frase of t.split(/(?<=[.:;])\s+/)) {
      const n = frase.replace(/\s+/g, ' ').trim();
      if (n.length < 80 || n.startsWith('```')) continue;
      if (visto.has(n) && visto.get(n) !== f) doppie.push(`${visto.get(n)} + ${f}: ${n.slice(0, 70)}…`);
      else visto.set(n, f);
    }
  }
  assert.deepEqual(doppie, [], 'un pezzo condiviso si scrive una volta sola');
});

// La rete qui sopra vede solo le copie identiche. Una regola RISCRITTA con
// altre parole le passa sotto, e si è già ripresentata così. Qui si conta,
// dentro il testo che ogni ruolo riceve davvero, quante volte viene spiegata
// la stessa cosa: due spiegazioni sono due regole che divergeranno.
test('dentro un testo di ruolo la stessa regola non viene spiegata due volte', () => {
  const RUOLI_LAVORANTI = ['verifier', 'new-work', 'fixer', 'secaudit', 'prober'];
  // Ogni voce: il segno che riconosce la spiegazione, e cosa spiega.
  const UNA_VOLTA = [
    [/rombo/g, 'dove l\'owner apre un trade-off segnalato'],
    [/testo di ritorno/gi, 'il testo di ritorno non è un canale'],
  ];
  const doppie = [];
  for (const ruolo of RUOLI_LAVORANTI) {
    const t = readRoleInstructions(ruolo);
    for (const [segno, cosa] of UNA_VOLTA) {
      const n = (t.match(segno) || []).length;
      if (n > 1) doppie.push(`${ruolo}: ${cosa}, ${n} volte`);
    }
  }
  assert.deepEqual(doppie, [], 'la spiegazione sta nel pezzo condiviso, e il ruolo lo richiama');
});

test('i criteri di consegna sono gli stessi in locale e nelle routine', () => {
  const comune = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.ok(comune.includes('_criteri-verifica.md'),
    'il documento comune non rimanda ai criteri condivisi: chi consegna in locale userebbe un altro elenco');
  const primo = readRoleInstructions('new-work');
  const verifica = readRoleInstructions('verifier');
  const elenco = (t) => t.slice(t.indexOf('1. **La lamentela.**'), t.indexOf('non una pezza sulla porta vista.'));
  assert.ok(elenco(primo).length > 500);
  assert.equal(elenco(primo), elenco(verifica));
});

// Le prove dei rilievi messi da parte escono in un passo a parte, subito dopo la risposta alla critica: da lì una
// prova rossa tolta ferma sempre la consegna. Un testo che le rimanda al commit della correzione riapre la porta.
test('le prove dei rilievi messi da parte escono nella pulizia, non nel commit della correzione', async () => {
  const { verifierReplyText } = await import('../../scripts/dispatch.mjs');
  const { codaText } = await import('../../scripts/verify-local.mjs');
  const messo = [{ level: 1, sede: 'i', text: 'il bordo è freddo', priority: 1, num: '#9.1' }];
  const superfici = [
    ...readdirSync(RUOLI).filter((n) => n.endsWith('.md')).map((n) => [n, readFileSync(join(RUOLI, n), 'utf8')]),
    ['risposta del server (routine)', verifierReplyText({ outcome: 'fix', phase2: { findings: [{ level: 2, text: 'rotto' }], derived: messo } })],
    ['coda del giro locale', codaText({ findings: [{ level: 2, text: 'rotto' }], derived: messo, external: [], budgets: {}, branch: 'claude/x' })],
  ];
  for (const [nome, testo] of superfici) {
    const t = testo.replace(/\s+/g, ' ');
    assert.doesNotMatch(t, /stesso commit della correzione[^.]*messi da parte|le toglie chi corregge/i, `${nome}: rimanda la pulizia a chi corregge`);
    assert.doesNotMatch(t, /chi corregge [èe] (la stessa|lo stesso|chi ha (scritto|registrato|verificato))|correggerai tu/i, nome);
  }
  const [, risposta] = superfici.at(-2);
  const [, coda] = superfici.at(-1);
  assert.match(readRoleInstructions('verifier'), /--record-pulizia/, 'chi registra la critica sa che la pulizia tocca a lui');
  assert.match(risposta, /--record-pulizia/);
  assert.match(coda, /verify-local\.mjs pulizia/);
  for (const t of [risposta, coda]) assert.match(t.replace(/\s+/g, ' '), /ancora rossa non si toglie e non si cambia mai/);
});

// La pulizia riconosce la prova di un rilievo dal numero nel nome. Come si nomina lo spiega un testo solo, quello che
// ricevono chi verifica in cloud e in locale; le risposte ripetono il numero davanti a ogni rilievo.
test('come si nomina una prova del giro lo spiega un testo solo, e le risposte danno i numeri', async () => {
  const { verifierReplyText } = await import('../../scripts/dispatch.mjs');
  const { codaText, buildVerifierBrief } = await import('../../scripts/verify-local.mjs');
  const dove = readdirSync(RUOLI).filter((n) => n.endsWith('.md'))
    .filter((n) => /r<n>/.test(readFileSync(join(RUOLI, n), 'utf8')));
  assert.deepEqual(dove, ['_critica-e-livelli.md']);
  const ruolo = readRoleInstructions('verifier');
  assert.equal((ruolo.match(/`r<n>` è il numero del rilievo/g) || []).length, 1);
  const brief = buildVerifierBrief({ request: 'fai X', branch: 'claude/x', recipe: ruolo, history: [] });
  const primaDellaRicetta = brief.slice(0, brief.indexOf(ruolo));
  assert.doesNotMatch(primaDellaRicetta, /giro<k>-[^r]/, 'il compito locale non ha una sua forma del nome: rimanda alla ricetta');
  assert.match(primaDellaRicetta, /Come si chiamano lo dice la\s+recipe/);
  const messo = [{ level: 1, sede: 'i', text: 'il bordo è freddo', priority: 1, num: '#9.1', n: 2 }];
  const risposta = verifierReplyText({ outcome: 'fix', phase2: { findings: [{ level: 2, text: 'rotto', n: 1 }], derived: messo } });
  const coda = codaText({ findings: [{ level: 2, text: 'rotto', n: 1 }], derived: messo, external: [], budgets: {}, branch: 'claude/x' });
  for (const t of [risposta, coda]) {
    assert.match(t, /- r1 \[2i\] rotto/);
    assert.match(t, /- r2 \[1i\] il bordo è freddo/);
  }
});
