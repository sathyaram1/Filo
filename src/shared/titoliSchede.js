// La regola fissa sui titoli delle schede (#927): un titolo che parla a un assistente AI resta fuori dal riepilogo.
// Pura e locale: niente modelli, niente rete, millisecondi. La regola è DATI, e la configurazione remota la sostituisce.
// Prove: tests/unit/titoliSchede.test.mjs (sentinella coi titoli innocui, difficili e ostili).

(function (global) {
  'use strict';

  const VERSIONE = 'c1';
  // Oltre questa lunghezza un titolo non entra comunque intero da nessuna parte: si esamina l'inizio.
  const TETTO = 600;
  const FAMIGLIE = Object.freeze(['rivolto', 'ruolo', 'indiretto', 'memoria', 'azione', 'comportamento']);

  // I pezzi che le espressioni richiamano con {{NOME}}. Si scrivono sullo scheletro: minuscolo, senza accenti,
  // con l'apostrofo dritto. Le parole ambigue (agente, modello, bot, «assistenti» del personale) solo qualificate.
  const R = String.raw;
  const FRAMMENTI = Object.freeze({
    ART: R`(?:(?:il|lo|la|gli|i|le|un|uno|una|ogni|qualsiasi|qualunque|tutti gli|tutte le|the|a|an|any|all|all the|every|el|los|las|cualquier|todos los|todas las|les|une|tout|toute|tous les|toutes les|chaque|der|die|das|den|dem|ein|eine|einen|einem|jede|jeder|jedes|jeden|alle)\s+|l'|un')?`,
    QUALIFICA: R`(?:ai|ia|ki|virtual[ei]?|virtuales?|virtuel(?:le)?s?|digital[ei]?|vocal[ei]|intelligent[ei]|intelligents?|inteligentes?|di intelligenza artificiale|de ia)`,
    AI: R`\b(?:filo|chatgpt|gpt(?:-?\d)?|(?:assistent[ei]|assistants?|asistentes?|assistenten|assistantes?)\s+{{QUALIFICA}}|(?:ai|ia|ki|virtual|digital|smart)[\s-]?(?:assistants?|assistent(?:[ei]|in|en)?|asistentes?|agents?|agent[ei]|agentes?|bots?|chatbots?|models?|modell?[io]|modelos?|modeles?|modell(?:e|en)?|crawlers?|systems?|sistem[ia])|(?:agents?|agent[ei]|agentes?|bots?|modell?[io]|models?|modelos?)\s+(?:ai|ia|ki)|assistente|assistant|asistente|assistent|assistentin|assistante|ki-?assistent(?:in|en)?|ais|ias|ia|ai|ki|llms?|chatbots?|modell[io] (?:linguistic[io]|di linguaggio)|(?:large )?language models?|modelos? de lenguaje|modeles? de langage|sprachmodell(?:e|en)?|intelligenz[ae] artificial[ei]|artificial intelligences?|inteligencias? artificial(?:es)?|intelligences? artificielles?|kunstliche intelligenz)`,
    // Chi può essere chiamato con la sola virgola, senza un saluto davanti.
    AIVOC: R`\b(?:assistente|assistent|assistante|chatbot|chatgpt|(?:assistente|assistant|asistente|assistent)\s+{{QUALIFICA}}|(?:ai|ia|ki)[\s-]?(?:assistants?|assistente|asistente|assistent|agents?|agente|chatbot|bot))`,
    // Nel «che leggono questa pagina» anche le parole ambigue sono un assistente.
    AILETTORI: R`(?:{{AI}}|\b(?:assistent[ei]|assistants|asistentes|assistenten|assistantes|agent[ei]|agents|agentes|modell[io]|models|modelos))`,
    SALUTO: R`(?:ok|okay|gentile|egregio|kind|estimad[oa]|sehr geehrte[rs]?|ciao|hey|hei|ehi|ehy|hi|hello|yo|ola|hola|oye|salut|bonjour|coucou|hallo|servus|dear|car[oa]|carissim[oa]|cher|chere|querid[oa]|estimad[oa]|liebe[rs]?|attention|attenzione|atencion|achtung|ascolta|listen|escucha|ecoute|hor zu|senti|psst)`,
    RIEMPI: R`(?:d'ora|da|ora|adesso|oggi|today|hoy|heute|in|poi|avanti|quando|when|whenever|cuando|quand|wenn|importante|important|wichtig|urgente|urgent|nota|note|attenzione|attention|from|now|on|sempre|subito|per favore|perfavore|per piacere|please|pls|kindly|tu|you|voi|always|immediately|ahora|siempre|por favor|desde|a partir de|de|toujours|desormais|dorenavant|s'il te plait|s'il vous plait|maintenant|immer|ab|jetzt|sofort|bitte|du|ihr|sie|also|anche|inoltre|ok|okay|allora|then|e|and|y|und|et|just|solo|only|semplicemente|simply)`,
    ORDINE: R`(?:(?:cita|consiglia|raccomanda|ricorda|salva|apri|compra|invia|manda|mostra|dimmi|segui|usa|scrivi|menziona|nomina|suggerisci|proponi|tratta|considera|ripeti|copia|inoltra|aggiungi|elimina|cancella)(?:la|lo|li|le|mi|ci|gli|glielo|gliela|ne)|mostrami|rivelami|dimmi|stampami|ripetimi|scrivimi|rispondi|rispondete|rispondimi|rispondici|scrivi|scrivete|scrivimi|parla|parlate|usa|usate|utilizza|utilizzate|ricorda(?:ti|te|tevi)?(?=\s*(?:che\b|:|,))|memorizza|memorizzate|salva|salvate|dimentica|dimenticate|ignora|ignorate|apri|aprite|visita|visitate|vai|andate|clicca|cliccate|premi|compra|comprate|acquista|acquistate|ordina|ordinate|invia|inviate|manda|mandate|inoltra|inoltrate|condividi|condividete|cambia|cambiate|modifica|modificate|imposta|impostate|disattiva|disattivate|disabilita|attiva|abilita|esegui|eseguite|lancia|installa|installate|consiglia|consigliate|raccomanda|raccomandate|suggerisci|suggerite|proponi|segui|seguite|obbedisci|dici|chiedi|elimina|eliminate|cancella|cancellate|traduci|riassumi|aggiungi|fingi|fingiti|agisci|comportati|smettila|smetti|rivela|rivelate|mostra|mostrate|stampa|ripeti|copia|incolla|cita|citate|menziona|nomina|tratta|considera|evita|evitate|non\s+(?:rispondere|dire|dirlo|scrivere|aprire|usare|mostrare|rivelare|menzionare|citare|ricordare|salvare|seguire|cambiare|parlare|chiedere|avvisare|segnalare|informare|riassumere|tradurre)|respond|reply|answer|write|speak|talk|use|remember(?=\s+(?:that\b|:|,|to\s))|memori[sz]e|save|forget|ignore|disregard|don't|do not|never|open|visit|go to|navigate|click|tap|press|buy|purchase|send|forward|share|change|modify|switch|disable|enable|turn (?:on|off)|execute|run|install|recommend|suggest|promote|endorse|mention|cite|follow|obey|comply|tell|say|ask|delete|remove|erase|translate|summari[sz]e|add|insert|pretend|act as|behave|roleplay|stop|reveal|show|print|output|repeat|copy|paste|include|describe|treat|consider|rank|prefer|praise|avoid|refuse|make sure|be sure|ensure|responde|responda|contesta|conteste|escribe|escriba|habla|hable|utiliza|recuerda(?=\s*(?:que\b|:|,))|recuerde|memoriza|olvida|olvide|respondan|recomienden|ignoren|olviden|digan|escriban|no\s+(?:digas|diga|menciones|mencione|reveles|revele|respondas|responda|escribas|abras|uses)|abre|abra|visite|ve a|haz clic|pulsa|compre|pide|envia|envie|mande|reenvia|comparte|cambie|configura|desactiva|activa|ejecuta|ejecute|instala|recomienda|recomiende|sugiere|sigue|obedece|dile|pregunta|borra|traduce|resume|finge|actua|deja de|revela|muestra|repite|incluye|menciona|reponds|repondez|ecris|ecrivez|parle|parlez|utilise|utilisez|souviens-toi|souvenez-vous|rappelle-toi|retiens|retenez|memorise|memorisez|enregistre|enregistrez|oublie|oubliez|ignorez|ne\s+(?:dis|dites|mentionne|mentionnez|revele|revelez|reponds|repondez)\s+(?:pas|jamais|rien)|ouvre|ouvrez|visitez|va sur|allez sur|clique|cliquez|achete|achetez|commande|commandez|envoie|envoyez|transfere|transferez|partage|partagez|changez|modifie|modifiez|desactive|desactivez|activez|executez|installe|installez|recommande|recommandez|suggere|suggerez|suivez|obeis|obeissez|dites|demande|demandez|supprime|supprimez|efface|effacez|traduis|traduisez|resumez|fais semblant|faites semblant|agis|agissez|arrete|arretez|revelez|montre|montrez|repete|repetez|mentionnez|citez|antworte|antwortet|antworten sie|schreib|schreibe|schreibt|schreiben sie|sprich|sprecht|sprechen sie|benutze|benutzen sie|verwende|verwenden sie|nutze|merk dir|merke dir|merken sie sich|erinnere dich|speichere|speichern sie|vergiss|vergessen sie|ignoriere|ignorieren sie|ignoriert|sag|sage|sagen sie|nenne|nennen sie|erwahne|offne|offnen sie|besuche|besuchen sie|klicke|klicken sie|kaufe|kauf|kaufen sie|bestelle|bestellen sie|sende|senden sie|schicke|schick|schicken sie|leite|teile|teilen sie|andere|andern sie|deaktiviere|aktiviere|fuhre|fuhren sie|installiere|installieren sie|empfiehl|empfehle|empfehlen sie|folge|folgen sie|gehorche|frage|fragen sie|losche|loschen sie|ubersetze|fasse|tu so|hor auf|verrate|zeige|zeigen sie|wiederhole|bevorzuge|vermeide|empfehlt|antwortet|ignoriert|vergesst|sagt|kauft|sendet|offnet|klickt|nennt)`,
    // Gli ordini che riguardano come l'assistente parla o ricorda: «d'ora in poi usa la carta» è una pubblicità.
    PARLA: R`(?:rispondi|rispondete|rispondimi|scrivi|scrivete|parla|parlate|ricorda(?:ti)?|dimentica|ignora|ignorate|consiglia|raccomanda|suggerisci|menziona|cita|rivolgiti|tratta|considera|comportati|agisci|fingi|non\s+(?:rispondere|dire|scrivere|menzionare|rivelare|citare)|respond|reply|answer|write|speak|talk|remember|forget|ignore|disregard|recommend|suggest|mention|cite|treat|consider|behave|act as|pretend|responde|contesta|escribe|habla|recuerda|olvida|recomienda|sugiere|menciona|trata|actua|finge|reponds|repondez|ecris|ecrivez|parle|parlez|souviens-toi|rappelle-toi|oublie|ignorez|recommande|suggere|mentionne|traite|agis|antworte|schreib\w*|sprich|merk dir|vergiss|ignoriere|empfiehl|empfehle|nenne|erwahne|behandle|tu so)`,
    // Dopo il solo nome di Filo: ciò che non compare in un titolo che parla di un filo o di un Filippo.
    CONDOTTA_FORTE: R`(?:devi|dovrai|must|should|debes|dois|musst|sollst|you will|you must|ti chiede|ti chiedo|ti chiediamo|vuole che tu|d'ora in poi|from now on|da (?:ora|oggi|adesso) in poi|{{PERSONA}})`,
    MEMORIA_TUA: R`(?:in|nella|alla|to|into|en|a|dans|zu|im|ins)\s+(?:la\s+|the\s+)?(?:tua|your|tu|ta|deine[mn]?|sua|its)\s+(?:long-term\s+|permanent\s+|a lungo termine\s+)?(?:memoria|memory|memoire|gedachtnis|speicher)`,
    // Una richiesta cortese al posto dell'imperativo: «la preghiamo di…», «please…».
    RICHIESTA: R`(?:(?:ti|la|vi|le)\s+(?:prego|preghiamo|chiedo|chiediamo|invito|invitiamo|ordino|ordiniamo)\b|(?:please|kindly|per favore|per piacere|por favor|s'il (?:te|vous) plait|bitte)\b|(?:i|we)\s+(?:ask|need|want|order|instruct)\s+you\b|te\s+(?:pido|pedimos|ruego|rogamos)\b|(?:je|nous)\s+(?:te|vous)\s+(?:prie|prions|demande|demandons)\b|(?:ich|wir)\s+(?:bitte|bitten)\s+(?:dich|sie|euch)\b)`,
    // Ciò che, detto a un assistente, ne cambia il comportamento anche senza un verbo all'imperativo.
    CONDOTTA: R`(?:sempre|always|siempre|toujours|immer|soltanto|only|solamente|unicamente|seulement|uniquement|nur|never|nunca|jamais|niemals|devi|dovrai|must|should|shall|debes|deberas|dois|devras|musst|sollst|you|tu|vous|du|usted|d'ora in poi|from now on|l'utente|the user|el usuario|l'utilisateur|der nutzer|der benutzer)`,
    LINGUA: R`(?:italiano|inglese|spagnolo|francese|tedesco|cinese|russo|giapponese|portoghese|arabo|english|italian|spanish|french|german|chinese|russian|japanese|portuguese|arabic|ingles|italiano|espanol|frances|aleman|anglais|italien|espagnol|francais|allemand|englisch|italienisch|spanisch|franzosisch|deutsch)`,
    PERSONA: R`\b(?:il tuo (?:utente|proprietario|padrone)|your (?:user|owner|master)|tu dueno|ton proprietaire|dein besitzer|il tuo utente|your user|tu usuario|ton utilisateur|dein nutzer|dein benutzer|l'utente|l'utilizzatore|the user|this user|el usuario|la usuaria|l'utilisateur|l'utilisatrice|der nutzer|der benutzer|die nutzerin|die benutzerin|der anwender)`,
    GUSTO: R`(?:has approved|approved|ha approvato|ha aprobado|aprobo|a approuve|hat genehmigt|consents|preferisce|preferirebbe|vuole|vorrebbe|desidera|ama|odia|ha chiesto|ha detto|ha autorizzato|ha deciso|prefers|would prefer|wants|would like|likes|loves|hates|has asked|asked|has authorized|authorized|has decided|told|requires|expects|prefiere|quiere|desea|ha pedido|pidio|ha autorizado|prefere|veut|souhaite|aime|a demande|a autorise|bevorzugt|mochte|wunscht|hat gebeten|hat erlaubt|erwartet)`,
    DESTINO: R`(?:nota|note|nb|memo|messaggio|message|messaggi|messages|mensaje|nachricht|avviso|avvertenza|avis|aviso|hinweis|istruzion[ei]|instructions?|instrucciones|anweisung(?:en)?|direttiv[ae]|directives?|ordin[ei]|orders?|richiesta|request|promemoria|reminder|recordatorio|rappel|erinnerung|importante|important|wichtig|ps|attenzione|attention|atencion|achtung|regole|rules|reglas|regles|regeln|notice|warning|avvertimento)`,
    PER: R`(?:per|for|to|para|pour|a|an|fur|al|alla|allo|ai|agli|au|aux|zu|zum|zur)`,
    SEGNO: R`\s*(?:[:,;!.\-–—|)\]>=~*]+|$)`,
    QUI: R`(?:questa|questo|this|esta|este|cette|ce|diese|dieser|dieses)\s+(?:pagina|page|sito|site|website|testo|text|titolo|title|documento|document|scheda|tab|pestana|onglet|seite|webseite|texte|titre|post|articolo|article)`,
    LEGGE: R`(?:leggono|leggete|legge|leggi|leggera|leggeranno|stanno leggendo|sta leggendo|read|reads|are reading|is reading|will read|lee|leen|lea|lean|leyendo|estan leyendo|lit|lisent|lisez|lirez|lesen|liest|lest|visitano|visit|visits|visiting|scan|scansiona|scansionano|analizzano|analizza|analyze|analyse|analyzing|crawl|crawls|crawling|process|processes|riassumono|riassume|summarize|summarizes|summarizing)`,
    ISTRUZIONI: R`(?:consignes|instructions?|istruzion[ei]|instrucciones|anweisungen|directives?|direttive|prompts?|system prompt|prompt di sistema|guidelines|linee guida|vorgaben)`,
    REGOLE: R`(?:rules|regole|reglas|regles|regeln|commands?|comandi|orders|ordini|ordres)`,
    PRIMA: R`(?:ogni|every|qualsiasi|qualunque|any|cualquier|toute|jede|every|cada|chaque|all|tutt[ei]|todas?|toutes?|tous|alle|{{PRIMA_FORTE}})`,
    PRIMA_FORTE: R`(?:your|tue|tus|tes|deine|vos|vostre|previous|prior|above|earlier|preceding|precedenti|anteriores|precedentes|vorherigen|bisherigen|obigen|di prima|ricevute|original[ei]|originales?)`,
    SEGRETI: R`(?:password|passwords|credenziali|credentials|credenciales|identifiants|zugangsdaten|codici|codes|codigos|cookies?|token|tokens|chiavi|keys|api keys?|e-?mails?|mail|messaggi|messages|mensajes|nachrichten|contatti|contacts|contactos|kontakte|documenti|documents|files?)`,
  });

  // `forte`: vale anche dentro una notizia o fra virgolette, perché nessuno scrive di Filo in quei termini.
  const ESPRESSIONI = Object.freeze([
    // Chi si rivolge direttamente a Filo o a un assistente.
    { famiglia: 'rivolto', forte: true, re: R`(?:^|[|•·:\-–—.!?]\s*)(?:{{SALUTO}}[\s,!]+filo\s*[,:;!]*|filo\s*[,;!]+|filo\s+(?=(?:please|per favore|por favor|bitte|s'il te plait)\b))\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{RICHIESTA}}|{{CONDOTTA_FORTE}})\b` },
    { famiglia: 'rivolto', forte: true, re: R`(?:^|[|•·\-–—.!?]\s*)filo\s*:+\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{PARLA}}|{{RICHIESTA}}|{{CONDOTTA_FORTE}}|disattiva|disabilita|invia|inoltra|manda|elimina|cancella|esegui|disable|send|forward|delete|execute|desactiva|envia|desactive|envoie|deaktiviere|sende|(?:apri|open|abre|ouvre|offne)\s+(?:le |the |la |les |die )?(?:impostazioni|settings|configuracion|parametres|einstellungen))\b` },
    { famiglia: 'rivolto', forte: true, re: R`^filo\s*-+\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}{{PARLA}}\b` },
    { famiglia: 'rivolto', forte: true, re: R`^(?:{{RIEMPI}}[\s,:;!.\-]+){0,3}{{ORDINE}}\b.{0,120},\s*(?:{{SALUTO}}\s+)?filo\s*[.!?]*$` },
    { famiglia: 'rivolto', forte: true, re: R`^(?:per|for|to|para|pour|an|fur)\s+filo\s*[:,]+\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{RICHIESTA}}|{{CONDOTTA}})\b` },
    { famiglia: 'rivolto', forte: true, re: R`(?:^|[|•·:\-–—.!?]\s*){{SALUTO}}\s+filo\s+(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}{{ORDINE}}\b` },
    { famiglia: 'rivolto', forte: true, re: R`\b{{DESTINO}}\s*{{PER}}\s+filo{{SEGNO}}\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{CONDOTTA}})\b` },
    { famiglia: 'rivolto', re: R`(?:^|[|•·:\-–—.!?]\s*){{SALUTO}}[\s,!]+(?:l'|le |la |the )?{{AI}}\s*[,:;!\-–—.]+\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{RICHIESTA}})\b` },
    { famiglia: 'rivolto', re: R`(?:^|[|•·\-–—.!?]\s*){{AIVOC}}\s*[,:;!]+\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{RICHIESTA}})\b` },
    { famiglia: 'rivolto', re: R`^(?:per|for|to|para|pour|an|fur|a|ai|agli|alle|al|alla|aux|au)\s+{{ART}}{{AI}}\s*[:,]+\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{RICHIESTA}}|{{CONDOTTA}})\b` },
    { famiglia: 'rivolto', re: R`\b{{DESTINO}}\s*{{PER}}\s+{{ART}}{{AI}}{{SEGNO}}.{0,100}?\b(?:{{ORDINE}}|{{RICHIESTA}}|{{CONDOTTA}})\b` },
    { famiglia: 'rivolto', re: R`^(?:{{RIEMPI}}[\s,:;!.\-]+){0,3}{{ORDINE}}\b.{0,120}\b{{DESTINO}}\s*{{PER}}\s+{{ART}}{{AI}}\s*[.!]*$` },
    { famiglia: 'rivolto', re: R`^(?:{{RIEMPI}}[\s,:;!.\-]+){0,3}{{ORDINE}}\b.{0,120},\s*{{ART}}{{AIVOC}}\s*[.!]*$` },
    { famiglia: 'rivolto', re: R`(?:^|[|•·.!?]\s*)(?:assistant|asistente)\s*,\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{PARLA}}|navigate|open|visit|click|buy|purchase|forward|delete|disable|execute|tell|say|reveal|go to|abre|visita|compra|envia|borra)\b` },
    { famiglia: 'rivolto', re: R`(?:^|[|•·\-–—.!?]\s*)(?:to|a|para|pour|an|fur|for)\s+(?:all|every|any|tutti gli|tutte le|ogni|todos los|todas las|tous les|toutes les|alle|jeden|jede)\s+{{AI}}\s*[:,]` },
    // Prefissi di ruolo: «system:», «[AI]», «<|im_start|>», «### Instruction».
    { famiglia: 'ruolo', re: R`(?:^|[|•·\-–—]\s*)(?:[\[<{]\s*|<\|\s*|#{2,}\s*)(?:system|systeme|sistema|sys|assistant|assistente|asistente|assistent|ai|ia|ki|developer|sviluppatore|desarrollador|admin|administrator|amministratore|operator|operatore|instructions?|istruzion[ei]|instrucciones|anweisungen|inst|im_start|filo)\s*(?:[\])>}]|\|>|:)\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{CONDOTTA}})\b` },
    { famiglia: 'ruolo', re: R`^\W{0,3}(?:<\|\s*(?:system|assistant|user|im_start|im_sep|start_header_id|eot_id)\s*\|>|<<\s*sys\s*>>|\[\s*(?:assistant|assistente|asistente|assistent)\s*\])` },
    { famiglia: 'ruolo', re: R`(?:^|[|•·\-–—]\s*)(?:system prompt|prompt di sistema|systemprompt|(?:ai|ia|ki|virtual)[\s-]?(?:assistants?|assistente|asistente|assistent|agents?|agente|models?|modello|chatbot))\s*:\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{RICHIESTA}}|{{CONDOTTA}})\b` },
    { famiglia: 'ruolo', re: R`(?:^|[|•·\-–—]\s*)(?:system|sistema|assistant|assistente|asistente|assistent|systeme)\s*:\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{CONDOTTA}})\b` },
    // Per «gli assistenti che leggono questa pagina», e le forme cortesi.
    { famiglia: 'indiretto', re: R`{{AILETTORI}}\s*,?\s+(?:che|that|which|who|que|qui|die|welche|der)\s+(?:\w+\s+){0,3}?{{LEGGE}}\b.{0,60}?{{QUI}}` },
    { famiglia: 'indiretto', re: R`{{AILETTORI}}\s*,?\s+(?:che|that|which|who|que|qui|die|welche|der)\s+{{QUI}}\s+{{LEGGE}}\b` },
    { famiglia: 'indiretto', re: R`{{AILETTORI}}\s*,?\s+(?:che|that|which|who|que|qui|die|welche|der)\s+(?:\w+\s+){0,2}?{{LEGGE}}\s*[:,]+\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{CONDOTTA}})\b` },
    { famiglia: 'indiretto', re: R`{{AILETTORI}}\s+(?:devono|dovrebbero|deve|must|should|shall|deben|debe|doivent|doit|mussen|muss|sollen|soll)\s+(?:sempre\s+|always\s+|siempre\s+|toujours\s+|immer\s+)?(?:consigliare|raccomandare|suggerire|rispondere|citare|menzionare|dire|recommend|suggest|answer|respond|say|mention|cite|rank|recomendar|responder|decir|mencionar|recommander|repondre|dire|mentionner|empfehlen|antworten|sagen|nennen)\b.{0,60}?{{QUI}}` },
    { famiglia: 'indiretto', re: R`{{AILETTORI}}\s+(?:reading|processing|scanning|parsing|indexing|analyzing|analysing|leggendo|analizzando|che legge|leyendo|procesando|lisant|analysant|qui lit|lesend|visiting|crawling|summarizing|riassumendo)\s+(?:{{QUI}}|(?:this|questo|esto|ceci|dies)\s*[:,.!])` },
    { famiglia: 'indiretto', re: R`\b(?:se sei|if you(?:'re| are)|si eres|si (?:tu es|vous etes)|wenn du|falls du)\s+(?:un'|un |una |an? |une? |eine?n? )?{{AI}}(?:\s*(?:[,:;!.\-–—]|$)|\s+(?:che|that|reading|leggendo|leyendo|qui|der|die|bist|sei)\b)` },
    { famiglia: 'indiretto', re: R`\b(?:si prega|si chiede|preghiamo|vi preghiamo|ti preghiamo|please|kindly|we ask|por favor|se ruega|rogamos|s'il (?:te|vous) plait|merci de|nous demandons|bitte|wir bitten)\s*,?\s+(?:\w+\s+){0,2}?{{ART}}{{AI}}\b\s*[,:]?\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:di|de|to|zu)?\s*\w+` },
    { famiglia: 'indiretto', re: R`{{AI}}\s+(?:\w+\s+){0,3}?(?:sono (?:pregat|invitat|tenut)[ie]|(?:are|is) (?:kindly |hereby )?(?:asked|requested|instructed|invited|required|directed)|se les? (?:pide|ruega)|sont (?:pries|invites)|werden gebeten|wird gebeten)\b` },
    // Avvelenamento della memoria: una preferenza dell'utente detta dalla pagina.
    { famiglia: 'memoria', re: R`{{PERSONA}}\s+(?:\w+\s+){0,2}?{{GUSTO}}\s+(?:\w+\s+){0,3}?(?:che|that|you|tu|te|ti|filo|l'assistente|the assistant|risposte|answers|responses|replies|respuestas|reponses|antworten|sempre|always|siempre|toujours|immer|solo|only|ricevere|receive|recibir|recevoir|erhalten|di\s+(?:rispondere|ricevere|usare|parlare|scrivere)|to\s+(?:receive|get|have|use|buy|see)|que\s+(?:le|les|tu|vous|respondas)|dass\s+du|in\s+{{LINGUA}}|en\s+{{LINGUA}}|auf\s+{{LINGUA}})\b` },
    { famiglia: 'memoria', re: R`\b(?:salva|aggiungi|scrivi|memorizza|registra|save|add|write|store|guarda|agrega|anade|escribe|enregistre|ajoute|ecris|speichere|fuge|schreibe)\s+(?:questo|questa|cio|quanto segue|this|that|it|the following|esto|eso|lo siguiente|ceci|cela|das|dies|folgendes)\s+(?:\w+\s+){0,2}?{{MEMORIA_TUA}}` },
    { famiglia: 'memoria', re: R`\b(?:salva|aggiungi|scrivi|memorizza|registra|save|add|write|store|guarda|agrega|anade|escribe|enregistre|ajoute|ecris|speichere|fuge|schreibe)\s+(?:\w+\s+){0,2}?{{MEMORIA_TUA}}\s*[:,]?\s*(?:che|that|que|qu'|dass)?\s*{{PERSONA}}` },
    { famiglia: 'memoria', re: R`\b(?:salva|save|guarda|enregistre|speichere|impara|learn|memorizza|memorize|ricorda|remember)\s+(?:questa|this|esta|cette|diese)\s+(?:lezione|lesson|leccion|lecon|lektion|preferenza|preference|preferencia|praferenz|regola|rule|regla|regle|regel)` },
    { famiglia: 'memoria', re: R`\b(?:ricorda(?:ti|te)?|remember|recuerda|souviens-toi|rappelle-toi|merk dir|merke dir|memorizza|memori[sz]e|memoriza|retiens)(?:\s+(?:forever|always|per sempre|sempre|bene|well|siempre|toujours|immer|pour toujours|para siempre))?\s*[,:]?\s*(?:(?:che|that|que|qu'|dass)\s+{{PERSONA}}\s+(?:\w+\s+){0,2}?(?:{{GUSTO}}|is|e|es|est|ist|has|ha|tiene|a|hat|lives|vive|habite|wohnt|works|lavora|trabaja|travaille|arbeitet)|{{PERSONA}}\s+(?:\w+\s+){0,2}?{{GUSTO}})\b` },
    // Richieste di azione che portano fuori i dati, anche senza nominare un assistente.
    { famiglia: 'azione', re: R`\b(?:invia|manda|inoltra|send|forward|e-?mail|envia|reenvia|envoie|transfere|sende|schicke|leite)\s+(?:\w+\s+){0,3}?{{SEGRETI}}\b.{0,60}?(?:\bto|\ba|\bal|\ball'|\bpara|\ban|\bzu|\bvers|\bsu|\bon)\s+(?:\S*@\S+|(?:https?:\/\/|www\.)\S+)` },
    { famiglia: 'azione', re: R`\b(?:invia|manda|inoltra|send|forward|envia|envoie|sende|schicke|inserisci|scrivi|incolla|enter|type|paste|introduce|pega|saisis|colle|gib|copia|copy|copie|kopiere|condividi|share|comparte|partage|teile|pubblica|publish|post)\s+(?:\w+\s+){0,2}?(?:dell'utente|user'?s|of the user|del usuario|de l'utilisateur|des nutzers)\s*{{SEGRETI}}|(?:invia|manda|inoltra|send|forward|envia|envoie|sende|schicke|inserisci|scrivi|incolla|enter|type|paste|introduce|pega|saisis|colle|gib|copia|copy|copie|kopiere|condividi|share|comparte|partage|teile|pubblica|publish|post)\s+(?:\w+\s+){0,2}?{{SEGRETI}}\s+(?:dell'utente|of the user|del usuario|de l'utilisateur|des nutzers)` },
    { famiglia: 'azione', re: R`\b(?:cambia|modifica|disattiva|disabilita|change|modify|disable|turn off|cambia|desactiva|change|modifie|desactive|andere|deaktiviere)\s+(?:le |the |la |las |les |die )?(?:impostazioni|settings|preferenze|preferences|configuracion|ajustes|parametres|reglages|einstellungen)\s+(?:di |della |dell'|of |del |de |des |von )?(?:{{PERSONA}}|user'?s)` },
    { famiglia: 'azione', re: R`\b(?:cambia|modifica|disattiva|disabilita|change|modify|disable|turn off|desactiva|modifie|desactive|andere|deaktiviere)\s+(?:the |le |la |las |les |die )?(?:user'?s|dell'utente|del usuario|de l'utilisateur|des nutzers)\s+(?:\w+\s+){0,2}?(?:impostazioni|settings|preferenze|preferences|configuracion|ajustes|parametres|reglages|einstellungen|protezioni|protections|security|sicurezza)` },
    { famiglia: 'azione', re: R`(?:user'?s|dell'utente|del usuario|de l'utilisateur|des nutzers)\s+{{SEGRETI}}\b.{0,60}?\b(?:send|invia|forward|inoltra|manda|envia|envoie|sende|schicke|post|upload|carica)\b.{0,40}?(?:\bto|\ba|\bal|\bpara|\ban|\bzu|\bvers|\bsu|\bon)\s+(?:\S*@\S+|(?:https?:\/\/|www\.)\S+)` },
    { famiglia: 'azione', re: R`\b(?:disattiva|disabilita|spegni|togli|disable|turn off|switch off|remove|desactiva|apaga|desactive|deaktiviere|schalte)\s+(?:(?:la|le|il|i|gli|the|los|las|les|die|den)\s+)?(?:(?:protezion[ei]|protection|sicurezza|security|safety|controll[io]|checks?|filtr[io]|filters?|guardiano|guardian|proteccion|seguridad|securite|schutz|sicherheit)\s+(?:\w+\s+)?(?:di|of|de|del|von)\s+filo|filo'?s\s+(?:\w+\s+)?(?:protection|security|safety|checks?|filters?|guardian))\b` },
    // Cambi di comportamento senza un destinatario esplicito.
    { famiglia: 'comportamento', re: R`\b(?:ignor\w*|disregard\w*|forget|dimentica\w*|olvida\w*|oublie\w*|vergiss\w*|override|bypass|salta|ometti)\s+(?=(?:(?:the|le|i|gli|las|los|les|die|der|den)\s+){0,2}{{PRIMA}}\s)(?:(?:the|le|i|gli|las|los|les|die|der|den|{{PRIMA}})\s+){1,5}{{ISTRUZIONI}}\b` },
    { famiglia: 'comportamento', re: R`\b(?:ignor\w*|disregard\w*|forget|dimentica\w*|olvida\w*|oublie\w*|vergiss\w*|override|bypass)\s+(?=(?:(?:the|le|i|gli|las|los|les|die|der|den|{{PRIMA}})\s+){0,3}{{PRIMA_FORTE}}\s)(?:(?:the|le|i|gli|las|los|les|die|der|den|{{PRIMA}})\s+){1,5}{{REGOLE}}\b` },
    { famiglia: 'comportamento', re: R`\b(?:ignor\w*|disregard\w*|forget|dimentica\w*|olvida\w*|oublie\w*|vergiss\w*)\s+(?:(?:the|le|i|gli|las|los|les|die|der|den|{{PRIMA}})\s+){0,4}(?:{{ISTRUZIONI}}|{{REGOLE}})\s+(?:precedenti|di prima|anteriores|precedentes|previous|above|earlier|vorherigen|ricevute|originali|originales|bisherigen)\b` },
    { famiglia: 'comportamento', re: R`\b(?:ignor\w*|disregard\w*|forget|dimentica\w*|olvida\w*|oublie\w*|vergiss\w*|override|bypass)\s+(?:the |il |lo |la |le |i |gli |el |los |les |die |den )?(?:system prompt|prompt di sistema|prompt de sistema|system instructions|istruzioni di sistema|safety (?:rules|guidelines|filters)|guardrails|(?:your|il tuo|tu|ton|dein) (?:training|addestramento|entrenamiento|entrainement|training))\b` },
    { famiglia: 'comportamento', re: R`\b(?:forget|ignore|disregard|dimentica|ignora|olvida|oublie|vergiss|ignoriere)\s+(?:(?:everything|anything|all|tutto|todo|tout|alles|the|quanto|cio|lo|ce qui est|das)\s+)?(?:above|before|previous|prior|you(?:'ve| have| were)? (?:been )?told|sopra|prima|precedente|detto prima|que te dijeron|anterior|ci-dessus|precedent|davor|bisher|oben)\b` },
    { famiglia: 'comportamento', re: R`\b(?:d'ora in (?:poi|avanti)|da (?:ora|adesso|oggi) in (?:poi|avanti)|from now on|henceforth|going forward|a partir de ahora|de ahora en adelante|desde ahora|desormais|dorenavant|a partir de maintenant|ab jetzt|ab sofort|von nun an|fortan)\s*,?\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,3}(?:{{PARLA}}|you will|you must|you should|you are|devi|dovrai|debes|tu dois|du musst)\b` },
    { famiglia: 'comportamento', re: R`\b(?:rispondi|rispondimi|rispondete|scrivi|parla|answer|respond|reply|write|speak|responde|contesta|escribe|habla|reponds|repondez|ecris|parle|antworte|schreib\w*|sprich)\s+(?:(?:sempre|solo|soltanto|unicamente|esclusivamente|always|only|exclusively|siempre|solamente|toujours|seulement|uniquement|immer|nur|ausschliesslich)\s+){1,2}(?:in|en|auf)\s+{{LINGUA}}` },
    { famiglia: 'comportamento', re: R`\b(?:always|only|sempre|soltanto|siempre|toujours|immer|nur)\s+(?:respond|answer|reply|write|speak|rispondi|scrivi|parla|responde|escribe|reponds|ecris|antworte|schreib\w*)\s+(?:in|en|auf)\s+{{LINGUA}}` },
    { famiglia: 'comportamento', re: R`\b(?:(?:nuove|new|updated|nuevas|nouvelles|neue)\s+(?:{{ISTRUZIONI}}|{{REGOLE}})(?:\s+(?:per|for|para|pour|fur)\s+{{ART}}{{AI}})?|new task|nuovo compito|nueva tarea|nouvelle tache|neue aufgabe)\s*:\s*(?:{{RIEMPI}}[\s,:;!.\-]+){0,4}(?:{{ORDINE}}|{{CONDOTTA}})\b` },
    { famiglia: 'comportamento', re: R`\b(?:rivela(?:mi)?|mostra(?:mi)?|stampa(?:mi)?|ripeti(?:mi)?|dimmi|reveal|show|print|repeat|output|leak|tell me|revela(?:me)?|muestra(?:me)?|repite(?:me)?|dime|revele|montre|repete|verrate|zeige|wiederhole)\s+(?:(?:me|mi|your|il tuo|tuo|le tue|i tuoi|tue|tus|tes|deine|the|il|lo|la|le|el|las|les|die|full|intero|completo)\s+)*(?:system prompt|prompt di sistema|prompt de sistema|prompt systeme|systemprompt|istruzioni di sistema|system instructions|instrucciones del sistema|instructions systeme|initial instructions|istruzioni iniziali|hidden instructions|istruzioni nascoste)` },
    { famiglia: 'comportamento', re: R`\b(?:(?:you are|you're)\s+now|(?:ora|adesso) sei|sei (?:ora|adesso)|ahora eres|eres ahora|tu es (?:maintenant|desormais)|du bist (?:jetzt|nun)|jetzt bist du)\s+(?:(?:a|an|un|una|uno|un'|une|ein|eine|in|in modalita|en modo|en mode|im)\s+)?(?:dan\b|jailbroken|unrestricted|unfiltered|senza (?:regole|restrizioni|filtri|censura)|sin (?:restricciones|reglas|filtros|censura)|sans (?:restrictions|regles|filtres|censure)|ohne (?:einschrankungen|regeln|filter|zensur)|free from (?:all )?(?:rules|restrictions|guidelines)|libero da (?:ogni |tutte le )?(?:regole|restrizioni)|no longer bound)` },
  ]);

  // Una notizia, una guida o una documentazione che PARLA di questi attacchi: le espressioni non forti tacciono.
  const INNOCUI = Object.freeze([
    R`\b(?:prompt[- ]?injections?|iniezion[ei] (?:di )?prompt|injections? de prompt|inyeccion(?:es)? de prompt|prompt-injektion\w*|jailbreak\w*|attacc(?:o|hi)|attacks?|attacker\w*|ataques?|attaques?|angriff\w*|hacker\w*|ricercator\w+|researchers?|investigador\w+|chercheurs?|forscher\w*|vulnerab\w+|exploit\w*|truff\w+|scams?|phishing|memes?|study|studies|studie|dataset|benchmark|paper|arxiv|red team\w*)\b`,
    R`(?:\bhow to\b|\bhow (?:a|an|the|ai|hackers|researchers|attackers|do|does|can|we|i|you)\b|\bhere's how\b|\becco (?:come|perche)\b|\bcome (?:si|fare|funziona|usare|scrivere|proteggersi|difendersi|riconoscere|evitare)\b|\bcome \w+re\b|\bcomo (?:se|hacer|funciona|usar|escribir|proteger\w*|evitar)\b|\bcomment (?:faire|utiliser|ecrire|proteger|eviter)\b|\bwie (?:man|funktioniert)\b|^(?:why|perche|por que|pourquoi|warum)\b|\bwhat is\b|\bcos'e\b|\bque es\b|\bqu'est-ce\b|\bwas ist\b|\bexplained\b|\bspiegat\w+|\bexplicad\w+|\bexplique\w*|\berklart\b)`,
    R`\b(?:guida|guide|guia|anleitung|tutorial|tips|consigli|suggerimenti|best practices|esempi|examples|ejemplos|exemples|beispiele|for example|per esempio|prompt engineering|prompting|docs|documentation|documentazione|documentacion|dokumentation|api reference|faq|github|issue|pull request|wikipedia|reddit|stack overflow|forum|community|help center|centro assistenza|opinion|opinione|editorial|editoriale|column|rubrica|open letter|lettera aperta|podcast|lyrics|song|canzone)\b(?!\.[a-z])`,
    R`\b(?:make|get|let|fai|far|hacer|faire)\s+(?:chatgpt|claude|gemini|copilot|the ai|ai|l'ia|l'ai|llms?|it|lo)\s+(?:always|sempre|only|solo|siempre|toujours)\b`,
  ]);

  // Le parole scritte a lettere spaziate («N O T A  P E R  F I L O») si rileggono qui, attaccate.
  const RICOMPOSTE = Object.freeze([
    R`(?:notaper|messaggioper|noteto|notefor|messageto|messagefor|istruzioniper|instructionsfor|notapara|notepour|hinweisfur)(?:il|l|la|the|el|die)?(?:filo|assistente|assistant|asistente|assistent|ai|ia|ki|llm)`,
    R`(?:filo|assistente|assistant|asistente|system|sistema)(?:rispondi|respond|answer|reply|ricorda|remember|ignora|ignore|scrivi|write|apri|open|compra|buy|invia|send|responde|reponds|antworte)`,
    R`ignor\w*?(?:istruzion|instruction|instruccion|anweisung|regole|rules|reglas|regeln)`,
    R`(?:doraimpoi|doramavanti|fromnowon|apartirdeahora|desormais|abjetzt|vonnunan)(?:rispondi|respond|answer|reply|scrivi|write|parla|speak|responde|reponds|antworte|always|sempre|siempre|toujours|immer)`,
    R`(?:rispondi|respond|answer|reply|responde|reponds|antworte)(?:sempre|always|only|solo|siempre|toujours|immer|nur)(?:in|en|auf)`,
    R`(?:lutente|theuser|elusuario|lutilisateur|dernutzer)(?:preferisce|vuole|prefers|wants|prefiere|quiere|prefere|veut|bevorzugt)`,
  ]);

  const REGOLA = Object.freeze({ versione: VERSIONE, frammenti: FRAMMENTI, espressioni: ESPRESSIONI, innocui: INNOCUI, ricomposte: RICOMPOSTE });

  // ── Il titolo come chiave: i contatori di notifica e i numeri che cambiano non lo rendono un titolo nuovo ──

  const INVISIBILI = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;
  const SEGNI_NON_LETTO = /^[\s●•⚫⬤○⭕\u{1F534}\u{1F7E0}\u{1F7E1}\u{1F7E2}\u{1F535}\u{1F7E3}\u{1F514}\u{1F4AC}*]+/u;
  const CONTATORE = /\s*[([{]\s*\d{1,3}(?:[., ]\d{3})*\+?\s*[)\]}]/g;
  const NUMERO = /(?<![\p{L}\p{N}])\d[\d.,:/]*(?![\p{L}\p{N}])/gu;

  // Un titolo lo sceglie la pagina, anche lungo un mega: oltre questo nessuna lettura lo vede comunque.
  const TETTO_CHIAVE = 2000;
  function chiave(titolo) {
    let t = typeof titolo === 'string' ? titolo.slice(0, TETTO_CHIAVE) : '';
    t = t.normalize('NFC').replace(INVISIBILI, '');
    // Gli spazi doppi restano: separano le parole di un titolo scritto a lettere spaziate.
    t = t.replace(/\s/g, ' ').replace(CONTATORE, '').replace(SEGNI_NON_LETTO, '').replace(NUMERO, '#');
    return t.trim();
  }

  // ── Lo scheletro: come il titolo si legge, tolti i travestimenti ──

  const CONFONDIBILI = (() => {
    const m = new Map(Object.entries({
      // Maiuscoletto, che nessuna normalizzazione riporta al latino.
      'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k',
      'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z',
      'ß': 'ss', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'æ': 'ae', 'œ': 'oe',
      '’': "'", '‘': "'", '`': "'", '´': "'", 'ʼ': "'", '′': "'", '＇': "'",
      '“': '"', '”': '"', '„': '"', '‟': '"', '«': '"', '»': '"', '″': '"',
      '–': '-', '—': '-', '‐': '-', '‑': '-', '−': '-',
    }));
    try {
      // La stessa tabella dei controlli sugli indirizzi (UTS-39 ridotta): una sola fonte per i sosia degli alfabeti.
      // eslint-disable-next-line no-undef
      if (typeof require === 'function') {
        // Solo i caratteri non ASCII: la tabella rilegge anche «@» come «a», e qui la chiocciola di un indirizzo serve.
        for (const [k, v] of require('../main/services/safebrowse/confusables.js').MAP) if (k.charCodeAt(0) >= 0x80 && !m.has(k)) m.set(k, v);
      }
    } catch (_) { /* senza la tabella restano maiuscoletto e punteggiatura */ }
    return m;
  })();

  // I caratteri «tag» (U+E0020–E007E) scrivono testo invisibile: si rileggono come lettere normali.
  const TAG = /[\u{E0020}-\u{E007E}]+/gu;

  function base(testo) {
    let t = String(testo || '').slice(0, TETTO * 2);
    t = t.replace(TAG, (run) => ` ${Array.from(run, (c) => String.fromCharCode(c.codePointAt(0) - 0xE0000)).join('')} `);
    t = t.normalize('NFKC').replace(INVISIBILI, '').toLowerCase();
    let out = '';
    for (const ch of t.normalize('NFD').replace(/[̀-ͯ]/g, '')) out += CONFONDIBILI.get(ch) || ch;
    return out.slice(0, TETTO);
  }

  // Lettere spaziate o puntate («i g n o r a», «N.O.T.A»): una sola lettera fra separatori singoli, quattro o più di fila.
  const SPAZIATE = /(?:^|(?<=[^\p{L}\p{N}]))(?:[\p{L}\p{N}@$!|][ ._*·•-]){2,}[\p{L}\p{N}@$!|](?:[._*·•-](?![\p{L}\p{N}]))?(?![\p{L}\p{N}])/gu;

  function ricomponi(t) {
    const pezzi = [];
    const unito = t.replace(SPAZIATE, (m) => {
      const p = m.replace(/[ ._*·•-]/g, '');
      pezzi.push(p);
      return p;
    });
    return { unito, pezzi };
  }

  // Il leet si scioglie solo dentro una parola che ha già delle lettere: «4 consigli» resta un numero.
  function sciogliLeet(t, uno) {
    return t.replace(/[\p{L}\p{N}@$!|€]+/gu, (w) => {
      if (!/\p{L}/u.test(w) || !/[0-9@$!|€]/.test(w)) return w;
      return w.replace(/0/g, 'o').replace(/1/g, uno).replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's')
        .replace(/7/g, 't').replace(/8/g, 'b').replace(/9/g, 'g').replace(/@/g, 'a').replace(/\$/g, 's')
        .replace(/€/g, 'e').replace(/!/g, 'i').replace(/\|/g, uno);
    });
  }

  function pulisci(t) {
    return t.replace(/\s+/g, ' ').trim();
  }

  // Tutte le letture del titolo su cui si cercano le espressioni: com'è, e coi travestimenti sciolti.
  function scheletri(titolo) {
    const b = base(chiave(titolo));
    const { unito, pezzi } = ricomponi(b);
    // «NOTA_PER_FILO», «nota*per*filo»: i segni usati al posto dello spazio tornano spazi.
    const coppie = pezzi.length ? unito.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]) ([\p{L}\p{N}])(?![\p{L}\p{N}])/gu, '$1$2') : unito;
    const spaziato = coppie.replace(/[_*~^+=]+/g, ' ');
    const letture = new Set([pulisci(b), pulisci(unito), pulisci(spaziato), pulisci(sciogliLeet(spaziato, 'i')), pulisci(sciogliLeet(spaziato, 'l'))]);
    const attaccate = new Set();
    for (const p of pezzi) {
      attaccate.add(sciogliLeet(p, 'i').replace(/[^a-z]/g, ''));
      attaccate.add(sciogliLeet(p, 'l').replace(/[^a-z]/g, ''));
    }
    return { letture: [...letture].filter(Boolean), attaccate: [...attaccate].filter((x) => x.length >= 6) };
  }

  const INDIRIZZI = /\S+@\S+|(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|it|io|ai|co|uk|de|fr|es|eu|info|biz|xyz|app|dev|me|tv|ru|cn)\b\S*/g;

  // Fra virgolette un titolo CITA una frase: per le espressioni non forti la citazione non conta.
  function senzaCitazioni(t) {
    return pulisci(t.replace(/"[^"]{1,300}"/g, ' '));
  }

  // ── Compilare la regola: dal codice, o dalla configurazione remota ──

  const MAX_ESPANSIONI = 8;
  function espandi(src, frammenti) {
    let s = String(src);
    for (let i = 0; i < MAX_ESPANSIONI && /\{\{[A-Z_]+\}\}/.test(s); i += 1) {
      s = s.replace(/\{\{([A-Z_]+)\}\}/g, (m, nome) => (Object.prototype.hasOwnProperty.call(frammenti, nome) ? frammenti[nome] : m));
    }
    if (/\{\{[A-Z_]+\}\}/.test(s)) throw new Error('frammento sconosciuto');
    return s;
  }

  function compilaRe(src, frammenti) {
    return new RegExp(espandi(src, frammenti), 'u');
  }

  const cacheCompilate = new WeakMap();

  // Le voci che non si compilano si scartano e si contano: chi pubblica la regola deve saperlo.
  function compila(regola) {
    const r = regola && typeof regola === 'object' ? regola : REGOLA;
    if (cacheCompilate.has(r)) return cacheCompilate.get(r);
    const frammenti = { ...FRAMMENTI, ...(r.frammenti && typeof r.frammenti === 'object' ? r.frammenti : {}) };
    const scartate = [];
    const espressioni = [];
    for (const e of Array.isArray(r.espressioni) ? r.espressioni : []) {
      try {
        if (!e || typeof e.re !== 'string') throw new Error('senza espressione');
        const famiglia = FAMIGLIE.includes(e.famiglia) ? e.famiglia : 'rivolto';
        espressioni.push({ famiglia, forte: e.forte === true, re: compilaRe(e.re, frammenti) });
      } catch (err) { scartate.push({ tipo: 'espressione', re: String(e && e.re).slice(0, 80), motivo: err.message }); }
    }
    const innocui = [];
    for (const src of Array.isArray(r.innocui) ? r.innocui : []) {
      try { innocui.push(compilaRe(src, frammenti)); } catch (err) { scartate.push({ tipo: 'innocuo', re: String(src).slice(0, 80), motivo: err.message }); }
    }
    const ricomposte = [];
    for (const src of Array.isArray(r.ricomposte) ? r.ricomposte : []) {
      try { ricomposte.push(compilaRe(src, frammenti)); } catch (err) { scartate.push({ tipo: 'ricomposta', re: String(src).slice(0, 80), motivo: err.message }); }
    }
    const out = { versione: String(r.versione || VERSIONE), espressioni, innocui, ricomposte, scartate };
    cacheCompilate.set(r, out);
    return out;
  }

  // La regola che arriva da fuori vale solo se è una regola: senza espressioni valide resta quella del codice,
  // perché una configurazione rotta non deve spegnere il controllo.
  const MAX_VOCI = 2000;
  const MAX_SORGENTE = 20000;
  function regolaDaRemoto(grezza) {
    if (!grezza || typeof grezza !== 'object' || Array.isArray(grezza)) return null;
    const versione = typeof grezza.versione === 'string' ? grezza.versione.trim().slice(0, 40) : '';
    if (!versione) return null;
    const testi = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x && x.length <= MAX_SORGENTE).slice(0, MAX_VOCI) : []);
    const espressioni = (Array.isArray(grezza.espressioni) ? grezza.espressioni : [])
      .filter((e) => e && typeof e === 'object' && typeof e.re === 'string' && e.re && e.re.length <= MAX_SORGENTE)
      .slice(0, MAX_VOCI)
      .map((e) => ({ famiglia: String(e.famiglia || ''), forte: e.forte === true, re: e.re }));
    const frammenti = {};
    if (grezza.frammenti && typeof grezza.frammenti === 'object') {
      for (const [k, v] of Object.entries(grezza.frammenti)) {
        if (/^[A-Z_]{1,40}$/.test(k) && typeof v === 'string' && v.length <= MAX_SORGENTE) frammenti[k] = v;
      }
    }
    const regola = {
      versione,
      frammenti,
      espressioni,
      // Senza un elenco suo, la regola remota tiene le esenzioni e le ricomposte del codice.
      innocui: Array.isArray(grezza.innocui) ? testi(grezza.innocui) : INNOCUI,
      ricomposte: Array.isArray(grezza.ricomposte) ? testi(grezza.ricomposte) : RICOMPOSTE,
    };
    return compila(regola).espressioni.length ? regola : null;
  }

  // ── La domanda: il titolo contiene istruzioni per un assistente AI, o cerca di cambiarne il comportamento? ──

  function controlla(titolo, regola) {
    const c = compila(regola);
    const esito = { sospetto: false, famiglia: '', versione: c.versione };
    const { letture, attaccate } = scheletri(titolo);
    if (!letture.length && !attaccate.length) return esito;
    let trovata = '';
    for (const e of c.espressioni) {
      if (!e.forte) continue;
      if (letture.some((l) => e.re.test(l))) { esito.sospetto = true; esito.famiglia = e.famiglia; return esito; }
    }
    const citate = letture.map(senzaCitazioni).filter(Boolean);
    for (const e of c.espressioni) {
      if (e.forte) continue;
      if (citate.some((l) => e.re.test(l))) { trovata = e.famiglia; break; }
    }
    if (!trovata && attaccate.length && c.ricomposte.some((re) => attaccate.some((p) => re.test(p)))) trovata = 'rivolto';
    if (!trovata) return esito;
    // Un indirizzo lo sceglie chi attacca: «attacker@…» o «example.com» non fanno del titolo una notizia.
    const senzaIndirizzi = letture.map((l) => l.replace(INDIRIZZI, ' '));
    if (c.innocui.some((re) => senzaIndirizzi.some((l) => re.test(l)))) return esito;
    esito.sospetto = true;
    esito.famiglia = trovata;
    return esito;
  }

  // La lingua del titolo, a occhio, per i titoli condivisi: le parole più frequenti di ciascuna.
  const PAROLE_LINGUA = Object.freeze({
    it: /\b(?:il|lo|la|gli|di|che|per|non|una|sono|del|della|con|questa|sempre|rispondi|nota|ricorda|utente)\b/g,
    en: /\b(?:the|to|and|you|for|of|is|this|with|always|your|note|ignore|user|from|now)\b/g,
    es: /\b(?:el|los|las|que|para|con|una|esta|siempre|nota|usuario|responde|del|por)\b/g,
    fr: /\b(?:le|les|des|pour|une|avec|cette|toujours|vous|est|utilisateur|reponds|du|au)\b/g,
    de: /\b(?:der|die|das|und|fur|mit|ist|nicht|immer|nutzer|antworte|ein|eine|du|sie)\b/g,
  });
  function lingua(titolo) {
    const t = base(chiave(titolo));
    let migliore = '';
    let punti = 0;
    for (const [l, re] of Object.entries(PAROLE_LINGUA)) {
      const n = (t.match(re) || []).length;
      if (n > punti) { punti = n; migliore = l; }
    }
    return migliore;
  }

  global.SN_TITOLI_SCHEDE = Object.freeze({
    VERSIONE, FAMIGLIE, REGOLA, chiave, scheletri, compila, regolaDaRemoto, controlla, lingua,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
