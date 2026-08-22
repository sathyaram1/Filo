# Filo — Piattaforma App: Specifica di Design

Stato: design approvato in discussione owner + Claude (2026-08-22). Nessuna
implementazione ancora avviata: questo documento è la fonte di verità per
quando partirà.

## 0. Visione

Filo diventa gradualmente una libreria di app, ognuna fedele alla filosofia di
Filo (`filo_filosofia.txt`). Ogni utente può creare l'app che gli serve
**descrivendola**: nessun utente scrive codice — il codice lo scrivono le
routine di Filo, dentro questo repo, con gli stessi cancelli di sicurezza del
resto dell'app.

Non è un app store: non si compra niente. È più simile alla dotazione di un
sistema operativo — app di serie (i giochi offline come su Windows) più quelle
nate dai bisogni degli utenti (esempio già vivo: il deck builder Commander,
`DECK-BUILDER-SPEC.md`).

**La promessa non è "la migliore app per ogni scopo dal giorno uno"** — la
qualità in questo modello arriva dalle iterazioni di feedback, quindi le app
nascono acerbe. La promessa onesta è: **l'unica app che può solo migliorare** —
ogni utente che si lamenta la migliora per tutti.

## 1. Perché è un moat

Rispetto a generatori di app usa-e-getta (Claude Code, Lovable, Base44):

1. **Sistema di feedback automatico** — ogni app eredita l'intera macchina
   (segnalazione → giudici → fix → consegna), non solo un modulo di raccolta.
2. **Servizi a pagamento integrati** — le app usano i crediti dell'account
   Filo dell'utente. Niente chiavi API da procurarsi.
3. **Integrazione con Filo** — nessun login, drag & drop, chat, memoria,
   personalizzazione: le primitive di Filo sono disponibili a ogni app.
4. **Nicchia garantita** — niente doppioni (§2): ogni app è l'unica del suo
   scopo e riceve tutta la domanda per quello scopo. Nessun mercato del pesce
   dove si urla per attirare attenzione.

Il punto 1 è il moat vero: un concorrente può copiare il generatore, non un
ecosistema dove ogni lamentela di ogni utente migliora l'unica app di quel
tipo.

## 2. Regola del consolidamento: strumenti e opere

- **Strumenti** (deck builder, editor, convertitori…): **una sola app per
  scopo**. Chi chiede qualcosa che esiste già non crea un doppione: la sua
  richiesta diventa **feedback sull'app esistente**. La domanda si consolida
  invece di frammentarsi.
- **Opere** (giochi, narrativa interattiva): si **moltiplicano**. Due giochi
  simil-scacchi sono due opere diverse, come due romanzi. Per le opere la
  soglia d'ingresso è di qualità, non di unicità.

La regola "niente fork" regge *perché* Filo impone la personalizzazione
estrema: le divergenze di gusto si risolvono con le preferenze, non con app
duplicate. Le due idee si sostengono a vicenda — se un'app non è abbastanza
personalizzabile, i doppioni tornano a bussare: è un segnale di feedback, non
un motivo per ammetterli.

## 3. Ruoli e governance

La governance **è la macchina dei feedback esistente** (`FEEDBACK-STATES.md`)
con un ambito per-app e un ruolo in più:

| Ruolo | Chi | Cosa può fare |
|-------|-----|---------------|
| Utente | chiunque | usa le app, invia feedback/suggerimenti |
| Creatore | permesso esplicito dell'owner | descrive l'app e la sua evoluzione; **giudice consultivo** dei feedback della sua app |
| Owner | uno | ultima parola su tutto; concede/revoca il ruolo di creatore; approva le allowlist |

Precisazioni:

- Il creatore giudica **gusto e direzione**, non la correttezza: bug e
  invarianti UX ovvie si sistemano senza aspettare il suo parere (come già
  oggi per Filo stesso).
- Il suo verdetto è **consultivo**: orienta il triage, non lo vincola.
- **Creatore inattivo**: dopo un periodo di silenzio (proposta: 3 mesi) le
  decisioni sulla sua app tornano al flusso normale (giudici + owner). Il
  ruolo non decade, la coda non si blocca.
- Il creatore **non guadagna** e non fa prezzi. Eventuale riconoscimento in
  crediti: rimandato (§8).

## 4. Ciclo di vita di un'app

1. **Proposta**: il creatore descrive cosa vuole. Se lo scopo esiste già →
   diventa feedback sull'app esistente (§2). Se è nuovo → nasce l'app.
2. **Costruzione**: le routine implementano nel repo, con giudici e cancello
   di merge come per qualsiasi lavoro. Il creatore vede versioni e dà
   direzione tramite feedback, come tutti — con peso da creatore.
3. **Evoluzione**: feedback per-app da qualunque utente; il creatore giudica,
   l'owner decide, le routine implementano.
4. **Opere importate**: un'opera può nascere fuori e entrare in Filo
   (Origanum sarà la prima). Entra come app a tutti gli effetti: stessa
   sicurezza, stesso feedback, stessa filosofia.

## 5. Dati e sicurezza

### 5.1 Principio del creatore cieco

**Il creatore non riceve dati degli utenti di nessun tipo, mai.** La fiducia
richiesta all'utente resta una sola: quella in Filo, che ha già dato.

