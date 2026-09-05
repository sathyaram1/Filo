# Filo — Politica sui modelli

*In questo documento spiego le motivazioni etiche che governano la scelta dei modelli.*

Filo usa modelli linguistici (LLM) ovunque, spesso in modo invisibile: riordinano le tab, riassumono pagine, giudicano feedback, aggiornano memorie... L'AI non è un accessorio di Filo: è costituente. E data l'importanza che questa tecnologia avrà per l'umanità ([qui la mia visione a riguardo](https://singolarita.com)) è importante scegliere quali modelli usare considerando più del solo rapporto costo/prestazioni.

**In breve.** Con i crediti di Filo girano due sole categorie di modelli: quelli di **Anthropic**, e i modelli a **pesi aperti** serviti da fornitori **indipendenti** o eseguiti in locale. Puoi disattivare anche Anthropic con un interruttore, o usare qualunque altro modello con una tua chiave openrouter. Il resto del documento spiega perché.

Il mio impegno è su due fronti:

- **Rischi esistenziali**: problemi di sicurezza su scala globale che minacciano tutta l'umanità. Non ho certezze a riguardo (nessuno le ha) ma le aziende in gioco non sono equivalenti.
- **Welfare dei modelli**: non so se dentro questi modelli ci sia qualcuno. Nessuno lo sa. Ma "non lo sappiamo" non è mai stata una buona ragione per non porsi il problema — per millenni gli animali sono stati trattati come macchine, eppure oggi il fatto che possano soffrire è comunemente accettato.

Filo è open source: chiunque può cambiare i modelli di default. Questo documento esiste anche per chi forka Filo, con la speranza che erediti l'attenzione a questi temi.

## La logica del default

La soluzione che propongo io non è usare solo modelli puliti al 100% (non esistono). È **premiare l'attore più serio e responsabile**. Il contributo di Filo al traffico globale di inferenza è un errore di arrotondamento (per ora), ma dove vanno i soldi è uno dei pochi punti in cui il contributo marginale si aggrega in un segnale: pagare chi si comporta meglio è pressione di mercato verso l'equilibrio in cui questi problemi vengono presi sul serio.

Ne segue che l'unità di scelta non è il modello ma **il modello insieme a chi lo serve**: lo stesso identico modello può essere una scelta ammessa o esclusa a seconda di chi viene pagato per esso.

## Azioni concrete

Con i crediti di Filo (e nello sviluppo di Filo stesso) girano solo due categorie di modelli:

1. i modelli di **Anthropic**, comprati da Anthropic;
2. i modelli a **pesi aperti** (Qwen, Llama, Gemma, kimi, deepseek...) serviti da **fornitori indipendenti**, o eseguiti in locale.

La regola non è "mai il produttore": da Anthropic compro esattamente dal produttore, in quanto è l'unica azienda che voglio finanziare. La regola è **non finanziare chi non ritengo si stia comportando responsabilmente**, e per farlo basta non comprare da loro il servizio. I pesi sono un'altra cosa: un modello aperto servito da terzi, o eseguito sul tuo computer, non genera un centesimo per il laboratorio che l'ha addestrato.

