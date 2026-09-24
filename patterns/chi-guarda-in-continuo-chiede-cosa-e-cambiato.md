# Chi guarda in continuo chiede cosa è cambiato, non tutto

**Regola.** Una superficie che si tiene aggiornata da sola non rilegge la
raccolta a ogni giro: chiede le sole righe scritte dopo l'ultimo giro, su un
campo che OGNI scrittura firma. Una domanda per data però non vede le
cancellazioni e non vede chi ha scritto senza firmare, quindi accanto ci sta
una riconciliazione completa RARA, dichiarata nel codice. E il giro è uno
solo, nel processo che le pagine hanno in comune.

## Il caso

La dashboard di gestione, tenuta aperta, chiedeva a Firestore i nomi di tutta
la collezione dei feedback ogni sessanta secondi. Con la lettura proiettata
(`select __name__`) la risposta era piccola — un centinaio di kilobyte — ma
Firestore le letture le conta per DOCUMENTO, non per campo: cinquecento
letture al minuto, con il database fermo e zero utenti. A settembre 2026 il
progetto ha pagato 6,4 milioni di letture, e questo era uno dei due cammini
che spiegavano il conto.

Il secondo giro di spreco stava attaccato al primo: appena UN feedback
risultava cambiato, la riunione dei voti rileggeva l'intera collezione delle
schede pubbliche — centinaia di documenti per ritrovarne uno. Aveva una
memoria breve da trenta secondi mentre il giro ne durava sessanta: non è mai
servita a niente, una volta.

## Cosa non ha funzionato

- **Abbassare il ritmo.** Un giro ogni cinque minuti costa un quinto e toglie
  alla dashboard la cosa per cui esiste: guardare le routine mentre lavorano.
  Il problema non era ogni quanto si chiede, era quanto si chiede.
- **Alzare la memoria breve delle schede.** Cura il sintomo (la rilettura
  ripetuta) e non la causa (si legge tutto per riunire tre campi a tre righe).
- **Ordinare per l'ora che scrive il database.** `updateTime` ce l'ha ogni
  documento e non si può sbagliare, ma Firestore non lo sa filtrare né
  ordinare in una query: non è un campo, è metadato. L'ora la deve scrivere
  chi scrive, ed è una responsabilità che va messa su TUTTI i cammini —
  l'app, gli script, il server. Uno che non la scrive rende le sue scritture
  invisibili, e non se ne accorge nessuno.

## Come si fa

1. **Un campo firmato da ogni scrittura.** Una funzione sola lo mette
   (`touchUpdatedAt` in `src/shared/feedback.js`), e i cammini che non passano
   da lì si contano a mano — una volta, per iscritto.
2. **La domanda incrementale.** Filtro `> ultimo visto`, ordinamento sul campo
   più il nome del documento come spareggio (Firestore lo mette in coda a ogni
   indice a campo singolo: nessun indice composto da dichiarare), tetto largo e
   cursore se lo supera. Un giro a vuoto costa una lettura. Il cursore si
   riporta indietro di qualche minuto rispetto all'ultimo giro: l'ora la
   scrivono macchine diverse, e un orologio scentrato non deve mangiare una
   scrittura.
3. **La riconciliazione rara.** Una cancellazione non compare in nessuna
   query, e nemmeno la scrittura di chi non ha firmato: ogni mezz'ora si
   chiedono le versioni di tutta la pagina e si fa il confronto di sempre.
   È la rete di sicurezza, non il giro.
4. **Un giro solo.** Vive nel main; le pagine si iscrivono e ascoltano. Dieci
   schede aperte sono dieci ascoltatori, non dieci conti da pagare. Nessun
   iscritto, nessun giro.
5. **Le letture accessorie vanno a colpo sicuro.** Per una manciata di id si
   chiedono quegli id (`batchGet`); dove serve l'elenco intero si chiedono i
   soli campi che chi riunisce guarda davvero.

## Riferimenti

- `src/shared/feedbackLive.js` — la decisione del giro, pura (`makeWatcher`).
- `src/shared/feedback.js` — `listChangedSince`, `touchUpdatedAt`,
  `getManyPublic`.
- `src/main/services/handlers/auth.js` — il giro unico e le iscrizioni.
- `tests/unit/feedbackGiroCambiati.test.mjs`,
  `tests/manage-giro-cambiati.spec.mjs` — le sentinelle: contano richieste e
  documenti, e asseriscono che il cambiamento si VEDE entro il giro.
