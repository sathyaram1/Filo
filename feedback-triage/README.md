# Coda di triage dei feedback (spool su git)

Questa cartella è una **coda** di decisioni di triage, non un registro.

**Perché esiste.** Le routine cloud non possono più scrivere su Firestore:
l'account Google robot usato per autenticarsi è stato bloccato. Quindi la
routine non scrive lo stato del feedback direttamente — deposita la decisione
qui come un file `<idFeedback>.json`, e l'hook di auto-commit lo pusha su
`origin/main`. In locale l'owner esegue `npm run feedback:apply`, che applica
le decisioni a Firestore con le credenziali admin (non bloccate) e **cancella**
i file applicati.

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

## Come si accoda (routine cloud)

```bash
node scripts/queue-triage.mjs <id> <status:todo|done|clarify> "testo note"
```

oppure crea il file a mano con l'editor: in una sessione Claude l'hook di
auto-commit lo committa e pusha.

## Come si applica (owner, in locale)

```bash
npm run feedback:apply            # applica a Firestore e svuota la coda
npm run feedback:apply -- --dry-run   # mostra cosa farebbe, senza scrivere
```

Richiede `FILO_ADMIN_REFRESH_TOKEN` (vedi `scripts/admin-login.mjs`).

I file `*.json` qui dentro **vanno committati** (sono il trasporto). Non
gitignorarli: senza commit la decisione non arriva alla macchina locale.
