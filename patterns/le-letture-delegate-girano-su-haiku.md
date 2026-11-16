# Le letture delegate girano su Haiku

[← Tutti i pattern](../PATTERNS.md)

Una lettura o una ricerca che un agente delega (dove sta una cosa, come arriva
un messaggio, quali file toccano una regola) va al sotto-agente `lettore`
(`.claude/agents/lettore.md`): Haiku, sola lettura, senza lo strumento Agent.
Il giudizio (cosa cambiare, se un rilievo regge, un verdetto) resta a chi lo
lancia, sul modello del suo ruolo.

## Perché

Le routine mettono `CLAUDE_CODE_SUBAGENT_MODEL=opus`: un sotto-agente lanciato
senza dire il modello gira su Opus, e le esplorazioni che CLAUDE.md chiede di
delegare sono la maggior parte dei lanci. Il modello scritto nella definizione
vince su quella variabile, ma non su `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`: con
quella accesa Claude Code ignora definizione e parametro `model` (che sparisce
dallo strumento Agent) e mette a tutti il modello della variabile.

Misurato il 16 novembre 2026 (Claude Code 2.1.325), con una definizione
`model: haiku` e `CLAUDE_CODE_SUBAGENT_MODEL=opus`: FORCE assente o `0` → il
sotto-agente gira su Haiku; FORCE `1` → Opus. Un `"0"` nell'`env` dei settings
non spegne un FORCE che arriva dall'ambiente del processo. Nel contenitore
cloud delle routine FORCE arriva così, dalle variabili dell'ambiente cloud:
finché c'è, il `lettore` gira su Opus come prima, e lo stesso vale per il
modello per fase che il gancio mette sul lancio dei worker. Toglierla è un
passo dell'owner.

## La misura (#2122, 16 novembre 2026)

Dieci esplorazioni vere sul repo, le stesse per ogni modello, lanciate con gli
stessi strumenti del `lettore` (Read, Grep, Glob) e la stessa consegna (250
parole, percorso:riga, solo file aperti). Domande: shell del terminale fuori da
Windows, catena modello e sforzo dei ruoli, porte della segnalazione nelle
Novità, chiamate al catalogo di OpenRouter, strada di `broadcastLiveUpdate`,
scorciatoie Alt su Mac, scrittura di `storage.json`, moduli incorporati dal
server, correttore ortografico, salvataggio automatico.

| | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|
| costo delle dieci, a listino | 2,77 $ | 1,21 $ | 0,09 $ |
| per esplorazione | 0,28 $ | 0,12 $ | 0,009 $ |
| tempo medio | 30 s | 25 s | 25 s |
| contesto massimo | 38k | 35k | 58k |
| risposte giuste nella sostanza | 10 su 10 | 10 su 10 | 10 su 10 |
| file inventati | 0 | 0 | 0 |

Differenze di qualità, tutte piccole: Opus è il più completo (sulla catena dei
modelli trova anche l'orchestratore locale, su `storage.json` il recupero dalla
copia). Sui moduli incorporati dal server (risposta vera: dieci) Opus e Haiku
li elencano tutti, ma il riassunto di testa ne conta undici e otto; Sonnet ne
salta uno e ne aggiunge uno che lo dice a metà file. Tutti e tre citano file
visti solo nei risultati di Grep, e tutti lo dichiarano. I percorsi
«inesistenti» citati sono del repo del server, letti in un commento.

Haiku costa il 3% di Opus a parità di esito; Sonnet non ha dato niente più di
Haiku. Il costo vero di un'esplorazione è quasi tutto nella prima scrittura
del prompt di sistema in cache (circa 20k token), che Haiku paga un ventesimo.

## Contesto oltre 100k

Il listino di Haiku 5.5 sale di cinque volte sopra i 100.000 token di prompt
(0,50 $ in ingresso e 2,50 $ in uscita per milione, contro 0,10 e 0,50): resta
a un quarto di Sonnet. Nella misura nessuna esplorazione ha passato i 58k, e
una lettura delegata che li passasse è già da spezzare. Per questo il
`lettore` non ha una soglia di compattazione sua: vale quella di Claude Code.

## Dove vive

- La definizione: `.claude/agents/lettore.md`.
- La regola per tutti: CLAUDE.md § Il contesto si paga a ogni turno.
- Per i worker: `routines/roles/_contratto-worker.md` § Sotto-agenti.
- La sentinella: `tests/unit/lettoreHaiku.test.mjs`.
