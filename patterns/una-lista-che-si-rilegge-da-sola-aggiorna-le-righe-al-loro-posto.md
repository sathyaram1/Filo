# Una lista che si rilegge da sola aggiorna le righe al loro posto

[← Tutti i pattern](../PATTERNS.md)

Una pagina che rilegge i suoi dati quando arriva un avviso dal main (crediti
cambiati, impostazioni salvate altrove, un elenco aggiornato dal server) non
sceglie il momento: l'avviso arriva mentre l'utente sta usando proprio quella
lista. Se la rilettura svuota il contenitore e lo ridisegna, sotto le sue mani
spariscono il menu del tasto destro aperto su una riga, la scheda espansa che
stava leggendo, il fuoco da tastiera (e con lui Invio ed Esc), un pulsante che
diceva «Copiato». Nessun errore: la cosa si chiude da sola, e l'utente pensa
di aver sbagliato lui.

**La regola.** Ogni riga ha una chiave stabile (l'id, lo pseudonimo) e una
rilettura la ritrova:

- una riga che c'è ancora resta lo stesso nodo: cambiano solo i testi, e solo
  se i suoi dati sono cambiati davvero (un'impronta dei dati basta);
- una riga nuova si inserisce al suo posto, senza spostare le altre: un nodo
  spostato perde il fuoco anche se torna nello stesso punto;
- una riga che non c'è più se ne va, e porta via quello che era aperto su di
  lei (il suo menu), nient'altro;
- ciò che una riga mostra espanso e dipende dai suoi dati si richiede quando i
  dati cambiano, e la versione vecchia resta visibile finché la nuova non
  arriva; se la nuova richiesta è partita mentre un'altra era in viaggio, la
  risposta di quella vecchia non chiude il giro.

Il cugino per i campi di una pagina di impostazioni, dove conta non
riscrivere ciò che l'utente ha sotto le dita, è
[Una pagina di impostazioni aperta non è una fotografia](una-pagina-di-impostazioni-aperta-non-e-una-fotografia.md).

## Il caso

Feedback #1087.4. Nella pagina «Inviti e utenti» dell'owner la prova del menu
del tasto destro su una persona era rossa sotto carico. Due cause: l'Esc si
ascoltava solo dopo un timer e andava perso se arrivava prima (corretto dal
#1219); e la vista si rileggeva a ogni movimento di crediti, anche quelli
dell'accesso all'avvio o di un'altra scheda, rifacendo la tabella da capo. Il
menu spariva prima del clic, la scheda aperta si richiudeva, il fuoco cadeva.
Adesso le righe restano quelle (`src/pages/manage/manageUtenti.js`), e la prova
`tests/wallet-owner-manopole.spec.mjs` rilegge la vista con il menu e la
scheda aperti, con una persona che entra e una che esce.
