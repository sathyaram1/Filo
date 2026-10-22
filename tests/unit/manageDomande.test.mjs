// Sentinella della sezione Domande di Gestione (#1150): ogni tipo d'azione di SN_DOMANDE ha la sua etichetta, e la
// pagina passa tutti i tipi dallo stesso ramo (etichetta e bulk dai dati), senza rami suoi per nome di tipo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..', '..');
require(join(RADICE, 'src', 'shared', 'domande.js'));
const D = globalThis.SN_DOMANDE;

// Un valore valido per ogni forma di parametro: una forma nuova senza esempio fa cadere la prova, non la salta.
const ESEMPI = {
  feedbackId: 'fb902',
  valorePriorita: 3,
  chiave: Object.keys(D.CHIAVI_AUTOMAZIONE)[0],
  valoreBooleano: true,
};
const RIFERIMENTI = { fb902: { num: '#902', priorita: 1, stato: 'todo', motivo: '' } };

function esempio(tipo) {
  const a = { tipo };
  for (const [nome, forma] of Object.entries(D.TIPI[tipo].parametri)) {
    assert.ok(Object.prototype.hasOwnProperty.call(ESEMPI, forma), `manca un esempio per la forma «${forma}» (tipo ${tipo})`);
    a[nome] = ESEMPI[forma];
  }
  return a;
}

test('ogni tipo attivo ha un’etichetta dai soli dati; quelli non attivi nessun pulsante', () => {
  for (const tipo of Object.keys(D.TIPI)) {
    const etichetta = D.etichettaAzione(esempio(tipo), RIFERIMENTI);
    if (D.TIPI[tipo].attivo) {
      assert.equal(typeof etichetta, 'string', `il tipo «${tipo}» non ha etichetta`);
      assert.ok(etichetta.trim().length > 0, `il tipo «${tipo}» ha un’etichetta vuota`);
    } else {
      assert.equal(etichetta, null, `il tipo «${tipo}» non è attivo ma avrebbe un pulsante`);
    }
  }
});

test('un riferimento che il server non ha dato toglie il pulsante ai tipi che puntano a un feedback', () => {
  for (const tipo of Object.keys(D.TIPI)) {
    if (!D.TIPI[tipo].attivo || !('feedbackId' in D.TIPI[tipo].parametri)) continue;
    assert.equal(D.etichettaAzione(esempio(tipo), {}), null, tipo);
  }
});

test('la pagina non ha rami per nome di tipo: etichetta e «una per una» vengono da SN_DOMANDE', () => {
  const pagina = readFileSync(join(RADICE, 'src', 'pages', 'manage', 'manageDomande.js'), 'utf8');
  assert.match(pagina, /D\.etichettaAzione\(/);
  assert.match(pagina, /D\.TIPI\[[^\]]+\]\.bulk/);
  for (const tipo of Object.keys(D.TIPI)) {
    assert.doesNotMatch(pagina, new RegExp(`['"\`]${tipo}['"\`]`), `manageDomande.js nomina il tipo «${tipo}»: l'effetto e l'etichetta stanno nel modulo`);
  }
  const html = readFileSync(join(RADICE, 'src', 'pages', 'manage', 'manage.html'), 'utf8');
  const ordine = ['filo://shared/domande.js', 'filo://shared/manageReview.js', 'manageDomande.js', 'manage.js'].map((s) => html.indexOf(s));
  assert.ok(ordine.every((i) => i >= 0), 'manage.html deve caricare domande.js, manageReview.js, manageDomande.js e manage.js');
  assert.deepEqual(ordine.slice().sort((a, b) => a - b), ordine, 'domande.js va caricato prima di chi lo usa');
});

// Una domanda non fidata non rigira né nasconde testo sotto gli occhi dell'owner (#1502).
test('domanda non fidata: i caratteri invisibili si vedono; azioni e testi dell’owner restano com’erano', () => {
  require(join(RADICE, 'src', 'shared', 'mergeApprovals.js'));
  const vis = globalThis.SN_MERGE_APPROVALS.caratteriVisibili;
  const RLO = '‮';
  const azione = { tipo: 'riprendi', feedbackId: 'fb902' };
  const d = {
    id: 'q1', fiducia: 'non_fidato', titolo: `Scegli ${RLO}A`, contesto: `c${RLO}`, problema: 'p​', notePerAgenti: `n${RLO}`,
    opzioni: [{ testo: `Archivia${RLO}`, pro: `si${RLO}`, contro: 'no', azione }],
    consiglio: { opzione: 0, perche: `perché${RLO}` },
    conversazione: [{ autore: { tipo: 'owner' }, testo: `mio 👩‍💻${RLO}` }, { autore: { tipo: 'agente', ruolo: 'resolver' }, testo: `suo${RLO}` }],
  };
  const v = D.testiVisibili(d, vis);
  assert.equal(v.titolo, 'Scegli ⟨U+202E⟩A');
  assert.deepEqual([v.contesto, v.problema, v.notePerAgenti], ['c⟨U+202E⟩', 'p⟨U+200B⟩', 'n⟨U+202E⟩']);
  assert.deepEqual([v.opzioni[0].testo, v.opzioni[0].pro, v.opzioni[0].contro], ['Archivia⟨U+202E⟩', 'si⟨U+202E⟩', 'no']);
  assert.equal(v.opzioni[0].azione, azione, 'l’azione è la stessa, non una copia rifatta dal testo');
  assert.equal(v.consiglio.perche, 'perché⟨U+202E⟩');
  assert.equal(v.conversazione[0].testo, `mio 👩‍💻${RLO}`, 'quello che scrive l’owner non si tocca');
  assert.equal(v.conversazione[1].testo, 'suo⟨U+202E⟩');
  assert.equal(d.titolo, `Scegli ${RLO}A`, 'l’originale non cambia');

  // Fidata: i suoi testi restano, ma un turno non fidato dentro di lei si mostra.
  const f = D.testiVisibili(Object.assign({}, d, { fiducia: 'fidato', conversazione: [
    { autore: { tipo: 'agente', fiducia: 'fidato' }, testo: `pulito${RLO}` }, { autore: { tipo: 'agente' }, testo: `sporco${RLO}` },
  ] }), vis);
  assert.equal(f.titolo, d.titolo);
  assert.deepEqual(f.conversazione.map((t) => t.testo), [`pulito${RLO}`, 'sporco⟨U+202E⟩']);
  assert.equal(D.testiVisibili(d, null), d, 'senza la resa la domanda passa com’è');
});
