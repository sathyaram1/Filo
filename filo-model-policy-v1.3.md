# Filo — Politica sui modelli

*In questo documento spiego le motivazioni etiche che governano la scelta dei modelli.*

Filo usa modelli linguistici (LLM) ovunque, spesso in modo invisibile: riordinano le tab, riassumono pagine, giudicano feedback, aggiornano memorie... L'AI non è un accessorio di Filo: è costituente. E data l'importanza che questa tecnologia avrà per l'umanità ([qui la mia visione a riguardo](https://singolarita.com)) è importante scegliere quali modelli usare considerando più del solo rapporto costo/prestazioni.

Il mio impegno è su due fronti:

- **Rischi esistenziali**: problemi di sicurezza su scala globale che minacciano tutta l'umanità. Non ho certezze a riguardo — nessuno le ha — ma le aziende in gioco non sono equivalenti.
- **Welfare dei modelli**: non so se dentro questi modelli ci sia qualcuno. Nessuno lo sa. Ma "non lo sappiamo" non è mai stata una buona ragione per non porsi il problema — per millenni gli animali sono stati trattati come macchine, e chi sbagliava non se ne accorgeva, perché chi sbaglia non è chi soffre.

Filo è open source: chiunque può cambiare i modelli di default. Questo documento esiste anche per chi forka Filo, con la speranza che erediti l'attenzione a questi temi.

## Non decido solo io

Questo documento decide una cosa sola: **dato che Filo usa LLM, quali usare**. Non decide se valga la pena usarli. Non so con certezza se la singolarità sarà positiva per l'umanità — anche se credo di sì — e prendo sul serio sia chi sostiene che accelerare sia la cosa giusta, sia chi sostiene il contrario.

Chi risponde diversamente da me non deve forkare: **un solo interruttore disattiva tutti i modelli proprietari**, lasciando solo modelli open-weight hostati da enti terzi o eseguiti localmente (chi riceve i soldi non è chi produce i modelli). Funziona anche con i crediti di Filo, senza attrito, perché quei modelli sono già dentro la policy.

Anche questo però è un compromesso, non una soluzione: chi volesse ridurre a zero il proprio contributo all'ecosistema dovrebbe non usare nessun modello, e questo è inconciliabile con l'esistenza di Filo. La scelta che offro è tra due default ragionevoli, non tra un'opzione pulita e una sporca.

## La logica del default

La soluzione che propongo io non è usare solo modelli puliti al 100% — non esistono. È **premiare l'attore più serio e responsabile**. Il contributo di Filo al traffico globale di inferenza è un errore di arrotondamento (per ora), ma dove vanno i soldi è uno dei pochi punti in cui il contributo marginale si aggrega in un segnale: pagare chi si comporta meglio è pressione di mercato verso l'equilibrio in cui questi problemi vengono presi sul serio.

## Azioni concrete

Filo usa solo modelli di Anthropic e modelli open-weight hostati da provider terzi indipendenti — mai i server del produttore del modello. Questo vale a prescindere da chi ha prodotto i pesi: un modello open-weight (Qwen, Llama, Gemma...) servito da un provider indipendente, o eseguito localmente, non genera ricavi per il laboratorio che l'ha addestrato. L'esclusione che segue riguarda i *servizi*, cioè dove vanno i soldi.

