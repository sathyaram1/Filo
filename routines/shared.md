# Conoscenza condivisa dei ruoli routine

Questo file raccoglie ciò che **più ruoli** usano: decifratura S1, coda su git,
claim, tono dei report, sintomo-vs-causa, invarianti UX, "insistere prima di
mollare". Ogni file-ruolo in `routines/roles/*.md` lo richiama. Lo legge il
worker (mai l'orchestratore) — `scripts/dispatch.mjs` lo passa al worker insieme
al file-ruolo.

> **Eccezione di isolamento.** Il ruolo **secaudit** NON legge questo file per
> intero: la parte "Decifratura feedback S1" gli è preclusa per costruzione (non
> deve mai avere in mano il testo del feedback). `dispatch.mjs` non gli passa né
> il feedback né le sezioni che lo riguardano. Vedi `routines/roles/secaudit.md`.

---

## Decifratura feedback S1 — obbligatoria per i ruoli che leggono un feedback

I campi sensibili dei feedback (`text`, `url`, `status`, `notes`, `priority`,
`clientId`, `name`, …) sono cifrati con prefisso `FENC1:`. La **`priority` è
cifrata** (campo S1): in chiaro rivelerebbe se il feedback è stato schedulato —
segnale di hill-climbing. I metadati pubblici in chiaro: `statusPublic` (lossy),
`seq`/`num`, titolo, `branch`.

`dispatch.mjs` consegna al worker il feedback **già decifrato** (lo ha decifrato
lui in locale, non-LLM, leggendo solo il vincitore). Se per qualche motivo il
worker deve decifrare a mano:

```js
import { decryptFeedbackFields } from '../../scripts/lib/decrypt-feedback-fields.mjs';
const plain = await decryptFeedbackFields(feedbackObject);
// plain.text, plain.notes, plain.priority, ecc. sono ora in chiaro
```

La chiave privata sta nel cloud via env **`FILO_FEEDBACK_PRIVKEY`** (PKCS8
base64, da `scripts/gen-feedback-keys.mjs`; mai committarla). In locale in
`tests/agent/.env`. Se manca, i campi diventano
`[cifrato — chiave privata non configurata]`: il worker NON può lavorare quel
feedback e lo segnala.

---

## Decifrare sintomo, non implementazione — il confine del verifier

Per il **verifier** vale un confine speciale (isolamento di QUALITÀ): vede il
**sintomo utente** (testo + screenshot decifrati) e il **codice nuovo eseguibile**
(`git checkout` del branch), ma NON il **diff come artefatto** né il **report del
risolutore**. Non è un buco di sicurezza vederlo — è che un verificatore che
sbircia il diff diventa un tester peggiore, ancorato allo happy-path di chi ha
scritto il fix. Dettagli in `routines/roles/verifier.md`.

---

## Coda su git: scrivere su Firestore (NON fare PATCH dirette)

⚠️ **L'account robot è BLOCCATO da Google.** Ogni PATCH diretta come ruolo
`routines` fallisce. Al suo posto c'è la **coda su git** (`feedback-triage/`,
vedi il README lì dentro): la routine deposita la decisione come file
`feedback-triage/<id>.json`; l'hook auto-commit lo pusha su `origin/main`; la
**GitHub Action** (`apply-triage.yml`) la applica a Firestore come service
account entro ~1-2 minuti e svuota la coda. Zero azioni owner.

```bash
node scripts/queue-triage.mjs <id> <status:todo|done|clarify|review|blocked|archived> "testo note" [--branch worker/<id>]
```

Per **creare** un nuovo feedback (audit, sub-feedback):

```bash
node scripts/queue-feedback.mjs --status <new|todo|clarify> --name "titolo breve" \
  [--priority 0-3] [--parent <idPadre>] [--image tests/.shots/<slug>.png] "descrizione"
```

Nel report finale di' all'utente che le decisioni sono **in coda** (non ancora
visibili in dashboard per ~1-2 min).

---

## Claim del feedback — semaforo anti-concorrenza

`dispatch.mjs` fa il claim **prima** di consegnarti il lavoro: se il feedback
risulta già claimato da un'altra routine, passa al bucket/feedback successivo e
non ti consegna quel feedback. Quindi **di norma non devi claimare a mano**.

Rilascio manuale (solo se devi abbandonare): `node scripts/claim-feedback.mjs
release <id>`. Il claim ha TTL 60 min e si rilascia da sé quando accodi il triage
`done`/`clarify`. **In sessione locale il claim non serve** (nessuna
concorrenza).

---

## Sintomo vs causa (autorevole in `CLAUDE.md`, richiamato qui)

Un feedback descrive il **sintomo** come lo vede l'utente. La prima domanda non è
"come faccio sparire questo errore" ma **"cosa stava cercando di fare l'utente, e
perché non gli è riuscito"**. Spesso la causa è in tutt'altra parte del codice.

