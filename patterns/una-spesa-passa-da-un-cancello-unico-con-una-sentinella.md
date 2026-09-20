# Una spesa passa da un cancello unico, con una sentinella che lo difende

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando una cosa costa — soldi, una finestra del sistema, una
chiave di qualcun altro — il controllo che la limita non si ripete a ogni
chiamante: si scrive un punto di passaggio obbligato, ci passano tutti, e un
test statico diventa rosso se qualcuno raggiunge la risorsa da un'altra parte.

**Il caso.** Il limite di spesa mensile di Filo viveva dentro i due cammini
principali della chat. Gli altri chiamanti dovevano ricordarsi di ripeterlo, e
quattro se l'erano dimenticato: il giudizio anti-phishing, il classificatore
del blocco geografico, il titolo di un feedback e la sintesi vocale chiamavano
il fornitore di modelli direttamente. Quelle chiamate non si fermavano mai e
non comparivano in nessun conto. Il banco di prova di sicurezza le ha trovate
da quattro porte diverse, in quattro momenti diversi: era un difetto solo.

**Perché la sentinella, e non solo il cancello.** Un cancello che si può
aggirare si aggira, e quasi sempre per distrazione: chi scrive una funzione
nuova copia il chiamante che ha sotto gli occhi. Finché il cancello è una
convenzione, ogni funzione nuova è un'altra occasione di dimenticarsene, e la
dimenticanza si scopre mesi dopo, da un controllo fatto a mano. La sentinella
sposta la scoperta a pochi millisecondi dopo la modifica, sulla macchina di chi
l'ha scritta.

**Come si fa una sentinella che regge.** Due parti, perché una sola lascia
sempre una strada aperta:

- **Statica** — cammina i sorgenti e cerca i nomi da cui si raggiunge davvero
  la risorsa, con un elenco corto di file ammessi (il cancello e il modulo che
  parla con l'esterno). Cerca i NOMI, non i chiamanti conosciuti: è l'unico
  modo di coprire anche quello che ancora non esiste. I commenti vanno tolti
  prima del confronto, altrimenti il cancello stesso non può spiegarsi.
- **Di comportamento** — per ogni via d'ingresso del cancello, col limite
  esaurito, il fornitore finto non deve essere stato toccato. Elencare le vie
  in una tabella e generare un test per ciascuna fa sì che una via nuova senza
  il suo controllo si veda subito.

**La prova che vale.** Prima di dichiararla finita, la sentinella statica si fa
girare sul codice com'era PRIMA: se non diventa rossa lì, sta guardando la cosa
sbagliata.

**Dove vive.** `src/main/services/modelGate.js` (il cancello: limite di spesa,
conteggio dei costi, registrazione di chi ha servito),
`tests/unit/modelGate.test.mjs` (le due sentinelle). Il gemello fisico è
`src/main/services/safebrowse/sandbox.js`: lì la risorsa non è il denaro ma la
finestra nascosta, e il cancello è un tetto di concorrenza con la sua coda e un
tempo massimo di vita.

**Il tempo massimo va reso non annullabile.** Nel caso delle finestre nascoste
il timer di attesa c'era già, ma un evento lo annullava (la pagina aveva finito
di caricare) e da lì in poi niente chiudeva più la finestra. Un tetto di vita
si scrive come un secondo timer che solo la chiusura vera può spegnere.

**Una memoria che frena si tiene sulla chiave giusta.** Ricordare un verdetto
per host completo non frena nulla: chi controlla un dominio fa comparire
sottodomini nuovi a volontà. La chiave è il dominio registrabile, e accanto
serve l'elenco delle chiamate già in volo — la memoria si riempie quando la
risposta arriva, e cinquanta richieste partite insieme la trovano tutte vuota.