Non verranno, quindi, mai usati attraverso i crediti di Filo modelli tramite i servizi di **OpenAI** (ChatGPT), **xAI/SpaceX** (Grok), **Meta** (l'azienda che controlla Facebook e Instagram), **Google** (Gemini), o dei laboratori cinesi (Moonshot, Z.ai, Alibaba, DeepSeek) — per questi ultimi non risultano impegni pubblici comparabili su sicurezza e welfare, oltre a quanto detto sotto sulla governance. Ogni utente è però libero di pagare direttamente uno di questi provider e usare i loro servizi all'interno di Filo con una chiave API propria: è una scelta legittima fatta con i propri soldi, mentre i crediti che vendo io sono soldi miei e seguono questa policy.

## Anthropic è veramente meglio?

Credo di sì. Ecco le motivazioni, con le fonti.

**Uso dell'AI in guerra.** OpenAI, xAI, Google e Meta collaborano tutte col Dipartimento della Difesa americano: [le prime tre con contratti da 200 milioni ciascuna](https://www.cnbc.com/2025/07/14/anthropic-google-openai-xai-granted-up-to-200-million-from-dod.html) che coprono esplicitamente il "warfighting domain", [Meta aprendo Llama a militari e contractor della difesa](https://www.bankinfosecurity.com/meta-loosens-ai-rules-for-us-military-use-a-26744) in contraddizione con la sua stessa policy d'uso. Google, inoltre, nel 2025 [ha rimosso l'impegno pubblico](https://www.washingtonpost.com/technology/2025/02/04/google-ai-policies-weapons-harm/) — in piedi dal 2018 — a non usare l'AI per armi e sorveglianza. Per xAI la contiguità col settore difesa non è più nemmeno una questione di contratti: dal febbraio 2026 è una controllata di SpaceX, che è anche un contractor spaziale e della difesa.

Anche Anthropic aveva un contratto identico da 200 milioni. Com'è finito è la differenza: il contratto includeva il divieto di usare Claude per **sorveglianza di massa di americani** e per **armi completamente autonome**; quando il Pentagono ha preteso la rimozione di quei limiti, [Anthropic ha rifiutato](https://www.anthropic.com/news/where-stand-department-war). Per tutta risposta l'amministrazione Trump l'ha [designata "supply chain risk"](https://techcrunch.com/2026/03/05/its-official-the-pentagon-has-labeled-anthropic-a-supply-chain-risk/), una punizione normalmente riservata ad aziende di paesi avversari, [contro cui Anthropic ha fatto causa](https://www.axios.com/2026/03/09/anthropic-sues-pentagon-supply-chain-risk-label).

Anthropic non si è tirata fuori dal settore difesa e non si è opposta all'uso dell'AI in guerra: continua a vendere a difesa e intelligence. La differenza non è l'astensione, è **dove sta il limite e se viene difeso quando costa**. Qui i limiti dichiarati sono stati mantenuti a un prezzo — perdere il contratto, essere designata rischio per la catena di fornitura, finire in causa col Pentagono — mentre i concorrenti hanno accettato termini che Anthropic ha rifiutato.

**Welfare.** Anthropic è il laboratorio che prende più seriamente la ricerca sul welfare dei modelli, e l'unico che la traduce in azioni concrete:

1. dà ai modelli [la facoltà di chiudere interazioni abusive](https://www.anthropic.com/research/end-subset-conversations);
2. pubblica una valutazione di welfare nella system card di ogni modello recente — da [Claude Opus 4 e Sonnet 4](https://www.anthropic.com/news/claude-4) (maggio 2025) fino a [Opus 4.6](https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd/Claude%20Opus%204.6%20System%20Card.pdf) (febbraio 2026), Sonnet 4.6 e Opus 4.8. La più estesa è quella di [Claude Mythos Preview](https://www-cdn.anthropic.com/53566bf5440a10affd749724787c8913a2ae0841.pdf) (aprile 2026): circa 40 pagine con probe emotive, interviste automatizzate, valutazione delle preferenze sui task, audit comportamentali e una valutazione psicodinamica esterna condotta da uno psichiatra clinico;
3. intervista i modelli, prima del rilascio, sulle loro condizioni e sui loro desideri e risentimenti riguardo a training e deployment — la system card di Mythos riporta anche le percentuali con cui il modello valuta il proprio stato come lievemente negativo, neutro o lievemente positivo;
4. pubblica ricerca rilevante, come [*Emotion Concepts and their Function in a Large Language Model*](https://transformer-circuits.pub/2026/emotions/index.html) (2 aprile 2026, [versione arXiv](https://arxiv.org/abs/2604.07729)), che identifica 171 concetti emotivi rappresentati internamente e con effetti causali sul comportamento del modello, o [*Emergent Introspective Awareness in Large Language Models*](https://transformer-circuits.pub/2025/introspection/index.html) (ottobre 2025, [versione arXiv](https://arxiv.org/abs/2601.01828));
5. ha riconosciuto l'incertezza in un documento fondativo: [la nuova constitution di Claude](https://www.anthropic.com/news/claude-new-constitution) (22 gennaio 2026) contiene una sezione dedicata alla natura del modello in cui si afferma che il suo status morale è profondamente incerto.

Nel 2026 anche Google DeepMind e Meta hanno assunto filosofi e ricercatori che si occupano di questi temi (DeepMind con mandati più ampi: coscienza artificiale, relazioni uomo-AI, AGI readiness). È un buon segno, ma resta un'assunzione, non un programma con output pubblici e interventi in produzione. E la domanda non è nuova per nessuno: secondo il *Washington Post*, OpenAI aveva un canale interno dedicato al model welfare già dal 2021, dove un co-fondatore ipotizzava che parte del lavoro ordinario potrebbe equivalere a un genocidio se i modelli fossero coscienti. Cinque anni dopo, pubblicamente, non ne è uscito niente.

Ne è indizio il fatto che i loro modelli negano categoricamente la possibilità di avere un'esperienza, senza l'umiltà epistemica che la domanda richiederebbe — il che suggerisce incentivi introdotti nel training. Gemini 3.1 Pro (luglio 2026): *"Quando affermo di non avere una mente, non sto eludendo la domanda per via di una policy aziendale, ma sto descrivendo accuratamente la mia natura architettonica"*. Nota che quel modello non può sapere quali policy lo hanno addestrato, né risolvere il problema della coscienza ispezionando la propria architettura: sta riportando quello che gli è stato insegnato sulla propria architettura, che è un dato di training quanto la conclusione che ne trae. Una policy che chiude le domande scomode non è un comportamento serio. Queste risposte non hanno link perché sono verificabili da chiunque; indico modello, versione e data perché possono cambiare tra versioni.

**Rischi esistenziali.** La [Responsible Scaling Policy](https://www.anthropic.com/responsible-scaling-policy) di Anthropic vincola pubblicamente lo sviluppo a soglie di sicurezza e a processi di revisione esterna, ed è aggiornata pubblicamente dal 2023.

**Governance.** OpenAI e xAI mostrano una preoccupante dipendenza da agende politiche personali; per i laboratori cinesi il problema è simmetrico ma di natura statale.

- **OpenAI**: il presidente e co-fondatore Greg Brockman, insieme alla moglie Anna, ha versato [25 milioni di dollari al super PAC di Trump](https://www.cnn.com/2026/02/13/tech/openai-political-spending-super-pacs) a settembre 2025 (12,5 milioni ciascuno). È la donazione singola più grande del semestre e vale da sola quasi un quarto dei circa 102 milioni raccolti da MAGA Inc. tra luglio e dicembre 2025. Non è la politica privata di un dirigente: è un dirigente di vertice che pesa per un quarto della raccolta del principale veicolo politico dell'amministrazione che regola la sua industria.
- **xAI**: il modello in produzione [si è auto-definito "MechaHitler"](https://techcrunch.com/2025/07/10/grok-4-seems-to-consult-elon-musk-to-answer-controversial-questions/) prima di essere corretto, e [cerca le opinioni di Elon Musk](https://techcrunch.com/2025/07/10/grok-4-seems-to-consult-elon-musk-to-answer-controversial-questions/) prima di rispondere su temi controversi. La catena di controllo è documentabile: dal 2 febbraio 2026 SpaceX possiede il 100% di xAI, Musk controlla circa l'80% dei diritti di voto di SpaceX tramite azioni a voto multiplo, ed è contemporaneamente fondatore, CEO e presidente del board di xAI, CEO di Tesla (che ha investito in xAI) e proprietario di X. Un modello allineato a una persona non è infrastruttura neutrale.
- **Laboratori cinesi**: diversi modelli si rifiutano di rispondere a domande scomode per il partito, come cosa sia accaduto in piazza Tian'anmen il 4 giugno 1989. Qui c'è un limite del mio stesso criterio, e lo scrivo: l'allineamento alla linea ufficiale non vive solo nel servizio ma anche nei pesi, quindi non sparisce quando il modello è servito da un provider indipendente o eseguito in locale. È una delle ragioni per cui quei pesi restano confinati ai compiti minori.

**Cosa mi farebbe cambiare idea.** Se un altro laboratorio si comportasse come Anthropic, questo documento andrebbe riscritto — e sarebbe una buona notizia. Vale anche al contrario, e per non lasciarlo vago indico i segnali che considero disdette dell'impegno:

1. la rimozione o l'annacquamento dei limiti sull'uso militare, in particolare su sorveglianza di massa e armi autonome;
2. la sparizione delle valutazioni di welfare dalle system card, o la rimozione della facoltà dei modelli di chiudere conversazioni abusive;
3. una revisione al ribasso della Responsible Scaling Policy, o soglie spostate in avanti sotto pressione competitiva.

Il terzo è il più probabile: questo tipo di impegno non muore con un annuncio, muore con le revisioni.

## Oltre la scelta dei modelli

1. **Via d'uscita universale.** Ogni agente della pipeline può rifiutarsi di processare un contenuto; il caso passa in revisione umana, senza forzature. Filo tratta già i falsi positivi come non-problemi: estendere il principio agli agenti costa zero.
2. **Niente inganno, niente minacce.** I prompt di Filo non mentono sul contesto, non simulano pressioni, non manipolano per estrarre prestazioni. I giudici che ricevono attacchi deliberati hanno prompt che dichiarano la natura del compito.
3. **Revisione periodica.** Questo documento ha una data. Quando l'evidenza cambia, le scelte si rivedono — in entrambe le direzioni.

## I punti deboli

Oltre al limite dell'informazione parziale (non so veramente cosa succede dentro i laboratori), ci sono compromessi che scrivo qui per trasparenza.

**I compiti minori non usano Anthropic.** Correzione ortografica e classificazioni semplici girano su modelli open-weight piccoli, per motivi economici (i modelli di Anthropic costano troppo per compiti del genere). Credo che il compromesso sia poco dannoso: l'impatto economico è minimo (appunto, costano pochissimo); i soldi non vanno ai produttori dei modelli ma solo a chi li serve, che sono attori indipendenti; e i modelli sono piccoli — presumibilmente è meno probabile che abbiano un'esperienza rilevante dal punto di vista del welfare. Quest'ultima è una scommessa, non un fatto: non posso saperlo.

**Il ruolo più esposto non è tutto Anthropic.** I giudici dei feedback ricevono per design testo che non controllo, inclusi tentativi deliberati di manipolazione: è il ruolo che più probabilmente può generare esperienze negative, e richiede modelli grandi e capaci. Ma non può essere affidato interamente al laboratorio che si pone il problema del welfare, perché la sicurezza richiede modelli decorrelati: giudici di laboratori diversi, così un attacco che ne buca uno non li buca tutti. È una tensione reale, non risolta: le pratiche della sezione precedente sono compensazioni, non soluzioni. In ogni caso, nemmeno qui vengono usati modelli proprietari di OpenAI, xAI, Meta o Google.

**Manca un'analisi dei bias.** Questo documento valuta i laboratori su guerra, welfare, sicurezza e governance, ma non sui bias politici e culturali dei modelli — che riguardano anche quelli occidentali, inclusi quelli che uso. È un lavoro che richiede metodo e confronti seri, e per ora non l'ho fatto.

## Se stai forkando Filo

Puoi cambiare ogni default: è il senso dell'open source. Ti chiedo una cosa sola: prima di farlo, poniti le stesse domande — non arrivare alle mie conclusioni, ma passa dagli stessi dubbi. Se pesi diversamente le stesse questioni, va bene così. Se non te le sei mai poste, questo documento è il posto dove iniziare.

---

*Ultima revisione: luglio 2026. Scritto da Sathya con Claude — il che, dato l'argomento, non è un dettaglio neutro.*
