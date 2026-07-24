# Filo — Deck Builder Commander (MTG): Specifica Tecnica

## Principio di design

Prima applicazione "Filo-style": la chat è il motore, la GUI è la shortcut. Ogni azione possibile via UI è possibile via linguaggio naturale; la UI esiste dove il click è più veloce della frase. Le primitive LLM-native (traduzione NL→query Scryfall, auto-tag, parere contestuale) sono il differenziale — un utente può concepire "un deck builder", non può concepire queste.

Il pattern stabilito qui (chat come colonna che produce oggetti manipolabili accanto al documento) è riusabile per le future app Filo.

---

## 1. Struttura dell'app: tre schermate

| Schermata | Stato alpha | Contenuto |
|-----------|-------------|-----------|
| **Mazzi** | Completa | Libreria: entry point, griglia dei mazzi |
| **Builder** | Completa | Editing di un mazzo (layout a 3 colonne, §2) |
| **Partita** | **Stub** | Placeholder + routing predisposto (direzione in §12) |

Navigazione: Mazzi è la home dell'app; click su un mazzo → Builder. Il routing a tre schermate va predisposto subito anche se Partita è vuota.

---

## 2. Builder — Layout a tre colonne fisse

**Nessun ridimensionamento automatico** (né su hover né su click): il resize automatico crea bersagli mobili. Tre colonne a larghezza fissa:

| Colonna | Larghezza | Contenuto |
|---------|-----------|-----------|
| Sinistra — **Chat / Risultati** | Media (più stretta di una chat standard: qui scorrono liste, non prosa lunga) | Chat unificata con l'agente + risultati ricerca |
| Centro — **Mazzo** | La più stretta (~300px: nome troncato + costo mana) | Elenco carte con gruppi collassabili |
| Destra — **Detail / Statistiche** | Il resto | Tre stati: statistiche / preview / carosello (§5) |

- **Divisori trascinabili a mano**, posizione persistita. È l'unico resize ammesso: deliberato, mai automatico.
- La carta Magic è portrait (~63:88): si renderizza nella larghezza corrente del pannello destro, qualunque essa sia. Il pinning (carosello) cambia il contenuto, mai la geometria.

---

## 3. Colonna Chat / Risultati

### 3.1 Ricerca e chat sono lo stesso pannello

La barra di ricerca è una shortcut del chiedere all'agente. Query secca ("commander izzet") → lista carte; frase conversazionale ("modi per stappare il commander") → risposta + eventuale lista. Entrambe passano dall'LLM che traduce in query Scryfall.

### 3.2 Messaggi tipizzati

I messaggi non sono testo: sono **contenuto tipizzato**. Una bolla può contenere testo, un componente `CardList`, o entrambi.

- Il tool di ricerca restituisce **dati strutturati** (lista di ID Scryfall); la bolla renderizza `CardList` da quegli ID, non markdown.
- Scrollando indietro, le bolle si ri-renderizzano dagli ID salvati; l'agente può riferirsi a "i risultati di prima" perché sono dati, non prosa.

### 3.3 Gestione dello scroll

- **Ultima bolla**: `CardList` mostra ~10 righe con scroll interno.
- **Bolle precedenti**: elenchi carte **sempre collassati** a una riga di sintesi ("12 risultati per 'payoff self-mill'"), riespandibili al click. La cronologia resta scorrevole rapidamente.

### 3.4 Righe carta (in `CardList`)

- Nome (tronca con ellissi) + **costo di mana** destro-allineato, renderizzato con i simboli SVG ufficiali di Scryfall (`{2}{U}{R}` → glifi; minuscoli, cacheati per sempre).
- Spunta/toggle "aggiungi al mazzo" per riga.
- Ordinamento default per CMC.
- **Nessuna immagine caricata** finché non c'è hover.

### 3.5 Nomi carta in prosa

L'agente è istruito a marcare **sempre** i nomi carta con la sintassi `[[Nome Carta]]` (standard delle community MTG, nativa per i modelli). Il renderer trasforma i marcatori in span hoverable, risolti via Scryfall (`/cards/named?fuzzy=`). Niente riconoscimento a posteriori del testo (fragile, fallisce su nomi parziali e in italiano). Dictionary-matching di fallback: solo se serve, dopo.

---

## 4. Ricerca semantica

**Flusso:** input utente → LLM traduce in query Scryfall → esecuzione → `CardList`.

