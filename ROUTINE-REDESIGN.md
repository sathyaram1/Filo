# Redesign automazione routine — spec confermata (2026-06-27)

Stato: **design confermato dall'owner in chat, implementazione da fare.** Questo
file è l'artefatto durevole del ridisegno; quando l'implementazione è completa,
il suo contenuto confluisce in `ROUTINES.md` (nuovo) + i file-ruolo, e questo
file si elimina.

## Principio centrale

L'orchestratore decide solo **SE** continuare il loop, non **QUALE** sotto-agente
lanciare. Il "quale" lo decide uno **script deterministico** (`dispatch.mjs`),
non un LLM. Questo è più fedele all'idea originale ("il primo agente sceglie solo
se lanciare un sotto-agente") ed elimina superficie d'attacco.

## Flusso

```
ORCHESTRATORE (banale, non legge NIENTE — né metadati né corpi):
  loop:
    - prima di rispawnare: CONTROLLO BUDGET (ex R4):
        npx ccusage@latest blocks --active --json → costUSD
        se ≥ soglia ALTA → checkpoint, rilascia claim, termina
        se ccusage non gira → ripiega sul budget di contesto
        rete di sicurezza: 429 → checkpoint + rilascio claim + termina
    - spawna un worker GENERICO (subagent_type general-purpose, model sonnet)
      prompt minimo: "esegui `node scripts/dispatch.mjs`, poi fai ciò che ti dice"
    - il worker torna una riga: "fatto X" | "niente da fare" | "budget pieno"
    - se "niente da fare"/"budget" → stop ; altrimenti ripeti

dispatch.mjs (NON-LLM, deterministico) — gira DENTRO il worker:
  1. sceglie il bucket per precedenza, leggendo solo lo STATO (mai testi liberi):
       branch passato da verifier ma senza verdetto L4   → secaudit   (M1)
       feedback `review` con branch                       → verifier   (M2)
       branch con FAIL del verifier in attesa             → fixer      (M3)
       c'è un todo (vincitore di next-feedback)           → new-work   (M4+M5)
       niente                                             → prober     (M6, audit)
  2. fa il CLAIM atomico (se già preso → prossimo bucket/feedback)
  3. legge/incrementa il CONTATORE LOOP persistito per quel branch
     (routines/state/<id>.json o campo sul doc); a 3 FAIL → bucket "blocked(loop)"
     invece di fixer, e marca il feedback con motivo `loop`
  4. aggrega SOLO la fetta che quel ruolo può vedere (vedi Isolamento)
  5. stampa JSON: { role, payload, claim, loopCount, instructions: <file-ruolo inline> }

worker: legge l'output, DIVENTA quel ruolo, esegue.
```

`dispatch.mjs` inlinea il contenuto del file-ruolo → i file-ruolo sono letti
**come dati**, non registrati come tipi di agente. Quindi NON serve che il cloud
onori `.claude/agents/` (incognita risolta): il worker resta sempre
`general-purpose`, il ruolo è dato.

## I 5 punti di spawn (6 compiti concettuali)

| Ruolo | Compito | Vede | NON vede |
|-------|---------|------|----------|
| secaudit (M1) | verifica sicurezza del diff (L4) | **solo il diff** | il feedback, le note, gli screenshot |
| verifier (M2) | stress test + visivo, black-box dal sintomo | feedback decifrato + **codice nuovo eseguibile** (checkout del branch) | il **diff** come artefatto, le note/report del risolutore |
| fixer (M3) | corregge data la critica del verifier | feedback + critica FAIL | il diff del risolutore originale |
| new-work (M4+M5) | risolve un feedback; **se è una spec grossa, la spezza** in sub-feedback | feedback decifrato | — |
| prober (M6) | audit autonomo → genera feedback | Filo (lo usa davvero) | — |

**M4 e M5 sono fusi** (confermato): solo dopo aver letto il feedback si sa se è
"spec da spezzare" o "fix normale", quindi è il ruolo `new-work` a forkare, non lo
script.

## Isolamento — due nature diverse

- **secaudit (M1)** → isolamento **di SICUREZZA**, quindi **strutturale**: il
  testo del feedback non entra MAI nel suo contesto (dispatch non glielo passa; il
  ruolo gli dice di non andarlo a prendere). È il gate anti prompt-injection.
