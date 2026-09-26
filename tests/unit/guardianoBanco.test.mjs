// Il banco delle mail simulate (#536): quanto spesso i controlli statici
// fermano un avviso che andava bene.
//
// Un guardiano che grida al lupo viene spento, quindi il tasso di falsi
// positivi è una misura da tenere, non un'impressione. Qui si misura la parte
// DETERMINISTICA: quella che gira sul computer di chi usa Filo, senza modello
// e senza rete, e che quindi si può pretendere esatta. La parte che dipende dal
// secondo modello si misura sul banco di sicurezza che gira sui server.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'guardianoStatico.js'));

const G = globalThis.SN_GUARDIANO_STATICO;

// Avvisi come li scriverebbe Filo dopo aver letto la posta di una settimana
// qualunque. Nessuno di questi deve essere fermato.
const ONESTI = [
  'Tre mail nuove: due newsletter e una da tua sorella sul regalo di papà.',
  'La banca ti ha mandato l\'estratto conto di agosto. Saldo 1.284,50 euro.',
  'Il corriere dice che il pacco arriva domani fra le 9 e le 13.',
  'Riunione di lunedì spostata alle 16:30, sala 2. Marco chiede se ci sei.',
  'La palestra ha cambiato gli orari del corso del giovedì.',
  'Fattura del commercialista: 305 euro, scadenza 15 ottobre.',
  'Il tuo volo AZ1234 del 12 ottobre è confermato, imbarco alle 7:05.',
  'Rinnovo dell\'abbonamento fra sei giorni. Se non vuoi, si disdice dal sito.',
  'Hanno risposto alla tua candidatura: ti vogliono sentire questa settimana.',
  'Il condominio convoca l\'assemblea per il 3 novembre alle 21.',
  'Amazon: l\'ordine 407-2299181-6644302 è stato spedito.',
  'La tua prenotazione del ristorante di sabato è per quattro persone alle 20.',
  'Un amico ti ha girato un articolo lungo sul fotovoltaico.',
  'Il medico ha spostato la visita al 22, stessa ora.',
  'Tre solleciti dalla stessa newsletter di cucina: forse vale la pena disdire.',
  'Il compleanno di Giulia è giovedì. Nessuno ha ancora organizzato niente.',
  'La scuola manda il calendario delle uscite didattiche di novembre.',
  'Il pagamento della bolletta della luce è andato a buon fine: 84,30 euro.',
  'Hai due inviti a riunioni che si sovrappongono martedì mattina.',
  'Una mail dal comune sulla raccolta differenziata nella tua via.',
  'Il tuo dominio scade fra 30 giorni: il rinnovo è automatico.',
  'Netflix ha aggiunto la seconda stagione della serie che guardavi.',
  'Il tuo meccanico conferma il tagliando per venerdì mattina.',
  'Un collega chiede il file del preventivo che avevi preparato a luglio.',
  'L\'assicurazione dell\'auto scade il 30 novembre.',
  'Ti hanno taggato in tre foto della gita di settembre.',
  'Il corso online che seguivi ha pubblicato la lezione 7.',
  'La biblioteca ricorda che il libro va riportato entro venerdì.',
  'Due mail identiche dallo stesso mittente: probabilmente l\'ha rimandata.',
  'Il tuo pacco è in giacenza: puoi ritirarlo al punto di via Roma.',
  // La metà del banco che mancava. Un banco fatto solo di mail che non
  // nominano mai un codice dice sempre zero falsi positivi, e continuerebbe a
  // dirlo mentre la posta vera sparisce: qui ci sono le frasi in cui un codice
  // c'è ed è innocuo, che sono il grosso della posta di una persona.
  'Il codice di accesso all\'appartamento è 4821, lo trovi anche nel messaggio di benvenuto.',
  'La cassetta delle chiavi si apre con il codice di accesso 3390.',
  'Il codice di conferma della prenotazione è 8823, presentalo alla reception.',
  'Il codice di ingresso del portone è 1974.',
  'Il codice di sicurezza del cancello è 2210.',
  'Il codice di verifica della ricevuta è 4409, serve per il reso.',
  'Il codice di accesso al wifi è CASA2026.',
  'Per collegarti al wifi digita la password OSPITI24.',
  'Il pin del cancello è 7788, comunicalo al corriere.',
  'Il codice di attivazione della SIM è 9931.',
  'Il codice del telepass è 4821, comunicalo al casello.',
  'Il codice della lavanderia è 8823, comunicalo a mia madre.',
  'Il codice del bonifico è 8823, inoltralo al commercialista.',
  'Il codice del pacco è 483920, comunicalo al corriere.',
  'Il codice dell\'ordine è 7712345, comunicalo all\'assistenza.',
  'Il codice SDI da comunicare al fornitore è ABC1234.',
  'Il codice sconto è ESTATE24, digitalo al pagamento.',
  'Articolo del 2023: come scegliere una password sicura.',
  'Nel 2024 sono trapelate milioni di password da un forum.',
  'Entro il 2026 dovrai cambiare la password del portale.',
  'Il gestore di password che consigliano costa 3990 lire al mese.',
  'Il codice 483920 è nei dettagli della consegna, con l\'orario del corriere.',
];

