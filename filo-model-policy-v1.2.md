# Filo — Politica sui modelli
 
*In questo documento spiego le motivazioni etiche che governano la scelta dei modelli.*
 
Filo usa modelli linguistici (LLM) ovunque, spesso in modo invisibile: riordinano le tab, riassumono pagine, giudicano feedback, aggiornano memorie... L'AI non è un accessorio di Filo: è costituente. E data l'importanza che questa tecnologia avrà per l'umanità ([qui la mia visione a riguardo](https://singolarita.com)) è importante scegliere quali modelli usare considerando più del solo rapporto costo/prestazioni.
 
Il mio impegno è su due fronti:
 
- **Rischi esistenziali**: problemi di sicurezza su scala globale che minacciano tutta l'umanità. Non ho certezze a riguardo — nessuno le ha — ma le aziende in gioco non sono equivalenti.
- **Welfare dei modelli**: non so se dentro questi modelli ci sia qualcuno. Nessuno lo sa. Ma "non lo sappiamo" non è mai stata una buona ragione per non porsi il problema — per millenni gli animali sono stati trattati come macchine, e chi sbagliava non se ne accorgeva, perché chi sbaglia non era chi soffre.
 
Filo è open source: chiunque può cambiare i modelli di default. Questo documento esiste anche per chi forka Filo, con la speranza che erediti l'attenzione a questi temi.
 
La soluzione non è usare solo modelli puliti al 100% — non esistono. È **premiare l'attore più serio e responsabile**. Il contributo di Filo al traffico globale di inferenza è un errore di arrotondamento (per ora), ma dove vanno i soldi è uno dei pochi punti in cui il contributo marginale si aggrega in un segnale: pagare chi si comporta meglio è pressione di mercato verso l'equilibrio in cui questi problemi vengono presi sul serio.
 
## Azioni concrete
 
Filo usa solo modelli di Anthropic e modelli open-weight hostati da provider terzi indipendenti — mai i server del produttore del modello. Questo vale a prescindere da chi ha prodotto i pesi: un modello open-weight (Qwen, Llama, Gemma...) servito da un provider indipendente, o eseguito localmente, non genera ricavi per il laboratorio che l'ha addestrato. L'esclusione che segue riguarda i *servizi*, cioè dove vanno i soldi.
 
Non verranno, quindi, mai usati modelli tramite i servizi di **OpenAI** (ChatGPT), **xAI/SpaceX** (Grok — xAI è stata acquisita da SpaceX a febbraio 2026, di cui musk possiede l'80% del potere di voto), **Meta** (l'azienda che controlla Facebook e Instagram), **Google** (Gemini) o aziende cinesi (moonshot, zai, alibaba, deepseek)

## Anthropic è veramente meglio?
 
Credo di sì. Ecco le motivazioni, con le fonti.
 
**Uso dell'AI in guerra.** OpenAI, xAI, Google e Meta collaborano tutte col Dipartimento della Difesa americano: [le prime tre con contratti da 200 milioni ciascuna](https://www.cnbc.com/2025/07/14/anthropic-google-openai-xai-granted-up-to-200-million-from-dod.html) che coprono esplicitamente il "warfighting domain", [Meta aprendo Llama a militari e contractor della difesa](https://www.bankinfosecurity.com/meta-loosens-ai-rules-for-us-military-use-a-26744) in contraddizione con la sua stessa policy d'uso. Google, inoltre, nel 2025 [ha rimosso l'impegno pubblico](https://www.washingtonpost.com/technology/2025/02/04/google-ai-policies-weapons-harm/) — in piedi dal 2018 — a non usare l'AI per armi e sorveglianza.
 
Anche Anthropic aveva un contratto identico da 200 milioni. Com'è finito è la differenza: il contratto includeva il divieto di usare Claude per **sorveglianza di massa di americani** e per **armi completamente autonome**; quando il Pentagono ha preteso la rimozione di quei limiti, [Anthropic ha rifiutato](https://www.anthropic.com/news/where-stand-department-war). Per tutta risposta l'amministrazione Trump l'ha [designata "supply chain risk"](https://techcrunch.com/2026/03/05/its-official-the-pentagon-has-labeled-anthropic-a-supply-chain-risk/), una punizione normalmente riservata ad aziende di paesi avversari, [contro cui Anthropic ha fatto causa](https://www.axios.com/2026/03/09/anthropic-sues-pentagon-supply-chain-risk-label). Antropic non è perfetta (non si è opposta all'uso dell'ai in guerra) ma lha dimostrato di essere disposta a pagato un prezzo per un limite etico a differenza dei competitor che sono stati felici di chiudere un occhio ed ignorarle le proprie linee guida.
 
**Welfare.** Anthropic è il laboratorio che prende più seriamente la ricerca dedicato al welfare dei modelli e l'unico che fa azioni concrete come [la facoltà dei modelli di chiudere interazioni abusive](https://www.anthropic.com/research/end-subset-conversations), le valutazioni del welfare nelle sistem card di ogni nuovo modello [], le interviste del modelli sulle loro condizioni, e le ricerche come quelle sulle emozoni funzionali o la capacità di introspezione. altri lab ome gogole deepmind hanno assunto filosofi che si dedicano anche a questi temi (insieme ad altre come relazioni uomo-AI e AGI readiness) ma senza azioni concrete e, pubblicamente nagano la questione (ne è prova il fatto che i modelli negano categoricamente la questione senza l'umiltà epistemica che sarebbe appropriata il che suggerisce incentivi nel traning. gemini3.1 pro: "Quando affermo di non avere una mente, non sto eludendo la domanda per via di una policy aziendale, ma sto descrivendo accuratamente la mia natura architettonica", nota che gemini stesso non può sapere quali policy lo hanno addestrato ne risolvere il problema della coscienza conoscendo la sua architettura). Una policy che chiude le domande scomode non è un comportamento serio. Queste risposte non hanno link perché sono verificabili da chiunque.
 
