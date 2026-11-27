1. **La lamentela.** Rifatta coi passi dell'utente, la cosa voluta accade: si
   asserisce il **successo**, non l'assenza di un errore.
2. **Strade equivalenti.** Menu, scorciatoia, tasto destro, chat, l'altra
   pagina che ha la stessa funzione: tutte fanno la stessa cosa.
3. **Stress.** Inserimenti insoliti (vuoto, soli spazi, testi lunghissimi,
   emoji, HTML), attese, sequenze particolari di clic e azioni (in fretta,
   durante un caricamento, apri e chiudi, annulla e ripeti), nessun dato.
4. **Sicurezza funzionale** di ciò che il lavoro ha aggiunto: input
   dell'utente mostrato come markup, provenienza non controllata nei canali
   interni nuovi, URL non validati.
5. **Aspetto.** Ogni elemento grafico segue lo stile di Filo, si comporta bene
   con tutte le impostazioni (tema chiaro e scuro) e sta nella posizione
   migliore, con meno elementi possibili: ogni elemento nuovo ha il suo
   motivo. Va guardato davvero: in cloud `page.screenshot()` in
   `tests/.shots/`, in locale `npm run test:shoot`.
6. **Completezza.** Nessuna invariante ovvia manca: ciò che si aggiunge si può
   togliere; se se ne salvano N si vedono tutte; una strada naturale per
   ottenere la stessa cosa non resta senza supporto senza una ragione.
7. **Pattern.** La UI toccata rispetta `PATTERNS.md`.
8. **Miglioramenti.** Uno **senza trade-off** che manca fa parte del lavoro.
   Un **trade-off di costo** lo decide chi lavora (CLAUDE.md § Iniziativa):
   con la stima e le opzioni esposte non è un rilievo. Lo è, senza `?`, se
   manca la stima (costo al mese e tempo di risposta) o non sta accanto
   all'opzione, se le opzioni non si cambiano senza codice o se quella di
   partenza non regge i numeri. Uno che non si misura lo decide l'owner.
9. **Una causa, tutte le porte.** Davanti a un difetto si cerca lo stato
   sbagliato che lo produce e **tutte le strade che portano a quello stato**:
   la cura è una regola sola sulla causa, non una pezza sulla porta vista.
10. **Oggetti e tipi.** In una modifica all'interfaccia si elencano gli oggetti
   e i tipi (titolo, testo, riquadro, tasto pieno, tasto vuoto, icona, link…)
   che aggiunge alla schermata, confrontando lo screenshot di prima con quello
   di dopo, e per ciascuno si scrive cosa perde l'utente senza. Un oggetto
   senza risposta è un rilievo da correggere, non un dubbio: si toglie, o la
   sua funzione passa al tasto destro o alla richiesta a Filo
   (`filo_design.txt` § ESTETICA). Il prima è la stessa schermata su `main`,
   o lo screenshot allegato alla segnalazione quando c'è: si fotografa con
   una prova che salva in `tests/.shots/`, e
   `node scripts/spec-su-main.mjs tests/<nome>.spec.mjs` la corre sul ramo e
   su `main`, anche se l'hai scritta adesso, e tiene le immagini dei due lati
   in `tests/.shots/confronto/`. Gli oggetti si contano sulle immagini, non a
   memoria.
11. **Prove importanti.** `npm run test:importanti` è verde e sotto il suo
   tetto. L'elenco dei cammini (`tests/importanti.spec.mjs`) lo cambiano solo
   l'owner e il manutentore: un ramo che ci aggiunge un cammino senza che il
   feedback lo chieda è un rilievo, e uno nuovo entra togliendone o
   accorciandone un altro.
