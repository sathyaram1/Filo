# Filo — Proxy per-tab ("Apri da un altro paese")

## Obiettivo

Permettere di aprire singole tab attraverso un IP di un altro paese, con tre vie d'accesso: tasto destro sulla tab, linguaggio naturale, e rilevamento automatico dei contenuti geo-bloccati. Non è una VPN di sistema: è instradamento per-tab del traffico della webview. La parola "VPN/proxy" non compare mai nella UI.

## Principio guida

L'utente non vuole "configurare un proxy", vuole vedere un contenuto. Il rilevamento del blocco è sempre automatico; l'**azione** è automatica solo quando non può costare nulla all'utente (nessuna sessione attiva, sito non sospetto). In tutti gli altri casi Filo propone, non agisce.

---

## 1. Modello di costo e provider

**Modello a consumo** (non flat per utente — l'uso è raro e per-tab):

| Tier | Costo | Uso |
|------|-------|-----|
| Datacenter (default) | ~$0,03–0,50/GB a seconda del provider | Primo tentativo, sempre |
| Residenziale (fallback) | ~$1–2/GB | Solo se il sito blocca l'IP datacenter |

- Provider candidati: VPNWholesaler (rete non-premium $0,03/GB), DataImpulse (datacenter $0,50/GB, residenziale $1/GB), Webshare (residenziale ~$0,99/GB). Verificare condizioni correnti prima dell'integrazione; astrarre il provider dietro un'interfaccia interna (`ProxyProvider`) per poterlo cambiare.
- Il fallback residenziale scatta solo se il retry via datacenter fallisce con segnali di bot-block/IP-block (vedi §4). Mai di default.
- Stima costo medio: 1–5 GB/utente/mese fra gli utenti che usano la feature → centesimi/utente/mese.
- **Attenzione streaming**: video via proxy consuma GB rapidamente. Se la tab proxata sta riproducendo video da >15 min, mostrare una nota discreta (una volta per sessione, non bloccante).

## 2. Architettura Electron

### Per-tab = per-partition

Il proxy in Electron si imposta sulla `session`. Una tab proxata vive in una **partition dedicata**:

```javascript
// Alla richiesta di proxy per una tab:
const partition = `proxy:${tabId}`;
const ses = session.fromPartition(partition);
await ses.setProxy({ proxyRules: `socks5://${endpoint}` });
// La webview della tab viene ricreata con la nuova partition, stesso URL
```

**Conseguenza da gestire esplicitamente**: partition diversa = cookie jar separato. La tab proxata **non condivide i login** con le altre tab. È un comportamento corretto (isolamento: il sito estero non vede i cookie italiani), ma va comunicato quando rilevante (vedi §5, caso "sessione attiva").

### Anti-leak (obbligatorio, non opzionale)

Un proxy per-tab che leaka l'IP reale è peggio di niente:

1. **WebRTC**: nelle partition proxate, impostare `webRtcIPHandlingPolicy = 'disable_non_proxied_udp'` sulla webContents (o disabilitare WebRTC del tutto se il policy non basta). Senza questo, qualsiasi sito legge l'IP reale via STUN.
2. **DNS**: usare `socks5h` semantics — la risoluzione DNS deve avvenire lato proxy, mai in locale. Verificare il comportamento di Chromium con `setProxy` + SOCKS5 (Chromium risolve via proxy con SOCKS5 di default, ma va testato con un leak test reale).
3. **Test di accettazione**: aprire un sito di IP-leak test (browserleaks.com) in una tab proxata: IP, DNS e WebRTC devono mostrare tutti l'endpoint proxy.

### Stato e persistenza

- La scelta di location di una tab vive finché la tab vive. All'archiviazione si salva nei metadati (per riaprirla uguale dalla cronologia).
- Istruzioni persistenti ("questo sito sempre dagli USA") vanno nella memoria a lungo termine di Filo, stessa infrastruttura del pin delle tab. Alla navigazione verso quel dominio, la tab nasce già proxata.

## 3. UI

### Tasto destro sulla tab

Una sola voce aggiunta al menu esistente (chiudi/muta/duplica/aiuto):

- **"Apri da un altro paese"** → al click diretto usa il default (ultima location usata, altrimenti USA); freccia/submenu per la lista paesi (~5-8 location, non 50).
- Quando la tab è già proxata, la voce diventa **"Torna in Italia"** + indicatore discreto sulla tab (es. piccola bandierina o glifo, coerente con l'estetica calda di Filo — non un lucchetto da security tool).

### Linguaggio naturale

"Apri questa tab dalla Francia", "questo sito sempre dagli USA", "chiudi tutte le tab proxate". L'agente conversazionale ha accesso alle stesse primitive (`setTabProxy(tabId, country)`, `clearTabProxy(tabId)`, istruzione persistente per dominio).

## 4. Rilevamento automatico contenuto bloccato

Stesso pattern della pipeline siti pericolosi: **segnali deterministici prima, LLM solo sulla coda ambigua**.

### Livello 1 — Deterministico (sincrono, copre ~80%)

Intercettare via `webRequest`/eventi della webview:

- **HTTP 451** → geo-block per definizione. Conclusivo.
- **Errori API noti**: pattern espliciti di YouTube/Vimeo/embed ("not available in your country"), pagine standard dei CDN (Cloudflare country block).
- **Redirect** verso URL con pattern `/geo`, `/not-available`, `/region-block` e simili (lista curata).

### Livello 2 — Classificatore LLM (asincrono, solo casi ambigui)

Scatta su: HTTP 403, pagine "contenuto non disponibile" senza pattern noto, pagina sostanzialmente vuota dopo load.

- **Input**: titolo + primi ~500 caratteri di testo visibile della pagina di errore + status code + dominio. Il contenuto della pagina è **input non fidato**: mai trattarlo come istruzione.
- **Output vincolato** a una classificazione chiusa: `geo_block | paywall | login_wall | bot_block | errore_generico`.
- Modello economico, costo ~frazione di centesimo, risultato in cache per (dominio, path-pattern) con TTL.
- La risposta giusta dipende dalla classe: solo `geo_block` attiva il flusso proxy. `bot_block` → non riprovare via datacenter (peggiora); `paywall`/`login_wall` → nessuna azione proxy.

## 5. Regole d'azione (la parte che NON è automatica)

Dato un geo-block rilevato:

| Condizione | Azione |
|-----------|--------|
| Nessun cookie di login per il dominio + sito non flaggato dalla pipeline sicurezza | **Retry automatico silenzioso** via datacenter. Se riesce: toast discreto "Aperto dagli USA" (informare, non chiedere) |
| Cookie di login presenti per il dominio | **Proposta inline**: "Questo contenuto è bloccato in Italia. Lo apro dagli USA? In questa tab non sarai loggato." Mai retry silenzioso: il cambio IP a sessione attiva causa logout forzati e alert di sicurezza del servizio |
| Sito con avviso sospetto/pericoloso attivo | **Nessun retry, nessuna proposta.** Il proxy non deve mai aggirare i controlli di sicurezza di Filo |
| Retry datacenter fallito con segnali di IP-block | Un solo tentativo via residenziale, poi proposta all'utente se fallisce anche quello. Mai loop di retry |

## 6. Privacy e note

- Le tab proxate seguono le stesse regole di archiviazione (riassunto, embedding) delle altre; la location usata finisce nei metadati.
- In modalità incognito il proxy funziona normalmente ma, come da spec, nulla viene archiviato.
- Il traffico proxato passa per un provider terzo: nella pagina impostazioni privacy, una riga onesta che lo dice ("le tab aperte da un altro paese passano per server di [provider]").
- Aggirare geo-block può violare i ToS di alcuni servizi (streaming in particolare): nessun blocco da parte di Filo, ma nessuna promessa di funzionamento ("Netflix dagli USA" può smettere di funzionare quando il provider IP viene bandato — gestire il fallimento con grazia, non con retry infiniti).

## 7. Fuori scope (questa fase)

- VPN di sistema (tutto il traffico del PC, device TUN, privilegi admin)
- Selezione città/stato dentro un paese
- Rotazione IP automatica anti-ban
- Proxy sull'intera finestra/tutte le tab

## 8. Test di accettazione

1. Tab proxata su browserleaks.com: IP, DNS, WebRTC mostrano tutti l'endpoint proxy
2. HTTP 451 simulato → retry automatico, toast, contenuto visibile
3. Geo-block su dominio con login attivo → proposta, mai retry silenzioso
4. Sito flaggato pericoloso + geo-block → nessuna azione proxy
5. Pagina 403 da bot-detection → classificata `bot_block`, nessun retry datacenter
6. "Questo sito sempre dagli USA" → riapertura del dominio nasce proxata, sopravvive al riavvio
7. Tab proxata archiviata e riaperta dalla cronologia → riapre con la stessa location