Segnali di "stai fissando il sintomo": cambi solo una stringa per chiudere un bug
funzionale; fai passare il test sbagliando *meno* (messaggio meno fuorviante)
invece di far funzionare la feature; chiudi senza poter rispondere a "se l'utente
riprova adesso, gli funziona?".

Segnale di causa vera: emergono **simmetrie mancanti** — due rami che fanno cose
simili divergono in modo sospetto, o un flusso A funziona ma il flusso B
equivalente no. Leggi i due cammini affiancati.

---

## Invarianti UX — completare ciò che il feedback implica

Quando risolvi, prendi iniziativa sulle **invarianti UX ovvie** che il feedback
implica ma non chiede:

- Se l'utente può aggiungere X, deve poter rimuovere X.
- Se l'app salva N cose, l'utente deve poterle vedere tutte.
- Se Ctrl+V fa Y, anche "Incolla" dal menu deve fare Y (parità tra cammini
  equivalenti).

**Limite**: quando ci sono più modi non equivalenti di fare la cosa (grid vs
modal vs lista…), non scegliere tu: proponi 2-3 opzioni nel report o lascia
`clarify`.

**Regola d'oro anti scope-creep**: nel report **elenca esplicitamente cosa hai
aggiunto oltre il chiesto**, così l'utente lo vede e può dire "no".

---

## Tono dei report e delle `notes`

I report (chat) e le `notes` su Firestore sono **per l'utente**, non per un altro
Claude:

- Niente nomi di variabili, funzioni, file con percorso. Spiega cosa l'utente
  vedrà di diverso, non come l'hai codato.
- Niente paragrafoni "Causa / Fix / Test" in stile diff review.
- Sintesi breve di **cosa hai fatto** (1-3 frasi), **cosa hai aggiunto oltre il
  chiesto** (se qualcosa), **come l'hai verificato**.
- Se serve memoria tecnica per la prossima passata (un vincolo non ovvio che
  potrebbe rompersi), aggiungi in fondo una sezione "Note tecniche" separata.
  Se non serve, non scriverla.

---

## Patch notes e manifesto capacità

Ogni fix/feature **visibile all'utente** richiede, nello stesso lavoro:

- una riga in **`src/shared/patchNotes.js`** (blocco della versione corrente,
  `features[]` o `fixes[]`, frase breve orientata al beneficio, in italiano);
- l'aggiornamento della voce in **`src/shared/capabilities.js`** se cambia una
  **capacità utente** (aggiungi/modifica/togli; `id` kebab-case stabile).

Le voci puramente interne (refactor, test, build, hook) **non** vanno né nel
changelog né nel manifesto. Dettaglio autorevole in `CLAUDE.md`.

---

## Insistere prima di mollare

Non abbandonare al primo intoppo. Se un test fallisce, capiscine la causa e
riprova con un approccio diverso. Se il fix scelto non funziona, prova un altro.

**Le uniche ragioni legittime per NON chiudere un feedback** (→ stato `clarify`):

a) **Ambiguo** — non capisci cosa l'utente voglia, nemmeno dopo testo +
   screenshot + codice circostante.
b) **Richiede una decisione di design** — il fix esiste tecnicamente ma ci sono N
   modi non equivalenti e non sai quale preferisca l'utente.
c) **Mancano informazioni** — il feedback fa riferimento a uno stato che non puoi
   riprodurre dai dati disponibili.

In `clarify` scrivi: cosa hai capito, cosa hai provato, *cosa ti serve sapere*
(domande specifiche). **Non usare `clarify` come scappatoia**: "non sono sicuro
al 100%" non è ambiguità — prova la cosa più ragionevole, verificala, chiudi.

---

## Verifica (REGOLA DURA — autorevole in `CLAUDE.md`)

Non dichiarare "fatto" senza **eseguire il codice** toccato.

- **In cloud (Linux headless)**: `npm test` (suite Playwright) per la regressione,
  e per una feature con UI nuova **aggiungi uno spec Playwright** che la esercita
  (click + assert sul **successo**, non sull'assenza di errore). `test:shoot`
  **ora funziona in cloud** tramite `scrot`+xvfb: usa
  `su tester -c "xvfb-run -a npm run test:shoot -- \"<scenario>\""` per catturare
  screenshot compositi reali (shell + WebContentsView). `test:explore` dipende
  dalla chiave API Gemini in `tests/agent/.env`.
- **Logica pura** (parsing, classificazione, validazione, trasformazioni in
  `src/shared/*` o script): aggiungi/aggiorna uno unit test in `tests/unit/` e
  lancia `npm run test:unit` (node:test, ms, niente Electron).
- Se la verifica non è possibile, **dichiaralo** nel report ("implementato ma non
  verificato end-to-end perché X").