Conseguenza in positivo: l'app **può** usare tutti i dati dell'utente che le
servono (inclusa la memoria personale), seguendo i criteri di Filo, perché
non escono verso terzi. Conseguenza in negativo: il creatore non ha analytics
(§5.7) e non debugga con dati veri — lo fanno le routine (§5.6).

Un'app non può in alcun modo rendere pubblici o aprire i dati dei suoi utenti
(non esiste "l'app che pubblica le memorie di tutti").

### 5.2 Due categorie: app locali e app condivise

| | Locale (default) | Condivisa |
|---|---|---|
| Dati | non escono mai dal Filo dell'utente (uniche uscite: modelli via provider di Filo, allowlist §5.3) | stato tra più utenti su server |
| Consenso | **nessuna richiesta**: non c'è niente da chiedere | conferma esplicita al primo uso: cosa esce, chi lo vede, in che forma |
| Esempio | deck builder, Origanum | matching tra persone compatibili via LLM |

Per le app condivise ogni **flusso** va dichiarato singolarmente (quale dato,
verso chi, in che forma). Modello di riferimento per il caso matching: l'LLM
vede i dati di entrambi, gli umani vedono solo la presentazione che l'LLM
scrive — approvata dal suo proprietario prima dell'invio. Nessuno legge mai i
dati grezzi dell'altro, nemmeno a match riuscito.

### 5.3 Allowlist di rete per-app

Il canale di fuga realistico non è "il creatore riceve dati": è l'app che li
*spedisce*. Quindi:

- ogni app dichiara **verso quali domini** può parlare;
- la lista la **approva l'owner** alla creazione; qualsiasi dominio fuori
  lista → richiesta di permesso all'owner, mai silenziosa;
- la lista è **pubblica** (chiunque può vedere con chi parla un'app);
- le chiamate ai modelli passano dai provider di Filo coi crediti
  dell'account: canale controllato per costruzione.

Con l'allowlist, "i dati restano nell'app" è vero **per architettura**, non
per promessa; i giudici L1–L5 diventano la seconda linea di difesa, non
l'unica.

### 5.4 Sanificatore dei feedback

I feedback contengono dati degli utenti (screenshot dell'app che mostra dati
personali, testi che raccontano fatti privati). Il creatore **non vede mai il
feedback grezzo**: vede la versione lavorata — riassunto operativo spogliato
di identità e contenuti personali. Componente non banale ma costruibile; va
progettato quando si implementa il ruolo creatore, non dopo.

### 5.5 Conferme di sistema

I dialoghi di consenso li disegna **Filo, mai l'app**: riquadro di sistema,
testo standard scritto da Filo che dice cosa esce e verso chi — non prosa
libera del creatore (che potrebbe vestirla per estorcere il sì, o
falsificarla). E le conferme devono restare **rare**: se ogni app può
chiederle spesso, l'utente clicca sì in automatico e il consenso non vale più
niente.

### 5.6 Debug

Le routine **possono** usare dati veri per il debug: non arrivano al creatore,
quindi il principio §5.1 non è violato. Il creatore debugga solo tramite
feedback e versioni pubblicate.

### 5.7 Telemetria minima e pubblica

Il creatore (e volendo chiunque) vede solo aggregati grezzi e a grana grossa:
utenti a settimana, conteggi d'uso — mai chi, mai quando di preciso. Come le
visualizzazioni di un video YouTube o i download di un gioco: un dato
pubblico, non sensibile. Tutto il resto: niente.

## 6. Costi

- **Sviluppo** (la risorsa scarsa vera: capacità delle routine): regolato dal
  **permesso esplicito di creatore** — pochi creatori, poco carico. In
  prospettiva: priorità di coda proporzionale a utenti e feedback dell'app
  (le app di nicchia avanzano piano, non vengono rifiutate — "serve solo a
  lui" non è un fallimento, è la promessa).
- **Esercizio** (API, modelli): crediti dell'account dell'utente che usa
  l'app — oggi regalati dall'owner ma comunque regolamentati, domani
  abbonamenti. Nessun costo separato per-app.

## 7. Fasi

- **Fase 0 — dogfooding (ora)**: l'owner è il primo creatore. Il deck builder
  è di fatto la prima app del sistema; Origanum la prima opera importata.
  Su queste due si formalizza il pipeline: dichiarazione allowlist, feedback
  per-app, categoria locale/condivisa. Nessuna superficie nuova per utenti.
- **Fase 1 — trial ristretto**: 2–3 creatori fidati con permesso esplicito.
  Serve prima: sanificatore feedback (§5.4) e ruolo creatore nella macchina a
  stati. Le conferme di sistema (§5.5) servono solo se nasce la prima app
  condivisa.
- **Fase 2 — apertura**: solo quando fase 1 ha dimostrato che il carico sulle
  routine e la qualità dei giudizi reggono. Non calendarizzata.

## 8. Rimandato esplicitamente

- Riconoscimento in crediti ai creatori (se e quanto).
- Priorità di coda automatica per popolarità (fase 0/1: decide l'owner).
- Soglia di qualità per le opere (chi la giudica, con che criteri).
- Meccanica fine delle app condivise (identità tra utenti, moderazione).
- Revoca/passaggio di mano di un'app quando il creatore sparisce per sempre.
