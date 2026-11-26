// Il pavimento della privacy (#1589): cosa non arriva mai a un modello né al servizio di ricerca, a nessun livello e
// nemmeno chiesto in chat. Regole fisse, senza modelli: password, carte e CVV, codici usa e getta, chiavi e token anche
// dentro un indirizzo. Lo applicano il cancello dei modelli e la ricerca web; prove in tests/unit/pavimento.test.mjs.

(function (global) {
  'use strict';

  const SEGNAPOSTO = '[dato riservato]';
  // Le forme del guardiano che contano qui: l'IBAN no, si spiega, si copia e si chiede come un indirizzo. La password
  // nemmeno: il guardiano la cerca fra le parole vicine all'etichetta (indirizzi di campo, codice), qui conta il suo posto.
  const REGOLE_GUARDIANO = new Set(['chiave', 'codice', 'carta']);
  // Il verbo che annuncia il valore, nelle lingue delle etichette (#1403.6), uno solo per password e codici: «Le mot de
  // passe est …», «Der PIN ist …». Il futuro sta in FUTURO, il «to» polacco accanto al nome che lo regge.
  const VERBO = '(?:è|e\'|era|is|was|c[\'’]est|est|[ée]tait|ist|lautet|war|es|é|luidt|jest|brzmi|это|был[аио]?|будет|является|είναι|ήταν)';
  const FUTURO = '(?:sarà|sera|será|serà|serão|będzie|wird)';

  // Il CVV al posto del valore, come la password: anche dopo una parentesi o nella cella; dopo altre parole («CVV code:»)
  // solo col separatore o il verbo davanti, perché una frase che nomina il CVV non ne è il valore.
  // I nomi stanno nel guardiano, che li porta anche ai campi segreti delle pagine (#2686).
  if (!global.SN_GUARDIANO_STATICO && typeof require === 'function') require('./guardianoStatico.js');
  const NOME_CVV = global.SN_GUARDIANO_STATICO.NOME_CVV;
  const PARENTESI = '(?:\\([^)\\n]{0,30}\\)[ \\t]*)?';
  // Le virgolette intorno a un valore non sono il valore né un confine: «il pin è «4821»» (#2678). Tutte le forme da qui.
  const APERTE = '«"\'“‘„';
  // Anche la chiusa tedesca («„casa“») e quella sbagliata («“casa“»).
  const CHIUSE = '»"\'”’“‘';
  const VIRGOLETTE = [...new Set(APERTE + CHIUSE)].join('');
  // Doppie e singole si separano perché l'apostrofo dentro un valore fra doppie («“l’albero”») non lo chiude.
  const DOPPIE = [...VIRGOLETTE].filter((c) => !'\'‘’'.includes(c)).join('');
  const SINGOLE = [...VIRGOLETTE].filter((c) => '\'‘’'.includes(c)).join('');
  const VIRGOLETTA = `(?:[${APERTE}][ \\t]*)?`;
  const CIFRE_CVV = `${VIRGOLETTA}(\\d{3,4})(?![\\d/]|[.,:-]\\d)`;
  const CVV = new RegExp(`${NOME_CVV}\\s*${PARENTESI}(?:[:=|\\t]|è|e'|is)?\\s*${CIFRE_CVV}`, 'gi');
  const CVV_DOPO = new RegExp(`${NOME_CVV}[^\\d\\n|\\t:=.!?;]{1,40}?${PARENTESI}(?:\\s*[:=|\\t]|\\s+(?:è|e'|is|was)(?=\\s))\\s*${CIFRE_CVV}`, 'gi');
  // Il codice che una mail o un SMS manda per entrare: il guardiano riconosce solo i marchi del monouso, perché lì un
  // falso allarme ferma un'azione; qui un falso allarme toglie un numero, e il codice di verifica non esce.
  // Le cifre in coda a una parola («Girasole2024») non sono il codice: è la password intera, e la toglie la regola delle
  // etichette; togliere solo «2024» lascerebbe il resto e cancellerebbe l'anno da tutto il messaggio.
  // Anche nelle lingue delle etichette (#1403.13): «le code d'accès 482913», «el código de acceso 482913».
  const CODICE_ACCESSO = /\b(?:codice|code|c[óo]digo|kod|pin)\b(?:\s+(?:di|da|per|the|your|il|tuo|de|du|des|del|do|der|von|van))*\s+(?:d['’])?(?:verifica|accesso|conferma|sicurezza|autenticazione|autorizzazione|login|verification|security|confirmation|access|sign-?in|acc[èe]s|v[ée]rification|s[ée]curit[ée]|connexion|acceso|acesso|verificaci[óo]n|verifica[çc][ãa]o|confirmaci[óo]n|confirma[çc][ãa]o|seguridad|seguran[çc]a|dost[ęe]pu|weryfikacyjny)(?![A-Za-zÀ-ÿ])[^\d\n]{0,24}?(?<![A-Za-zÀ-ÿ])(\d{4,8})\b/gi;
  const CODICE_ACCESSO_EN = /\b(?:verification|security|confirmation|access|login|sign-?in|one-?time|otp|2fa)\s+(?:code|codice|pin)\b[^\d\n]{0,24}?(?<![A-Za-zÀ-ÿ])(\d{4,8})\b/gi;
  const PIN = new RegExp(`\\bpin\\b\\s*(?:[:=]|è|e'|is)?\\s*${VIRGOLETTA}(\\d{4,8})\\b`, 'gi');
  // La regola sulla forma, per i codici: un numero con la forma di un codice (quattro-otto cifre, o due-tre gruppi) al
  // posto del codice (vedi alPostoDelCodice), nella frase che lo nomina o sulla riga sotto. Col nome del codice conta, a
  // meno che la frase lo dica un identificativo che non apre niente (cliente, ordine, prenotazione) senza parole
  // dell'entrare (verifica, autorizza, accedi, sblocca); senza nome conta solo dopo «usa», «inserisci», «enter» o col
  // prefisso («Use 337164 to verify», «G-482913»), perché «Verificato da 1532 utenti» non è un codice. Un anno resta.
  // Il nome del codice anche nelle lingue delle etichette (#1403.13): «código», «kod», i composti tedeschi e olandesi
  // («Zugangscode», «verificatiecode») elencati, perché «barcode» o «unicode» non annunciano un segreto.
  const NOMI_DEL_CODICE = '\\b(?:codic[ei]|codes?|keycodes?|pin|puk|passcode|otp|2fa|mfa|c[óo]digos?|kod(?:u|em|y)?'
    + '|(?:zugangs|sicherheits|best[äa]tigungs|verifizierungs|verifikations|anmelde|einmal|aktivierungs|freischalt(?:ungs)?'
    + '|entsperr|autorisierungs|authentifizierungs|tür|toegangs|verificatie|beveiligings|bevestigings|inlog|login|activatie)codes?)\\b';
  const NOME_CODICE = new RegExp(NOMI_DEL_CODICE, 'i');
  const SEGNO_FORTE = /\b(?:verific\w*|verif(?:y|ied|ies|ication)\w*|autorizz\w*|authori[sz]\w*|autentic\w*|authentic\w*|sblocc\w*|unlock\w*|acced\w*|accesso|access|log-?in|log\s+in|sign-?in|sign\s+in|monouso|one-?time|usa\s+e\s+getta|otp|passcode|2fa|mfa|v[ée]rif\w*|verifizier\w*|acc[èe]s|acceso|acesso|connexion|zugang\w*|anmeld\w*|best[äa]tig\w*|toegang\w*|inlog\w*|dost[ęe]p\w*)\b/i;
  const NON_APRE = /\b(?:client[ei]|customer|client|ordin[ei]|orders?|prenotazion[ei]|booking|reservation|pratica|scont[oi]|discount|promo\w*|coupon|fiscale|postale|postal|zip|cap|prodott[oi]|products?|articol[oi]|items?|sku|tracking|spedizion[ei]|shipp?(?:ing|ment)|fattur[ae]|invoices?|riferimento|reference|tribut[oi]|civile|penale|strada|procedura|error[ei]?|errors?|status|http|abi|cab|ateco|ean|isbn|iban|swift|bic|ticket|bigliett[oi]|vol[oi]|flights?|ricetta|esenzione|destinatario|sdi|cig|cup|colore|colou?r|sorgente|source|paese|country|comune|catastale|matricola|tessera|socio|membro|member|telefono|phone|tel|numero\s+verde|chiam\w*|call|predefinit\w*|default|factory|fabbrica|commandes?|pedidos?|encomendas?|bestellung\w*|zam[óo]wieni\w*|bestelling\w*|factures?|facturas?|faturas?|rechnung\w*|faktur\w*|produits?|articles?|productos?|produtos?|produkt\w*|erreurs?|erros?|fehler\w*|b[łl][ęe]d\w*|suivi|seguimiento|rastreo|rastreamento|sendungsverfolgung|r[ée]servations?|reservas?|reservierung\w*|buchung\w*|rezerwac\w*|boeking\w*|r[ée]duction|descuentos?|descontos?|rabatt\w*|rabat\w*|remise|gutschein\w*|cup[óo]n|cupom|pocztow\w*|postleitzahl|couleurs?|farbe|kolor\w*|barres|barras|barcode|kreskow\w*|kunde\w*|klient\w*|clientes?|banques?|guichets?|communes?|douan\w*|[ée]?tablissements?|pays|pa[íi]s|kraj\w*|naf|ape|insee|siret|siren|cpv|uai|cnae|nace|cip|iata|upc|gtin)\b/i;
  const INTRODOTTO = /\b(?:use|usa|utilizza|inserisci|immetti|digita|enter|type)\s+$/i;
  const FORMA_CODICE = /(?<![\w./:€$£-])(?:([A-Z]{1,3}-)?(\d{3,4}(?:[ -]\d{3,4}){1,2}|\d{2}-\d{2}-\d{2})|([A-Z]{1,3}-)?(\d{4,8}))(?![\w/]|[.,:]\d|-\d|\s?(?:€|%|euro\b|eur\b|usd\b))/g;
  const ANNO = /^(?:19|20)\d\d$/;
  const FINE_DI_UN_NUMERO = /(?:[*•·xX]{2,}[ .-]?|\b(?:termin\w*|finisc\w*|ending|ends?)\s+(?:con|in|with|per)\s+(?:le\s+cifre\s+)?)$/i;
  // L'etichetta che dice di che cosa è il codice, subito prima del numero («Codice abbonamento: 4829», «Il codice del
  // corso è 4829», «event code 4829»): un nome comune qualunque lo fa un identificativo, senza elencarli. Restano codici
  // il nome di un servizio («Telegram code», «codice Amazon») e le parole del monouso qui sotto.
  const ETICHETTA_IT = /\b[Cc]odic[ei]\s+(?:d(?:i|el|ella|ello|ei|egli|elle|ell['’])\s*)?([a-zà-ÿ]{3,})\s*(?:[:=#]|è|\bn\.?|\bnr\.?)?\s*$/;
  const ETICHETTA_EN = /\b([a-z][a-z-]{2,})\s+codes?\s*(?:[:=#]|\bis\b|\bno\.?)?\s*$/;
  // Le stesse due regole nelle lingue dei nomi del codice (#1403.13): «Le code de suivi est …», «El código del pedido es …»,
  // «Kod rabatowy to …», «Der Code der Bestellung ist …». «Code» solo col complemento, perché da solo è anche inglese.
  const SEPARA_ALTRE = `(?:\\s*[:=#]|\\s+(?:${VERBO}|${FUTURO}|to)(?![\\p{L}]))?\\s*$`;
  // Il possessivo vale l'articolo («Le code de mon colis», «Kod mojej paczki»). «Le code banque», senza complemento,
  // passa dall'elenco degli identificativi: lì la parola dopo «code» può essere un aggettivo («Le code généré est …»).
  const POSSESSIVO_ALTRE = '(?:mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leurs?|mis|mi|tus?|sus?|nuestr[oa]s?|vuestr[oa]s?'
    + '|meus?|minhas?|teus?|tuas?|seus?|suas?|noss[oa]s?|moj\\p{L}*|mój|twoj\\p{L}*|twój|swoj\\p{L}*|swój|nasz\\p{L}*|wasz\\p{L}*)';
  const ETICHETTA_ALTRE = new RegExp(`(?:\\b[Cc]ode\\s+(?:(?:de|du|des|van)\\s+(?:(?:la|les|le|de|het)\\s+|l['’]\\s*|${POSSESSIVO_ALTRE}\\s+)?|d['’]\\s*)`
    + `|\\b(?:[Cc][óo]digo|[Kk]od)\\s+(?:(?:de|del|do|da|dos|das)\\s+(?:(?:la|las|los|el|o|a|os|as)\\s+)?)?(?:${POSSESSIVO_ALTRE}\\s+)?)`
    + `([\\p{Ll}][\\p{Ll}-]{2,})${SEPARA_ALTRE}`, 'u');
  const ETICHETTA_DE = new RegExp(`\\b[Cc]odes?\\s+(?:der|des|vom|zur|zum|für\\s+(?:die|den|das|(?:mein|dein|sein|ihr|Ihr|unser|eur)(?:e|en)?)`
    + `|(?:[Mm]ein|[Dd]ein|[Ss]ein|[Ii]hr|[Uu]nser|[Ee]ur)e[rs])\\s+(\\p{Lu}\\p{Ll}+)${SEPARA_ALTRE}`, 'u');
  const UN_VERBO = new RegExp(`^(?:${VERBO}|${FUTURO}|sono|sont|son|são|sind|zijn|fue|foi|to)$`, 'iu');
  const RESTA_ALTRE = new RegExp('^(?:acc[èe]s|acceso|acesso|dost[ęe]p\\p{L}*|v[ée]rifica\\p{L}*|weryfikac\\p{L}*|s[ée]curit[ée]|seguridad|seguran[çc]a'
    + '|zabezpiecz\\p{L}*|bezpiecze\\p{L}*|beveiliging|confirma\\p{L}*|potwierdz\\p{L}*|bevestiging|activa\\p{L}*|ativa[çc][ãa]o|aktywac\\p{L}*'
    + '|connexion|sesi[óo]n|sess[ãa]o|logowani\\p{L}*|inlog\\p{L}*|autori[sz]a\\p{L}*|autoryz\\p{L}*|authentifi\\p{L}*|autentica\\p{L}*'
    + '|uwierzyteln\\p{L}*|d[ée]verrouillage|desbloque\\p{L}*|odblokow\\p{L}*|r[ée]cup[ée]ration|recupera\\p{L}*|odzyskiw\\p{L}*|secours'
    + '|emerg[êe]ncia|emergencia|respaldo|backup|secret\\p{L}*|tajn\\p{L}*|temporaire|tempor[áa]l|tempor[áa]rio|tymczasow\\p{L}*'
    + '|nuevo|novo|nowy|[úu]nico|jednorazow\\p{L}*|sms|e-?mail|correo|envoy[ée]|enviado|recibido|re[çc]u|recebido|siguiente|seguinte'
    + '|num[ée]ric[oa]|personnel|personal|pin|otp|blik|tan|validation|validaci[óo]n|valida[çc][ãa]o'
    + '|din[áa]mico|dynamique|transac\\p{L}*|transa[çc][ãa]o|identifica\\p{L}*|identyfikac\\p{L}*'
    // Le cose il cui codice è un segreto (carta, conto, telefono, app) e gli aggettivi di un codice d'accesso.
    + '|cartes?|tarjetas?|cart[ãa]o|cart[õo]es|\\p{L}*kart\\p{L}*|comptes?|cuentas?|contas?|kont[aouy]s?|account|t[ée]l[ée]phone|portable'
    + '|m[óo]vil|celular|tel[ée]fono|telem[óo]vel|telefon\\p{L}*|handys?|smartphone|appli\\p{L}*|app|aplicaci[óo]n|aplicativo'
    + '|confidenti\\p{L}*|confidencial|poufn\\p{L}*|priv[ée]e?|privad[oa]|prywatn\\p{L}*|pessoal|osobist\\p{L}*|provisoire|provisional'
    + '|provis[óo]rio|unique|num[ée]rique|suivant|ci-dessous|habituel|habitual|actuel|actual|atual|initial|inicial|parental'
    + '|ma[îi]tre|maestro|mestre|administra\\p{L}*|admin|utilisateur|usuario|usu[áa]rio|verrouillage|bloqueo|bloqueio|blokad\\p{L}*'
    + '|bancaire|bancari[oa]|banc[áa]ri[oa]|bankow\\p{L}*|einlog\\p{L}*|login\\p{L}*|anmeld\\p{L}*|freischalt\\p{L}*|entsperr\\p{L}*'
    + '|puk|nip|cb|cvv|cvc|code|codes|c[óo]digo|kod)$', 'iu');
  const APRE_ALTRE = '(?:retrait|retiro|levantamento|odbioru|abholung|ouverture|apertura|abertura|otwarcia|öffnung|recoger|retirar|abrir|ouvrir'
    + '|entrer|entrar|öffnen|otworzy\\p{L}*|odebra\\p{L}*|r[ée]cup[ée]rer|levantar|portes?|portail|portillon|entr[ée]e|immeuble|interphone|digicode|coffre(?:-fort)?|alarme|garage|cadenas|casier|consigne'
    + '|puertas?|portal|port[óo]n|entrada|edificio|portero|alarma|garaje|candado|cerradura|taquilla|casillero|porta|port[ãa]o|pr[ée]dio|cofre'
    + '|fechadura|cadeado|t[üu]r|tor|haust[üu]r|eingang\\p{L}*|geb[äa]ude\\p{L}*|tresors?|safe|alarm\\p{L}*|schloss\\p{L}*|schlie(?:ß|ss)fach\\p{L}*'
    + '|drzwi|bram[ay]?|furtk[ai]|wej[śs]ci\\p{L}*|sejfu?|domofonu?|gara[żz]u|deur|poort|ingang|kluis|wi-?fi|wlan)';
  const APRE_ALTRE_SOLO = new RegExp(`^${APRE_ALTRE}$`, 'iu');
  const NOME_ALTRE = /(?<![\p{L}])(?:code|c[óo]digo|kod)(?![\p{L}])/giu;
  const LEGAMI_ALTRE = /^(?:\s+|[dl]['’]|(?:de|du|des|del|do|da|dos|das|la|las|los|le|les|el|o|a|os|as|à|al|au|aux|pour|para|f[üu]r|vom|von|der|die|das|dem|den|zur|zum|van|het|od|ton|ta|votre|tu|su|seu|sua)(?![\p{L}]))+/iu;
  const DOPO_IL_NOME = new RegExp(`^${SEPARA_ALTRE}`, 'u');
  const RESTA_UN_CODICE = /^(?:conferm\w*|sicurezza|temporane\w*|provvisori\w*|segret\w*|personal\w*|attivazion\w*|recupero|ripristino|emergenza|associazion\w*|abbinament\w*|ricevut\w*|inviat\w*|numeric\w*|nuovo|seguente|unico|sms|email|mail|your|the|my|this|that|our|its|new|same|following|above|below|one|confirmation|security|backup|recovery|reset|activation|temporary|secret|pairing|text|unique|special)$/;
  // Le cose che un codice apre: il loro codice è un segreto anche col nome comune davanti («Il codice del cancello è
  // 4829», «Codice di ritiro: 640385»). Contano solo come nome del codice, cioè subito dopo «codice» o subito prima di
  // «code»: «Videocitofono Wi-Fi, codice prodotto 4829» è un identificativo. «Porta» è anche un verbo: solo lì.
  const COSE_CHE_SI_APRONO = 'cancell(?:o|i|etto)|portone|ingresso|entrata|citofono|cassaforte|casseforti|cassett[ae]\\s+(?:delle\\s+)?chiavi|keybox|lockbox|key\\s?safe|lucchett[oi]|serratur[ae]|allarm[ei]|antifurto|ritir(?:o|are)|preliev(?:o|i|are)|armadiett[oi]|locker|wi-?fi|wlan|dispositiv[oi]|device|garage|gate|door|safe|alarm|pick-?up|withdrawal|keypad|appartament[oi]|apartment|serrand[ae]|ascensor[ei]|elevator|bancomat|building|entry|lock|apertur[ae]|disattivazion[ei]|disinseriment[oi]|opening';
  const APRE = new RegExp(`\\b(?:${COSE_CHE_SI_APRONO})\\b`, 'i');
  const NOME_CHE_APRE = new RegExp(`^(?:${COSE_CHE_SI_APRONO}|port[ae]|apri(?:re)?|apre|entra(?:re)?)\\b`, 'i');
  const NOME_CHE_APRE_SOLO = new RegExp(`^(?:${COSE_CHE_SI_APRONO}|port[ae])\\s*(?:[:=#]|è|\\bis\\b)?\\s*$`, 'i');
  const LEGAMI = /^(?:\s+|(?:d|l|dell|all|dall|nell)['’]|(?:di|del|della|dello|dei|degli|delle|per|da|a|al|alla|allo|il|la|lo|i|gli|le|tuo|tua|of|for|to|the|your)\b)+/i;
  const PER_APRIRE = /\b(?:apri(?:re)?|apre|aprono|open(?:s|ing)?|entra(?:re)?|disattiva(?:re)?|disinseri(?:re|sci)|disarm(?:a|are)?)\b/i;
  // Il nome del codice nell'etichetta prima del numero: quello che segue l'ultimo «codice», o la parola prima di «code».
  const nomeDelCodice = (prima) => {
    if (/\bkeycodes?\b/i.test(prima)) return { apre: true, solo: /\bkeycodes?\s*(?:[:=#]|\bis\b)?\s*$/i.test(prima) };
    const it = [...prima.matchAll(/\b(?:codic[ei]|pin)\b/gi)].pop();
    const en = [...prima.matchAll(/\b([A-Za-z-]+)\s+(?:codes?|pin)\b/g)].pop();
    if (en && (!it || en.index > it.index) && NOME_CHE_APRE.test(en[1])) {
      return { apre: true, solo: /^\s*(?:[:=#]|\bis\b)?\s*$/i.test(prima.slice(en.index + en[0].length)) };
    }
    const altro = [...prima.matchAll(NOME_ALTRE)].pop();
    if (altro && (!it || altro.index > it.index)) {
      const coda = prima.slice(altro.index + altro[0].length).replace(LEGAMI_ALTRE, '');
      const p = /^[\p{L}-]+/u.exec(coda);
      if (p && APRE_ALTRE_SOLO.test(p[0])) return { apre: true, solo: DOPO_IL_NOME.test(coda.slice(p[0].length)) };
    }
    if (!it) return { apre: false, solo: false };
    const coda = prima.slice(it.index + it[0].length).replace(LEGAMI, '');
    return { apre: NOME_CHE_APRE.test(coda), solo: NOME_CHE_APRE_SOLO.test(coda) };
  };
  // Un verbo al posto dell'etichetta («Il codice sarà 4829», «El código era 4829») annuncia il valore, non lo nomina.
  const etichettaDiUnIdentificativo = (prima) => {
    const m = ETICHETTA_IT.exec(prima) || ETICHETTA_EN.exec(prima);
    if (m && !UN_VERBO.test(m[1])) {
      return !RESTA_UN_CODICE.test(m[1]) && !SEGNO_FORTE.test(m[1]) && !APRE.test(m[1]) && !/^port[ae]$/.test(m[1]);
    }
    const a = ETICHETTA_ALTRE.exec(prima) || ETICHETTA_DE.exec(prima);
    return !!a && !UN_VERBO.test(a[1]) && !RESTA_ALTRE.test(a[1]) && !APRE_ALTRE_SOLO.test(a[1]) && !SEGNO_FORTE.test(a[1]);
  };
  // Il valore sulla riga sotto si cerca solo per un codice che non ha già il suo numero sulla sua riga, dopo di lui:
  // in «Codice evento | 739204» la riga sotto è un altro dato. Un pezzo di telefono o un anno non sono il suo numero.
  const haGiaIlNumero = (resto) => [...resto.matchAll(FORMA_CODICE)].some((m) => {
    if (!m[2] && ANNO.test(m[4])) return false;
    const prima = resto.slice(0, m.index);
    return !/(?:\+|\d)[ .]?$/.test(prima) && !FINE_DI_UN_NUMERO.test(prima);
  });
  // Il posto del codice, come quello della password: subito dopo il suo nome («Inserisci il codice 615204»), dopo il
  // separatore o il verbo che chiude l'etichetta («Telegram code: 48291», «il codice per autorizzare l'operazione è …»),
  // dopo un'etichetta breve in testa («Codice OTP 482913»), prima di «è il tuo codice», da solo in testa alla riga o alla
  // cella dopo l'etichetta. Un altro numero della frase («The code uses port 3000») non è il codice.
  const NOMI_CODICE = new RegExp(NOMI_DEL_CODICE, 'gi');
  // L'articolo dopo il verbo («El código es el 482913») non cambia il posto del numero.
  const CHIUDE_ETICHETTA = new RegExp(`(?:[:=#]|(?:^|\\s)(?:${VERBO}|${FUTURO}|will\\s+be|sono|are)(?:\\s+(?:il|el|le|o|the))?|\\bn\\.|\\bnr\\.?|\\bno\\.)\\s*$`, 'i');
  // Il polacco «to» solo dopo «kod»: in inglese «code to …» è una destinazione.
  const CHIUDE_KOD = /\sto\s*$/i;
  const PRIMA_DEL_NOME = new RegExp(`^\\s*(?:[:=-]\\s*)?(?:${VERBO}|=|sarà)\\s+(?:[\\p{L}'’-]+\\s+){0,4}?${NOMI_DEL_CODICE}`, 'iu');
  // Prima del numero si guarda solo la coda: il nome conta a 60 caratteri al più, e rileggere da capo la riga a ogni
  // numero rendeva quadratico un testo lungo che ripete «el código es 482913».
  const CODA = 400;
  const RELATIVA = /^\s*,\s*(?:den|die|das|der|dem|welche[nmrs]?|che|which|that|que|qui|kt[óo]r\p{L}*)\s[^,;!?\n\d]{1,40},/iu;
  const SENZA_VIRGOLETTA = new RegExp(`[${APERTE}][ \\t]*$`);
  const DOPO_VIRGOLETTA = new RegExp(`^[ \\t]*[${CHIUSE}]`);
  function alPostoDelCodice(z, m, inTesta, forte) {
    const prima = z.slice(0, m.index).replace(SENZA_VIRGOLETTA, '');
    if (inTesta) return !prima.trim();
    if (PRIMA_DEL_NOME.test(z.slice(m.index + m[0].length).replace(DOPO_VIRGOLETTA, ''))) return true;
    const da = Math.max(0, prima.length - CODA);
    const n = [...prima.slice(da).matchAll(NOMI_CODICE)].pop();
    if (!n) return false;
    n.index += da;
    // Una relativa fra virgole non chiude la frase del codice («Der Code, den du erhalten hast, ist 482913»).
    const fra = prima.slice(n.index + n[0].length).replace(RELATIVA, ' ');
    if (!fra.trim()) return true;
    // Una virgola chiude la frase del codice («In the code below, MAX_SIZE is 65536»), salvo dove parla di entrare.
    if (fra.length > 60 || /[;!?]|\d{4,}/.test(fra) || (!forte && fra.includes(','))) return false;
    if (CHIUDE_ETICHETTA.test(fra) || (/^kod/i.test(n[0]) && CHIUDE_KOD.test(fra))) return true;
    return /^[\s•*·>–-]*$/.test(prima.slice(0, n.index)) && !/\d/.test(fra) && fra.trim().split(/\s+/).length <= 4;
  }
  // Un codice usa e getta di lettere e cifre («Steam Guard code: 7K2F9», quello da scrivere sulla TV, «WDJB-MJHT»):
  // conta solo al posto del codice, come i numeri, e col nome del codice nella frase.
  const CODICE_ALFANUMERICO = /(?<![\w./:-])(?:(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9]{5,10}|[A-Z]{4}-[A-Z]{4})(?![\w/-])/g;
  function codiciVicini(s, out) {
    const righe = s.split('\n');
    for (let i = 0; i < righe.length; i++) {
      const celle = righe[i].split(/[|\t]/);
      for (let c = 0; c < celle.length; c++) {
        const pezzi = celle[c].split(/(?<=[.!?;])\s+(?=[A-ZÀ-Ý«"])/);
        for (let f = 0; f < pezzi.length; f++) {
          const frase = pezzi[f];
          const nome = NOME_CODICE.test(frase);
          const forte = SEGNO_FORTE.test(frase);
          // Senza il nome del codice: «Per aprire il cancello digita 3958», non «Apri il file e inserisci 48291».
          const perAprire = PER_APRIRE.test(frase) && (APRE.test(frase) || /\b(?:port[ae]|entra(?:re)?)\b/i.test(frase));
          if (!nome && !forte && !perAprire) continue;
          const zona = [{ z: frase, inTesta: false }];
          const ultima = f === pezzi.length - 1;
          if (ultima && c + 1 < celle.length && !haGiaIlNumero(frase)) zona.push({ z: celle[c + 1], inTesta: true });
          const dove = righe[i].indexOf(frase);
          if (righe[i].trim().length <= 80 && !haGiaIlNumero(righe[i].slice(dove < 0 ? 0 : dove))) {
            for (let j = i + 1, vuote = 0; j < righe.length && vuote <= 2; j++) {
              if (!righe[j].trim()) { vuote++; continue; }
              zona.push({ z: righe[j], inTesta: true });
              break;
            }
          }
          for (const { z, inTesta } of zona) {
            const nonApre = NON_APRE.test(`${frase} ${z}`);
            const trovati = [...z.matchAll(FORMA_CODICE)].map((m) => ({ m, v: m[2] || m[4] }));
            if (nome) for (const m of z.matchAll(CODICE_ALFANUMERICO)) trovati.push({ m, v: m[0], lettere: true });
            for (const { m, v, lettere } of trovati) {
              const prima = z.slice(Math.max(0, m.index - CODA), m.index).replace(SENZA_VIRGOLETTA, '');
              const etichetta = inTesta ? frase.slice(-CODA) : prima;
              const chiave = nome ? nomeDelCodice(etichetta) : { apre: false, solo: false };
              const entra = forte || chiave.apre;
              if (nonApre && !(nome && entra)) continue;
              if (nome ? !(alPostoDelCodice(z, m, inTesta, forte) || (!lettere && (m[1] || m[3] || INTRODOTTO.test(prima))))
                : !(m[1] || m[3] || INTRODOTTO.test(prima))) continue;
              // Un anno resta, tranne subito dopo il nome di quello che apre: «Il codice del cancello è 1990».
              if (!lettere && !m[2] && ANNO.test(v) && !chiave.solo) continue;
              // A coppie («48-29-13») somiglia a una data: conta solo dove la frase parla di entrare.
              if (/^\d\d-/.test(v) && !entra) continue;
              if (nome && !entra && etichettaDiUnIdentificativo(etichetta)) continue;
              // Un pezzo di un numero più lungo («+39 333 1234567», «Chiama 02 4829 1736») è un telefono, non il codice;
              // così le cifre finali di un numero coperto o annunciate come tali («al ***4567», «che termina con 4567»).
              if (/(?:\+|\d)[ .]?$/.test(prima) || FINE_DI_UN_NUMERO.test(prima)) continue;
              out.push({ valore: v, regola: 'codice' });
            }
          }
        }
      }
    }
  }
  // L'elenco sotto un titolo di codici di recupero («Recovery codes», «Codici di backup»): ogni riga con la forma di un
  // codice fino alla prima che non ce l'ha, anche dopo una o due righe di spiegazione fra il titolo e l'elenco.
  const TITOLO_RECUPERO = /\b(?:codici|codes|chiavi|keys)\b/i;
  const SENSO_RECUPERO = /\b(?:recupero|ripristino|backup|recovery|emergenza|emergency|monouso|one-?time|single-?use|2fa|two-?factor)\b/i;
  const PEZZO_RECUPERO = /^[A-Za-z0-9]{4,12}(?:-[A-Za-z0-9]{3,12}){0,3}$/;
  function rigaDiCodici(riga) {
    const pezzi = riga.trim().replace(/^(?:\d{1,2}[.)]|[•·*-])\s+/, '').split(/\s+/);
    return pezzi.length <= 4 && pezzi.every((p) => PEZZO_RECUPERO.test(p) && /\d/.test(p)) ? pezzi : null;
  }
  function codiciDiRecupero(s, out) {
    const righe = s.split('\n');
    for (let i = 0; i < righe.length; i++) {
      if (righe[i].length > 80 || !TITOLO_RECUPERO.test(righe[i]) || !SENSO_RECUPERO.test(righe[i])) continue;
      let presi = 0;
      for (let j = i + 1, vuote = 0, prosa = 0; j < righe.length; j++) {
        if (!righe[j].trim()) { if (++vuote > 2) break; continue; }
        vuote = 0;
        const pezzi = rigaDiCodici(righe[j]);
        if (!pezzi) { if (presi || ++prosa > 2) break; continue; }
        for (const p of pezzi) out.push({ valore: p, regola: 'codice' });
        presi++;
        i = j;
      }
    }
  }
  // Un token dopo «Bearer», anche fuori dall'intestazione. Il JWT e le chiavi col loro prefisso li riconosce il guardiano.
  const BEARER = /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g;
  // I parametri di un indirizzo che portano una credenziale: il nome lo dice, il valore si toglie.
  const NOME_SEGRETO = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|api[_-]?key|apikey|key|secret|client[_-]?secret|password|passwd|pwd|pass|otp|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|session[_-]?id|sessionid|sid|auth|ticket|code)$/i;
  const NOME_CORTO = /^(?:password|passwd|pwd|pass|otp)$/i;
  const INDIRIZZO = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`)\]]+/gi;
  // Le password accanto a un'etichetta. La regola generale è il posto del valore (alPostoDelValore): dopo il separatore o
  // il verbo che chiude l'etichetta, subito dopo di lei, sulla riga sotto. Mai il resto della riga: «la password di
  // Office365», un nome utente, un indirizzo di campo o una riga di codice vicini all'etichetta non sono il valore.
  // Le parole senza la forma di una password («Password: hunter», la cella, la colonna) contano solo da sole al posto del
  // valore, con l'etichetta in testa alla riga o alla cella: «un campo password o carta: …» resta.
  // Le etichette: anche la password del wifi del router, il codice di accesso e le altre lingue, che porta urlExfil.js
  // (PRESENTA) col loro confine. ETICHETTA_NUDA vale anche attaccata a un prefisso («login_password»).
  if (!global.SN_URL_EXFIL && typeof require === 'function') require('./urlExfil.js');
  const ALTRE_LINGUE = global.SN_URL_EXFIL && global.SN_URL_EXFIL.PRESENTA ? `|${global.SN_URL_EXFIL.PRESENTA.altreLingue}` : '';
  const NOMI = '(?:password|passwd|passcode|passphrase|parola\\s+d[\'’]ordine|pwd|pswd?'
    + '|chiave\\s+(?:di\\s+)?(?:rete|sicurezza(?:\\s+di\\s+rete)?|wi-?fi|wpa2?|wlan)|(?:wpa[23]?(?:-psk)?|wi-?fi|wlan|network|security)\\s+key'
    + '|codice\\s+(?:di\\s+)?(?:accesso|segreto))\\b';
  const NON_ETICHETTA = '(?!\\s*(?:managers?|policy|reset|recovery|generator|hint|strength)\\b)';
  const ETICHETTA = `(?:\\b${NOMI}${ALTRE_LINGUE})${NON_ETICHETTA}`;
  const ETICHETTA_NUDA = `(?:${NOMI}${ALTRE_LINGUE})${NON_ETICHETTA}`;
  // «Pass:», «pw:» sono anche altro («Green pass: valido»): contano solo davanti a un valore con la forma di una password.
  const ETICHETTA_CORTA = '\\b(?:pass|pw)\\b';
  // Fra etichetta e valore anche una parentesi («Password del router (admin): x») e un trattino o una freccia
  // circondati da spazi; il valore sotto l'etichetta anche dopo una riga vuota (due paragrafi), ma da solo sulla riga,
  // coi due punti o senza: «Wi-Fi password:» a capo vale quanto «Password:» a capo (#2673.3).
  const PRIMA = '(?:^|[\\n|\\t])[^\\n|\\t:=.!?;,]{0,30}?';
  // Fra etichetta e separatore niente virgolette, uguali o parentesi di codice: in `"Password" :: #c` o in
  // `password" id="pwd1"` quello che segue è di un altro campo.
  const ACCANTO = '(?:(?!\\s(?:o|e|né|ne|or|and|nor|ma|but)\\s)[^\\n:|=\\t?!.,;\\[\\]«»"<>{}$]){0,40}?';
  const ACCANTO_LUNGO = '(?:(?!\\s(?:o|e|né|ne|or|and|nor|ma|but)\\s)[^\\n:|=\\t?!.,;\\[\\]«»"<>{}$]){0,90}?';
  const ACCANTO_FORTE = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ ]*([:=|\\t]|[-–—→](?=[ \\t]))[ \\t]*([^\\n|\\t]*)`, 'gid');
  // Il «to» polacco solo dopo «hasło»: in inglese «send the password to …» porta a chi la riceve, non al valore.
  const VERBO_PASSWORD = `(?:${VERBO}|${FUTURO}|(?<=\\bhas[łl]o\\b[^\\n]{0,40})to)`;
  const ACCANTO_DEBOLE = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ \\t]+${VERBO_PASSWORD}[ \\t]+([^\\s|\\[]{4,64})`, 'gi');
  const SOTTO = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ \\t]*:?[ \\t]*\\n(?:[ \\t]*\\n)?[ \\t]*([^\\s|\\[]{4,64})[ \\t]*(?=\\n|$)`, 'gi');
  // Dentro una frase, senza i due punti («utente mario, password Mela!Verde77»): solo un valore che non può essere una
  // parola, con lettere e cifre o un simbolo da password.
  const QUALIFICA = '(?:[ \\t]+(?:provvisori[ao]|temporane[ao]|iniziale|nuova|attuale|new|temporary|initial|current))?';
  const IN_FRASE = new RegExp(`${ETICHETTA}${QUALIFICA}[ \\t]+${VIRGOLETTA}([^\\s|\\[${VIRGOLETTE}(),;]{6,64})`, 'gi');
  const FORMA_FORTE = (v) => /[A-Za-zÀ-ÿ]/.test(v) && (/[0-9]/.test(v) || /[!@#$%^&*+=?~_]/.test(v));
  const INTESTAZIONE = new RegExp(`^${ETICHETTA}[^|\\t]{0,30}$`, 'i');
  // In un CSV l'intestazione è un nome di campo, anche col prefisso delle esportazioni («login_password»): al più una
  // parola in più, perché una frase con le virgole («utente, password e premi invio») non apra una colonna.
  const INTESTAZIONE_CSV = new RegExp(`^(?:[A-Za-z0-9]{1,20}[_.\\s-])?${ETICHETTA_NUDA}(?:[_.\\s-]?[A-Za-z0-9()]{1,20})?$`, 'i');
  const NOMINA_ETICHETTA = new RegExp(ETICHETTA_NUDA, 'i');
  // Le parole che una pagina mette accanto all'etichetta senza che siano la password.
  const NON_VALORE = /^(?:obbligatori[ao]|richiest[ao]|required|optional|facoltativ[ao]|dimenticat[ao]|forgot(?:ten)?|almeno|minimo|mostra|nascondi|show|hide|non|not|errat[ao]|sbagliat[ao]|incorrect|wrong|invalid[ao]?|nuova|new|attuale|current|conferma|confirm|ripeti|repeat|inserisci|enter|digita|type|scegli|choose|cambia|change|imposta|set|chiedi|chiedila|ask|la|il|lo|una|un|the|an?|your|tu[aoe]|del|della|di|per|for|e|and|o|or)$/i;

  function testo(v) {
    return String(v == null ? '' : v);
  }

  // Il valore di un parametro conta se è abbastanza lungo da essere una credenziale: «?code=it» è una lingua.
  function valoreSegreto(nome, valore) {
    const v = testo(valore);
    if (!v || v === SEGNAPOSTO || encodeURIComponent(SEGNAPOSTO) === v) return false;
    if (NOME_CORTO.test(nome)) return v.length >= 4;
    return v.length >= 12 && /[0-9]/.test(v) && /[A-Za-z]/.test(v);
  }

  // Dentro un indirizzo: la password dopo «utente:» e i parametri col nome di una credenziale, in query e frammento.
  function segretiNellIndirizzo(url, out) {
    const auth = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#@\s:]*:([^/?#@\s]+)@/i);
    if (auth) out.push({ valore: auth[1], regola: 'password' });
    for (const m of url.matchAll(/[?#&;]([^=&#;?\s]{1,40})=([^&#;\s]*)/g)) {
      let nome = m[1];
      try { nome = decodeURIComponent(nome); } catch (_) {}
      if (NOME_SEGRETO.test(nome) && valoreSegreto(nome, m[2])) out.push({ valore: m[2], regola: 'token' });
    }
    // Un webhook porta il segreto nel percorso, e l'indirizzo dice che è un webhook (hooks.slack.com, /api/webhooks/):
    // dopo quel nome si toglie ogni pezzo lungo che non è un nome fatto di parole minuscole. Il segreto di Slack può
    // non avere cifre (l'esempio della sua documentazione è tutto «X»).
    const w = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#\s]*\bhooks?\b[^/?#\s]*|[^/?#\s]+(?:\/[^/?#\s]+)*?\/(?:web)?hooks?)(\/[^?#\s]*)/i);
    if (w) {
      for (const pezzo of w[1].split('/')) {
        if (pezzo.length >= 20 && /^[A-Za-z0-9_-]+$/.test(pezzo) && /[A-Za-z]/.test(pezzo) && !/^[a-z]+(?:[-_][a-z]+)*$/.test(pezzo)) out.push({ valore: pezzo, regola: 'token' });
      }
    }
  }

  const TESTA_VALORE = new RegExp(`^[${APERTE}(]+`);
  const CODA_VALORE = new RegExp(`[.,;:)${CHIUSE}]+$`);
  function valorePassword(grezzo, { forma = false } = {}) {
    const v = testo(grezzo).trim().replace(TESTA_VALORE, '').replace(CODA_VALORE, '');
    if (v.length < 3 || v.startsWith('[') || NON_VALORE.test(v.split(/\s/)[0]) || CODICE_SORGENTE.test(v) || NOME_DI_TIPO.test(v)) return '';
    if (forma && !(/[0-9]/.test(v) || /[^A-Za-zÀ-ÿ]/.test(v) || /[a-zà-ÿ][A-Z]/.test(v))) return '';
    return v;
  }

  // Una parola senza cifre, simboli né maiuscole in mezzo («Telefono», «Attiva») può essere la password solo dove sta:
  // altrove nella pagina è una parola, e il segnaposto si mette solo lì (vedi oscura). `inizio`: dove sta nel testo.
  const SENZA_FORMA = (v) => !(/[0-9]/.test(v) || /[^\p{L}]/u.test(v) || /\p{Ll}\p{Lu}/u.test(v));
  function alPosto(v, inizioGrezzo, grezzo) {
    const k = testo(grezzo).indexOf(v);
    return k >= 0 ? { valore: v, regola: 'password', inizio: inizioGrezzo + k } : { valore: v, regola: 'password' };
  }

  const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
  // Un'espressione di codice («form.password.value», «process.env.DB_PASSWORD», «input(», «getpass.getpass()») sta al
  // posto di un valore ma non lo è; così il nome di un tipo («password: str», «password: string»).
  const CODICE_SORGENTE = /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(\))?|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(.*)$/;
  const NOME_DI_TIPO = /^(?:str|string|int|integer|bool|boolean|number|bytes|any|object|char|varchar|text|unknown|void)(?:\[\])?$/i;
  // Un indirizzo o un'email sotto «Reset your password:» ha la forma di una password ma è il link per cambiarla.
  const INDIRIZZO_O_EMAIL = (v) => /:\/\/|^www\./i.test(v) || EMAIL.test(v);
  function formaVicina(pezzo) {
    const v = pezzo.replace(/^[:=\-–—→«"'“‘(\[]+/, '').replace(/[.,;:!?)»"'”’\]]+$/, '');
    if (v.length < 6 || v.length > 64 || v.includes(SEGNAPOSTO) || INDIRIZZO_O_EMAIL(v) || CODICE_SORGENTE.test(v)) return '';
    return FORMA_FORTE(v) ? v : '';
  }
  // La prima riga piena sotto un'etichetta, saltando le righe vuote e quelle dei soli bottoni o puntini («Mostra»,
  // «Copia», «••••»), che le pagine mettono fra l'etichetta e la password. `saltate`: quante righe piene ha scavalcato.
  const SOLO_BOTTONI = /^(?:[\s•*·●]|mostra|nascondi|copia|copy|show|hide|reveal|rivela|visualizza|view|modifica|edit|cambia|change|accedi|entra|login|log\s+in|sign\s+in|invia|continua|avanti|next|ok|annulla|cancel|registrati|sign\s+up|register)*$/i;
  function rigaSotto(righe, i) {
    for (let j = i + 1, vuote = 0, bottoni = 0; j < righe.length && vuote <= 2 && bottoni <= 2; j++) {
      if (!righe[j].trim()) { vuote++; continue; }
      if (SOLO_BOTTONI.test(righe[j])) { bottoni++; continue; }
      return { riga: righe[j], j, saltate: bottoni };
    }
    return { riga: '', j: -1, saltate: 0 };
  }

  // Il posto del valore di un'etichetta: dopo il separatore o il verbo che la chiude, anche in mezzo alla riga («Utente:
  // mario Password: tramonto») o lontano («La password per entrare nel portale di Mario è …»), e sulla prima riga piena
  // sotto un'etichetta sola, dopo i bottoni. Lì un pezzo con la forma di una password si toglie sempre; una parola
  // qualunque solo da sola: dopo di lei la riga finisce o comincia un altro campo o una parentesi. Seguita da altre
  // parole è una frase («Password: deve avere almeno otto caratteri») e resta.
  const AL_POSTO = new RegExp(`${ETICHETTA}${ACCANTO}[ \\t]*[:=][ \\t]*([^\\s|\\t\\[(]{3,64})([^\\n|\\t]*)`, 'gid');
  const DOPO = `[ \\t]*(?:[:=|\\t]|[-–—→](?=[ \\t])|[ \\t]${VERBO_PASSWORD}(?=[ \\t]))[ \\t]*([^\\s|\\t]{6,70})`;
  const DOPO_LUNGO = new RegExp(`${ETICHETTA}${ACCANTO_LUNGO}${DOPO}`, 'gi');
  const DOPO_CORTA = new RegExp(`${ETICHETTA_CORTA}${ACCANTO}[ \\t]*[:=][ \\t]*([^\\s|\\t]{6,70})`, 'gi');
  const DA_SOLA = /^[.,;!]?[ \t]*(?:$|\(|[^\s:]{1,30}:(?:\s|$)|[·•–—-]\s)/;
  const SOLO_ETICHETTA = new RegExp(`^[ \\t]*${ETICHETTA}${ACCANTO}[ \\t]*:?[ \\t]*$`, 'i');
  const TESTA_ETICHETTA = new RegExp(`^[ \\t]*${ETICHETTA}`, 'i');
  function alPostoDelValore(s, out) {
    const righe = s.split('\n');
    const forma = (pezzo) => { const v = formaVicina(pezzo); if (v) out.push({ valore: v, regola: 'password' }); };
    const inizi = [];
    for (let i = 0, o = 0; i < righe.length; o += righe[i].length + 1, i++) inizi.push(o);
    for (let i = 0; i < righe.length; i++) {
      for (const m of righe[i].matchAll(AL_POSTO)) {
        // Una parentesi attaccata («password = input(…)») è una chiamata nel codice, non una nota dopo il valore.
        if (!DA_SOLA.test(m[2]) || m[2].startsWith('(')) continue;
        const v = valorePassword(m[1]);
        if (v) out.push(alPosto(v, inizi[i] + m.indices[1][0], m[1]));
      }
      for (const re of [DOPO_LUNGO, DOPO_CORTA]) for (const m of righe[i].matchAll(re)) forma(m[1]);
      if (!SOLO_ETICHETTA.test(righe[i])) continue;
      const { riga, j, saltate } = rigaSotto(righe, i);
      const sotto = riga.trim().split(/\s+/);
      // Oltre i bottoni o i puntini (la password mostrata coperta) la riga dopo è spesso un altro campo («Telefono»):
      // lì conta solo la forma di una password, anche coi puntini o il bottone sulla riga dell'etichetta.
      const accanto = righe[i].replace(TESTA_ETICHETTA, '').replace(/:/g, '');
      if (sotto.length === 1 && !saltate && !(accanto.trim() && SOLO_BOTTONI.test(accanto))) {
        const v = valorePassword(sotto[0]);
        if (v) out.push(alPosto(v, inizi[j], riga));
      } else forma(sotto[0]);
    }
  }

  // Una frase di più parole dopo i due punti, da sola sulla riga e con l'etichetta in testa («Password: casa mia al mare
  // 2019»): la password con gli spazi. Toglierla toglie solo quella frase, mai una parola sola altrove. Una frase che
  // comincia come una spiegazione («disponibile alla reception», «sul retro del modem», «vedi email») o che misura la
  // password («min. 8 caratteri») dice dove trovarla o come sceglierla, e resta.
  const FRASE_DOPO = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ \\t]*[:=][ \\t]*([^\\n|\\t]{3,64}?)[ \\t]*(?=\\n|$)`, 'gi');
  const INIZIO_SPIEGAZIONE = /^(?:a|al|allo|alla|ai|agli|alle|da|dal|dallo|dalla|dai|dagli|dalle|in|nel|nello|nella|nei|negli|nelle|su|sul|sullo|sulla|sui|sugli|sulle|presso|tra|fra|con|senza|dentro|sotto|sopra|dietro|at|on|from|under|behind|inside|with|see|ask|check|contact|available|provided|sent|printed|same|vedi|vedere|guarda|chiedere|richiedi|richiedila|contatta|rivolgiti|disponibile|disponibili|fornita|fornito|inviata|inviato|stampata|scritta|indicata|riportata|deve|devono|può|must|should|can|minimo|min|massimo|max|stessa|stesso|quella|quello|uguale|identica|come|vuota|nessuna|nessuno|scegli|sceglila|usa|use)$/i;
  const MISURA = /^(?:caratter[ei]|characters?|chars?|cifre|digits?|lettere|letters?|simboli|symbols?)[.,;:]?$/i;
  // Quando è cambiata o scade («12 mar 2024», «2 mesi fa», «tra 30 giorni»): la data di una password non è la password.
  const TEMPO = /^(?:gen(?:naio)?|feb(?:braio)?|mar(?:zo)?|apr(?:ile)?|mag(?:gio)?|giu(?:gno)?|lug(?:lio)?|ago(?:sto)?|set(?:tembre)?|ott(?:obre)?|nov(?:embre)?|dic(?:embre)?|jan(?:uary)?|february|march|april|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|dec(?:ember)?|fa|ago|giorn[oi]|settiman[ae]|mes[ei]|ann[oi]|or[ae]|minut[oi]|days?|weeks?|months?|years?|hours?|minutes?|ieri|oggi|yesterday|today)[.,;:]?$/i;
  const spiegazione = (parole) => INIZIO_SPIEGAZIONE.test(parole[0].replace(/[.,;:]+$/, '')) || parole.some((p) => MISURA.test(p) || TEMPO.test(p));
  function fraseDopo(s, out) {
    for (const m of s.matchAll(FRASE_DOPO)) {
      const v = m[1].trim();
      const parole = v.split(/\s+/);
      if (parole.length < 2 || parole.length > 6 || parole.some((p) => !/^[\p{L}\p{N}'’]+[.,;:]?$/u.test(p)) || v.startsWith('[') || NON_VALORE.test(parole[0]) || formaVicina(parole[0])) continue;
      if (spiegazione(parole)) continue;
      out.push({ valore: v.replace(/[.,;:]+$/, ''), regola: 'password' });
    }
  }

  // Fra virgolette il valore finisce alla virgoletta che chiude, qualunque cosa segua e con gli spazi dentro (#2678):
  // «la password è « Mela!Verde77 »». Niente filtri sulla prima parola né sulla lunghezza: «“la casa al mare”». Dopo i
  // due punti o il verbo è il valore salvo che la descriva («la stessa di prima», «vedi email»); senza nessuno dei due
  // più parole contano solo con la forma di una password, perché lì sono spesso una voce («password «Gestisci account»»).
  const FRA_VIRGOLETTE = `[ \\t]*(?:[${DOPPIE}](?<d>[^\\n|\\t${DOPPIE}]{1,2000})[${DOPPIE}]|[${SINGOLE}](?<s>[^\\n|\\t${SINGOLE}]{1,2000})[${SINGOLE}])`;
  const VIRGOLETTATO_DOPO = new RegExp(`${ETICHETTA}${ACCANTO}(?:[ \\t]*(?<sep>[:=])|[ \\t]+${VERBO_PASSWORD})${FRA_VIRGOLETTE}`, 'gid');
  const VIRGOLETTATO_IN_FRASE = new RegExp(`${ETICHETTA}${QUALIFICA}[ \\t]${FRA_VIRGOLETTE}`, 'gid');
  const ARTICOLO = /^(?:la|il|lo|i|le|gli|una?|the|an?|el|der|die|das|de|het)$/i;
  const DESCRIVE = /^(?:stess[aoie]|quell[aoie]|ugual[ei]|identic[aoie]|vedi|vedere|guarda|same|see|disponibil[ei]|available|scritt[ao]|indicat[ao]|riportat[ao]|fornit[ao]|inviat[ao]|stampat[ao]|vuot[ao]|nessun[ao]?|deve|devono|può|must|should|almeno|minimo|min|massimo|max)$/i;
  const descrive = (parole) => {
    const p = parole.map((x) => x.replace(/[.,;:]+$/, ''));
    const i = ARTICOLO.test(p[0]) && p.length > 1 ? 1 : 0;
    // Misura e data solo col numero («min 8 caratteri», «2 mesi fa»): «ci vediamo ogni giorno» è una frase-password.
    return DESCRIVE.test(p[i]) || (p.some((x) => /\d/.test(x)) && p.some((x) => MISURA.test(x) || TEMPO.test(x)));
  };
  function fraVirgolette(s, out) {
    for (const re of [VIRGOLETTATO_DOPO, VIRGOLETTATO_IN_FRASE]) {
      for (const m of s.matchAll(re)) {
        const k = m.groups.d !== undefined ? 'd' : 's';
        const v = m.groups[k].trim();
        if (!v || v.startsWith('[') || v.includes(SEGNAPOSTO)) continue;
        const parole = v.split(/\s+/);
        const separato = re === VIRGOLETTATO_DOPO;
        if (parole.length > 1) {
          if (separato ? !descrive(parole) : FORMA_FORTE(v)) out.push({ valore: v, regola: 'password' });
          continue;
        }
        const p = valorePassword(v);
        if (p && (separato || FORMA_FORTE(p))) out.push(alPosto(p, m.indices.groups[k][0], m.groups[k]));
      }
    }
  }

  // Un file di configurazione o di codice (JSON, .env, YAML, XML): il valore della chiave che si chiama password, anche
  // dentro un nome di variabile («DB_PASSWORD=…», «"adminPassword": "…"», «<password>…</password>»). Conta come codice
  // una chiave fra virgolette o composta, un uguale o un valore fra virgolette: «Password: deve…» è testo, e lo guardano
  // le regole sopra. Un'espressione, una variabile o un percorso («process.env.X», «${X}», «PWD=/home») non sono valori.
  // La regola è sul nome della chiave, come negli indirizzi: un nome di password (anche incollato, «PGPASSWORD») o di
  // segreto (secret, token, «api_key», «Chiave API») annuncia il valore. Per i segreti conta solo un valore con la forma
  // di una credenziale (vedi formaDiSegreto): «max_tokens: 4096» e «token_type: bearer» restano.
  const PAROLA_CHIAVE = /^(?:password|passwd|pwd|pass|passphrase|passcode)$/i;
  const CHIAVE = /(?<![\w$.?&-])(["']?)([A-Za-z_][\w.-]{0,60})\1[ \t]*(=>|:(?!:)|=(?![=>~]))[ \t]*(?:"([^"\n]{1,256})"|'([^'\n]{1,256})'|([^\s,;"'`<>(){}[\]]{1,256}))/gd;
  const ELEMENTO = /<([A-Za-z_][\w.:-]{0,60})>([^<\n]{1,256})<\/\1>/gd;
  const ADD_KEY = /<add\b[^>\n]*?\bkey\s*=\s*"([^"\n]{1,60})"[^>\n]*?\bvalue\s*=\s*"([^"\n]{1,256})"/gid;
  const SEGNAPOSTO_DI_TIPO = /^(?:string|text|null|none|nil|undefined|true|false|required|optional|secret|changeit|\*+|x+|\.+|<[^>]*>)$/i;
  const QUALIFICA_CHIAVE = /^(?:api|secret|private|access|auth|client|app|master|signing|encryption|license|licence|account|service|subscription|webhook|session)$/;
  // Dopo la parola password il nome dice di che password si tratta solo con una conferma o un indice
  // («password_confirmation», «password2»); altrimenti ne descrive una proprietà («password_label», «password_reset_timeout»).
  const DOPO_PASSWORD = /^(?:\d+|confirm\w*|again|repeat|new|old|current|plain\w*|clear|raw|value)$/;
  function tipoDiNome(nome) {
    const parti = nome.split(/[_.:\s-]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((p) => p.toLowerCase());
    const pw = parti.findIndex((p) => PAROLA_CHIAVE.test(p.replace(/\d+$/, '')) || /(?:password|passwd|passphrase)\d*$/.test(p));
    if (pw >= 0 && parti.slice(pw + 1).every((p) => DOPO_PASSWORD.test(p))) return 'password';
    if (parti.some((p, i) => /^(?:secrets?|tokens?|credentials?)$/.test(p) || /(?:secret|token|apikey)$/.test(p)
      || (/^keys?$/.test(p) && i > 0 && QUALIFICA_CHIAVE.test(parti[i - 1])))) return 'segreto';
    return '';
  }
  function valoreDiChiave(grezzo) {
    const v = testo(grezzo).trim();
    if (v.length < 3 || /^[$%{!]|^[/~]|^[A-Za-z]:\\/.test(v) || CODICE_SORGENTE.test(v) || SEGNAPOSTO_DI_TIPO.test(v) || PAROLA_CHIAVE.test(v) || v.includes(SEGNAPOSTO)) return '';
    return v;
  }
  // Un segreto che non porta il prefisso di un servizio: almeno dodici caratteri senza spazi, con lettere e cifre.
  function formaDiSegreto(grezzo) {
    const v = valoreDiChiave(grezzo);
    if (!v || v.length < 12 || /\s/.test(v) || /:\/\/|^www\./i.test(v) || EMAIL.test(v)) return '';
    return /[A-Za-z]/.test(v) && /[0-9]/.test(v) ? v : '';
  }
  function valorePerNome(nome, grezzo) {
    const tipo = tipoDiNome(nome);
    if (tipo === 'password') return valoreDiChiave(grezzo);
    return tipo === 'segreto' ? formaDiSegreto(grezzo) : '';
  }
  function chiaviDiConfigurazione(s, out) {
    for (const m of s.matchAll(CHIAVE)) {
      const [, virgolette, nome, sep, dq, sq, nudo] = m;
      const tipo = tipoDiNome(nome);
      if (!tipo) continue;
      // «Password: deve…» è testo, e lo guardano le regole sopra; «dbpassword: …», «db_password: …» sono configurazione.
      if (tipo === 'password' && !virgolette && PAROLA_CHIAVE.test(nome) && sep === ':' && nudo !== undefined) continue;
      const g = dq !== undefined ? 4 : sq !== undefined ? 5 : 6;
      // Una chiamata («password = input(…)») è codice; una frase («"password_label": "Inserisci la password"») è testo.
      if (g === 6 && s[m.index + m[0].length] === '(') continue;
      if (tipo === 'password' && /\s/.test(m[g].trim())) continue;
      const v = valorePerNome(nome, m[g]);
      if (v) out.push({ ...alPosto(v, m.indices[g][0], m[g]), regola: tipo === 'password' ? 'password' : 'chiave' });
    }
    for (const re of [ELEMENTO, ADD_KEY]) {
      for (const m of s.matchAll(re)) {
        const v = valorePerNome(m[1], m[2]);
        if (v) out.push(alPosto(v, m.indices[2][0], m[2]));
      }
    }
  }

  // Le stesse chiavi scritte per un umano, sulla pagina dell'account di un servizio: «Chiave API: …», «Secret key» con la
  // chiave sulla riga sotto (anche dopo «Copia»), un'intestazione «Authorization: Basic …», la password di una riga di comando.
  const ETICHETTA_SEGRETO = '\\b(?:chiave\\s+(?:api|segreta|privata|di\\s+accesso|d[\'’]accesso|di\\s+licenza|personale)'
    + '|(?:api|secret|private|access|client|license|licence|subscription)[ \\t_-]?key|client[ \\t_-]?secret|secret|segreto'
    + '|(?:access|api|auth|personal\\s+access|refresh|bearer)[ \\t_-]?token|token(?:\\s+(?:di\\s+accesso|api|personale|segreto))?)\\b';
  const SEGRETO_ACCANTO = new RegExp(`(?<![?&#/=.\\w-])${ETICHETTA_SEGRETO}(?:[ \\t]+\\([^)\\n]{0,24}\\))?[ \\t]*(?:[:=]|[-–—→](?=[ \\t]))[ \\t]*["'«“]?([^\\s"'»”,;<>&]{12,256})`, 'gi');
  const SEGRETO_SOLO = new RegExp(`^[ \\t]*${ETICHETTA_SEGRETO}[ \\t]*:?[ \\t]*$`, 'i');
  const BASIC = /\bAuthorization\s*:\s*Basic\s+([A-Za-z0-9+/]{8,}={0,2})/gi;
  const RIGA_DI_COMANDO = /\bsshpass\s+-p\s*(?:'([^'\n]+)'|"([^"\n]+)"|(\S+))|\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]*?\s-p(?:'([^'\n]+)'|"([^"\n]+)"|([^\s'"]+))/gi;
  // In una riga di comando la password sta nella coppia dell'utente («-u mario:x», «-U mario%x») o dopo l'opzione della
  // password quando la riga nomina un utente («docker login -u mario -p x», «sqlcmd -U sa -P x»): «-p 8080:80» resta.
  const COPPIA_UTENTE = /(?:^|\s)(?:-u|-U|--user(?:name)?)(?:\s+|=)['"]?[^\s:%'"]{1,64}[:%]([^\s'"]{3,128})/g;
  const CON_UTENTE = /(?:^|\s)(?:-u|-U|-l|--user(?:name)?|login)(?:\s|=)/;
  const OPZIONE_PASSWORD = /(?:^|\s)(?:-p|-P|-a|-pw|--pass(?:word)?|--passwd)(?:\s+|=)(['"]?)([^\s'"-][^\s'"]{2,127})\1/g;
  const SOLO_REDIS = /\bredis-cli\b[^\n]*?\s-a\s+(['"]?)([^\s'"]{3,128})\1/g;
  function passwordDiComando(s, out) {
    for (const m of s.matchAll(COPPIA_UTENTE)) if (/[A-Za-z]/.test(m[1])) out.push({ valore: m[1], regola: 'password' });
    for (const riga of s.split('\n')) {
      if (CON_UTENTE.test(riga)) {
        // Solo con la forma di una password: in «mysql -u root -p mydb» dopo «-p» c'è il database.
        for (const m of riga.matchAll(OPZIONE_PASSWORD)) if (FORMA_FORTE(m[2])) out.push({ valore: m[2], regola: 'password' });
      }
      for (const m of riga.matchAll(SOLO_REDIS)) out.push({ valore: m[2], regola: 'password' });
    }
  }
  // Una chiave privata ha intestazione e coda fisse: si toglie il corpo che segue l'intestazione, qualunque sia il formato
  // (OpenSSH, RSA, EC, cifrata, PGP), anche coi ritorni a capo scritti come «\n» dentro un JSON. PuTTY non ha
  // intestazione: la parte privata è il blocco dopo «Private-Lines:».
  const CORPO_PUTTY = /\bPrivate-Lines:[ \t]*\d{1,3}((?:(?:\r?\n|(?:\\r)?\\n)[A-Za-z0-9+/=]{4,})+)/g;
  const CORPO_PEM = /-----BEGIN (?:[A-Z0-9]+ ){0,4}PRIVATE KEY(?: BLOCK)?-----((?:(?:\r?\n|(?:\\r)?\\n)[A-Za-z-]{1,20}:[^\n\\]{0,200}){0,4}(?:(?:\r?\n|(?:\\r)?\\n|[ \t]){1,8}[A-Za-z0-9+/=]{4,})+)/g;
  // Il token di un bot Telegram ha la sua forma: l'id del bot, i due punti, «AA» e una trentina di caratteri.
  const TOKEN_TELEGRAM = /(?<![\w-])\d{8,10}:AA[A-Za-z0-9_-]{30,40}(?![\w-])/g;
  function chiaviInChiaro(s, out) {
    passwordDiComando(s, out);
    // Col ritorno a capo in testa: dentro un JSON la «n» di «\n» toccherebbe il corpo, e il segnaposto cerca una parola intera.
    for (const re of [CORPO_PEM, CORPO_PUTTY]) for (const m of s.matchAll(re)) out.push({ valore: m[1], regola: 'chiave' });
    for (const m of s.matchAll(TOKEN_TELEGRAM)) out.push({ valore: m[0], regola: 'token' });
    for (const m of s.matchAll(SEGRETO_ACCANTO)) {
      const v = formaDiSegreto(m[1].replace(/[.»”"']+$/, ''));
      if (v) out.push({ valore: v, regola: 'chiave' });
    }
    const righe = s.split('\n');
    for (let i = 0; i < righe.length; i++) {
      if (!SEGRETO_SOLO.test(righe[i])) continue;
      const v = formaDiSegreto(rigaSotto(righe, i).riga.trim());
      if (v) out.push({ valore: v, regola: 'chiave' });
    }
    for (const m of s.matchAll(BASIC)) out.push({ valore: m[1], regola: 'token' });
    for (const m of s.matchAll(RIGA_DI_COMANDO)) {
      const v = m.slice(1).find((x) => x !== undefined);
      if (!v || v.length < 3) continue;
      out.push({ valore: v, regola: 'password' });
      // Incollata a «-p» la password non è una parola a sé, e il segnaposto la cerca come parola intera (vedi oscura).
      if (m[6] !== undefined) out.push({ valore: `-p${v}`, regola: 'password' });
    }
  }

  // I due punti e l'uguale a tutta larghezza («密码：…», «パスワード＝…») valgono i nostri: le regole leggono una copia
  // della stessa lunghezza, e il valore torna com'è scritto nel testo.
  function passwordAccanto(s, out) {
    const n = s.replace(/：/g, ':').replace(/＝/g, '=');
    if (n === s) return etichette(s, out);
    const qui = [];
    etichette(n, qui);
    for (const x of qui) {
      const v = String(x.valore);
      const k = Number.isInteger(x.inizio) ? x.inizio : n.indexOf(v);
      out.push(k >= 0 ? { ...x, valore: s.slice(k, k + v.length) } : x);
    }
  }
  function etichette(s, out) {
    alPostoDelValore(s, out);
    fraseDopo(s, out);
    fraVirgolette(s, out);
    chiaviDiConfigurazione(s, out);
    chiaviInChiaro(s, out);
    for (const m of s.matchAll(ACCANTO_FORTE)) {
      // In una cella tutta la cella, anche con gli spazi; dopo i due punti il primo token, che se è una parola
      // qualunque conta solo da solo in coda («Password: hunter»), non in testa a una frase.
      // Dopo un trattino il titolo di una sezione («Password - Guida») è comune: conta solo la forma di una password.
      let v = '';
      if (m[1] === ':' || m[1] === '=') {
        const pezzi = m[2].trim().split(/\s+/);
        v = MISURA.test(pezzi[1] || '') ? '' : valorePassword(pezzi[0], { forma: pezzi.length > 1 });
      } else if (/^[-–—→]$/.test(m[1])) v = valorePassword(m[2].trim().split(/\s+/)[0], { forma: true });
      else v = valorePassword(m[2]);
      if (v) out.push(alPosto(v, m.indices[2][0], m[2]));
    }
    for (const re of [ACCANTO_DEBOLE, SOTTO]) {
      for (const m of s.matchAll(re)) {
        const v = valorePassword(m[1], { forma: true });
        if (v && !INDIRIZZO_O_EMAIL(v)) out.push({ valore: v, regola: 'password' });
      }
    }
    for (const m of s.matchAll(IN_FRASE)) {
      const v = valorePassword(m[1].replace(/[?!.,;:]+$/, ''));
      if (v && FORMA_FORTE(v)) out.push({ valore: v, regola: 'password' });
    }
    // La colonna «Password» di una tabella, a barre o a tabulazioni: le celle sotto l'intestazione. Una riga di due celle
    // con «Password» in testa è una coppia nome-valore («Password | x», poi «Server | imap…»): il valore lo toglie la regola
    // della cella, e le righe sotto sono altri campi.
    let col = -1;
    let sep = '';
    let o = 0;
    for (const riga of s.split('\n')) {
      const inizioRiga = o;
      o += riga.length + 1;
      const barre = /^\s*\|/.test(riga);
      const tab = !barre && riga.includes('\t');
      const celle = barre ? riga.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        : tab ? riga.split('\t').map((c) => c.trim()) : null;
      if (!celle || (col >= 0 && sep !== (barre ? '|' : '\t'))) { col = -1; continue; }
      if (col >= 0) {
        if (celle.every((c) => !c || /^:?-{2,}:?$/.test(c))) continue;
        const v = valorePassword(celle[col]);
        if (v) {
          const parti = riga.split(sep);
          const k = barre ? col + 1 : col;
          const prima = parti.slice(0, k).reduce((n, p) => n + p.length + 1, 0);
          out.push(alPosto(v, inizioRiga + prima, parti[k]));
        }
        continue;
      }
      const i = celle.findIndex((c) => INTESTAZIONE.test(c));
      if (i >= 0 && celle.length > 1 && !(i === 0 && celle.filter(Boolean).length === 2)) { col = i; sep = barre ? '|' : '\t'; }
    }
    colonnaCsv(s, out);
  }

  // La stessa colonna in un CSV, a virgole o a punti e virgola, con le celle anche fra virgolette (#1403.2): le
  // esportazioni delle password dei browser e dei gestionali. Le righe sotto contano finché hanno tante celle quante
  // l'intestazione; con due colonne sole il valore deve avere la forma di una password, come in una frase.
  const MAX_CAMPO_CSV = 4096;
  function rigaCsv(s, i, sep) {
    const celle = [];
    for (;;) {
      if (s[i] === '"') {
        let v = '';
        let j = i + 1;
        let chiuso = -1;
        while (j < s.length && j - i <= MAX_CAMPO_CSV) {
          if (s[j] === '"') {
            if (s[j + 1] === '"') { v += '"'; j += 2; continue; }
            chiuso = j;
            break;
          }
          v += s[j++];
        }
        // Una virgoletta che non si chiude è un carattere qualunque: la cella si legge com'è scritta.
        if (chiuso >= 0) {
          celle.push({ v, a: i + 1 });
          let k = chiuso + 1;
          while (k < s.length && s[k] !== sep && s[k] !== '\n') k++;
          if (s[k] === sep) { i = k + 1; continue; }
          return { celle, fine: k + 1 };
        }
      }
      let k = i;
      while (k < s.length && s[k] !== sep && s[k] !== '\n') k++;
      celle.push({ v: s.slice(i, k), a: i });
      if (s[k] === sep) { i = k + 1; continue; }
      return { celle, fine: k + 1 };
    }
  }
  function intestazioneCsv(s, i) {
    for (const sep of [',', ';']) {
      const { celle, fine } = rigaCsv(s, i, sep);
      if (celle.length < 2 || celle.some((c) => !c.v.trim() || c.v.length > 40)) continue;
      const col = celle.findIndex((c) => INTESTAZIONE_CSV.test(c.v.trim()));
      if (col < 0 || (col === 0 && celle.length === 2)) continue;
      return { sep, col, n: celle.length, fine };
    }
    return null;
  }
  function colonnaCsv(s, out) {
    let i = 0;
    while (i < s.length) {
      const a = s.indexOf('\n', i);
      const fineRiga = a < 0 ? s.length : a;
      const riga = s.slice(i, fineRiga);
      const tab = riga.length <= 2000 && !riga.includes('\t') && !/^\s*\|/.test(riga) && NOMINA_ETICHETTA.test(riga)
        ? intestazioneCsv(s, i) : null;
      if (!tab) { i = fineRiga + 1; continue; }
      i = tab.fine;
      while (i < s.length) {
        const r = rigaCsv(s, i, tab.sep);
        if (r.celle.length === 1 && !r.celle[0].v.trim()) { i = r.fine; continue; }
        if (r.celle.length !== tab.n) break;
        const c = r.celle[tab.col];
        const v = valorePassword(c.v, { forma: tab.n < 3 });
        if (v) out.push(alPosto(v, c.a, c.v));
        i = r.fine;
      }
    }
  }

  // Fra virgolette con lo spazio dentro («la password è « Mela!Verde77 »», la grafia francese) il valore si legge come
  // senza spazi: gli spazi passano fuori, e la lunghezza resta, così ogni posto trovato vale anche nel testo vero (#1403.11).
  // L'apostrofo attaccato a una parola («dell'altra») non apre né chiude; le altre virgolette sì, anche dopo «は». Dentro
  // il valore un apostrofo fra due lettere o cifre («« l'Albero77 »») è della password, non la chiude.
  const Q = `${VIRGOLETTE}‚‹›「」『』`;
  const CON_SPAZI_DENTRO = new RegExp(`((?<![\\p{L}\\p{N}])['‘‚]|[«»“„‹›"「『])([^\\S\\n]*)([^\\s${Q}](?:(?:[^\\n${Q}]|(?<=[\\p{L}\\p{N}])['’‘](?=[\\p{L}\\p{N}])){0,254}[^\\s${Q}])?)([^\\S\\n]*)([»«”“›‹"」』]|['’‘](?![\\p{L}\\p{N}]))`, 'gu');
  const HA_VIRGOLETTE = new RegExp(`[${Q}]`, 'u');
  const TESTA_VIRGOLETTE = new RegExp(`^[${Q}]+`, 'u');
  const CODA_VIRGOLETTE = new RegExp(`[${Q}]+$`, 'u');
  const spazi = (w) => ' '.repeat(w.length);
  const virgoletteStrette = (s) => (HA_VIRGOLETTE.test(s)
    ? s.replace(CON_SPAZI_DENTRO, (_, a, w1, v, w2, c) => `${spazi(w1)}${a}${v}${c}${spazi(w2)}`) : s);
  // Un valore preso con le virgolette attaccate («»Mela!Verde77«») nel testo vero le ha staccate: si cerca senza.
  function nelTestoVero(x, vero) {
    const v = String(x.valore);
    if (vero.includes(v)) return x;
    const testa = (v.match(TESTA_VIRGOLETTE) || [''])[0].length;
    const y = { ...x, valore: v.slice(testa).replace(CODA_VIRGOLETTE, '') };
    if (Number.isInteger(x.inizio)) y.inizio = x.inizio + testa;
    return y;
  }

  // `[{ valore, regola }]`: quello che in questo testo non deve uscire. Regola 'chiave' | 'password' | 'codice' |
  // 'carta' | 'cvv' | 'token'.
  function trova(valore) {
    const vero = testo(valore);
    const s = virgoletteStrette(vero);
    const out = [];
    if (!s.trim() || /^data:image\//i.test(s.slice(0, 16))) return out;
    if (!global.SN_GUARDIANO_STATICO && typeof require === 'function') require('./guardianoStatico.js');
    const G = global.SN_GUARDIANO_STATICO;
    if (G && typeof G.segretiNelTesto === 'function') {
      for (const x of G.segretiNelTesto(s)) if (REGOLE_GUARDIANO.has(x.regola)) out.push(x);
    }
    passwordAccanto(s, out);
    for (const re of [CVV, CVV_DOPO]) for (const m of s.matchAll(re)) out.push({ valore: m[1], regola: 'cvv' });
    for (const re of [CODICE_ACCESSO, CODICE_ACCESSO_EN]) {
      for (const m of s.matchAll(re)) if (!FINE_DI_UN_NUMERO.test(m[0].slice(0, -m[1].length))) out.push({ valore: m[1], regola: 'codice' });
    }
    for (const m of s.matchAll(PIN)) out.push({ valore: m[1], regola: 'codice' });
    codiciVicini(s, out);
    codiciDiRecupero(s, out);
    for (const m of s.matchAll(BEARER)) out.push({ valore: m[1], regola: 'token' });
    for (const m of s.matchAll(INDIRIZZO)) segretiNellIndirizzo(m[0], out);
    scritteAMano(s, out);
    return out.filter((x) => x.valore).map((x) => (s === vero ? x : nelTestoVero(x, vero)))
      .filter((x) => String(x.valore).length >= 3);
  }

  // Le password scritte a mano (la risposta sotto chi la chiede, «Utente / Password: mario / …», dopo il nome della rete):
  // le forme del correttore, da un posto solo (riservatiNelTesto.js). Qui la risposta conta solo sulle righe sotto la
  // domanda, e solo un valore con una cifra o un simbolo: una parola qualunque resta (tests/unit/pavimento.test.mjs).
  function scritteAMano(s, out) {
    if (!global.SN_RISERVATI_TESTO && typeof require === 'function') require('./riservatiNelTesto.js');
    const R = global.SN_RISERVATI_TESTO;
    if (!R) return;
    const basso = s.toLowerCase();
    const stesso = basso.length === s.length;
    for (const v of R.trova(s, { sotto: true })) {
      if (!/[^\p{L}'’]/u.test(v)) continue;
      // Il valore torna minuscolo: si toglie com'è scritto, in ogni punto del testo.
      let i = stesso ? basso.indexOf(v) : -1;
      if (i < 0) { out.push({ valore: v, regola: 'password' }); continue; }
      for (; i >= 0; i = basso.indexOf(v, i + v.length)) out.push({ valore: s.slice(i, i + v.length), regola: 'password' });
    }
  }

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Il testo coi valori trovati al posto del segnaposto, che dice al modello che lì c'era qualcosa. Una carta scritta
  // a gruppi si trova anche spezzata da spazi o trattini.
  function oscura(valore) {
    const s = testo(valore);
    const trovati = trova(s);
    if (!trovati.length) return valore;
    const alSuoPosto = (x) => x.regola === 'password' && Number.isInteger(x.inizio) && SENZA_FORMA(String(x.valore));
    const ovunque = new Set(trovati.filter((x) => !alSuoPosto(x)).map((x) => String(x.valore)));
    const posti = trovati.filter((x) => alSuoPosto(x) && !ovunque.has(String(x.valore)))
      .sort((a, b) => b.inizio - a.inizio);
    let t = s;
    let fine = Infinity;
    for (const x of posti) {
      const v = String(x.valore);
      if (x.inizio + v.length > fine || s.slice(x.inizio, x.inizio + v.length) !== v) continue;
      t = t.slice(0, x.inizio) + SEGNAPOSTO + t.slice(x.inizio + v.length);
      fine = x.inizio;
    }
    const valori = [...ovunque].sort((a, b) => b.length - a.length);
    for (const v of valori) {
      const forma = /^\d{12,19}$/.test(v) ? v.split('').map(escRe).join('[ -]?') : escRe(v);
      // Il valore si toglie come parola intera: la password «casa» non spezza «casalinga».
      const confine = /^[\p{L}\p{N}]/u.test(v) ? '(?<![\\p{L}\\p{N}])' : '';
      const fine = /[\p{L}\p{N}]$/u.test(v) ? '(?![\\p{L}\\p{N}])' : '';
      t = t.replace(new RegExp(`${confine}${forma}${fine}`, 'gu'), SEGNAPOSTO);
    }
    return t;
  }

  // Ogni stringa di un messaggio (anche annidata), tranne le foto: lo stesso oggetto se non c'è niente da togliere.
  function oscuraTutto(valore) {
    const giro = (v, n) => {
      if (typeof v === 'string') return oscura(v);
      if (n > 12 || !v || typeof v !== 'object') return v;
      let cambiato = false;
      const o = Array.isArray(v) ? [] : {};
      for (const k of Object.keys(v)) {
        const x = giro(v[k], n + 1);
        if (x !== v[k]) cambiato = true;
        o[k] = x;
      }
      return cambiato ? o : v;
    };
    return giro(valore, 0);
  }

  global.SN_PAVIMENTO = { SEGNAPOSTO, trova, oscura, oscuraTutto };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_PAVIMENTO;
})(typeof globalThis !== 'undefined' ? globalThis : self);
