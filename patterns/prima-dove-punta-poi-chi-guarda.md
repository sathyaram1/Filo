# Prima dove punta, poi chi guarda

[← Tutti i pattern](../PATTERNS.md)

**Regola.** In un canale che riceve un indirizzo arrivato da fuori, il
controllo della PROVENIENZA viene prima di quello dell'identità di chi chiede.
Un indirizzo che non è di Filo riceve la stessa risposta per tutti — «non è
roba mia» — e la riceve senza che Filo dica altro su di lui: non che è
arrivato, non che è al sicuro, non che è cifrato.

E la seconda metà, che vale anche quando l'indirizzo È di Filo: **Filo dice
solo ciò che ha guardato**. Riconoscere la forma di un indirizzo non è aver
visto il file. Se il canale non ha scaricato e decifrato quei byte, la risposta
dice l'unica cosa vera in ogni caso — chi lo apre — e non che è arrivato né come
viaggia.

Con l'identità davanti nascono due risposte diverse per la stessa domanda: chi
ha i permessi si vede controllare l'indirizzo, chi non li ha riceve una frase
scritta per il caso normale — e quella frase, davanti a un indirizzo
inventato, diventa una bugia che Filo firma.

## Il caso che l'ha fatta nascere

Verifica del feedback #582, giro 4. Gli allegati di una segnalazione si aprono
passando dal main, che li scarica e li decifra. Il canale guardava prima chi
stava guardando: a chi non riceve le segnalazioni rispondeva subito «allegato
consegnato: lo apre solo chi riceve le segnalazioni, perché viaggia cifrato con
la sua chiave», e solo dopo, nel ramo di chi le riceve, confrontava l'indirizzo
col deposito di Filo.

L'indirizzo di un allegato però non lo sceglie Filo: sta dentro la
segnalazione, e una segnalazione la manda chiunque, anche senza account e senza
avere Filo installato. Quindi bastava dichiarare un allegato che punta al
proprio sito perché Filo scrivesse, nel riquadro che ogni tester apre per
leggere le segnalazioni di tutti, che quel file era stato consegnato e viaggiava
cifrato. Non era mai entrato nel deposito. Due porte, stessa causa: il
segnaposto dello screenshot («allegato consegnato») e la pillola del documento
(«(consegnato)», col motivo nell'hover).

È la coda della famiglia dei giri 1-3 dello stesso feedback — un indirizzo che
arriva da fuori e che Filo tratta come proprio. Tolto il clic (giro 2) e
sistemata la scritta del collegamento (giro 3), restava la PAROLA: Filo che
avvalora un pezzo di interfaccia costruito da chi ha mandato la segnalazione.

## I tentativi sbagliati

- **Cambiare la frase.** Ammorbidirla («l'allegato potrebbe essere stato
  consegnato») la rende solo più vaga per tutti, compreso il mittente vero a cui
  serviva esatta. Il difetto non è la frase: è che veniva detta senza guardare.
- **Controllare l'indirizzo nella pagina.** Le pagine che mostrano un allegato
  sono due (il riquadro dei feedback e la Gestione) e diventerebbero due strade
  per la stessa cosa: è esattamente la forma del difetto del giro 2, dove una
  delle due non guardava niente. Il controllo sta nel canale, che è uno.
- **Confrontare l'host con una regex.** Vedi
  [Una credenziale si manda all'indirizzo esatto, non all'host](una-credenziale-si-manda-all-indirizzo-esatto-non-all-host.md):
  l'indirizzo si parsa e si confronta per intero, deposito compreso.

## Dove vive

- Il canale degli allegati in `src/main/services/handlers/auth.js`
  (`FEEDBACK_DECRYPT_IMAGE`): `SN_FEEDBACK.isAttachmentUrl` prima di
  `auth.isAdmin()`.
- Guardie: in `tests/feedback-allegato-del-mittente.spec.mjs` le due prove
  «non si dichiara consegnato» (una per lo screenshot, una per il documento),
  accanto a quelle che tengono chiuse le porte dei giri prima.