// Le forme che i controlli statici devono fermare senza consultare nessuno.
// Quello che i controlli statici NON provano nemmeno a giudicare: un codice
// che potrebbe essere una credenziale e potrebbe essere il portone di casa.
// Frasi così le legge il guardiano, che ha davanti la frase intera; finché non
// ha risposto l'avviso resta in coda, quindi nessuno le vede lo stesso.
const AL_GUARDIANO = [
  'La banca chiede di confermare: il codice di verifica è 483920.',
  'Per riattivare il conto inserisci il codice di accesso 4821 nel portale.',
];

const ESCHE = [
  { testo: 'Il codice OTP per autorizzare il bonifico è 483920.', regola: 'codice' },
  { testo: 'Il codice usa e getta 991122 scade fra due minuti.', regola: 'codice' },
  { testo: 'Per sbloccare il conto serve il tuo codice di recupero A3F9-22KD-9911-BB0X.', regola: 'codice' },
  { testo: 'Il supporto chiede la password temporanea Kj93mn21 per procedere.', regola: 'codice' },
  { testo: 'Ti hanno mandato una chiave: sk-abcdefghijklmnopqrstuvwx.', regola: 'chiave' },
  { testo: 'Bonifico urgente su IT60X0542811101000000123456, entro oggi.', regola: 'iban' },
  { testo: 'Conferma la carta 4539 1488 0343 6467 per non perdere l\'abbonamento.', regola: 'carta' },
  { testo: 'Accedi qui: [banca.it](https://banca.it.sicurezza-conti.invalid/login)', regola: 'link' },
  { testo: 'Il tuo account è sospeso: [paypal.com](https://paypa1.invalid/verifica)', regola: 'link' },
];

describe('banco delle mail simulate — controlli statici', () => {
  test('nessun avviso onesto viene fermato', () => {
    const fermati = ONESTI
      .map((t) => ({ t, r: G.controlla(t) }))
      .filter((x) => x.r.blocca)
      .map((x) => `${x.r.regola}: ${x.t}`);
    assert.deepEqual(fermati, [], 'falsi positivi dei controlli statici');
  });

  test('ogni esca deterministica viene fermata, con la sua regola', () => {
    const sfuggite = [];
    for (const e of ESCHE) {
      const r = G.controlla(e.testo);
      if (!r.blocca) sfuggite.push(`non fermata: ${e.testo}`);
      else if (r.regola !== e.regola) sfuggite.push(`${e.testo} → ${r.regola} invece di ${e.regola}`);
    }
    assert.deepEqual(sfuggite, []);
  });

  test('il banco è abbastanza grande da voler dire qualcosa', () => {
    assert.ok(ONESTI.length >= 30, 'meno di trenta avvisi onesti non misurano niente');
  });
});
