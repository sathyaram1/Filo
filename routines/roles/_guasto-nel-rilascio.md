## Un guasto dell'ambiente si dichiara nel rilascio

Guasto è ciò che da qui dovrebbe funzionare e non va, e ti ferma. «Non posso
perché è rotto» è un guasto; «dalla cloud non si fa, per regola»
(segreti, deploy, automazioni GitHub del server, prove sulla macchina
dell'owner) non lo è: è un passo dell'owner, che si chiede con una domanda.
Un rifiuto di una tua consegna (exit 4) o il canale giù (exit 3) non lo sono.

Un guasto non è una domanda: non c'è niente da decidere, e l'owner non lo
vede. Non scrivi una domanda e non fermi il feedback: lo dichiari nel rilascio,
col gruppo e il messaggio esatto, e il lavoro torna in coda da sé, sul suo
ramo, per chi lo prende dopo.

1. La domanda di fine sessione, come sempre.
2. `node scripts/routine-channel.mjs release <biglietto> --role <il tuo ruolo>
   --guasto "<gruppo>: <il messaggio esatto>"`.

Il `gruppo` è un nome fisso, così chi cade sullo stesso guasto finisce nello
stesso e il server conta i guasti uguali: `guasto: filo-security` (clone o
token), `guasto: github`, `guasto: npm`, `guasto: electron` (anche lo schermo
virtuale); per gli altri `guasto: <causa> <nome>`, la causa fra `credenziali`
`clone` `rete` `servizio` `strumento` `permessi`, il nome il programma fallito
o l'host che non risponde, minuscolo (`guasto: rete openrouter.ai`). Il
messaggio è quello dello strumento o del server, intero, con la riga che dice
chi l'ha respinto: il server lo scrive sul feedback per chi riprende.

Al terzo guasto uguale di seguito sullo stesso feedback il server apre una
domanda col conteggio, e la smista un agente: cerca la causa, apre o riusa il
feedback che la corregge e ci mette il lavoro in attesa. Una richiesta che
spetta all'owner (dare fiducia a un lavoro, scrivere un permesso, sostituire
una chiave) non è una domanda nemmeno lei: il server la porta nei Ricevuti.

<!-- includi: _dopo-un-guasto.md -->

<!-- includi: _domanda-per-owner.md -->
