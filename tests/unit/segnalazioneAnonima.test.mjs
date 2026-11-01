// #1669 — chi è l'utente non entra nelle segnalazioni scritte da Filo: la regola nel prompt e la rete prima del riquadro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/actionLevels.js');
require('../../src/shared/actionTools.js');
require('../../src/shared/segnalazioneAnonima.js');
require('../../src/shared/autoFeedback.js');
const C = globalThis.SN_CONST;
const A = globalThis.SN_SEGNALAZIONE_ANONIMA;
const AF = globalThis.SN_AUTO_FEEDBACK;

const ID = { nomi: ['Giulia Ferraris'], email: ['giulia.ferraris@example.com'] };

test('la regola sta nel prompt della chat, in quello dell\'Aiuto e nello strumento', () => {
  const regola = C.SEGNALAZIONE_SENZA_PERSONA;
  assert.match(regola, /terza persona/);
  assert.match(regola, /«utente»/);
  for (const parola of ['nome', 'email', 'città', 'persone', 'dispositivi', 'percorsi', 'note']) assert.ok(regola.includes(parola), parola);
  assert.ok(C.PROMPTS.filoChatStatic().includes(regola), 'chat');
  assert.ok(C.PROMPTS.helpStatic().includes(regola), 'Aiuto sopra una pagina');
  const strumento = globalThis.SN_ACTION_TOOLS.definitions().find((d) => d.function.name === 'INVIA_FEEDBACK');
  assert.ok(strumento.function.description.includes(regola), 'descrizione dello strumento');
  assert.match(C.PROMPTS.filoChatStatic(), /nome dell'utente con parsimonia, e mai in una segnalazione/);
});

test('il caso di #1664: «L\'utente (nome) sta cercando di…» diventa «L\'utente sta cercando di…»', () => {
  assert.equal(A.ripulisci('L\'utente (Giulia) sta cercando di aprire un PDF.', ID), 'L\'utente sta cercando di aprire un PDF.');
  assert.equal(A.ripulisci('L’utente, Giulia Ferraris, vuole il tema scuro.', ID), 'L’utente vuole il tema scuro.');
});

test('nome intero e pezzi del nome diventano «l\'utente», con preposizioni e maiuscole a posto', () => {
  assert.equal(
    A.ripulisci('Giulia vorrebbe aprire i PDF. Ho detto a Giulia di riprovare; il profilo di Giulia Ferraris non si carica, e Ferraris lo ha notato.', ID),
    'L\'utente vorrebbe aprire i PDF. Ho detto all\'utente di riprovare; il profilo dell\'utente non si carica, e l\'utente lo ha notato.',
  );
  assert.equal(A.ripulisci('GIULIA FERRARIS non riesce ad accedere', ID), 'L\'utente non riesce ad accedere');
});

test('un pezzo del nome scritto minuscolo è una parola qualunque e resta', () => {
  const id = { nomi: ['Rosa Bianchi'], email: [] };
  assert.equal(A.ripulisci('Il bottone rosa non si vede. Rosa lo ha chiesto.', id), 'Il bottone rosa non si vede. L\'utente lo ha chiesto.');
});

test('chi si presenta col nome in minuscolo lo perde; «sono» in mezzo alla frase resta un verbo', () => {
  const id = { nomi: ['Luca Moretti'], email: [] };
  assert.equal(A.ripulisci('ciao sono luca, quanti crediti ho?', id), 'ciao sono l\'utente, quanti crediti ho?');
  assert.equal(A.ripulisci('mi chiamo luca e non vedo i crediti', id), 'mi chiamo l\'utente e non vedo i crediti');
  assert.equal(A.ripulisci('Ciao, sono luca! Il tema non va.', id), 'Ciao, sono l\'utente! Il tema non va.');
  assert.equal(A.ripulisci('L\'utente ha scritto «sono luca, aiuto»', id), 'L\'utente ha scritto «sono l\'utente, aiuto»');
  const rosa = { nomi: ['Rosa Bianchi'], email: [] };
  assert.equal(A.ripulisci('le icone sono rosa', rosa), 'le icone sono rosa');
  assert.equal(A.ripulisci('ciao sono rosa, le icone sono rosa', rosa), 'ciao sono l\'utente, le icone sono rosa');
});

test('un nome corto o di una parola sola non mangia le parole comuni', () => {
  assert.equal(A.ripulisci('Al momento il tema va al contrario.', { nomi: ['Al'], email: [] }), 'Al momento il tema va al contrario.');
  assert.equal(A.ripulisci('La luce resta accesa, Luce lo ha notato.', { nomi: ['Luce'], email: [] }), 'La luce resta accesa, l\'utente lo ha notato.');
});

test('dentro un percorso il nome esce anche in minuscolo, e la cartella diventa «utente»', () => {
  assert.equal(A.ripulisci('Il file C:\\Users\\giulia\\Documents\\fattura.pdf non si apre.', ID), 'Il file C:\\Users\\utente\\Documents\\fattura.pdf non si apre.');
  assert.equal(A.ripulisci('Non trova /Users/Giulia/Desktop/foto.png', ID), 'Non trova /Users/utente/Desktop/foto.png');
  assert.equal(A.ripulisci('La cartella /home/ferraris/progetti resta vuota.', ID), 'La cartella /home/utente/progetti resta vuota.');
  assert.equal(A.ripulisci('Il bottone rosa non si vede in /tmp/x', { nomi: ['Rosa Bianchi'], email: [] }), 'Il bottone rosa non si vede in /tmp/x');
});

test('un cognome col trattino esce intero e a metà', () => {
  const id = { nomi: ['José Núñez-García'], email: [] };
  assert.equal(A.ripulisci('Núñez dice che il tema scuro non si applica.', id), 'L\'utente dice che il tema scuro non si applica.');
  assert.equal(A.ripulisci('Ho scritto a Núñez-García e a García.', id), 'Ho scritto all\'utente e all\'utente.');
});

test('l\'email dell\'account diventa «l\'utente», le altre si tolgono', () => {
  const t = A.ripulisci('Scrivere a Giulia.Ferraris@example.com o a marco@posta.it per i dettagli.', ID);
  assert.equal(t, 'Scrivere all\'utente o a [email] per i dettagli.');
  assert.ok(!/@/.test(A.ripulisci('contatto: chiunque.sia@dominio.co.uk', { nomi: [], email: [] })));
});

test('Filo non è mai un nome, e la rete senza identità lascia il testo com\'è', () => {
  assert.equal(A.ripulisci('Filo non apre i PDF', { nomi: ['Filo'], email: [] }), 'Filo non apre i PDF');
  assert.equal(A.ripulisci('Filo non apre i PDF', null), 'Filo non apre i PDF');
  assert.equal(A.ripulisci('', ID), '');
});

test('ripulire due volte dà lo stesso testo: richiesta e conferma firmano uguale', () => {
  const una = A.ripulisci('L\'utente (Giulia) ha scritto da giulia.ferraris@example.com a Giulia Ferraris.', ID);
  assert.equal(A.ripulisci(una, ID), una);
});

test('il nome che la memoria ricorda: con l\'utente come soggetto, non quello del cane', () => {
  const ricordo = [
    '- L\'utente si chiama Luca Moretti e lavora come grafico.',
    'Il suo cane si chiama Rex.',
    'Preferisce essere chiamato Max.',
    'Nome: Anna',
    '- Si chiama Paolo.',
    'L\'utente vuole che l\'assistente si chiami Filo.',
  ].join('\n');
  const nomi = A.nomiDalRicordo(ricordo);
  assert.deepEqual(nomi.sort(), ['Anna', 'Luca Moretti', 'Max', 'Paolo']);
  assert.equal(A.ripulisci('Luca non riesce a salvare.', { nomi, email: [] }), 'L\'utente non riesce a salvare.');
});

test('la proposta automatica passa dalla stessa rete prima di citare il messaggio', () => {
  const p = AF.composeProposal({ kind: 'capability-gap' }, {
    userMessage: 'Sono Giulia Ferraris, mandami il riepilogo a giulia.ferraris@example.com ogni sera',
    textReply: 'Non posso mandarti email da sola, Giulia. Puoi farlo dalla posta.',
    identita: ID,
  });
  assert.ok(!/Giulia|Ferraris|@/.test(p.testo), p.testo);
  assert.ok(!/Giulia|Ferraris|@/.test(p.titolo), p.titolo);
  assert.match(p.testo, /Sono l'utente, mandami il riepilogo all'utente ogni sera/);
  assert.match(p.titolo, /^Sono l'utente/);
});

test('l\'informativa sulla privacy lo dice, e non promette indirizzo e titolo della pagina dalla chat', () => {
  const md = readFileSync(new URL('../../transparency/privacy.md', import.meta.url), 'utf8');
  const sezione = md.slice(md.indexOf('## I feedback'), md.indexOf('## I crediti'));
  assert.match(sezione, /accetti in chat porta meno cose/);
  assert.match(sezione, /Niente indirizzo o titolo della pagina/);
  assert.match(sezione, /senza il tuo nome né altri tuoi dati/);
  assert.ok(!/accettando quello che Filo ti propone in chat, parte un documento con il testo, l'indirizzo/.test(sezione));
});