- **verifier (M2)** → isolamento **di QUALITÀ**, quindi **comportamentale**: "non
  vede il diff" ≠ "non vede il codice". Il codice nuovo è fisicamente lì
  (`git checkout worker/<id>`) e DEVE esserlo per testare; ciò che non riceve è il
  **diff come artefatto** e il **report del risolutore**, così lavora black-box dal
  sintomo utente e non si àncora allo happy-path del risolutore. Se sbirciasse il
  diff sarebbe solo un tester peggiore, non un buco di sicurezza.

## Struttura file target

```
CLAUDE.md            MINIMO (~100 righe): convenzioni repo valide per QUALSIASI
                     agente (porting IIFE, shim, comandi test, patch notes,
                     capabilities) + uno "switch di ruolo" in cima.
LOCAL.md             Sessione locale (owner + Claude): NON si scrive codice in
                     Filo (stato bersaglio, quando le routine saranno riaccese);
                     si discute, si scrivono feedback, si lavora su filo-security.
ROUTINES.md          SOLO l'orchestratore banale: avvio, loop, budget (R4),
                     sequenzialità, come spawna. NON i dettagli dei ruoli.
routines/roles/      secaudit.md verifier.md fixer.md new-work.md prober.md
routines/shared.md   Info usata da più ruoli: decifratura S1, coda git/
                     queue-triage, claim, tono report, sintomo-vs-causa,
                     invarianti UX. Ogni file-ruolo la richiama.
scripts/dispatch.mjs Precedenza + claim + contatore loop + payload per-ruolo +
                     output JSON che inlinea il file-ruolo. Riusa
                     next-feedback.mjs e la logica di claim.
```

`TASKS.md` (pubblico) → **eliminato**. Il lavoro pubblico vive nei feedback; il
lavoro `filo-security` vive in `filo-security/TASKS.md`.

## Disposizione degli item aperti di TASKS.md (pubblico)

- **R4 (budget)** → regola di stop nel nuovo `ROUTINES.md`. Sopravvive.
- **R5 (schedulare 2 account su claude.ai)** → azione owner, da ricordare a fine
  redesign.
- **Deploy rules + Deploy functions** → li esegue Claude (claude-can-deploy);
  verificare i deploy rules arretrati di DB2/DB4/DC3/DC4 (`reviewDecision`,
  `archiveOverride`, `reopenRequests`, `votes`, `priorityManual`).
- **DD3 residuo + S1.4 + S1.F2.3 (backend sanitizer/decrypt)** → **filo-security**,
  migrano in `filo-security/TASKS.md`, li implemento io in locale. Le routine non
  hanno accesso a filo-security.
- **Consolidamento suite test** → feedback pubblico (le routine ci arrivano).
- **P4 (spike cattura visiva cloud)** → già feedback **#237**. Non duplicare.

## Dashboard (manage) — colori per tipo

`SN_MANAGE_REVIEW.classifyBlock`/`REASONS` già colora il bordo: attacco (rosso),
spam (arancio), design (blu). Da estendere: stato **bloccato** nella tassonomia +
**nero** riservato a `blocked` per **loop** (i 3 FAIL di verifier→fixer, stato
nuovo introdotto da questo redesign). I feedback convertiti vanno creati come
`todo` → tab "In coda".

## I giudici girano già

`onFeedbackCreate` (filo-security) è **deployata** (v2, europe-west1) → ogni
feedback creato passa da L1/L2 (annota `feedback.pipeline`) e, se entra in coda,
dal giudice di priorità. Per "far valutare" i convertiti basta crearli
normalmente. Verificare `feedback.pipeline` sui doc creati = prova che i giudici
hanno girato.

## Ordine di esecuzione consigliato (multi-sessione)

1. Migrare il residuo filo-security in `filo-security/TASKS.md` + implementarlo
   (DD3/S1.4/S1.F2.3) — sessione locale.
2. Doc: `CLAUDE.md` minimo + `LOCAL.md` + nuovo `ROUTINES.md` + `routines/roles/*`
   + `routines/shared.md`.
3. `scripts/dispatch.mjs` + unit test (precedenza, claim, contatore loop, payload
   per-ruolo, isolamento).
4. Dashboard: estendere `classifyBlock`/`REASONS` (bloccato + nero-loop).
5. Convertire gli item pubblici in feedback + eliminare `TASKS.md` pubblico.
6. Verificare deploy rules arretrati; ricordare R5 all'owner.
```
