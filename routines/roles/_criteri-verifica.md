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
   migliore. Va guardato davvero: in cloud `page.screenshot()` in
   `tests/.shots/`, in locale `npm run test:shoot`.
6. **Completezza.** Nessuna invariante ovvia manca: ciò che si aggiunge si può
   togliere; se se ne salvano N si vedono tutte; una strada naturale per
   ottenere la stessa cosa non resta senza supporto senza una ragione.
7. **Pattern.** La UI toccata rispetta `PATTERNS.md`.
8. **Miglioramenti.** Uno **senza trade-off** che manca fa parte del lavoro.
   Uno **con trade-off** (costi, complessità, gusto) lo decide l'owner.
9. **Una causa, tutte le porte.** Davanti a un difetto si cerca lo stato
   sbagliato che lo produce e **tutte le strade che portano a quello stato**:
   la cura è una regola sola sulla causa, non una pezza sulla porta vista.
