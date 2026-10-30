# Ridisegno del lavoro: pacchetti, una sessione per feedback, manutentore

Bozza del 27/10/2026, dalle decisioni prese in chat con l'owner. Cambia come si
sceglie e si accende il lavoro; non cambia il canale autenticato
(ROUTINE-AUTH-SPEC.md), la macchina a stati (FEEDBACK-STATES.md) né i controlli
del server alla fusione. Supera l'orchestratore cieco (#1145) e il compito di
monitoraggio di SPEC-DOMANDE § 4.3–4.8, che qui diventa il manutentore.

## 1. Perché: i numeri (06–26/10/2026)

Campione: 935 biglietti con rapporto, circa 1.970 $, un quinto delle ore; stima
sulle tre settimane 8.000 $ per 505 fusioni su main.

- Dove va la spesa: verifiche 55% (di cui 16% rifatte dopo un riallineamento),
  primo lavoro 20%, correttore 16%, controllo di sicurezza 6%, orchestratore 4%.
- Riallineamenti: 32–35% della spesa. In 38 casi su 67 il ramo non aveva nessun
  file in comune con quello cambiato su main: il correttore non ha risolto un
  conflitto, e il motivo non è registrato da nessuna parte.
- Costo fisso di una pratica: circa 2 $ (le fusioni che non cambiano nessun
  file costano quello). 50 fusioni su 428 (12%) non cambiavano niente: il
  difetto era già chiuso su main. 28% delle fusioni tocca al massimo un file o
  meno di 50 righe: lì si pagano 17 $ ogni 100 righe, contro 2,8 $ fra 300 e
  1.000 righe. Sopra le 1.000 righe nessun lavoro è passato al primo giro.
- Il limite delle 5 ore non ha mai fermato niente (picco 225 $ in 5 ore su
  circa 440 disponibili); il limite settimanale sì.
