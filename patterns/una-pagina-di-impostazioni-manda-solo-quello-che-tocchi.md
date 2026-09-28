# Una pagina di impostazioni manda solo quello che l'utente ha toccato

[← Tutti i pattern](../PATTERNS.md)

In Filo un'impostazione si cambia anche chiedendolo, quindi una pagina di
impostazioni è spesso aperta in una scheda mentre la stessa cosa cambia da
un'altra parte. Nel #592 le Preferenze rimandavano a ogni tocco tutto il loro
blocco coi valori letti all'apertura: uno stile confermato in chat tornava
quello di prima al primo clic sul tema, e intanto la pagina mostrava lo stile
vecchio.

- **Si manda solo il campo toccato.** Chi ascolta `input`/`change` segna il
  campo prima che parta il salvataggio; il salvataggio manda i campi segnati e
  li toglie dall'elenco. Una mappa che lo storage sostituisce intera
  (`REPLACE_KEYS`, come i token) si ricompone da quella in memoria adesso, con
  sopra le sole voci toccate.
- **La pagina segue la memoria da aperta.** All'annuncio `settings_updated`
  riscrive i campi che l'utente non sta cambiando e solo se il valore è
  davvero diverso: così la risposta al proprio salvataggio non sposta il
  cursore né toglie lo spazio in fondo a chi scrive.
- **Quello che è in sospeso resta.** Un testo oltre il tetto, una misura
  scritta a metà, una manopola nel mezzo della pausa: non sono salvati, quindi
  un annuncio da fuori non li riscrive.

Dove: `src/pages/preferences/preferences.js` (`toccati`, `riempi`,
`riallinea`, e i gemelli per token e colore delle schede). Prova:
`tests/preferences-aperta.spec.mjs`. Le pagine Opzioni e Sicurezza hanno ancora
il salvataggio a blocco intero.