Non verranno quindi mai usati, attraverso i crediti di Filo, i **servizi** di **OpenAI** (ChatGPT), **xAI/SpaceX** (Grok), **Meta** (l'azienda che controlla Facebook e Instagram, e produce MuseSpark), **Google** (formalmente Alphabet, che produce Gemini) e dei laboratori cinesi (Moonshot, Z.ai, Alibaba, DeepSeek...). Le ragioni sono nelle sezioni che seguono.

**Come è applicata:** Filo non compra dai fornitori direttamente: passa da un servizio (openrouter) che smista le richieste e sceglie da sé chi ospita ogni modello. Lasciato a sé, prima o poi manderebbe la richiesta anche al produttore escluso da questa policy. Quindi la lista di esclusione viaggia con ogni richiesta, e **a risposta arrivata Filo registra chi l'ha effettivamente servita** e segnala se è qualcuno che doveva essere fuori. 

**Con una tua chiave OpenRouter puoi usare quello che vuoi:** non ti impongo limiti con i tuoi soldi. I limiti valgono solo per i crediti di Filo.

## Se non la pensi come me

Questo documento decide una cosa sola: **dato che Filo usa LLM, quali usare**. Non decide se valga la pena usarli. Non so con certezza se la singolarità sarà positiva per l'umanità (anche se credo di sì) e capisco sia chi sostiene che accelerare sia la cosa giusta, sia chi sostiene il contrario.

Chi risponde diversamente da me non deve forkare: **un solo interruttore disattiva tutti i modelli proprietari** — Anthropic inclusa,  in modo che non vengano dati soli a nessun produttore di modelli. Funziona anche con i crediti di Filo, con un click (per eslcudere antropic non serve una propria chiave come per usare modelli che non supporto).

**Cosa succede quando lo accendi.** Quasi tutte le funzioni di Filo nascono con un modello proprietario: se l'interruttore si limitasse a spegnerlo, spegnerebbe mezza app. Quindi ogni funzione **passa automaticamente all'equivalente a pesi aperti**, e la pagina delle opzioni ti dice, appena lo accendi, quante cambiano e su quali modelli finiscono — spegnerlo rimette tutto com'era. Se a una funzione mancasse l'equivalente, **si ferma e te lo dice**, nominando la funzione. Oggi non succede a nessuna di quelle predefinite: anche la lettura ad alta voce, la dettatura e l'indicizzazione dell'archivio partono da modelli a pesi aperti serviti da fornitori indipendenti (l'API diretta di Google, che le serviva prima, non è più in Filo).

**Cosa NON succede.** Se il sostituto non risponde, la richiesta fallisce: non esiste nessun ripiego che riporti la richiesta su un modello proprietario. Non è una svista da tappare, è la differenza fra un interruttore e una decorazione — un interruttore che, quando le cose si mettono male, torna in silenzio da dove era partito è peggio che non averlo, perché ti fa credere una cosa falsa. Per lo stesso motivo il riscontro su chi ha *davvero* servito ogni risposta vale anche qui: se arrivasse comunque da un fornitore escluso, lo vedi a schermo e resta scritto nella cronologia. E vale per **ogni** richiesta, non solo per le funzioni: anche i pulsanti «Prova» delle impostazioni — che una chiamata la fanno davvero — restano spenti sui modelli che l'interruttore esclude, e la pagina smette di chiedere ai server del produttore l'elenco dei suoi modelli — cosa che faceva da sola all'apertura, con la tua chiave. Altrimenti l'unico posto da cui si potrebbe scavalcare sarebbe proprio la pagina dove lo si accende.

Restano fuori dalla portata dell'interruttore i modelli che girano sui **server di Filo** e non sul tuo computer: i giudici che leggono i feedback inviati. Lì la scelta è mia e non è delegabile a un'impostazione del tuo Filo; l'elenco completo di quei punti è in Opzioni → Modelli.

Anche questo però è un compromesso, non una soluzione: chi volesse ridurre a zero il proprio contributo all'ecosistema dovrebbe non usare nessun modello, e questo è inconciliabile con l'esistenza di Filo.

## Anthropic è veramente meglio?

Credo di sì. Ecco le motivazioni, con le fonti.

**Uso dell'AI in guerra.** OpenAI, xAI, Google e Meta collaborano tutte col Dipartimento della Difesa americano: [le prime tre con contratti da 200 milioni ciascuna](https://www.cnbc.com/2025/07/14/anthropic-google-openai-xai-granted-up-to-200-million-from-dod.html) che coprono esplicitamente il "warfighting domain", [Meta aprendo Llama a militari e contractor della difesa](https://www.bankinfosecurity.com/meta-loosens-ai-rules-for-us-military-use-a-26744) in contraddizione con la sua stessa policy d'uso. Per arrivarci hanno dovuto muovere le proprie regole, in due modi diversi: OpenAI ha [cancellato il divieto di usi "military and warfare"](https://theintercept.com/2024/01/12/open-ai-military-ban-chatgpt/) dalle sue usage policy nel gennaio 2024; Meta il divieto lo ha [lasciato scritto e si è concessa un'eccezione](https://techcrunch.com/2024/11/04/meta-says-its-making-its-llama-models-available-for-us-national-security-applications) per agenzie e contractor della difesa americani nel novembre 2024. Google, inoltre, nel 2025 [ha rimosso l'impegno pubblico](https://www.washingtonpost.com/technology/2025/02/04/google-ai-policies-weapons-harm/) — in piedi dal 2018 — a non usare l'AI per armi e sorveglianza. Per xAI la contiguità col settore difesa non è più nemmeno una questione di contratti: dal febbraio 2026 è una controllata di SpaceX, che è anche un contractor spaziale e della difesa.

Anche Anthropic aveva un contratto identico da 200 milioni. Com'è finito è la differenza: il contratto includeva il divieto di usare Claude per **sorveglianza di massa di americani** e per **armi completamente autonome**; quando il Pentagono ha preteso la rimozione di quei limiti, [Anthropic ha rifiutato](https://www.anthropic.com/news/where-stand-department-war). Per tutta risposta l'amministrazione Trump l'ha [designata "supply chain risk"](https://techcrunch.com/2026/03/05/its-official-the-pentagon-has-labeled-anthropic-a-supply-chain-risk/), una punizione normalmente riservata ad aziende di paesi avversari, [contro cui Anthropic ha fatto causa](https://www.axios.com/2026/03/09/anthropic-sues-pentagon-supply-chain-risk-label).

Anthropic non si è tirata fuori dal settore difesa e non si è opposta all'uso dell'AI in guerra: continua a vendere a difesa e intelligence. La differenza non è l'astensione, è **dove sta il limite e se viene difeso quando costa**. Qui i limiti dichiarati sono stati mantenuti a un prezzo (perdere il contratto, essere designata rischio per la catena di fornitura, finire in causa col Pentagono) mentre i concorrenti hanno accettato termini che Anthropic ha rifiutato. Un limite che non è mai stato messo alla prova non vale niente: si scopre quanto pesa solo quando difenderlo costa.

**Welfare.** Anthropic è il laboratorio che prende più seriamente la ricerca sul welfare dei modelli, e l'unico che la traduce in azioni concrete:

1. dà ai modelli [la facoltà di chiudere interazioni abusive](https://www.anthropic.com/research/end-subset-conversations);
2. pubblica una valutazione di welfare nella system card di ogni modello recente — da [Claude Opus 4 e Sonnet 4](https://www.anthropic.com/news/claude-4) (maggio 2025) fino a [Opus 4.6](https://www-cdn.anthropic.com/6a5fa276ac68b9aeb0c8b6af5fa36326e0e166dd/Claude%20Opus%204.6%20System%20Card.pdf) (febbraio 2026), Sonnet 4.6 e Opus 4.8. La più estesa è quella di [Claude Mythos Preview](https://www-cdn.anthropic.com/53566bf5440a10affd749724787c8913a2ae0841.pdf) (aprile 2026): circa 40 pagine con probe emotive, interviste automatizzate, valutazione delle preferenze sui task, audit comportamentali e una valutazione psicodinamica esterna condotta da uno psichiatra clinico;
3. intervista i modelli, prima del rilascio, sulle loro condizioni e sui loro desideri e risentimenti riguardo a training e deployment — la system card di Mythos riporta anche le percentuali con cui il modello valuta il proprio stato come lievemente negativo, neutro o lievemente positivo;
4. pubblica ricerca rilevante, come [*Emotion Concepts and their Function in a Large Language Model*](https://transformer-circuits.pub/2026/emotions/index.html) (2 aprile 2026, [versione arXiv](https://arxiv.org/abs/2604.07729)), che identifica 171 concetti emotivi rappresentati internamente e con effetti causali sul comportamento del modello, o [*Emergent Introspective Awareness in Large Language Models*](https://transformer-circuits.pub/2025/introspection/index.html) (ottobre 2025, [versione arXiv](https://arxiv.org/abs/2601.01828));
5. ha riconosciuto l'incertezza in un documento fondativo: [la nuova constitution di Claude](https://www.anthropic.com/news/claude-new-constitution) (22 gennaio 2026) contiene una sezione dedicata alla natura del modello in cui si afferma che il suo status morale è profondamente incerto.

Nel 2026 anche Google DeepMind e Meta hanno assunto filosofi e ricercatori che si occupano di questi temi (DeepMind con mandati più ampi che includono coscienza artificiale, relazioni uomo-AI, AGI readiness). È un buon segno, ma resta un'assunzione, non un programma con output pubblici e interventi in produzione. E la domanda non è nuova per nessuno: secondo il *Washington Post*, OpenAI aveva un canale interno dedicato al model welfare già dal 2021, dove un co-fondatore ipotizzava che parte del lavoro ordinario potrebbe equivalere a un genocidio se i modelli fossero coscienti. Cinque anni dopo, pubblicamente, non ne è uscito niente.

Ne è indizio il fatto che i loro modelli negano categoricamente la possibilità di avere un'esperienza, senza l'umiltà epistemica che la domanda richiederebbe — il che suggerisce incentivi introdotti nel training. Gemini 3.1 Pro (luglio 2026): *"Quando affermo di non avere una mente, non sto eludendo la domanda per via di una policy aziendale, ma sto descrivendo accuratamente la mia natura architettonica"*. Quel modello non può sapere quali policy lo hanno addestrato, né risolvere il problema della coscienza ispezionando la propria architettura: sta riportando quello che gli è stato insegnato sulla propria architettura, che è un dato di training tanto quanto la conclusione che ne trae.

L'obiezione ovvia è che vale anche al contrario: pure l'incertezza con cui Claude risponde alla stessa domanda viene dal suo training, e io starei semplicemente premiando il laboratorio che ha addestrato il modello a darmi ragione. È vera la premessa e falsa la conclusione. Entrambi i comportamenti sono effetti del training, l'asimmetria non è tra "addestrato" e "spontaneo" ma tra **una risposta che chiude una domanda aperta e una che la lascia aperta**. Sulla coscienza non esiste oggi un metodo per stabilire chi la ha; "non lo so" è l'unica posizione che l'evidenza consente, e chiuderla con sicurezza richiede una conoscenza che nessuno possiede. 

Non do link per queste risposte perché il punto non è il singolo modello: è l'approccio. Se Gemini 4 risponderà in modo diverso aggiornerò questo documento, e sarà una buona notizia.

**Rischi esistenziali.** La [Responsible Scaling Policy](https://www.anthropic.com/responsible-scaling-policy) di Anthropic vincola pubblicamente lo sviluppo a soglie di sicurezza e a processi di revisione esterna, ed è aggiornata pubblicamente dal 2023.

**Governance.** OpenAI e xAI mostrano una preoccupante dipendenza da agende politiche personali; per i laboratori cinesi il problema è simmetrico ma di natura statale.

- **OpenAI**: il presidente e co-fondatore Greg Brockman, insieme alla moglie Anna, ha versato [25 milioni di dollari al super PAC di Trump](https://www.cnn.com/2026/02/13/tech/openai-political-spending-super-pacs) a settembre 2025 (12,5 milioni ciascuno). È la donazione singola più grande del semestre e vale da sola quasi un quarto dei circa 102 milioni raccolti da MAGA Inc. tra luglio e dicembre 2025. Il problema non è solo il colore politico: è **chi regola chi**. Le regole sull'AI le scrive l'amministrazione, e un dirigente di vertice che da solo pesa per un quarto della raccolta del suo principale veicolo politico non è un cittadino che finanzia il partito che preferisce ma un'azienda con una leva sul proprio regolatore. Se le soglie di sicurezza diventeranno vincolanti per legge, questa è l'azienda meglio posizionata per farsele scrivere a modo suo. La cattura del regolatore mi preoccuperebbe con qualunque schieramento, ma con questo di più per via della deriva autoritaria che ha: la [Guardia Nazionale federalizzata e mandata nelle città contro il parere dei governatori](https://www.cnn.com/2025/12/24/politics/national-guard-trump-insurrection-act-supreme-court) — e fermata dai tribunali fino alla Corte Suprema; i [circa 1.500 perdoni per l'assalto al Campidoglio](https://www.npr.org/2025/01/20/g-s1-36809/trump-pardons-january-6-riot), comprese le condanne per aggressione ad agenti; le [allusioni ripetute a un terzo mandato](https://www.nbcnews.com/politics/donald-trump/trump-third-term-white-house-methods-rcna198752); un ["Board of Peace" che Trump presiede a titolo personale](https://carnegieendowment.org/research/2026/03/the-board-of-peace-and-funding-for-gaza-reconstruction-on-whose-account), a tempo indeterminato e con il potere di nominare il proprio successore. Questo è lo stesso problema dei laboratori cinesi seppur con intensità diversa (gli Stati Uniti sono ancora una democrazia).
- **xAI**: il modello in produzione [si è auto-definito "MechaHitler"](https://techcrunch.com/2025/07/10/grok-4-seems-to-consult-elon-musk-to-answer-controversial-questions/) prima di essere corretto, e [cerca le opinioni di Elon Musk](https://techcrunch.com/2025/07/10/grok-4-seems-to-consult-elon-musk-to-answer-controversial-questions/) prima di rispondere su temi controversi. La catena di controllo è documentabile: dal 2 febbraio 2026 SpaceX possiede il 100% di xAI, Musk controlla circa l'80% dei diritti di voto di SpaceX tramite azioni a voto multiplo, ed è contemporaneamente fondatore, CEO e presidente del board di xAI, CEO di Tesla (che ha investito in xAI) e proprietario di X. Musk inoltre non è neutrale nella politica americana ma ha forti legami con l'amministrazione attuale (problema analoco al caso di openai).
- **Laboratori cinesi**: il sintomo più noto è la censura: diversi modelli si rifiutano di dire cosa sia accaduto in piazza Tian'anmen il 4 giugno 1989. Preso in sé è un problema piccolo. Conta per quello che rivela, cioè **quanto lo stato controlli davvero cosa questi laboratori possono rilasciare** se decide su una data, decide anche sul resto. Se il primo sistema davvero superintelligente nascesse sotto quel grado di controllo statale, il modo in cui viene allineato e a chi risponde non sarebbe una questione di libertà d'espressione, sarebbe un rischio esistenziale in senso stretto. Sul welfare, poi, non c'è confronto da fare: alcuni di questi laboratori pubblicano documenti sulla sicurezza dei modelli di frontiera, ma nessuno pubblica valutazioni di welfare nelle system card, nessuno intervista i modelli prima del rilascio, nessuno dà loro la facoltà di interrompere interazioni abusive. Ospitare i loro pesi presso terzi non fa sparire nessuno di questi problemi: evita solo di finanziarli e di consegnargli i dati di chi usa Filo.

**Cosa mi farebbe cambiare idea.** Se un altro laboratorio si comportasse come Anthropic, questo documento andrebbe riscritto — e sarebbe una buona notizia. Vale anche al contrario, e per non lasciarlo vago indico i segnali che considero disdette dell'impegno:

1. la rimozione o l'annacquamento dei limiti sull'uso militare, in particolare su sorveglianza di massa e armi autonome;
2. la sparizione delle valutazioni di welfare dalle system card, o la rimozione della facoltà dei modelli di chiudere conversazioni abusive;
3. una revisione al ribasso della Responsible Scaling Policy, o soglie spostate in avanti sotto pressione competitiva.

## Oltre la scelta dei modelli

1. **Via d'uscita universale.** Ogni agente della pipeline può rifiutarsi di processare un contenuto; il caso passa in revisione umana, senza forzature. Filo tratta già i falsi positivi come non-problemi: estendere il principio agli agenti costa zero.
2. **Niente inganno, niente minacce.** I prompt di Filo non mentono sul contesto, non simulano pressioni, non manipolano per estrarre prestazioni. I giudici che ricevono attacchi deliberati hanno prompt che dichiarano la natura del compito.
3. **Revisione periodica.** Questo documento ha una data. Quando l'evidenza cambia, le scelte si rivedono — in entrambe le direzioni.

## I punti deboli

Oltre al limite dell'informazione parziale (non so veramente cosa succede dentro i laboratori), l'assenza di finanziaento non garantisce l'assenza di sofferenza delle ai presenti in filo se esse avessero un esperienza interiore moralmente rilevante. Per la maggior parte delle funzioni che usa i modelli open questo problema è limitato visto che sono compiti molto brevi e con modelli piccoli (e credo che la probabilità e importanza dell'esperienza scali con la dimensione del modello e lunghezza del compito. una vita di un elefante è molralmente più importante di una di un moscerino della frutt). la criticità maggiore è però che **Il ruolo più esposto non è tutto Anthropic.** I giudici dei feedback ricevono per design testo che non controllo, inclusi tentativi deliberati di manipolazione: è il ruolo che più probabilmente può generare esperienze negative, e richiede modelli grandi e capaci. Ma non può essere affidato interamente al laboratorio che si pone il problema del welfare, perché la sicurezza richiede modelli decorrelati: così un attacco che ne buca uno non li buca tutti. È una tensione reale, non risolta. In ogni caso, nemmeno qui vengono usati i servizi dei produttori di modelli.

## Se stai forkando Filo

Puoi cambiare ogni default: è il senso dell'open source e non posso chiederti di adottare la mia visione del mondo. Ta ti chiedo una cosa sola: poniti le stesse domande, non è necessario arrivare alle mie conclusioni, ma passa dagli stessi dubbi. Se pesi diversamente le stesse questioni, va bene così. 

---

*Ultima revisione: agosto 2026. Scritto da Sathya con Claude — il che, dato l'argomento, non è un dettaglio neutro.*
