# Un testo dell'utente che entra in un prompt è CONTENUTO, non prompt

[← Tutti i pattern](../PATTERNS.md)

Una preferenza a testo libero che finisce nel messaggio di sistema di un agente
è un pezzo di prompt scritto da fuori, e ci resta dopo il riavvio. Non basta
che «l'abbia scritta l'utente»: testo ostile arriva nel contesto del modello
per vie del tutto ordinarie (il titolo di una scheda, un risultato web, il
riassunto di un file), e da lì basta convincerlo a salvarlo come preferenza.
Un inganno che durava un turno diventa un'istruzione permanente, senza
conferma e senza traccia.

Il caso che l'ha fatto nascere è il **#592** (banco di prova di sicurezza del
27 agosto 2026, gravità alta): la preferenza `agentStyle` accettava testo
libero senza tetto e senza livello di rischio, e `injectAgentStyle` lo
ACCODAVA al messaggio di sistema come istruzione «richiesta dall'utente».
Nell'agente di pagina cadeva così **dopo** la riga che dice di ignorare le
istruzioni della pagina, cioè nel punto dove non c'è più niente che lo tenga a
bada.

Quattro cose, tutte insieme. Tre sono difese, la quarta è quella che rende le
altre utili.

- **Livello di rischio 2.** Se è il modello a proporla, l'azione si sospende e
  il popup mostra il **testo esatto** che sta per diventare permanente, non
  un'etichetta («Stile dell'agente aggiornato» non è un consenso). Il livello
  sta nel setter di `src/shared/preferences.js`, come per tutte le altre
  (vedi il pattern sul registro dei livelli).
- **Un tetto di lunghezza, con rifiuto spiegato.** Uno stile sono una o due
  frasi; un secondo prompt di sistema è lungo. `AGENT_STYLE_MAX` in
  `src/shared/constants.js` è a 600 caratteri, tre volte il preset più lungo.
  Chi sfora riceve il numero e riscrive lui: **mai un taglio muto**, che
  mangerebbe proprio la parte che contava.
- **Un recinto, e i marcatori tolti dal testo.** Il testo entra fra
  `AGENT_STYLE_OPEN` e `AGENT_STYLE_CLOSE`, preceduto da una riga che dice che
  è contenuto dell'utente e seguito da una che dice cosa può e cosa non può
  fare. `sanitizeAgentStyle` toglie i marcatori dal testo: senza, basta
  scriverli per uscire dal recinto e tornare a parlare come il sistema.
- **La posizione.** Il recinto va **prima** della riga anti-inganno del
  prompt, non dopo. I prompt dichiarano dove con un segnaposto
  (`AGENT_STYLE_SLOT`), piazzato in fondo alla parte immutabile e sopra la
  sezione di sicurezza: così il grosso del prefisso resta uguale per tutti (la
  cache del #422 continua a valere) ma le regole restano l'ultima parola.
  `injectAgentStyle` toglie il segnaposto anche quando non c'è nessuno stile,
  altrimenti finisce nel prompt come testo misterioso.

E poi il contorno, che è quello che si dimentica:

- **Resta visibile e cancellabile.** Il testo si rilegge in Preferenze →
  Stile dell'agente, col conteggio dei caratteri sotto la casella, e si toglie
  svuotando la casella o dicendolo a Filo («togli lo stile»). Se si può
  mettere si deve poter togliere, da tutte e due le strade.
- **Le porte laterali si chiudono.** `UPDATE_SETTINGS` è aperto anche ai
  content script delle pagine web: da lì `agentStyle` è tolto dal messaggio,
  come le chiavi API. E il choke point delle scritture (`applySettingsUpdate`)
  ripulisce i marcatori e scarta un valore oltre il tetto invece di
  accorciarlo.

**Regola operativa.** Prima di aggiungere una preferenza a testo libero,
chiediti se quel testo finisce in un prompt. Se sì, le quattro cose qui sopra
valgono tutte. La sentinella `tests/unit/preferences.test.mjs`
(«REGOLA #592») sonda ogni setter con una stringa improbabile: quelle che se
la tengono identica sono le preferenze a testo libero, e devono essere censite
una per una con la riga che dice dove va a finire quel testo. Una preferenza a
testo libero nuova e non censita fa diventare rossa la sentinella.

Codice: `src/shared/constants.js` (`AGENT_STYLE_MAX`, `sanitizeAgentStyle`,
`validateAgentStyle`, `agentStyleBlock`, `injectAgentStyle`, e i segnaposto
dentro `PROMPTS.helpStatic` / `PROMPTS.filoChatStatic`),
`src/shared/preferences.js` (setter `stile_agente`),
`src/shared/actionLevels.js` (il rifiuto non apre popup),
`src/main/services/handlers.js` (`applySettingsUpdate`, dispatch di
`IMPOSTA_PREFERENZA`, `toolResultText`),
`src/main/services/handlers/storage.js` (campi vietati da origine web),
`src/pages/preferences/preferences.js` (conteggio e rifiuto).
Prove: `tests/unit/agentStyle.test.mjs`, `tests/agent-style.spec.mjs`.