- Oggi aperti 791 feedback, 370 figli (#N.M) su 219 padri, 190 con un'attesa.

## 2. Gli oggetti

**Scheda.** Per ogni feedback aperto: titolo di 3–5 parole, riassunto sotto i
200 token, tipo, area, file probabili, se è ancora valido con la prova, di chi è
doppione, se è già risolto su main. La scrive un agente Haiku dal testo del
feedback e da pochi controlli su repo e git; Opus rilegge un campione del 10%
e tutte le schede che dicono «non valido» o «doppione», perché quelle fanno
sparire lavoro. La scheda è fatta per il manutentore; chi lavora legge il
feedback intero. Il ruolo che la scrive: `routines/roles/scheda.md`. La scheda
nasce con il feedback (un agente Haiku alla nascita, Opus rilegge solo quelle
che tolgono lavoro) e si rifà quando il feedback cambia; il manutentore le
legge tutte, Haiku gli serve anche per le letture di massa che non decidono.

**Pacchetto.** Un feedback che contiene più segnalazioni della stessa area, non
ancora lavorate, con il testo che è una spec: cosa cambia, per ogni
segnalazione unita, e come si verifica. Porta con sé gli allegati delle
segnalazioni unite, col nome che dice da dove viene ognuno (tetto: quello di un
feedback, oltre il pacchetto non nasce); alla sua nascita le unite si archiviano
con la nota «Unito nel pacchetto #P: il lavoro continua lì» e il rimando
`unitoIn`, senza frase per chi le ha segnalate, e chi le aspettava aspetta il
pacchetto (decisione dell'owner del 30/10; regole in FEEDBACK-STATES.md § 3a).
Alla fusione non resta niente da chiudere: il messaggio cita le unite, e la
ricerca «già risolto su main» le trova. Un feedback scorrelato
resta da solo. Un problema urgente (sicurezza, difetto che blocca l'uso) non
entra in nessun pacchetto: si lavora appena arriva.

**Manutentore.** Una sessione con in contesto tutte le schede (791 × ~300 token
≈ 240k; con i pacchetti scende; se serve, solo le priorità alte e il resto a
turni), i rami in corso con i loro file (da git, senza modello) e la spesa
della settimana. Decide l'ordine, forma i pacchetti, sceglie cosa accendere in
parallelo. Non fonde niente: legge testo scritto da altri, quindi è non fidato,
e le fusioni restano ai controlli del server. Modello di frontiera (Opus o
Fable: stesso costo di lettura dalla cache; prima scelta Fable, per l'ordine
dei lavori).

**Sessione di lavoro.** Una per feedback, accesa dal server col biglietto di
quel feedback: niente orchestratore. Fa il primo lavoro con i sotto-agenti che
servono, anche in più fasi; per un pacchetto scrive il piano nelle note del
feedback, così se muore la sessione successiva riparte da lì. Verifica,
controllo di sicurezza e correzione restano sessioni separate, assegnate dal
server come oggi: chi ha fatto il lavoro non lancia mai il proprio
verificatore.

## 3. Regole

1. **Pacchetti.** Stessa area; nessuna segnalazione già in lavorazione; nessuna
   a priorità 3. Tetto indicativo 1.000 righe stimate o 15 file. Un pezzo che
   si blocca in verifica non si stacca: il pacchetto passa o non passa intero.
2. **Una sessione per feedback.** Il server accende una sessione per ogni
   feedback scelto dal manutentore, fino ai posti liberi; nessuna sessione
   sceglie il lavoro da sola. Un lavoro grosso ricomincia dal piano nelle note.
3. **Verifica dopo un riallineamento.** Riallineamento pulito, o con conflitti
   solo nei file di servizio (`src/shared/patchNotes.js`,
   `src/shared/capabilities.js`, `tests/rossi-noti.json`, `PATTERNS.md`):
   niente giro nuovo, bastano le prove del server. Conflitto risolto in un file
   di codice: verifica intera, perché il correttore ha scritto logica che
   nessuno ha guardato.
4. **Il correttore scrive il motivo** nel biglietto: conflitto (con i file),
   prove rosse alla fusione (quali), ripresa dopo una risposta dell'owner,
   altro. Senza motivo il biglietto non si chiude. Serve a trovare la causa del
   57% di riallineamenti senza file in comune.
5. **Già risolto su main.** Prima di accendere una sessione il server controlla
   le fusioni su main che citano il numero del feedback; la sessione lo
   ricontrolla come primo passo e, se è già chiuso, lo chiude senza aprire un
   ramo.
6. **Spesa.** Si dosa sulla settimana, non sulle 5 ore; più lavoro a inizio
   settimana, meno vicino al rinnovo. I rapporti dei biglietti contano circa il
   60% del consumo vero (misura del 07/10): il manutentore usa il consumo
   dell'account, non la somma dei biglietti.
7. **Priorità 3.** Fuori dai pacchetti, subito. Idea per dopo, non decisa: a
   regime le priorità 3 si accendono tutte in parallelo appena arrivano.
8. **Figli (#N.M).** Non se ne aprono più per spezzare un lavoro: il pacchetto è
   il contenitore. I 370 figli aperti rientrano nei padri o nei pacchetti con il
   censimento (§ 5).

## 4. Cosa resta e cosa sparisce

- Resta: canale autenticato e biglietti; verificatore, controllo di sicurezza,
  correttore; L5 e le approvazioni dell'owner; le attese fra feedback (servono
  ai pacchetti); la coda per priorità come ripiego quando il manutentore non ha
  deciso niente.
- Sparisce: l'orchestratore (e con lui il buco #1182); il pacemaker come scelta
  del lavoro (resta come accensione: chi è libero, quanti posti); i figli come
  modo di spezzare; la verifica intera dopo ogni riallineamento.

## 5. Transizione

**Fase 0, ora, in locale.** Censimento: una scheda per ogni feedback aperto
(#1679), Opus rilegge, e il manutentore compone i pacchetti da solo: l'owner
(27/10) non vuole le proposte una per una, si fida dell'ordine scelto.

**Fase 1, con i 240 € di crediti.** Il manutentore è la sessione locale; le
sessioni cloud si accendono a mano, una per feedback, come routine (parola
d'ordine dei trigger). Prima i lavori sul processo, uno alla volta nell'area
del server: #1040 e #1153 fermi, #1154 e #1155 (manutentore), #1652, #1653,
#1648, #1630, #1555. In parallelo, in aree di codice diverse, i primi pacchetti
dell'app. Prima di accendere una sessione si guardano i file dei rami in corso.

**Fase 2.** Il manutentore gira in cloud come compito ricorrente (SPEC-DOMANDE
§ 4.3, con i poteri in più di § 2); il server accende una sessione per feedback.
Serve un'operazione del server che dia schede e testi a chi ha la chiave delle
routine: oggi dal cloud non si legge un feedback a scelta (servono il token
admin e la chiave di decifratura, che stanno solo sul PC dell'owner).

## 6. Da costruire

Server (filo-security): accensione per feedback scelto dal manutentore; chiusura
delle segnalazioni unite alla fusione del pacchetto; controllo «già risolto su
main» prima dell'accensione; motivo del correttore nel biglietto, obbligatorio;
verifica leggera dopo riallineamento pulito; spesa per account al manutentore.

App e script: ruolo del manutentore (prompt, schede in contesto, file dei rami
da git); ruolo del primo lavoro con piano nelle note; il ruolo della scheda e lo
script del censimento in `scripts/`; `feedback:apri … --pacchetto N,M,…` che
mette le attese; FEEDBACK-STATES.md per pacchetti e motivo del correttore.

Ogni voce è un lavoro per le sessioni cloud di fase 1; l'ordine lo decide il
manutentore.

### 6.1 Stato (#1680)

Fatto dalla parte dell'app, con le regole in FEEDBACK-STATES.md § 3a:

- manutentore: `routines/roles/manutentore.md` e `npm run manutentore --
  contesto | rami | incroci <N>` (schede in una riga, rami in corso coi file da git);
- schede: `routines/roles/scheda.md` e `npm run feedback:schede -- elenca |
  scrivi | rileggi | stato` (Haiku scrive, Opus rilegge chi toglie lavoro e il 10%);
- pacchetti: `feedback:apri --pacchetto` (campo `unisce`, attese, controlli della
  regola 1); la transizione `todo → done` della pipeline per chiudere le unite;
- primo lavoro: «già risolto su main» come primo passo (`payload.suMain`, chiusura
  `gia_risolto` con la fusione), piano consegnato con `deliver piano` e rimandato in
  `payload.piano`;
- correttore: `--motivo` obbligatorio su `--record-fixed`, e alla consegna i file in
  conflitto con main e quelli in cui la modifica del ramo è cambiata, con la regola
  dei file di servizio in `verifierRound.js`;
- sessione per feedback accesa a mano: preflight `--feedback <N>` col ruolo `sessione.md`,
  cieca come l'orchestratore (lancia un worker, non legge il feedback), e `ticket …
  --feedback <N>`; il comando `ticket` manda anche l'id della sessione cloud.

Fatto dalla parte del server (ramo omonimo di filo-security, da rideployare):

- biglietto per numero (`routineTicket` con `feedback`), con tutti i controlli della
  scelta di sempre; un feedback già risolto il biglietto lo prende e lo chiude il primo
  lavoro;
- `suMain` nel primo lavoro (API di GitHub) e chiusura `gia_risolto` provata dal server,
  con la riga `working → done` (routine) nella tabella;
- piano consegnato, cifrato nel feedback, rimandato al primo lavoro e alla ripresa,
  tolto alla chiusura;
- unite chiuse alla fusione del pacchetto, e il messaggio della fusione che le cita;
- motivo del correttore obbligatorio e scritto nel biglietto; `shaVerificato` al
  correttore di un riallineamento; confronto rifatto dal server e niente giro dopo un
  riallineamento pulito.

- accensione per feedback: l'ordine del manutentore in `config/manutentore`
  (`npm run manutentore -- accendi`), che decide i primi lavori (verifica, correzione,
  controllo e risposte restano del server, anche fuori dall'ordine); le due voci del
  pacemaker, normale e lavori server, che accendono una sessione per ciascun lavoro e la
  legano al numero con l'id della sessione; la ricerca «già risolto» prima
  dell'accensione; il biglietto che quella sessione riceve per il suo feedback e uno solo. Il prompt salvato della routine non cambia: la sessione accesa
  così è l'orchestratore cieco, ristretto dal server al suo feedback.

Resta: fase 2, la spesa dell'account per il manutentore e l'operazione che dà schede e
testi a chi ha la chiave delle routine.
