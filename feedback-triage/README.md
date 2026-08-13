# Coda di triage dei feedback (spool su git)

Questa cartella è una **coda** di decisioni di triage, non un registro.

**Perché esiste.** Le routine cloud non possono più scrivere su Firestore:
l'account Google robot usato per autenticarsi è stato bloccato. Quindi la
routine non scrive lo stato del feedback direttamente — deposita la decisione
qui come un file `<idFeedback>.json`, e l'hook di auto-commit lo pusha su
`origin/main`. Da lì una **GitHub Action** applica la decisione a Firestore e
**cancella** il file. L'owner non deve fare nulla.

Siccome ogni file viene rimosso appena applicato, non resta nessun elenco
permanente di ID risolti che possa diventare stantio quando un feedback viene
riaperto.

## Formato di un file `<id>.json`

```json
{
  "id": "<idFeedback Firestore>",
  "status": "todo | done | clarify",
  "notes": "report breve per l'utente",
  "queuedAt": "2026-06-03T12:00:00.000Z",
  "queuedBy": "routine"
}
```

## Formato di un file `new-*.json` (creazione di un feedback)

Oltre alle decisioni di triage, la coda accetta la **creazione** di nuovi
feedback (è così che una routine spezza una spec corposa in sub-feedback
`todo` lavorabili una sessione alla volta). Il nome file inizia per `new-`:

```json
{
  "op": "create",
  "text": "descrizione autoconsistente del task",
  "name": "titolo breve",
  "parentId": "<idFeedback del padre, o stringa vuota>",
  "status": "new | todo | clarify",
  "priority": 2,
  "notes": "",
  "images": ["https://firebasestorage.googleapis.com/...?alt=media&token=..."],
  "queuedAt": "2026-06-12T12:00:00.000Z",
  "queuedBy": "routine"
}
```