- **Filtro color identity automatico**: ogni ricerca è vincolata all'identità del commander (`id<=WUBRG-subset`). "Modi per dare haste" in un mazzo Izzet non deve mai proporre carte verdi.
- **Query cross-mazzo** ("il ramp di mazzo X"): non è una feature di layout, è scope della query. L'agente risolve il riferimento leggendo l'altro mazzo (carte + tag) e produce una `CardList` normale, aggiungibile al mazzo corrente.
- Query ibride (semantica + sintassi Scryfall esplicita) passano invariate dove l'utente usa sintassi nativa.

---

## 5. Pannello destro — tre stati

Le statistiche sono lo **stato di riposo**; il pannello non si ridimensiona mai, cambia solo contenuto.

| Stato | Trigger | Contenuto |
|-------|---------|-----------|
| **Statistiche** | Default; ritorno automatico | §8 |
| **Preview** | Hover su una riga carta (ovunque) | Carta + contesto (§5.2) |
| **Carosello** | Click su una riga carta | Pinnato: flusso di triage (§5.3) |

### 5.1 Sistema di preview unificato

**Un componente unico, tre consumatori**: righe risultati (chat), righe mazzo (centro), nomi in prosa (`[[...]]`). Comportamento e timing identici ovunque.

Timing (valori di partenza, fine-tuning in test dal vivo):
- Apertura: ~200ms di ritardo (anti-flicker).
- Passaggio riga→riga: grace period ~100ms — il contenuto si **aggiorna sul posto**, senza chiudi-riapri.
- Uscita: ritorno alle statistiche dopo ~1s di linger (non istantaneo, o flickera).

Immagini: caricate solo all'hover; cache locale delle immagini Scryfall; nel carosello, prefetch di successiva e precedente.

### 5.2 Contenuto del detail: la carta nel contesto del mazzo

Sopra: immagine della carta. Sotto, riga di contesto: **prezzo** (Cardmarket EUR via Scryfall), tag già assegnati, indicatore "già nel mazzo".

Poi un **box modulare** (slot): tasto destro sul box → "modifica" → scelta del modulo, secondo il sistema moduli esistente di Filo. Moduli alpha (2-3 + default):

1. **Mini mana curve** con evidenziato dove cadrebbe la carta ("mi fixa la curva?" ha risposta visiva senza uscire dal detail).
2. **Prezzo + dati** (prezzo, ristampe, legalità).
3. **Parere di Filo** (§6).

Futuro: chart dei tag, "hai già 3 carte che fanno questo" (ridondanza funzionale).

### 5.3 Carosello (click) — flusso di triage

Il caso d'uso: 50 risultati, valutati uno a uno, aggiunti quelli buoni. Occhi sull'immagine, mano sulla tastiera.

- Immagine piena + indicatore posizione ("23/50") + toggle aggiungi/rimuovi + carte già aggiunte marcate.
- **Scorciatoie**: ←/→ (o ↑/↓) naviga, Invio/Spazio aggiunge/rimuove, Esc chiude → statistiche.
- All'aggiunta, la riga **appare nel gruppo giusto della colonna centrale**: feedback immediato, il mazzo cresce sotto gli occhi.
- Il carosello naviga la lista da cui è partito (risultati di quella bolla, o elenco mazzo).

---

## 6. Parere LLM

Giudizio contestuale sulla carta rispetto al mazzo corrente.

### 6.1 Trigger

| Evento | Azione |
|--------|--------|
| Hover / carosello su una carta | Chiamata per la carta corrente + prefetch delle vicine nel carosello |
| Aggiunta di una carta al mazzo | Parere calcolato per la carta appena aggiunta |
| Richiesta esplicita ("valuta il mazzo", "valuta questi risultati") | Batch sull'insieme indicato |
| In chat, su carta specifica | Risposta conversazionale normale (il caso più frequente in pratica) |

**Mai** batch automatico sui risultati di ricerca: una ricerca sbagliata non deve far partire decine di chiamate.

### 6.2 Cache e invalidazione

- Cache per **(carta, versione del mazzo)**. La versione è un contatore che incrementa a ogni modifica del mazzo.
- Dopo una modifica, i pareri esistenti restano visibili ma **marcati stantii** (pallino discreto, non un muro): un parere calcolato su 97/100 carte è quasi sempre ancora valido.
- Refresh: on-demand per carta singola, o batch completo su richiesta. Mai rigenerazione eager a ogni edit.

### 6.3 Economia