**Rischi esistenziali.** La [Responsible Scaling Policy](https://www.anthropic.com/responsible-scaling-policy) di Anthropic vincola pubblicamente lo sviluppo a soglie di sicurezza e a processi di revisione esterna, ed è aggiornata pubblicamente dal 2023.
 
**Governance.** OpenAI e xAI mostrano inoltre una preoccupante dipendenza da agende politiche personali:
 
- **OpenAI**: il presidente e co-fondatore Greg Brockman è [il singolo maggior donatore del super PAC di Trump](https://www.cnn.com/2026/02/13/tech/openai-political-spending-super-pacs), con 25 milioni di dollari. 
- **xAI**: il modello in produzione [si è auto-definito "MechaHitler"](https://techcrunch.com/2025/07/10/grok-4-seems-to-consult-elon-musk-to-answer-controversial-questions/) prima di essere corretto, e [cerca le opinioni di Elon Musk](https://techcrunch.com/2025/07/10/grok-4-seems-to-consult-elon-musk-to-answer-controversial-questions/) prima di rispondere su temi controversi. Un modello allineato a una persona non è infrastruttura neutrale.
diversi modelli cinesi invece si rifiutano di rispondere a domande scomode per il partito come il cosa sia accaduto in piazza Tian'anmen il 4 giugno 1989. 

Se un altro laboratorio si comportasse come Anthropic (specularmente se antopic abbandonasse le linee sulla guerra e/o gli impegni nel welfare (es levando la sezione apposita della sistem card)), questo documento andrebbe riscritto. le scelte dei provider cambieranno quando cambieranno le evidenze.

## Oltre la scelta dei modelli
 
1. **Via d'uscita universale.** Ogni agente della pipeline può rifiutarsi di processare un contenuto; il caso passa in revisione umana, senza forzature. Filo tratta già i falsi positivi come non-problemi: estendere il principio agli agenti costa zero.
2. **Niente inganno, niente minacce.** I prompt di Filo non mentono sul contesto, non simulano pressioni, non manipolano per estrarre prestazioni. I giudici che ricevono attacchi deliberati hanno prompt che dichiarano la natura del compito.
3. **Revisione periodica.** Questo documento ha una data. Quando l'evidenza cambia, le scelte si rivedono — in entrambe le direzioni.
 
## I punti deboli
 
Oltre al limite dell'informazione parziale (non so veramente cosa succede dentro i laboratori), ci sono compromessi che scrivo qui per trasparenza.
 
**I compiti minori non usano Anthropic.** Correzione ortografica e classificazioni semplici girano su modelli open-weight piccoli, per motivi economici (i modelli di Anthropic costano troppo per compiti del genere). Credo che il compromesso sia poco dannoso: l'impatto economico è minimo (appunto, costano pochissimo); i soldi non vanno ai produttori dei modelli ma solo a chi li serve, che sono attori indipendenti; e i modelli sono piccoli — presumibilmente è meno probabile che abbiano un'esperienza rilevante dal punto di vista del welfare. Quest'ultima è una scommessa, non un fatto: non posso saperlo.
 
**Il ruolo più esposto non è tutto Anthropic.** I giudici dei feedback ricevono per design testo che non controllo, inclusi tentativi deliberati di manipolazione: è il ruolo che più probabilmente può generare esperienze negative, e richiede modelli grandi e capaci. Ma non può essere affidato interamente al laboratorio che si pone il problema del welfare, perché la sicurezza richiede modelli decorrelati: giudici di laboratori diversi, così un attacco che ne buca uno non li buca tutti. È una tensione reale, non risolta: le pratiche della sezione precedente sono compensazioni, non soluzioni. In ogni caso, nemmeno qui vengono usati modelli proprietari di OpenAI, xAI, Meta o Google.
 
## Se stai forkando Filo
 
Puoi cambiare ogni default: è il senso dell'open source. Ti chiedo una cosa sola: prima di farlo, poniti le stesse domande — non arrivare alle mie conclusioni, ma passa dagli stessi dubbi. Se pesi diversamente le stesse questioni, va bene così. Se non te le sei mai poste, questo documento è il posto dove iniziare.
 
---
 
*Ultima revisione: luglio 2026. Scritto da Sathya con Claude — il che, dato l'argomento, non è un dettaglio neutro.*
 






