# Un clic, una scheda: nessuna azione ricompone la lista sotto il cursore

[← Tutti i pattern](../PATTERNS.md)

Un pulsante che sta DENTRO una riga di una lista che si riordina da sé è una
trappola: al clic la riga esce dalla sezione, le altre risalgono e sotto il
puntatore FERMO arriva il pulsante della riga successiva. Il secondo clic cade
su un altro elemento. Non è il doppio clic accidentale — succede anche a quattro
decimi di secondo di distanza, e cliccare due volte viene naturale proprio
perché al primo clic non si vede succedere niente. Sulla pagina dei feedback due
volte «→ In coda» mettevano in coda il primo e marcavano il SECONDO come attacco
confermato: la decisione più pesante della pagina, presa per sbaglio, in
silenzio, su una segnalazione che nessuno aveva scelto (#509).

- **La regola è una sola e le copre tutte.** Non "disabilita quel bottone":
  *nessuna azione presa dentro una scheda ricompone la lista*. Chiudere una
  porta per volta (prima «In coda», poi «Risolto», poi «Ripristina», poi i
  pallini della priorità che in una sezione sono un criterio di ordinamento)
  costa un giro di verifica a testa e ne lascia sempre una aperta.
- **La scheda si aggiorna AL PROPRIO POSTO.** Si spegne mentre scrive (il clic
  così si vede, ed è il motivo per cui non se ne dà un secondo), poi resta dov'è
  con l'esito scritto al posto dei pulsanti: «✓ Spostata in «In coda»». Niente
  si muove da sotto il puntatore, e un secondo clic non trova niente da premere.
- **La lista si ricompone solo su richiesta esplicita** — cambio sezione,
  ricerca, filtro, Aggiorna, dati nuovi. È lì, e solo lì, che le schede già
  decise lasciano il posto.
- **I numeri, invece, dicono subito la verità.** Il conteggio della sezione
  scende all'istante: la scheda decisa è visibilmente marcata come non più
  appartenente, quindi il numero non contraddice ciò che si vede. Il totale in
  cima lo dice a parole («4 feedback · 1 decisa»).
- **Vale anche dentro la scheda.** La × che toglie un allegato ridisegnava la
  scheda e faceva scorrere le miniature: la seconda × cadeva su un allegato
  diverso. Stesso rimedio, stesso motivo.
- **Non è solo il clic a muovere la lista: anche i dati che arrivano da soli.**
  Una lista che si aggiorna dal vivo si ricompone senza che l'utente tocchi
  niente. Nella cronologia degli appunti bastava copiare qualcosa in un'altra
  scheda: la voce nuova entrava in cima, spingeva giù tutte le altre e il clic
  che stavi per dare su «Rimuovi» cancellava la voce di sopra, per sempre
  (#256). Quindi: finché il puntatore è DENTRO la lista non si muove niente —
  le voci nuove aspettano fuori (con una riga che lo dice, messa SOTTO la lista
  e mai sopra) e quelle tolte restano al loro posto barrate. Appena il
  puntatore esce, la lista si ricompone.
- **Una lista identica non si ridisegna.** Chi tiene un dato condiviso avvisa
  tutte le pagine quando cambia, e l'avviso torna anche a chi ha appena chiesto
  la modifica: la stessa lista arriva due volte, la seconda uguale alla prima.
  Ricostruirla per nulla azzera lo scorrimento e butta fuori il fuoco della
  tastiera. Prima di svuotare il contenitore, confronta le chiavi già disegnate
  con quelle in arrivo: se coincidono, aggiorna i contorni (avvisi, filtro) e
  fermati lì.
- **La protezione del puntatore non copre la tastiera: serve la sua.** Tenere
  ferma la lista finché il mouse ci sta sopra non aiuta chi preme Invio: lì il
  bottone si disabilita, il fuoco torna al corpo della pagina e per l'azione
  successiva tocca riattraversare col tabulatore tutta la pagina. Dopo
  un'azione presa da tastiera il fuoco va rimesso su qualcosa di premibile —
  lo stesso posto in lista (l'elemento che ha preso quel posto), altrimenti il
  vicino, altrimenti il controllo che resta. `event.detail === 0` distingue
  Invio/Barra dal clic: col mouse il fuoco non si sposta, o comparirebbe un
  anello di fuoco sulla riga vicina a ogni clic.
- **La condizione per rimettere il fuoco è "il bottone è ancora PREMIBILE", non
  "il bottone è ancora nella pagina".** Con le due protezioni insieme il
  bottone premuto ha due destini diversi: se la lista si ricompone sparisce, se
  la lista sta ferma sotto il puntatore resta a schermo disabilitato. Un
  controllo `document.contains(btn)` copre solo il primo, e chi tiene la mano
  ferma sul mouse mentre usa la tastiera resta senza fuoco: proprio il caso di
  partenza. Anche l'indice da cui ripartire va contato sulle righe VIVE (né
  tolte né nascoste dal filtro), o con righe barrate ancora a schermo punta al
  posto sbagliato. E nel ramo d'errore, dove la riga resta viva, il fuoco torna
  sul suo stesso bottone.
- **Ferma è la LISTA, non i controlli intorno.** Il tasto che svuota, il campo
  di ricerca, i conteggi: quelli parlano dei dati veri, subito, anche mentre a
  schermo restano righe barrate. Nella cronologia appunti, tolte a mano tutte le
  voci senza uscire dalla lista, «Svuota cronologia» restava a schermo e
  raggiunto col tabulatore chiedeva conferma di far sparire zero voci. Le righe
  aspettano; le decisioni no.
- **L'aggiornamento ottimistico non è il colpevole; il ridisegno sì.** Scrivere
  subito nel modello va benissimo: quello che non si può fare è ricostruire
  l'elenco mentre la mano dell'utente è ancora lì. Serve anche nel ramo
  d'errore, o il ripristino rimescola la lista esattamente come il successo.
- **Dove:** `azioneScheda` / `spegniScheda` / `marcaDecisa` / `bindCardActions`
  e l'opzione `inPlace` di `patch()` in `src/pages/feedback/feedback.js`; la
  gemella `src/pages/manage/manage.js` non ha il problema perché l'azione vive
  in un pannello fermo e riguarda la scheda selezionata. Test:
  `tests/feedback-doppio-clic.spec.mjs` (clicca due volte alle STESSE
  coordinate con `page.mouse.click`, non sul locator: un locator seguirebbe il
  pulsante ovunque vada e il difetto non si vedrebbe).
- **Dove (cronologia appunti):** `renderClipboard`/`segnaSparite`/
  `fuocoDopoRimozione` in `src/pages/security/security.js` e il ramo della `×`
  in `openSubmenu` di `src/content/menu.js`; classi `sn-clip-gone` /
  `sn-menu-history-gone`. Test: `tests/clipboard-history-stabile.spec.mjs`
  (stessa tecnica: `hover()` una volta sola, poi due `mouse.down()/up()`) e
  `tests/clipboard-history-conferma-fuoco.spec.mjs` per il fuoco da tastiera.