Modello economico classe DeepSeek (~$0.5/M input, ~$1/M output), mazzo (~50k token) in **input cache**:

| Operazione | Costo stimato |
|-----------|---------------|
| Parere singola carta (input cached + ~1k output) | ~$0.001–0.002 |
| Batch completo (100 carte, reasoning abbondante) | ~$0.10–0.15 |

Con margine 20% del sistema crediti, operazione vendibile senza attrito. Downgrade a modello più piccolo / meno reasoning se serve. Il parere ambientale è per pochi; la maggioranza chiederà in chat su carte specifiche — il costo reale medio sarà molto sotto questi tetti.

---

## 7. Auto-tag

- L'utente chiede in chat: "tagga il mazzo con ramp, draw, removal, payoff self-mill".
- Per ogni carta, un LLM economico giudica l'appartenenza a ogni tag (batch, input cache sul mazzo).
- **Cache per (carta, tag)** quando il tag è context-free (dipende solo dal testo della carta: "ramp", "payoff self-mill") — riusabile tra mazzi. Tag contestuali ("sinergizza col mio commander") ricalcolati per mazzo.
- I tag alimentano: raggruppamento (§8.1), calcolatore di probabilità (§9.3), query cross-mazzo (§4).

---

## 8. Colonna Mazzo (centro)

### 8.1 Elenco carte

- Righe: nome + costo mana (come §3.4). Con **focus sulla colonna**: info extra per riga (prezzo).
- **Divisori di gruppo collassabili**. Il raggruppamento è una funzione di visualizzazione: per tipo (default) / per tag / per CMC / per colore. "Dividi in questi tag" via chat cambia la vista.
- Con tag multipli, la carta appare **una sola volta**, nel primo gruppo che matcha (ordine dei gruppi definito); il conteggio 100 resta leggibile. Tasto destro → "sposta in gruppo" fa override. L'override è **per-vista** (#316): vale solo nella vista di raggruppamento in cui è stato fatto — cambiando raggruppamento la carta torna al criterio naturale di quella vista, senza trascinarsi dietro il gruppo forzato altrove. Override in viste diverse sono indipendenti.
- Dentro ogni gruppo, ordinamento default per CMC.

### 8.2 Header della colonna = identità del documento

Nome del mazzo + **commander** (sempre visibile). Click sul nome → **switcher**: cambia mazzo, nuovo, duplica, importa, esporta, elimina, budget. La gestione mazzi vive dove vive il mazzo.

### 8.3 Tasto destro sulla riga carta

"Voglio fare qualcosa qui": rimuovi · sposta in gruppo · copia/sposta in mazzo X · imposta come commander · apri su Scryfall.

### 8.4 Il commander è un parametro del mazzo, non una carta

- La sua **color identity filtra ogni ricerca** automaticamente (§4).
- Statistiche su 100 singleton; check duplicati, identity per carta, banned list (`legalities.commander` di Scryfall) come riga del pannello stats.
- Mostrato nell'header e come art crop nella libreria (§10).

---

## 9. Statistiche

Stato di riposo del pannello destro. Card verticali:

### 9.1 Statistiche base
- Curva dei costi (istogramma per CMC).
- Mana **richiesto** per colore (conteggio pip nei costi).
- Mana **prodotto** per colore (fonti: terre + rock + dork, dai dati carta).
- CMC medio, conteggio per tipo, conteggio totale /100.
- Riga legalità: singleton ✓, identity ✓, banned ✓.

### 9.2 Modulo budget
- Tetto impostabile via chat ("budget 40€") o dal menu del mazzo (switcher).
- Totale / residuo sempre visibili. Prezzi Cardmarket EUR da Scryfall (cache con TTL).
- Prima classe perché i gruppi proxy si danno limiti di budget: il budget è una statistica, non un calcolo mentale.

### 9.3 Calcolatore di probabilità
- Input: mano desiderata a turno N — es. "al turno 10: 2 ramp, 3 terre, 1 removal". Le categorie sono i tag.
- **Motore: simulazione Monte Carlo locale** (~10k pescate, millisecondi, costo zero): gestisce nativamente tag sovrapposti, mulligan, pescate extra — dove la formula ipergeometrica multivariata chiusa si complica.
- UI: sotto-pannello dentro statistiche + invocabile via chat ("probabilità di 2 ramp e 3 terre al turno 10"), che resta più veloce di qualsiasi form.

---

## 10. Schermata Mazzi (libreria)