`queuedBy` è la **provenienza** (#443): il ruolo dell'istanza che ha accodato
(`prober`, `new-work`, `fixer`, `verifier`, `secaudit`) — lo scrive il dispatcher
al momento della consegna del lavoro e `queue-feedback.mjs` lo rilegge da solo.
L'applier lo trasforma nel `clientId` del documento (`routine:<ruolo>`), che è
ciò che la dashboard usa per distinguere esplorazione, sviluppo e verifica. Fuori
da un giro di routine resta `routine` generico.

`images` (opzionale) sono URL pubblici di screenshot **già caricati su Firebase
Storage** da `queue-feedback.mjs --image <path>` al momento dell'accodamento (le
storage.rules consentono l'upload senza auth, vedi `scripts/lib/feedback-storage.mjs`).
L'applier li scrive nel campo `images` del documento feedback: la dashboard li
mostra come prova visiva. Solo stringhe http(s), max 5.

L'applier assegna il **numero** al momento della creazione: con `parentId` il
nuovo feedback eredita il numero del padre con suffisso (#22 → #22.1, #22.2…),
senza `parentId` prende il prossimo numero progressivo top-level. Se il padre
non ha ancora un numero (feedback storico), gliene viene assegnato uno al volo.

### Ordine di accodamento = ordine delle dipendenze

Quando spezzi una spec in sub-feedback, **accodali nell'ordine in cui vanno
lavorati** (prima il task che serve al successivo). Il resto è imposto dagli
script, non dal testo:

- `apply-triage.mjs` applica le `create` **in ordine di `queuedAt`** → i numeri
  (#22.1, #22.2, …) seguono l'ordine di accodamento;
- `next-feedback.mjs` (`filterEligible`) rende un sub-feedback **#N.k
  lavorabile solo quando #N.1..#N.k-1 sono chiusi** (done: fuori dai doc open);
  un fratello ancora todo/claimato/in review blocca il successivo. Il
  **top-level con figli aperti** (es. il feedback "ombrello" di una spec) non è
  mai eleggibile: si lavora — cioè si verifica e si chiude — solo quando tutti
  i figli sono done.

Scrivere "dipende dal task X" nel testo resta utile per chi lavora il feedback,
ma non è ciò che garantisce l'ordine.

## Semaforo sui feedback — `claims/<id>.json`

La sottocartella `claims/` è il **semaforo** che impedisce a due routine cloud
avviate a poca distanza di prendere in carico **lo stesso** feedback (tutte
leggono la stessa lista `todo` da Firestore e sceglierebbero lo stesso). A
differenza dei file di triage qui sopra — consumati e cancellati dall'applier —
i file di claim sono **persistenti** per tutta la durata del lavoro.

```jsonc
// feedback-triage/claims/<idFeedback>.json
{
  "id": "<idFeedback>",
  "by": "<slug routine / host-pid>",
  "claimedAt": "2026-06-16T12:00:00.000Z",
  "expiresAt": "2026-06-16T13:00:00.000Z",  // claimedAt + TTL (default 60 min)
  "num": "#22.1"
}
```

- **Acquisizione/rilascio** con `scripts/claim-feedback.mjs` (vedi sotto). Il
  file viene pushato su `origin/main` con un push ff-only, così le altre routine
  lo vedono in **pochi secondi** (non i ~1-2 min della Action): è lì il
  mutuo-esclusione vero.
- **Scadenza (TTL)**: oltre `expiresAt` il claim è morto e il feedback torna
  libero (così una routine che crasha non lo blocca per sempre). `apply-triage`
  e `claim-feedback.mjs prune` rimuovono i file scaduti.
- **UI**: `apply-triage.mjs` **specchia** i claim vivi su Firestore (campi
  `claimedBy`/`claimExpiresAt`/`claimNum` sul doc feedback) così la dashboard
  mostra "🔧 in lavorazione". Quel passo serve SOLO alla visualizzazione: il
  lock non dipende da Firestore.

```bash
node scripts/claim-feedback.mjs acquire <id> [--num "#22.1"]  # exit 0=preso, 10=occupato
node scripts/claim-feedback.mjs release <id>                  # a fine lavoro
node scripts/claim-feedback.mjs list                          # claim attivi
```

## Registro dei worker — `wl-<istante>-<casuale>.json`

Ogni volta che il dispatcher consegna il lavoro a un worker lascia qui una riga
di registro, che l'applier scrive nel campo `workerLog` del documento
`config/automation` — è quello che la dashboard mostra nella tab Automazioni.

```json
{
  "op": "worker-log",
  "role": "new-work",
  "startedAt": "2026-08-13T12:00:00.000Z",
  "num": "#22.1",
  "queuedAt": "2026-08-13T12:00:00.000Z",
  "queuedBy": "dispatch"
}
```

**Perché passa da qui** (feedback #451): prima il dispatcher scriveva quel campo
direttamente su Firestore con una credenziale admin, e in silenzio se la
credenziale mancava. Nelle macchine delle routine non c'è mai stata: il registro
è nato vuoto ed è rimasto vuoto per tutta la sua esistenza. Dalla coda invece la
scrittura la fa la GitHub Action col service account, che la credenziale ce l'ha
per costruzione.

Le voci si applicano **tutte insieme** (una lettura e una scrittura sole) e le
duplicate — stesso ruolo, stesso istante — vengono scartate: la spedizione si
ritenta, e un registro che conta due volte lo stesso worker mentirebbe. Se la
scrittura fallisce i fogliettini **restano in coda** e ci riprova il giro
successivo.

## Op di manutenzione (rare)

La coda accetta anche due operazioni una-tantum, utili quando in locale non
c'è nessuna credenziale admin (la Action le esegue col service account):

- `{"op": "backfill"}` — assegna il numero progressivo ai feedback storici
  che non ne hanno (equivale a `npm run feedback:backfill`).
- `{"op": "delete", "id": "<idFeedback>"}` — elimina un documento, ma SOLO
  se è un doc di test (`clientId` che inizia per `test:`). Per i feedback
  veri la cancellazione resta un'azione manuale dell'admin.

## Come si accoda (routine cloud)

```bash
node scripts/queue-triage.mjs <id> <status:todo|done|clarify> "testo note"   # triage
node scripts/queue-feedback.mjs --name "titolo" [--parent <id>] \
  [--priority 0-3] [--status new|todo|clarify] "testo"                      # creazione
#   Default: un ritrovamento NUOVO (senza --parent) nasce `new` → Ricevuti, così
#   passa dal giudizio e dall'auto-approvazione per mittente (#446). Con --parent
#   nasce `todo`: la spec padre l'owner l'ha già approvata. `--status todo` su un
#   top-level scavalca il cancello: esplicito sì (l'allarme dei controlli rossi in
#   pubblicazione), per distrazione no.
```

oppure crea il file a mano con l'editor: in una sessione Claude l'hook di
auto-commit lo committa e pusha.

## Come si applica — automatico (GitHub Action, primario)

Il workflow `.github/workflows/apply-triage.yml` si sveglia a **ogni push** che
tocca `feedback-triage/*.json`, esegue `scripts/apply-triage.mjs` e svuota la
coda. Si autentica come **service account** (non un account Google personale →
nessun rischio di blocco come l'account robot). Latenza tipica: ~1-2 minuti dopo
il push della routine. **L'owner non deve fare niente.**

La chiave del service account vive nel secret di repo `FILO_SA_KEY` (vedi
"Setup una tantum" sotto). Il commit che svuota la coda contiene `[skip ci]`,
così non ri-triggera il workflow all'infinito.

### Setup una tantum (lo fa l'owner, una sola volta)

1. **Crea il service account** nella console Google Cloud del progetto
   `filo-8b9cb`:
   - vai su <https://console.cloud.google.com/iam-admin/serviceaccounts?project=filo-8b9cb>
   - "Create service account" → nome es. `filo-triage` → Create and continue.
2. **Dagli il permesso di scrivere su Firestore**: nel passo "Grant access"
   (o poi da IAM) assegna il ruolo **Cloud Datastore User**
   (`roles/datastore.user`) → Done.
3. **Scarica la chiave JSON**: apri il service account → tab "Keys" → "Add key"
   → "Create new key" → **JSON** → Create. Si scarica un file `.json`.
4. **Incollalo nei GitHub Secrets** del repo `sathyaram1/Filo`:
   - Settings → Secrets and variables → Actions → "New repository secret"
   - Name: **`FILO_SA_KEY`** — Value: **tutto il contenuto del file JSON**
     (incolla il file intero, comprese le graffe) → Add secret.
5. Fatto. Da ora ogni decisione accodata dalle routine viene applicata da sola.
   Per provarlo subito: tab **Actions** del repo → "Applica coda feedback" →
   "Run workflow".

⚠️ La chiave JSON del service account **non va mai committata** né incollata in
file tracciati (incluso questo README e CLAUDE.md): sta SOLO nei GitHub Secrets.

## Come si applica — manuale, in locale (fallback dell'owner)

Se la GitHub Action è giù o vuoi applicare subito senza aspettare:

```bash
npm run feedback:apply            # applica a Firestore e svuota la coda
npm run feedback:apply -- --dry-run   # mostra cosa farebbe, senza scrivere
```

In locale lo script usa il refresh token Firebase dell'account **owner**
(`FILO_ADMIN_REFRESH_TOKEN`, vedi `scripts/admin-login.mjs`) — NON il service
account. È un fallback: con la Action attiva di solito la coda è già vuota.

I file `*.json` qui dentro **vanno committati** (sono il trasporto). Non
gitignorarli: senza commit la decisione non arriva né alla Action né alla
macchina locale.
