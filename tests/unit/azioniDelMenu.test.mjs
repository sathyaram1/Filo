// #2555 — il tasto destro è a icone e si costruisce da un elenco unico: ogni azione ha icona e nome, e in uno stesso menu
// due azioni non hanno la stessa icona né lo stesso tasto. Le voci scritte delle pagine di Filo si riconoscono dal verbo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['i18n', 'icons', 'disposizioneIcone']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const D = globalThis.SN_DISPOSIZIONE_ICONE;
const ICONS = globalThis.SN_ICONS;

test('ogni azione dell\'elenco ha un\'icona che esiste, un nome breve e un tasto singolo', () => {
  for (const [id, a] of Object.entries(D.VERBI)) {
    assert.equal(typeof ICONS[a.icona], 'function', `${id}: senza icona («${a.icona}» non c'è)`);
    assert.ok(typeof a.nome === 'string' && a.nome.trim(), `${id}: senza nome`);
    assert.ok(a.nome.trim().split(/\s+/).length <= 3, `${id}: il nome «${a.nome}» supera tre parole`);
    assert.match(a.tasto, /^[a-z0-9]$/, `${id}: il tasto «${a.tasto}» non è un tasto singolo`);
  }
  for (const [id, a] of Object.entries(D.AZIONI)) {
    assert.ok(a.nome && typeof ICONS[a.icona] === 'function', `${id}: senza icona o senza nome`);
    for (const o of a.oggetti) assert.ok(Object.prototype.hasOwnProperty.call(D.OGGETTI, o), `${id}: l'oggetto «${o}» non ha la sua frase`);
  }
});

test('in uno stesso menu due azioni diverse non hanno la stessa icona né lo stesso tasto', () => {
  for (const [ctx, c] of Object.entries(D.CONTESTI)) {
    const azioni = [...c.fila, ...c.altro];
    assert.equal(new Set(azioni).size, azioni.length, `${ctx}: un'azione compare due volte`);
    const icone = new Map();
    const tasti = new Map();
    for (const a of azioni) {
      const { icona, tasto } = D.VERBI[a];
      assert.ok(!icone.has(icona), `${ctx}: «${a}» e «${icone.get(icona)}» hanno la stessa icona «${icona}»`);
      assert.ok(!tasti.has(tasto), `${ctx}: «${a}» e «${tasti.get(tasto)}» hanno lo stesso tasto «${tasto}»`);
      icone.set(icona, a);
      tasti.set(tasto, a);
    }
  }
});

test('su un\'immagine dentro un collegamento: apri apre il collegamento, salva salva l\'immagine, copia copia l\'immagine', () => {
  const o = D.CONTESTI.immagine.oggetti;
  assert.deepEqual(o.openTab, ['link']);
  assert.equal(o.save[0], 'immagine');
  assert.equal(o.copy[0], 'immagine');
  assert.ok(o.copy.includes('link'), 'il collegamento si copia dalle varianti');
  for (const ctx of ['testo', 'campo', 'scrivibile']) assert.equal(D.CONTESTI[ctx].oggetti.copy[0], 'selezione', ctx);
});

test('dietro il «+» per scelta dell\'owner: dimensione reale, controlli del filmato, red-team', () => {
  for (const [ctx, c] of Object.entries(D.CONTESTI)) {
    for (const a of ['zoom', 'redteam']) assert.ok(c.altro.includes(a) && !c.fila.includes(a), `${ctx}: ${a}`);
  }
  assert.ok(D.CONTESTI.media.altro.includes('controls'));
});

test('un\'etichetta scritta si riconosce dal verbo, e il resto è l\'oggetto', () => {
  assert.deepEqual(D.verboDellEtichetta('Copia il messaggio'), { verbo: 'copy', oggetto: 'il messaggio' });
  assert.deepEqual(D.verboDellEtichetta('Annulla · aggiunta del tema'), { verbo: 'undo', oggetto: 'aggiunta del tema' });
  assert.deepEqual(D.verboDellEtichetta('Togli la conversazione dal filo'), { verbo: 'remove', oggetto: 'la conversazione dal filo' });
  assert.equal(D.verboDellEtichetta('Mostra nella cartella').verbo, 'folder');
  assert.equal(D.verboDellEtichetta('Tieni aperto il pannello').verbo, 'lock');
  assert.equal(D.verboDellEtichetta('Copiature'), null);
  assert.equal(D.verboDellEtichetta(''), null);
});

test('le voci che le pagine di Filo scrivono per i loro menu si riconoscono, e diventano un\'icona vera', () => {
  // Le etichette dei menu propri e delle voci date al tasto destro (dashboard, Mazzi, Editor, Scaricamenti, Gestione,
  // pannello di destra, correttore): un verbo nuovo va nell'elenco, o la voce avrebbe l'icona generica.
  const SCRITTE = ['Rispondi a questo passo', 'Copia il messaggio', 'Cita a questo passo', 'Nascondi la conversazione',
    'Togli la conversazione dal filo', 'Annulla · tema scuro', 'Rifai · tema scuro', 'Salta l\'accoglienza', 'Riprendi dopo',
    'Rimetti nella casella', 'Ferma', 'Srotola', 'Riavvolgi', 'Annulla invio', '✓ Invia da solo', 'Lascia testo',
    'Riapri la pagina', 'Mostra le pagine', 'Chiudi lo scambio', 'Vai a questo punto del filo', 'Collega', 'Scollega',
    'Dimentica la rete', 'Togli la chiave', 'Rimetti di serie', 'Spiega cosa fa', 'Cambia la scorciatoia di «Cerca»',
    'Tienila', 'Non tenerla', 'Cancella per sempre', 'Mostra nella cartella', 'Metti nel messaggio', 'Rinomina',
    'Esegui', 'Avvia', 'Sposta', 'Aggiungi sito…', 'Ripiega la chat', 'Riapri la chat', 'Rileggi dal server',
    'Tieni aperto il pannello', 'Sblocca il pannello', 'Regola il pannello…', 'Spiegami di più', 'Duplica', 'Esporta…',
    'Elimina…', 'Svuota la chat…', 'Rimuovi', 'Imposta come commander', 'Rimanda', 'Scarica', 'Non scaricare', 'Pausa',
    'Apri cartella', 'Rigenera titolo', 'Storico versioni', 'Cestino (2)', 'Regala crediti', 'Ricarica il conto…',
    'Sposta in…', 'Ignora', 'Aggiungi al dizionario', 'Apri la fonte', 'Invia feedback', 'Spegni Filo su questo sito'];
  const ignote = SCRITTE.filter((s) => !D.verboDellEtichetta(s));
  assert.deepEqual(ignote, [], 'voci senza un verbo dell\'elenco');
});