- Griglia di card: **art crop del commander** (Scryfall lo espone ritagliato), nome mazzo, pip dei colori, prezzo totale, ultima modifica.
- Click → Builder. Tasto destro → duplica / esporta / elimina (coerente col resto).
- È la vista in cui i mazzi esistono come oggetti confrontabili — "il ramp di mazzo X" diventa navigabile oltre che interrogabile.

---

## 11. Import / Export

Due vie, complementari:

1. **Switcher (parser rigido)**: formato testuale standard (`1 Sol Ring` per riga — quello di Moxfield/Archidekt). Export nello stesso formato.
2. **Chat (parser LLM)**: incolli la lista grezza in chat → l'agente parsa → bolla `CardList` con conferma. Gestisce gratis i casi sporchi: typo, formati strani, nomi in italiano.

---

## 12. Partita (direzione, fuori scope alpha)

**Non esiste la via di mezzo fra tavolo manuale e rules engine.** Un motore di regole Magic è un progetto pluriennale (Forge/XMage = decenni-uomo; Commander è il formato peggiore per le interazioni). La versione trattabile è il modello Cockatrice/untap:

- Tavolo virtuale condiviso, stato manipolato a mano, **zero enforcement**, fiducia come dal vivo.
- Feature Filo: agente come **judge consultivo** ("posso rispondere a questo con...?") che legge lo stato del tavolo senza enforzarlo — il parere costa una chiamata, l'enforcement costerebbe il motore.
- **Unico vincolo da rispettare oggi**: il modello dati resta ID Scryfall + quantità (§13), per non chiudersi la strada.

---

## 13. Dati e infrastruttura

### 13.1 Modello dati (storage locale)

```
mazzo {
  id, nome,
  commander: scryfall_id,
  carte: [{ scryfall_id, qty (=1 salvo basics), tags[], gruppo_override? }],
  raggruppamento: "tipo" | "tag" | "cmc" | "colore",
  budget?: number,
  versione: int,            // incrementa a ogni edit → invalidazione pareri
  created_at, updated_at
}
```

Storage interamente locale (come l'archivio tab: JSON o SQLite). Sync cloud fuori scope alpha.

### 13.2 Scryfall

| Uso | Endpoint / risorsa |
|-----|--------------------|
| Ricerca | `/cards/search` con sintassi query (+ `id<=` per identity) |
| Risoluzione nomi `[[...]]` | `/cards/named?fuzzy=` |
| Prezzi | `prices.eur` (Cardmarket) — cache con TTL |
| Simboli mana | Symbology SVG — cache permanente |
| Immagini | `image_uris` (normal per detail, `art_crop` per libreria) — cache locale |
| Dati carta bulk | Bulk data download opzionale per lookup locale veloce/offline |

Rispettare i rate limit di cortesia (~10 req/s); tutte le risorse statiche cacheate localmente.

### 13.3 Cache riassunto

| Cosa | Chiave | Vita |
|------|--------|------|
| Immagini, simboli | URL | Permanente |
| Prezzi | scryfall_id | TTL (ore) |
| Tag context-free | (carta, tag) | Permanente, cross-mazzo |
| Pareri | (carta, versione mazzo) | Fino a refresh; stantio marcato dopo edit |

---

## 14. Costi operativi stimati

| Operazione | Costo unitario |
|-----------|----------------|
| Traduzione NL→query Scryfall | ~$0.0005 |
| Parsing import via chat | ~$0.001 |
| Auto-tag (passaggio mazzo intero, cache input) | ~$0.02–0.05 |
| Parere singola carta | ~$0.001–0.002 |
| Parere batch 100 carte | ~$0.10–0.15 |
| Ricerca Scryfall, Monte Carlo, statistiche, storage | $0 |

---

## 15. Scope

### Alpha (da costruire ora)
- Schermate Mazzi + Builder complete come sopra; Partita come stub con routing.
- Box modulare con 3 moduli (mini-curva, prezzo/dati, parere).
- Timing hover/preview: valori di partenza in §5.1, fine-tuning in test dal vivo.

### Fuori scope / futuro
- Partita (tavolo virtuale + judge consultivo).
- Ottimizzatore di stampa proxy su A4.
- Modulo "ridondanza funzionale" ("hai già 3 carte che fanno questo").
- Dictionary-matching di fallback per nomi non marcati.
- Condivisione globale della cache tag (carta, tag) fra utenti.
- Sync cloud dei mazzi.
