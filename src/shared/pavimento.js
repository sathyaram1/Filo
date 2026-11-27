// Il pavimento della privacy (#1589): cosa non arriva mai a un modello né al servizio di ricerca, a nessun livello e
// nemmeno chiesto in chat. Regole fisse, senza modelli: password, carte e CVV, codici usa e getta, chiavi e token anche
// dentro un indirizzo. Lo applicano il cancello dei modelli e la ricerca web; prove in tests/unit/pavimento.test.mjs.

(function (global) {
  'use strict';

  const SEGNAPOSTO = '[dato riservato]';
  // Le forme del guardiano che contano qui: l'IBAN no, si spiega, si copia e si chiede come un indirizzo. La password
  // nemmeno: il guardiano la cerca fra le parole vicine all'etichetta (indirizzi di campo, codice), qui conta il suo posto.
  const REGOLE_GUARDIANO = new Set(['chiave', 'codice', 'carta']);
  // Le parole che annunciano il valore («Le mot de passe est …», «Der PIN wird …») sono l'elenco del guardiano, lo stesso
  // del controllo delle uscite (#1403.33). Il «to» polacco sta accanto al nome che lo regge.
  if (!global.SN_GUARDIANO_STATICO && typeof require === 'function') require('./guardianoStatico.js');
  const VERBO = `(?:${global.SN_GUARDIANO_STATICO.ANNUNCI.join('|')})`;
  // Le lunghezze di PIN e CVV sono quelle del guardiano, che le usa anche per i numeri accanto in elenco.
  const CIFRE_PIN = global.SN_GUARDIANO_STATICO.cifre('codice');
  const CIFRE_DEL_CVV = global.SN_GUARDIANO_STATICO.cifre('cvv');

  // Il CVV al posto del valore, come la password: anche dopo una parentesi o nella cella; dopo altre parole («CVV code:»)
  // solo col separatore o il verbo davanti, perché una frase che nomina il CVV non ne è il valore.
  // Come per la password il trattino o la freccia fra spazi («CVV — 123», #2681.2).
  const TRATTINO = '[-–—→](?=[ \\t])';
  // Il confine di una parola anche fuori dall'ASCII, dove \b non vede le lettere: «Код безопасности».
  const LETTERE = 'A-Za-z0-9\\u00C0-\\u024F\\u0400-\\u052F';
  // Le parole che fanno polacca la frase, per il suo «to» dopo un nome che non è solo polacco come PIN e CVV («Mój PIN
  // to 4829», #1403.80): in inglese «send the PIN to …» è una destinazione. Senza \p{L}, perché vale anche senza flag u.
  const POSSESSIVO_POLACCO = `(?:moj[${LETTERE}]*|mój|twoj[${LETTERE}]*|twój|swoj[${LETTERE}]*|swój|nasz[${LETTERE}]*|wasz[${LETTERE}]*)`;
  const SEGNO_POLACCO = `(?<![${LETTERE}])(?:${POSSESSIVO_POLACCO}|kod[${LETTERE}]*|numer[${LETTERE}]*|now(?:y|a|e|ego|ej|ym|ą)`
    + `|(?:tymczasow|jednorazow|tajn|poufn|prywatn|osobist|bankow)[${LETTERE}]*|kart(?:a|y|ę|ą|zie))(?![${LETTERE}])`;
  // CVV_ALTRE_LINGUE (#2681.1) e NOMI_CVV (#1403.61) vanno ai campi dei moduli (da etichette() di campiSegreti.js);
  // CVV_ALTRE_LINGUE anche agli indizi di pagamento (copia autonoma in safebrowseHints.js, uguale per
  // tests/unit/cvvAltreLingue.test.mjs), coi separatori dei nomi di campo («codigo_de_seguridad»). Nel testo vale
  // NOME_CVV, dove «Prüfnummer» da sola non è il CVV.
  const CVV_ALTRE_LINGUE = 'cryptogramme|code[\\s_-]*(?:de[\\s_-]*)?s[ée]curit[ée]|c[óo]digo[\\s_-]*(?:de[\\s_-]*)?(?:seguridad|seguran[çc]a)|(?:karten)?pr(?:ü|ue|u)f(?:nummer|ziffer)|sicherheits[\\s_-]*code|beveiligings[\\s_-]*code|kod[\\s_-]*bezpiecze[ńn]stwa';
  const NOMI_CVV = '(?:(?:card\\s+)?security\\s+code|card\\s+verification\\s+(?:code|value|number)'
    + '|codice\\s+(?:di\\s+)?sicurezza|cryptogrammes?(?:\\s+visuels?)?|code\\s+(?:de\\s+)?s[ée]curit[ée]'
    + '|c[óo]digos?\\s+(?:de\\s+)?segur(?:idad|an[çc]a)|(?:karten-?)?pr(?:ü|ue?)f(?:nummer|ziffern?|zahl|code)'
    + '|(?:karten)?sicherheits-?(?:code|nummer)|(?:beveiligings|veiligheids)code|kaartverificatiecode'
    + '|kod\\s+(?:zabezpieczaj[ąa]cy|bezpiecze[ńn]stwa)|код\\s+(?:безопасности|проверки))';
  const DELLA_CARTA = '(?:\\s+(?:(?:della|de\\s+la|de|do|da|der|van\\s+de|of\\s+the)\\s+(?:carta|carte|tarjeta|cart[ãa]o|karte|kaart|card)|karty))?';
  // Il nome anche nelle lingue del verbo (#2681), anche senza accenti (#1403.61): «cryptogramme», «código de seguridad»,
  // «Kartenprüfnummer». Il confine vede anche le lettere greche. «Prüfnummer» solo con la carta: da sola è il numero di
  // controllo di qualunque cosa («Die Prüfnummer des Gutachtens ist 2024»).
  const LETTERA_CVV = '[A-Za-z0-9_\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u052F]';
  const NOME_CVV = `(?<!${LETTERA_CVV})(?:cvv2?|cvc2?|csc|cid|(?:(?:card\\s+)?security\\s+code|card\\s+verification\\s+(?:value|code|number)`
    + '|codice\\s+(?:di\\s+)?sicurezza|cryptogrammes?(?:\\s+visuels?)?|code\\s+(?:(?:de\\s+)?s[ée]curit[ée]|de\\s+v[ée]rification)'
    + '|c[óo]digos?\\s+(?:(?:de\\s+)?segur(?:idad|an[çc]a)|de\\s+(?:verificaci[óo]n|verifica[çc][ãa]o))|codi\\s+de\\s+(?:seguretat|verificaci[óo])'
    + '|(?:kredit)?karten-?(?:pr(?:ü|ue|u)f(?:nummer|ziffern?|zahl|code)|verifizierungsnummer)|(?:(?:kredit)?karten)?sicherheits-?(?:code|nummer)'
    + '|kaartverificatiecode|(?:beveiligings|veiligheids)code|kod\\s+(?:zabezpieczaj[ąa]cy|bezpiecze[ńn]stwa|weryfikacyjny\\s+karty|cvv2?|cvc2?|csc)'
    + `|код\\s+(?:безопасности|проверки)|κωδικ[όο]ς\\s+ασφαλε[ίι]ας)${DELLA_CARTA})(?!${LETTERA_CVV})`;
  // «Prüfziffer», «Prüfcode» senza la carta solo annunciati subito dal verbo o dal separatore («Die Prüfziffer wird 321»,
  // #2681.2): con altre parole in mezzo o senza annuncio sono il controllo di altro («Der Prüfcode des Produkts ist 456»).
  const NOME_PRUF = `(?<!${LETTERA_CVV})pr(?:ü|ue|u)f(?:ziffern?|zahl|code)(?!${LETTERA_CVV})`;
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
  // Davanti a un PIN, un CVV o un codice una parentesi vale una virgoletta, anche le due insieme: «il PIN è («4821»)»
  // esce come «il PIN è 4821» (#2689). Le minori no: «pin < 1000» è un confronto nel codice.
  const INTORNO_APERTE = `[${APERTE}([{]`;
  const INTORNO_CHIUSE = `[${CHIUSE})\\]}]`;
  const DAVANTI = `(?:${INTORNO_APERTE}[ \\t]*){0,3}`;
  const CIFRE_CVV = `${DAVANTI}(${CIFRE_DEL_CVV})(?![\\d/]|[.,:-]\\d)`;
  // Il «to» polacco e il catalano «és» solo qui: in VERBO il «to» porterebbe a chi riceve. Conta se dopo il numero non
  // segue una parola («send the CVV to 123 Main St»), o in una frase polacca (SEGNO_POLACCO: «Kod CVV to 123 z tyłu»).
  // Dopo il verbo anche l'articolo («Il CVV è il 123», «Die Kartenprüfnummer ist die 123», #2681.2).
  const VERBO_CVV = `(?:${VERBO}|és|to(?=\\s+${CIFRE_DEL_CVV}(?![\\d/]|[.,:-]\\d)(?![ \\t]*${LETTERA_CVV}))|(?<=${SEGNO_POLACCO}[^\\n]{0,40})to)`
    + '(?:\\s+(?:il|lo|la|el|le|die|der|das|the|o)(?=\\s))?';
  const CVV = new RegExp(`(?:${NOME_CVV}\\s*${PARENTESI}(?:[:=|\\t]|${TRATTINO}|${VERBO_CVV})?`
    + `|${NOME_PRUF}\\s*(?:[:=|\\t]|${TRATTINO}|${VERBO_CVV}))\\s*${CIFRE_CVV}`, 'gi');
  const CVV_DOPO = new RegExp(`${NOME_CVV}[^\\d\\n|\\t:=.!?;]{1,40}?${PARENTESI}(?:\\s*(?:[:=|\\t]|${TRATTINO})|\\s+${VERBO_CVV}(?=\\s))\\s*${CIFRE_CVV}`, 'gi');
  // I refusi del nome («crytogramme», «seguirdad»): le parole lunghe dei nomi, riconosciute a un errore di distanza.
  const PAROLE_CVV = ['cryptogramme', 'securite', 'verification', 'seguridad', 'seguranca', 'verificacion', 'verificacao',
    'seguretat', 'kartenprufnummer', 'kartenpruefnummer', 'kartenprufziffer', 'sicherheitscode', 'kartensicherheitscode',
    'kaartverificatiecode', 'beveiligingscode', 'bezpieczenstwa', 'безопасности', 'ασφαλειας', 'sicurezza', 'security'];
  const NOVITA = () => global.SN_NOVITA || (typeof require === 'function' ? (require('./novita.js'), global.SN_NOVITA) : null);
  const piatta = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function nomiCvvCorretti(s) {
    if (!/\d{3}/.test(s)) return s;
    const N = NOVITA();
    if (!N || typeof N.distanza !== 'function') return s;
    return s.replace(/\p{L}{6,}/gu, (w) => {
      const p = piatta(w);
      // Prima la parola giusta: «security» è a un errore da «securite», e la lingua cambierebbe sotto il nome.
      if (PAROLE_CVV.includes(p)) return w;
      for (const giusta of PAROLE_CVV) {
        if (Math.abs(p.length - giusta.length) > 1 || (p[0] !== giusta[0] && p[1] !== giusta[1])) continue;
        if (N.distanza(p, giusta, 1) <= 1) return giusta;
      }
      return w;
    });
  }
  // Il codice che una mail o un SMS manda per entrare: il guardiano riconosce solo i marchi del monouso, perché lì un
  // falso allarme ferma un'azione; qui un falso allarme toglie un numero, e il codice di verifica non esce.
  // Le cifre in coda a una parola («Girasole2024») non sono il codice: è la password intera, e la toglie la regola delle
  // etichette; togliere solo «2024» lascerebbe il resto e cancellerebbe l'anno da tutto il messaggio.
  // Anche nelle lingue delle etichette (#1403.13): «le code d'accès 482913», «el código de acceso 482913».
  const CODICE_ACCESSO = new RegExp(/\b(?:codice|code|c[óo]digo|kod|pin)\b(?:\s+(?:di|da|per|the|your|il|tuo|de|du|des|del|do|der|von|van))*\s+(?:d['’])?(?:verifica|accesso|conferma|sicurezza|autenticazione|autorizzazione|login|verification|security|confirmation|access|sign-?in|acc[èe]s|v[ée]rification|s[ée]curit[ée]|connexion|acceso|acesso|verificaci[óo]n|verifica[çc][ãa]o|confirmaci[óo]n|confirma[çc][ãa]o|seguridad|seguran[çc]a|dost[ęe]pu|weryfikacyjny)(?![A-Za-zÀ-ÿ])[^\d\n]{0,24}?(?<![A-Za-zÀ-ÿ])/.source
    + `(${CIFRE_PIN})\\b`, 'gi');
  const CODICE_ACCESSO_EN = new RegExp(/\b(?:verification|security|confirmation|access|login|sign-?in|one-?time|otp|2fa)\s+(?:code|codice|pin)\b[^\d\n]{0,24}?(?<![A-Za-zÀ-ÿ])/.source
    + `(${CIFRE_PIN})\\b`, 'gi');
  const PIN = new RegExp(`\\bpin\\b\\s*(?:[:=]|${VERBO}(?=\\s))?\\s*${DAVANTI}(${CIFRE_PIN})\\b`, 'gi');
  // La regola sulla forma, per i codici: un numero con la forma di un codice (quattro-otto cifre, o due-tre gruppi) al
  // posto del codice (vedi alPostoDelCodice), nella frase che lo nomina o sulla riga sotto. Col nome del codice conta, a
  // meno che la frase lo dica un identificativo che non apre niente (cliente, ordine, prenotazione) senza parole
  // dell'entrare (verifica, autorizza, accedi, sblocca); senza nome conta solo dopo «usa», «inserisci», «enter» o col
  // prefisso («Use 337164 to verify», «G-482913»), perché «Verificato da 1532 utenti» non è un codice. Un anno resta.
  // Il nome del codice anche nelle lingue delle etichette (#1403.13): «código», «kod», i composti tedeschi e olandesi
  // («Zugangscode», «verificatiecode») elencati, perché «barcode» o «unicode» non annunciano un segreto.
  // I nomi del PIN senza «codice» (#1403.35): «numero segreto», «Geheimzahl» (il PIN della carta per le banche tedesche),
  // «Pincode». Dicono da soli che il numero apre qualcosa, anche accanto a un cliente o a un ordine.
  const NOMI_DEL_PIN = '(?:pin-?(?:codes?|nummern?)|geheim(?:zahl(?:en)?|nummern?|codes?)|geheime?\\s+(?:nummer|code)'
    + '|n[uú]m[eé]r[oi]s?\\s+(?:segret[oi]|secret[oa]?s?|confidenzial[ei]|confidentiels?|confidencial(?:es)?|riservat[oi])'
    + '|secret\\s+(?:numbers?|pins?)|confidential\\s+(?:numbers?|pins?)|tajn(?:y|ego|ym)\\s+numer(?:u|em)?)';
  const NOME_PIN = new RegExp(`\\b${NOMI_DEL_PIN}\\b`, 'i');
  // L'elenco degli apparecchi il cui codice li sblocca è uno solo (#1403.44): la frase col possessivo, l'etichetta senza
  // e il nome attaccato a «code» («Handycode», «Gerätecode») lo leggono da qui.
  // Coi refusi più comuni del telefono («telefno», «telfono»), perché il codice si scrive di fretta.
  const APPARECCHIO = '(?:telefon(?:o|i|ino|ini|u|ie|em|s|e|es)?|tel[ef]{1,2}f?o?n[oi]|t[ée]l[ée]phones?|tel[ée]fonos?|telefoons?|cellular[ei]|celular(?:es)?'
    + '|t[ée]l|celus?|cell|compus?|gsms?|smartphones?'
    + '|m[óo]vil(?:es)?|mobiles?|mobiel|portables?|portatil[ei]|port[áa]til(?:es)?|telem[óo]ve(?:l|is)|handys?|(?:smart|cell|i-?)?phones?'
    + '|i-?pads?|tablet(?:s|a|u|em|y)?|tablettes?|tabletas?|computer(?:s|a)?|computador(?:es|a|as)?|komputer(?:a|ze|em|y)?|ordinateurs?'
    + '|ordis?|ordenador(?:es)?|rechners?|laptop(?:s|a|ie|em)?|notebooks?|mac(?:book)?s?|pcs?|sim|kom[óo]rk(?:a|i|ę|ą)?|dispositiv[oi]'
    + '|devices?|appareils?|ger[äa]te?s?|urz[ąa]dzeni[ea]|apparaats?)';
  const NOMI_DEL_CODICE = `\\b(?:${NOMI_DEL_PIN}|codic[ei]|codes?|keycodes?|pin|puk|passcode|otp|2fa|mfa|c[óo]digos?|kod(?:u|em|y)?`
    + '|(?:zugangs|sicherheits|best[äa]tigungs|verifizierungs|verifikations|anmelde|einmal|aktivierungs|freischalt(?:ungs)?'
    + `|entsperr|autorisierungs|authentifizierungs|tür|toegangs|verificatie|beveiligings|bevestigings|inlog|login|activatie|${APPARECCHIO})-?codes?)\\b`;
  const NOME_CODICE = new RegExp(NOMI_DEL_CODICE, 'i');
  const SEGNO_FORTE = /\b(?:verific\w*|verif(?:y|ied|ies|ication)\w*|autorizz\w*|authori[sz]\w*|autentic\w*|authentic\w*|sblocc\w*|unlock\w*|acced\w*|accesso|access|log-?in|log\s+in|sign-?in|sign\s+in|monouso|one-?time|usa\s+e\s+getta|otp|passcode|2fa|mfa|v[ée]rif\w*|verifizier\w*|acc[èe]s|acceso|acesso|connexion|zugang\w*|anmeld\w*|best[äa]tig\w*|toegang\w*|inlog\w*|dost[ęe]p\w*)\b/i;
  const NON_APRE = /\b(?:client[ei]|customer|client|ordin[ei]|orders?|prenotazion[ei]|booking|reservation|pratica|scont[oi]|discount|promo\w*|coupon|fiscale|postale|postal|zip|cap|prodott[oi]|products?|articol[oi]|items?|sku|tracking|spedizion[ei]|shipp?(?:ing|ment)|fattur[ae]|invoices?|riferimento|reference|tribut[oi]|civile|penale|strada|procedura|error[ei]?|errors?|status|http|abi|cab|ateco|ean|isbn|iban|swift|bic|ticket|bigliett[oi]|vol[oi]|flights?|ricetta|esenzione|destinatario|sdi|cig|cup|colore|colou?r|sorgente|source|paese|country|comune|catastale|matricola|tessera|socio|membro|member|telefono|phone|tel|numero\s+verde|chiam\w*|call|commandes?|pedidos?|encomendas?|bestellung\w*|zam[óo]wieni\w*|bestelling\w*|factures?|facturas?|faturas?|rechnung\w*|faktur\w*|produits?|articles?|productos?|produtos?|produkt\w*|erreurs?|erros?|fehler\w*|b[łl][ęe]d\w*|suivi|seguimiento|rastreo|rastreamento|sendungsverfolgung|r[ée]servations?|reservas?|reservierung\w*|buchung\w*|rezerwac\w*|boeking\w*|r[ée]duction|descuentos?|descontos?|rabatt\w*|rabat\w*|remise|gutschein\w*|cup[óo]n|cupom|pocztow\w*|postleitzahl|couleurs?|farbe|kolor\w*|barres|barras|barcode|kreskow\w*|kunde\w*|klient\w*|clientes?|banques?|guichets?|communes?|douan\w*|[ée]?tablissements?|pays|pa[íi]s|kraj\w*|naf|ape|insee|siret|siren|cpv|uai|cnae|nace|cip|iata|upc|gtin)\b/i;
  // Il codice di fabbrica è scritto sul manuale: non apre niente di nessuno, nemmeno quando è un PIN.
  const PREDEFINITO = /\b(?:predefinit\w*|default|factory|fabbrica)\b/i;
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
  const SEPARA_ALTRE = `(?:\\s*[:=#]|\\s+(?:${VERBO}|to)(?![\\p{L}]))?\\s*$`;
  // Il possessivo vale l'articolo («Le code de mon colis», «Kod mojej paczki»). «Le code banque», senza complemento,
  // passa dall'elenco degli identificativi: lì la parola dopo «code» può essere un aggettivo («Le code généré est …»).
  const POSSESSIVO_ALTRE = '(?:mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leurs?|mis|mi|tus?|sus?|nuestr[oa]s?|vuestr[oa]s?'
    + `|meus?|minhas?|teus?|tuas?|seus?|suas?|noss[oa]s?|${POSSESSIVO_POLACCO})`;
  const ETICHETTA_ALTRE = new RegExp(`(?:\\b[Cc]ode\\s+(?:(?:de|du|des|van)\\s+(?:(?:la|les|le|de|het)\\s+|l['’]\\s*|${POSSESSIVO_ALTRE}\\s+)?|d['’]\\s*)`
    + `|\\b(?:[Cc][óo]digo|[Kk]od)\\s+(?:(?:de|del|do|da|dos|das)\\s+(?:(?:la|las|los|el|o|a|os|as)\\s+)?)?(?:${POSSESSIVO_ALTRE}\\s+)?)`
    + `([\\p{Ll}][\\p{Ll}-]{2,})${SEPARA_ALTRE}`, 'u');
  const ETICHETTA_DE = new RegExp(`\\b[Cc]odes?\\s+(?:der|des|vom|zur|zum|für\\s+(?:die|den|das|(?:mein|dein|sein|ihr|Ihr|unser|eur)(?:e|en)?)`
    + `|(?:[Mm]ein|[Dd]ein|[Ss]ein|[Ii]hr|[Uu]nser|[Ee]ur)e[rs])\\s+(\\p{Lu}\\p{Ll}+)${SEPARA_ALTRE}`, 'u');
  const UN_VERBO = new RegExp(`^(?:${VERBO}|sont|son|são|sind|zijn|fue|foi|to)$`, 'iu');
  const RESTA_ALTRE = new RegExp('^(?:acc[èe]s|acceso|acesso|dost[ęe]p\\p{L}*|v[ée]rifica\\p{L}*|weryfikac\\p{L}*|s[ée]curit[ée]|seguridad|seguran[çc]a'
    + '|zabezpiecz\\p{L}*|bezpiecze\\p{L}*|beveiliging|confirma\\p{L}*|potwierdz\\p{L}*|bevestiging|activa\\p{L}*|ativa[çc][ãa]o|aktywac\\p{L}*'
    + '|connexion|sesi[óo]n|sess[ãa]o|logowani\\p{L}*|inlog\\p{L}*|autori[sz]a\\p{L}*|autoryz\\p{L}*|authentifi\\p{L}*|autentica\\p{L}*'
    + '|uwierzyteln\\p{L}*|d[ée]verrouillage|desbloque\\p{L}*|odblokow\\p{L}*|r[ée]cup[ée]ration|recupera\\p{L}*|odzyskiw\\p{L}*|secours'
    + '|emerg[êe]ncia|emergencia|respaldo|backup|secret\\p{L}*|tajn\\p{L}*|temporaire|tempor[áa]l|tempor[áa]rio|tymczasow\\p{L}*'
    + '|nuevo|novo|nowy|[úu]nico|jednorazow\\p{L}*|sms|e-?mail|correo|envoy[ée]|enviado|recibido|re[çc]u|recebido|siguiente|seguinte'
    + '|num[ée]ric[oa]|personnel|personal|pin|otp|blik|tan|validation|validaci[óo]n|valida[çc][ãa]o'
    + '|din[áa]mico|dynamique|transac\\p{L}*|transa[çc][ãa]o|identifica\\p{L}*|identyfikac\\p{L}*'
    // Le cose il cui codice è un segreto (carta, conto, app; gli apparecchi in APPARECCHIO) e gli aggettivi di un codice d'accesso.
    + '|cartes?|tarjetas?|cart[ãa]o|cart[õo]es|\\p{L}*kart\\p{L}*|comptes?|cuentas?|contas?|kont[aouy]s?|account'
    + '|appli\\p{L}*|app|aplicaci[óo]n|aplicativo'
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
  const RESTA_UN_CODICE = /^(?:conferm\w*|sicurezza|temporane\w*|provvisori\w*|segret\w*|confidenzial\w*|riservat\w*|privat\w*|confidential|private|personal\w*|attivazion\w*|recupero|ripristino|emergenza|associazion\w*|abbinament\w*|ricevut\w*|inviat\w*|numeric\w*|nuovo|seguente|unico|sms|email|mail|your|the|my|this|that|our|its|new|same|following|above|below|one|confirmation|security|backup|recovery|reset|activation|temporary|secret|pairing|text|unique|special)$/;
  // Le cose che un codice apre: il loro codice è un segreto anche col nome comune davanti («Il codice del cancello è
  // 4829», «Codice di ritiro: 640385»). Contano solo come nome del codice, cioè subito dopo «codice» o subito prima di
  // «code»: «Videocitofono Wi-Fi, codice prodotto 4829» è un identificativo. «Porta» è anche un verbo: solo lì.
  const COSE_CHE_SI_APRONO = 'cancell(?:o|i|etto)|portone|ingresso|entrata|citofono|cassaforte|casseforti|cassett[ae]\\s+(?:delle\\s+)?chiavi|keybox|lockbox|key\\s?safe|lucchett[oi]|serratur[ae]|allarm[ei]|antifurto|ritir(?:o|are)|preliev(?:o|i|are)|armadiett[oi]|locker|wi-?fi|wlan|dispositiv[oi]|device|garage|gate|door|safe|alarm|pick-?up|withdrawal|keypad|appartament[oi]|apartment|serrand[ae]|ascensor[ei]|elevator|bancomat|building|entry|lock|apertur[ae]|disattivazion[ei]|disinseriment[oi]|opening';
  const APRE = new RegExp(`\\b(?:${COSE_CHE_SI_APRONO})\\b`, 'i');
  const NOME_CHE_APRE = new RegExp(`^(?:${COSE_CHE_SI_APRONO}|port[ae]|apri(?:re)?|apre|entra(?:re)?)\\b`, 'i');
  const LEGAMI = /^(?:\s+|(?:d|l|dell|all|dall|nell)['’]|(?:di|del|della|dello|dei|degli|delle|per|da|a|al|alla|allo|il|la|lo|i|gli|le|tuo|tua|of|for|to|the|your)\b)+/i;
  const PER_APRIRE = /\b(?:apri(?:re)?|apre|aprono|open(?:s|ing)?|entra(?:re)?|disattiva(?:re)?|disinseri(?:re|sci)|disarm(?:a|are)?)\b/i;
  // Il codice del proprio telefono o computer lo sblocca, in ogni lingua (#1403.44): col possessivo e l'apparecchio a
  // chiudere l'etichetta, così «il codice del telefono del cliente» e «my phone number» restano identificativi.
  const POSSESSIVO = `(?:mi[oaei]|tu[oaei]|su[oaei]|nostr[oaei]|vostr[oaei]|loro|my|your|his|her|our|their|${POSSESSIVO_ALTRE}`
    + '|(?:mein|dein|sein|ihr|unser|eur)\\p{L}*|mijn|jouw|je|uw|zijn|haar|onze?)';
  const APPARECCHIO_SOLO = new RegExp(`^${APPARECCHIO}$`, 'iu');
  // Anche attaccato all'apparecchio, come si scrive in tedesco e olandese: «Handycode», «telefooncode», «Entsperrcode».
  const NOME_SBLOCCO = '(?:(?:entsperr|sperr|zugangs|toegangs|ontgrendel)?(?:codic[ei]|codes?)|c[óo]digos?|kod(?:u|em|y)?|pin|puk|passcode)';
  const LEGAME_SBLOCCO = '(?:di|del|della|dello|dei|degli|delle|per|of|for|on|to|in|the|de|du|des|do|da|dos|das|para|pour|sur|en|von|vom|f[üu]r|zu|zum'
    + '|auf|der|van|voor|op|het|od|dla|na|w|la|le|les|il|lo|el|los|las|o|a|os|as|al|alla|sul|sulla|nel|nella|au|à|om|te)';
  // La parola che dice a cosa serve il codice, fra il nome e l'apparecchio: le parole che già tengono segreto un codice
  // («personale», «nuovo», «secret»), i segni dell'entrare e quelle dello sblocco, coi loro verbi («pour déverrouiller»).
  const SBLOCCA = '(?:sblocc\\p{L}*|unlock\\p{L}*|d[ée]verrouill\\p{L}*|verrouill\\p{L}*|d[ée]bloqu\\p{L}*|d[ée]bloc\\p{L}*|desbloqu\\p{L}*'
    + '|bloqu\\p{L}*|entsperr\\p{L}*|sperr\\p{L}*|ontgrendel\\p{L}*|odblok\\p{L}*|blokad\\p{L}*)';
  const QUALIFICA_SBLOCCO = `(?:d['’]\\s*)?(?:${SBLOCCA}|blocco|schermo|[ée]cran|pantalla|tela|lock|screen|segreto|secreto`
    + `|${RESTA_UN_CODICE.source.slice(1, -1)}|${RESTA_ALTRE.source.slice(1, -1)}|${SEGNO_FORTE.source})(?![\\p{L}])`;
  // Prima e dopo il verbo può stare un avverbio («ora è», «is now»), e il verbo può essere composto («è sempre stato»,
  // «has been»); «e» senza accento è un refuso; la virgola o i due punti valgono il verbo («il codice del mio telefono, 4829»).
  const AVVERBIO_SBLOCCO = global.SN_GUARDIANO_STATICO.AVVERBIO;
  const VERBO_SBLOCCO = `(?:${VERBO}|e|cest|serait|ser[íi]a|wäre|would\\s+be|to|will\\s+be|sind|zijn)`;
  const PARTICIPIO = '(?:stat[oaie]|been|[ée]t[ée]|sido|gewesen|geweest)';
  const AUSILIARE = '(?:has|have|had|ha|hat|heeft|a|avait|hab[íi]a|tem|tinha)';
  const AVV = `(?:\\s+${AVVERBIO_SBLOCCO})?`;
  const CHIUDE_VERO = `(?:\\s*[:=#,]|\\s*,?${AVV}\\s+(?:${VERBO_SBLOCCO}(?![\\p{L}])(?:${AVV}\\s+${PARTICIPIO})?|${AUSILIARE}${AVV}\\s+${PARTICIPIO})`
    + `(?![\\p{L}])(?:\\s*[:=])?${AVV}(?:\\s+(?:il|el|le|o|the))?)`;
  const CHIUDE_CORPO = `${CHIUDE_VERO}?`;
  // Il codice di quello che si apre e il PIN chiudono l'etichetta come il proprio apparecchio (#1403.93): «Il codice del
  // cancello è sempre 4829», «The gate code is now 4829», «Il codice del cancello e 4829».
  // La virgola, la «e» senza accento e il «to» polacco sono anche congiunzioni o preposizioni: valgono il verbo solo
  // subito dopo la cosa che si apre («del cancello e 4829», non «del cancello non funziona e 4829 volte», «the PIN to 4829 people»).
  const CHIUDE_CHI_ENTRA = new RegExp(`${CHIUDE_VERO}\\s*$`, 'iu');
  const CHIUSURA_DEBOLE = /^\s*,|^(?:\s*,)?(?:\s+\p{L}+)?\s+(?:e|to)(?![\p{L}'’])/iu;
  const DOPO_CHE_SI_APRE = new RegExp(`(?:^|\\s)(?:${COSE_CHE_SI_APRONO}|port[ae])(?:\\s+[\\p{L}-]+)?$`, 'iu');
  const chiudeChiEntra = (fra) => {
    const m = CHIUDE_CHI_ENTRA.exec(fra);
    return !!m && (!CHIUSURA_DEBOLE.test(m[0]) || DOPO_CHE_SI_APRE.test(fra.slice(0, m.index)));
  };
  const NOME_CHE_APRE_SOLO = new RegExp(`^(?:${COSE_CHE_SI_APRONO}|port[ae])(?:${CHIUDE_VERO})?\\s*$`, 'iu');
  const SOLO_DOPO_IL_NOME = new RegExp(`^(?:${CHIUDE_VERO})?\\s*$`, 'iu');
  const AGGETTIVO = '(?:[\\p{L}-]+\\s+)?';
  // Le marche di telefoni e computer sono un elenco solo (#1403.91), dopo l'apparecchio e al suo posto (MARCA).
  const MARCHE = 'samsung|galaxy|iphone|pixel|xiaomi|redmi|huawei|honor|oppo|oneplus|motorola|nokia|sony|xperia|lg|realme|vivo|apple'
    + '|macbook|imac|dell|hp|lenovo|thinkpad|asus|acer|surface|android|windows|chromebook|zte|tcl|alcatel|fairphone|doro|brondi|wiko';
  const MARCHE_COMUNI = 'moto|poco';
  // Dopo l'apparecchio, una o due parole sue («telefono nuovo», «di lavoro», «Samsung», «13», «mio»): elencate, perché dopo
  // «phone» può venire «number»; e solo col verbo dopo: «codice del mio telefono nuovo serie 71034» è un altro dato.
  const DOPO_APPARECCHIO = '(?:\\s+(?:(?:di|de|da|du|del|of|for|para|pour|f[üu]r)\\s+)?(?:mi[oaei]|tu[oaei]|su[oaei]|nostr[oaei]|vostr[oaei]'
    + '|nuov\\p{L}*|vecchi\\p{L}*|aziendal\\p{L}*|personal\\p{L}*'
    + '|privat\\p{L}*|fisso|portatile|principale|attuale|lavoro|ufficio|casa|nuev\\p{L}*|viej\\p{L}*|trabajo|nouve(?:au|l|lle)|vieux|ancien\\p{L}*'
    + '|travail|bureau|perso|pro|professionnel\\p{L}*|new|old|work|office|home|current|main|neu\\p{L}*|alt\\p{L}*|arbeit|dienst\\p{L}*|nieuw\\p{L}*'
    + `|oud\\p{L}*|werk|novo|nova|antigo|velho|móvil|movil|portable|cellulare|celular|${MARCHE}|${MARCHE_COMUNI}|pro|max|plus|mini`
    + '|ultra|air|se|lite|\\d{1,3})(?![\\p{L}\\d]))'
    + '{1,2}';
  // Col possessivo il telefono si chiama anche per marca, col suo modello («il codice del mio Galaxy S23 è …»): senza,
  // «il codice del pixel» può essere un colore. Le marche che sono anche parole comuni solo col modello («Moto G»).
  const MODELLO = '(?:\\s+(?:\\p{L}{0,3}\\d{1,4}\\p{L}{0,3}|note|tab|pro|max|plus|mini|ultra|lite|fold|flip|edge|fe|neo|play|power|go|watch|[gxz])'
    + '(?![\\p{L}\\d]))';
  const MARCA = `(?:(?:${MARCHE})(?![\\p{L}])${MODELLO}{0,3}|(?:${MARCHE_COMUNI})${MODELLO}{1,3})`;
  const IL_MIO = `(?:${APPARECCHIO}|${MARCA})`;
  const UN_APPARECCHIO = `${AGGETTIVO}${IL_MIO}(?:\\s*(?:,|e|and|et|y|und|en|i|o|or|ou)\\s+(?:${LEGAME_SBLOCCO}\\s+)*${POSSESSIVO}`
    + `\\s+${AGGETTIVO}${IL_MIO})?`;
  const TRA_NOME_E_APPARECCHIO = `(?:\\s+(?:${LEGAME_SBLOCCO}|${QUALIFICA_SBLOCCO}))*`;
  const NUCLEO_COL_NOME = `(?:${NOME_SBLOCCO}${TRA_NOME_E_APPARECCHIO}\\s+${POSSESSIVO}\\s+${UN_APPARECCHIO}`
    + `|${POSSESSIVO}\\s+${NOME_SBLOCCO}${TRA_NOME_E_APPARECCHIO}\\s+${UN_APPARECCHIO})`;
  const NUCLEO = `(?:${NUCLEO_COL_NOME}`
    + `|${POSSESSIVO}\\s+${AGGETTIVO}${IL_MIO}(?:['’]s)?(?:\\s+(?:ha|has|hat|heeft|tiene|tem|ma)(?:\\s+(?:il|un|the|a|el|o|den|einen|de))?)?`
    + `(?:\\s+(?:(?:unlock|lock|screen|access)\\s+)?|-)?${NOME_SBLOCCO})`;
  const DEL_MIO_APPARECCHIO = new RegExp(`(?<![\\p{L}])(?:${NUCLEO_COL_NOME}${DOPO_APPARECCHIO}${CHIUDE_VERO}|${NUCLEO}${CHIUDE_CORPO})\\s*$`, 'iu');
  const NON_UN_PREZZO = '(?![\\d\\p{L}]|\\s?(?:€|%|euro\\b|eur\\b|usd\\b|\\$))';
  // Il codice che sblocca può avere lettere ed essere corto come un PIN («Il pin è 48A9», «Mela77», #1403.91), e i
  // simboli di una password («M3l@77!»): intero, come la password con lo stesso valore. Il punto no: chiude la frase.
  const SIMBOLI_CODICE = '!@#$%^&*+?~_\\-';
  // Gli sguardi avanti hanno la misura del codice: senza, una riga di soli simboli costava secondi.
  const CON_LETTERE = `(?=[\\p{L}\\p{N}${SIMBOLI_CODICE}]{0,31}\\p{N})(?=[\\p{L}\\p{N}${SIMBOLI_CODICE}]{0,31}\\p{L})[\\p{L}\\p{N}]`
    + `[\\p{L}\\p{N}${SIMBOLI_CODICE}]{3,31}(?<![?_\\-])`;
  const PIN_O_LETTERE = `(${CIFRE_PIN}|${CON_LETTERE})`;
  // Il numero prima del nome: «4829 è il codice del mio telefono», «4829 is my phone code».
  const DOPO_IL_NUMERO = new RegExp(`^\\s*(?:[:=-]\\s*)?${VERBO_SBLOCCO}\\s+(?:(?:il|lo|la|the|le|el|o|der|de|het)\\s+)?${NUCLEO}(?![\\p{L}])`, 'iu');
  // «Quello del pc è 5512» dopo il codice del telefono, nella frase o in quella dopo: il pronome sta per il codice.
  const QUELLO_DEL_MIO = new RegExp(`(?<![\\p{L}])(?:quell[oa]|celui|celle|the\\s+one|that|der|die|el|la)\\s+(?:${LEGAME_SBLOCCO}\\s+)*`
    + `(?:${POSSESSIVO}\\s+)?${UN_APPARECCHIO}${CHIUDE_CORPO}\\s*["«“]?${PIN_O_LETTERE}${NON_UN_PREZZO}`, 'giu');
  const NUCLEO_NEL_TESTO = new RegExp(`(?<![\\p{L}])${NUCLEO}`, 'iu');
  // Lo sblocco detto col verbo, senza «codice»: «Per sbloccare il mio telefono uso 6118», «I unlock my phone with 6215».
  // Anche col nome dello sblocco al posto del codice: «Lo sblocco del mio telefono è 4829».
  const COL_NUMERO = '(?:\\s+[\\p{L}\'’]+){0,3}?\\s+(?:con|with|avec|mit|met|uso|use|using|usando|utilizzo|digito|typing|tapant|codice|code|c[óo]digo|pin)\\s*[:=]?';
  const SBLOCCO_COL_NUMERO = new RegExp(`(?<![\\p{L}])${SBLOCCA}\\s+(?:${LEGAME_SBLOCCO}\\s+)*(?:${POSSESSIVO}\\s+)?${UN_APPARECCHIO}`
    + `(?:${COL_NUMERO}|${CHIUDE_VERO})\\s*["«“]?${PIN_O_LETTERE}${NON_UN_PREZZO}`, 'giu');
  // L'apparecchio prima del verbo: «Il mio telefono si sblocca con 4829», «My phone unlocks with 6215».
  const APPARECCHIO_SI_SBLOCCA = new RegExp(`(?<![\\p{L}])(?:${POSSESSIVO}\\s+)?${UN_APPARECCHIO}(?:\\s+(?:si|se|sich|zich|się))?\\s+${SBLOCCA}`
    + `${COL_NUMERO}\\s*["«“]?(${CIFRE_PIN})${NON_UN_PREZZO}`, 'giu');
  // Le cifre staccate dopo l'etichetta del proprio apparecchio («Il codice del mio telefono è 48 29»): da quattro a otto.
  // Si parte dalle cifre e si guarda l'etichetta prima, come per il codice intero: un testo lungo resta lineare.
  const CIFRE_STACCATE = /(?<![\d\p{L}])\d{1,4}(?:[ .-]\d{1,4}){1,7}(?![\d\p{L}])/gu;
  // Le regole lunghe partono solo dove c'è un apparecchio: su una riga di 120.000 caratteri senza, costerebbero secondi.
  const UN_APPARECCHIO_NEL_TESTO = new RegExp(`(?<![\\p{L}])${IL_MIO}`, 'iu');
  function codiceDelMioApparecchio(s, out) {
    if (!UN_APPARECCHIO_NEL_TESTO.test(s)) return;
    for (const m of s.matchAll(QUELLO_DEL_MIO)) {
      if (NUCLEO_NEL_TESTO.test(s.slice(Math.max(0, m.index - 200), m.index))) out.push(conCheApre({ valore: m[1], regola: 'codice' }, true));
    }
    for (const re of [SBLOCCO_COL_NUMERO, APPARECCHIO_SI_SBLOCCA]) {
      for (const m of s.matchAll(re)) out.push(conCheApre({ valore: m[1], regola: 'codice' }, true));
    }
    for (const m of s.matchAll(CIFRE_STACCATE)) {
      const n = m[0].replace(/\D/g, '').length;
      if (n < 4 || n > 8) continue;
      const prima = s.slice(Math.max(0, m.index - 160), m.index).replace(/["«“]\s*$/, '');
      if (delMioApparecchio(prima) || etichettaSbloccabile(prima)) out.push(conCheApre({ valore: m[0], regola: 'codice' }, true));
    }
  }
  // `apre`: il codice di qualcosa che apre (il mio telefono, il cancello, la carta). Il controllo delle uscite prende
  // questi, la password e il CVV (guardianoStatico.js, segretiInUscita); il resto lo legge con le sue forme.
  const conCheApre = (x, apre) => (apre ? Object.assign(x, { apre: true }) : x);
  // «The serial code of my phone»: un nome comune davanti a «code» ne fa un identificativo, come nell'etichetta inglese.
  const INIZIA_COL_NOME = new RegExp(`^${NOME_SBLOCCO}`, 'iu');
  const DAVANTI_AL_NOME = /^(?:il|lo|la|le|el|un|the|and|gli|una|une|uno|los|las|der|die|das|den|dem|des|het|een|ein\w*|unlock|lock|screen|access|pin|puk|sim|what|what['’]?s|here|ecco|anche|also|plus)$/i;
  const delMioApparecchio = (coda) => {
    if (!UN_APPARECCHIO_NEL_TESTO.test(coda)) return false;
    const m = DEL_MIO_APPARECCHIO.exec(coda);
    return !!m && nomeSenzaUnAltroDavanti(coda, m);
  };
  const nomeSenzaUnAltroDavanti = (coda, m) => {
    if (!INIZIA_COL_NOME.test(m[0])) return true;
    const w = /([A-Za-z][A-Za-z'-]{2,}|[A-Z]{2,})\s+$/.exec(coda.slice(0, m.index));
    return !w || DAVANTI_AL_NOME.test(w[1]) || RESTA_UN_CODICE.test(w[1]) || SEGNO_FORTE.test(w[1]) || UN_VERBO.test(w[1])
      || POSSESSIVO_SOLO.test(w[1]);
  };
  const POSSESSIVO_SOLO = new RegExp(`^${POSSESSIVO}$`, 'iu');
  // Il codice del telefono o della carta li sblocca anche senza possessivo (#2678.10), con la stessa chiusura della frase
  // col possessivo e chi lo possiede («di mia madre»); un identificativo nell'etichetta («del cliente») ne fa un altro dato.
  const CARTA = '(?:cart[ae]|cards?|postepay|prepagat[ae]|mastercard|visa|amex|revolut|hype)';
  const SBLOCCABILE = `(?:${APPARECCHIO}|${CARTA})`;
  const SI_SBLOCCA_SOLO = new RegExp(`^${SBLOCCABILE}$`, 'iu');
  const DI_QUALCUNO = `(?:\\s+(?:di|del|della|dello|de|du|da|of|von|vom|van|od)\\s+(?:${POSSESSIVO}\\s+)?[\\p{L}]+)?`;
  const DOPO_SBLOCCABILE = `(?:${DOPO_APPARECCHIO})?${DI_QUALCUNO}`;
  const PRIMA_DI_SBLOCCABILE = `(?:\\s+|\\s+(?:dell|all|nell|d|l)['’]\\s*)${AGGETTIVO}`;
  const ETICHETTA_SBLOCCABILE = new RegExp(`(?<![\\p{L}])(?:${NOME_SBLOCCO}${TRA_NOME_E_APPARECCHIO}${PRIMA_DI_SBLOCCABILE}${SBLOCCABILE}`
    + `${DOPO_SBLOCCABILE}(?:${CHIUDE_VERO})?|${SBLOCCABILE}${DOPO_SBLOCCABILE}\\s+(?:ha|has|hat|heeft|tiene|tem)`
    + `(?:\\s+(?:il|un|the|a|el|o|den|einen|de|le))?\\s+${NOME_SBLOCCO}(?:${CHIUDE_VERO})?)\\s*$`, 'iu');
  const UN_SBLOCCABILE = new RegExp(`(?<![\\p{L}])${SBLOCCABILE}(?![\\p{L}])`, 'giu');
  const etichettaSbloccabile = (coda) => {
    const m = ETICHETTA_SBLOCCABILE.exec(coda);
    return !!m && !NON_APRE.test(m[0].replace(UN_SBLOCCABILE, ' ')) && !PREDEFINITO.test(m[0]) && nomeSenzaUnAltroDavanti(coda, m);
  };
  // Il nome del codice nell'etichetta prima del numero: quello che segue l'ultimo «codice», o la parola prima di «code».
  const nomeDelCodice = (prima) => {
    if (/\bkeycodes?\b/i.test(prima)) return { apre: true, solo: /\bkeycodes?\s*(?:[:=#]|\bis\b)?\s*$/i.test(prima) };
    if (delMioApparecchio(prima.slice(-160)) || etichettaSbloccabile(prima.slice(-160))) return { apre: true, solo: true };
    const it = [...prima.matchAll(/\b(?:codic[ei]|pin)\b/gi)].pop();
    const en = [...prima.matchAll(/\b([A-Za-z-]+)\s+(?:codes?|pin)\b/g)].pop();
    if (en && (!it || en.index > it.index)) {
      const solo = SOLO_DOPO_IL_NOME.test(prima.slice(en.index + en[0].length));
      if (NOME_CHE_APRE.test(en[1])) return { apre: true, solo };
      if (solo && SI_SBLOCCA_SOLO.test(en[1])) return { apre: true, solo };
    }
    const altro = [...prima.matchAll(NOME_ALTRE)].pop();
    if (altro && (!it || altro.index > it.index)) {
      const coda = prima.slice(altro.index + altro[0].length).replace(LEGAMI_ALTRE, '');
      const p = /^[\p{L}-]+/u.exec(coda);
      if (p && APRE_ALTRE_SOLO.test(p[0])) return { apre: true, solo: DOPO_IL_NOME.test(coda.slice(p[0].length)) };
    }
    if (!it) return { apre: false, solo: false };
    // Un PIN non è mai un identificativo, di qualunque cosa sia: «il pin del telefono è 4821», anche se è un anno (#2678.3).
    if (/^pin$/i.test(it[0])) return { apre: true, solo: true, pin: true };
    const coda = prima.slice(it.index + it[0].length).replace(LEGAMI, '');
    return { apre: NOME_CHE_APRE.test(coda), solo: NOME_CHE_APRE_SOLO.test(coda) };
  };
  // Un verbo al posto dell'etichetta («Il codice sarà 4829», «El código era 4829») annuncia il valore, non lo nomina.
  const etichettaDiUnIdentificativo = (prima) => {
    const m = ETICHETTA_IT.exec(prima) || ETICHETTA_EN.exec(prima);
    if (m && !UN_VERBO.test(m[1])) {
      return !RESTA_UN_CODICE.test(m[1]) && !SEGNO_FORTE.test(m[1]) && !APRE.test(m[1]) && !/^port[ae]$/.test(m[1])
        && !APPARECCHIO_SOLO.test(m[1]);
    }
    const a = ETICHETTA_ALTRE.exec(prima) || ETICHETTA_DE.exec(prima);
    return !!a && !UN_VERBO.test(a[1]) && !RESTA_ALTRE.test(a[1]) && !APRE_ALTRE_SOLO.test(a[1]) && !SEGNO_FORTE.test(a[1])
      && !APPARECCHIO_SOLO.test(a[1]);
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
  const CHIUDE_ETICHETTA = new RegExp(`(?:[:=#]|(?:^|\\s)(?:${VERBO}|will\\s+be)(?:\\s+(?:il|el|le|o|the))?|\\bn\\.|\\bnr\\.?|\\bno\\.)\\s*$`, 'i');
  // Il polacco «to» dopo un nome polacco («kod», «tajny numer»), o dopo il PIN in una frase polacca (SEGNO_POLACCO).
  const CHIUDE_KOD = /\sto\s*$/i;
  const NOME_POLACCO = /^(?:kod|tajn)/i;
  const FRASE_POLACCA = new RegExp(SEGNO_POLACCO, 'i');
  const nomePolacco = (nome, prima) => NOME_POLACCO.test(nome) || (/^pin$/i.test(nome) && FRASE_POLACCA.test(prima));
  const PRIMA_DEL_NOME = new RegExp(`^\\s*(?:[:=-]\\s*)?(?:${VERBO}|=)\\s+(?:[\\p{L}'’-]+\\s+){0,4}?${NOMI_DEL_CODICE}`, 'iu');
  // Prima del numero si guarda solo la coda: il nome conta a 60 caratteri al più, e rileggere da capo la riga a ogni
  // numero rendeva quadratico un testo lungo che ripete «el código es 482913».
  const CODA = 400;
  const RELATIVA = /^\s*,\s*(?:den|die|das|der|dem|welche[nmrs]?|che|which|that|que|qui|kt[óo]r\p{L}*)\s[^,;!?\n\d]{1,40},/iu;
  const SENZA_VIRGOLETTA = new RegExp(`(?:${INTORNO_APERTE}[ \\t]*)+$`);
  const DOPO_VIRGOLETTA = new RegExp(`^(?:[ \\t]*${INTORNO_CHIUSE})+`);
  // `risposta`: la riga sotto, dopo chi scrive (`testa`). Sotto chi chiede il codice vale ogni punto del messaggio,
  // come per la password («Luc: è sempre 4821», #2692); sotto una riga che lo nomina e basta, solo la testa.
  function alPostoDelCodice(z, m, inTesta, forte, risposta, entra) {
    const prima = z.slice(0, m.index).replace(SENZA_VIRGOLETTA, '');
    if (inTesta) {
      if (!risposta) return !prima.trim();
      return m.index >= risposta.testa && (risposta.chiesto || !prima.slice(risposta.testa).trim());
    }
    if (PRIMA_DEL_NOME.test(z.slice(m.index + m[0].length).replace(DOPO_VIRGOLETTA, ''))) return true;
    const da = Math.max(0, prima.length - CODA);
    const n = [...prima.slice(da).matchAll(NOMI_CODICE)].pop();
    if (!n) return false;
    n.index += da;
    // Una relativa fra virgole non chiude la frase del codice («Der Code, den du erhalten hast, ist 482913»).
    const fra = prima.slice(n.index + n[0].length).replace(RELATIVA, ' ');
    if (!fra.trim()) return true;
    // Il codice del proprio apparecchio ha la sua etichetta, con le sue virgole e i suoi refusi («, c'est», «e» senza accento).
    if (!/\d/.test(fra) && (delMioApparecchio(prima.slice(-160)) || etichettaSbloccabile(prima.slice(-160)))) return true;
    if (entra && !/\d/.test(fra) && fra.length <= 60 && !/[;!?]/.test(fra) && chiudeChiEntra(fra)) return true;
    // Una virgola chiude la frase del codice («In the code below, MAX_SIZE is 65536»), salvo dove parla di entrare.
    if (fra.length > 60 || /[;!?]|\d{4,}/.test(fra) || (!forte && fra.includes(','))) return false;
    if (CHIUDE_ETICHETTA.test(fra) || (nomePolacco(n[0], prima.slice(Math.max(da, n.index - 60), n.index)) && CHIUDE_KOD.test(fra))) return true;
    return /^[\s•*·>–-]*$/.test(prima.slice(0, n.index)) && !/\d/.test(fra) && fra.trim().split(/\s+/).length <= 4;
  }
  // Un codice usa e getta di lettere e cifre («Steam Guard code: 7K2F9», quello da scrivere sulla TV, «WDJB-MJHT»):
  // conta solo al posto del codice, come i numeri, e col nome del codice nella frase.
  const CODICE_ALFANUMERICO = /(?<![\w./:-])(?:(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9]{5,10}|[A-Z]{4}-[A-Z]{4})(?![\w/-])/g;
  // Lo sblocco con le lettere (CON_LETTERE) solo dove il nome dice il PIN, lo sblocco o l'entrare.
  const CODICE_CON_LETTERE = new RegExp(`(?<![\\p{L}\\p{N}./:@_-])${CON_LETTERE}(?![\\p{L}\\p{N}/@_-]|\\.[\\p{L}\\p{N}])`, 'gu');
  // Il blocco schermo di Android («codice di blocco schermo», «schermata di blocco») è lo stesso sblocco.
  // «Il codice del blocco try» è un pezzo di programma: il blocco conta col «di» o con lo schermo.
  const DI_SBLOCCO = new RegExp(`(?<![\\p{L}])(?:${SBLOCCA}|di\\s+blocco|blocco\\s+(?:dello\\s+)?schermo|schermata|lock|screen)(?![\\p{L}])`
    + `|${SEGNO_FORTE.source}`, 'iu');
  // «Codice di sblocco iPhone15: 4821»: la parola con le cifre è dell'etichetta, il valore viene dopo.
  const POI_UN_VALORE = new RegExp(`^\\s*(?:[:=#]|(?:${VERBO})(?![\\p{L}]))\\s*["«“]?[\\p{L}\\p{N}]*\\p{N}`, 'iu');
  // Le sigle che non aprono niente, se la frase non parla di sblocco: il pin di una scheda elettronica («Il pin del relè
  // è PB13», «SDA1», «GPIO4») e il modello di un apparecchio («Il codice del mio Samsung è SM-A525F», «i7-1255U»).
  const SIGLA_DI_UN_PIN = /^(?:gpio\d{1,3}|p[a-k]\d{1,2}|rst\d?|sda\d?|scl\d?|[tr]x\d{1,2}|io\d{1,2}|adc\d{1,2}|pwm\d{1,2})$/i;
  const SIGLA_DI_UN_MODELLO = /^(?:[A-Z]{1,4}-[A-Z]*\d[A-Z\d]*|i[3579]-\d{4,5}[A-Z]{0,2})$/;
  const UN_CODICE = new RegExp(FORMA_CODICE.source);
  const UN_ALFANUMERICO = new RegExp(CODICE_ALFANUMERICO.source);
  // La risposta sotto chi chiede il codice può essere quello con le lettere («Mela77»): la cerca la stessa forma.
  const UN_CON_LETTERE = new RegExp(CODICE_CON_LETTERE.source, 'u');
  const haUnCodice = (z, nome) => UN_CODICE.test(z) || (nome && (UN_ALFANUMERICO.test(z) || UN_CON_LETTERE.test(z)));
  // I messaggi sotto la domanda che si saltano cercando la risposta: in chat ne passano parecchi senza numero.
  const RIGHE_SALTATE = 8;
  function codiciVicini(s, out) {
    const righe = s.split('\n');
    for (let i = 0; i < righe.length; i++) {
      const celle = righe[i].split(/[|\t]/);
      for (let c = 0; c < celle.length; c++) {
        // Il punto di un'abbreviazione non chiude la frase: «Codice sblocco tel. Mela77».
        const pezzi = celle[c].split(/(?<=[.!?;])(?<!(?<![A-Za-zÀ-ÿ])(?:[Tt]el|[Cc]ell|[Cc]od|[Nn]um|[Nn]r)\.)\s+(?=[A-ZÀ-Ý«"])/);
        for (let f = 0; f < pezzi.length; f++) {
          const frase = pezzi[f];
          const nome = NOME_CODICE.test(frase);
          const forte = SEGNO_FORTE.test(frase);
          const pinNellaFrase = nome && NOME_PIN.test(frase);
          // Senza il nome del codice: «Per aprire il cancello digita 3958», non «Apri il file e inserisci 48291».
          const perAprire = PER_APRIRE.test(frase) && (APRE.test(frase) || /\b(?:port[ae]|entra(?:re)?)\b/i.test(frase));
          if (!nome && !forte && !perAprire) continue;
          const zona = [{ z: frase, inTesta: false }];
          const ultima = f === pezzi.length - 1;
          if (ultima && c + 1 < celle.length && !haGiaIlNumero(frase)) zona.push({ z: celle[c + 1], inTesta: true });
          const dove = righe[i].indexOf(frase);
          const R = riservati();
          const chiesto = !!R && R.chiede(righe[i]);
          if ((chiesto || righe[i].trim().length <= 80) && !haGiaIlNumero(righe[i].slice(dove < 0 ? 0 : dove))) {
            // Sotto chi chiede il codice la risposta è il primo messaggio con un numero, come per la password: i solleciti
            // di chi chiede, i messaggi senza numero e l'intestazione di Telegram si saltano (#2692).
            const chi = R ? R.parlaInChat(righe[i]) : null;
            for (let j = i + 1, vuote = 0, saltate = 0; j < righe.length && vuote <= 2 && saltate <= RIGHE_SALTATE; j++) {
              if (!righe[j].trim()) { vuote++; continue; }
              vuote = 0;
              const parla = R ? R.parlaInChat(righe[j]) : null;
              if (chi && parla && parla.chi === chi.chi) { saltate++; continue; }
              if (chiesto && !haUnCodice(parla ? parla.resto : righe[j], nome)) { saltate++; continue; }
              zona.push({ z: righe[j], inTesta: true, risposta: { chiesto, testa: parla ? righe[j].length - parla.resto.length : 0 } });
              break;
            }
          }
          for (const { z, inTesta, risposta } of zona) {
            const predefinito = PREDEFINITO.test(`${frase} ${z}`);
            const nonApre = predefinito || NON_APRE.test(`${frase} ${z}`);
            const trovati = [...z.matchAll(FORMA_CODICE)].map((m) => ({ m, v: m[2] || m[4] }));
            if (nome) for (const m of z.matchAll(CODICE_ALFANUMERICO)) trovati.push({ m, v: m[0], lettere: true });
            if (nome) {
              const gia = new Set(trovati.map((t) => t.m.index));
              for (const m of z.matchAll(CODICE_CON_LETTERE)) if (!gia.has(m.index)) trovati.push({ m, v: m[0], lettere: true, largo: true });
            }
            for (const { m, v, lettere, largo } of trovati) {
              const prima = z.slice(Math.max(0, m.index - CODA), m.index).replace(SENZA_VIRGOLETTA, '');
              const etichetta = inTesta ? frase.slice(-CODA) : prima;
              let chiave = nome ? nomeDelCodice(etichetta) : { apre: false, solo: false };
              if (nome && !chiave.apre && !inTesta && DOPO_IL_NUMERO.test(z.slice(m.index + m[0].length, m.index + m[0].length + 160))) {
                chiave = { apre: true, solo: true };
              }
              // Il PIN conta se è lui il nome più vicino al numero: in «Codice cliente 4829, numero segreto…» il numero è del cliente.
              const ultimo = pinNellaFrase ? [...etichetta.matchAll(NOMI_CODICE)].pop() : null;
              const pin = !!ultimo && NOME_PIN.test(ultimo[0]);
              const entra = forte || pin || chiave.apre;
              if (lettere) {
                const n = [...etichetta.matchAll(NOMI_CODICE)].pop();
                // Il nome e quello che lo segue, o la parola subito prima («unlock code»).
                const davanti = n ? /[\p{L}-]+\s*$/u.exec(etichetta.slice(0, n.index)) : null;
                const sblocca = n && DI_SBLOCCO.test(`${davanti ? davanti[0] : ''}${etichetta.slice(n.index)}`);
                if (!sblocca && (SIGLA_DI_UN_PIN.test(v) || SIGLA_DI_UN_MODELLO.test(v))) continue;
                if (largo && !(chiave.apre || pin || sblocca)) continue;
              }
              if (largo && POI_UN_VALORE.test(z.slice(m.index + m[0].length, m.index + m[0].length + 60))) continue;
              if (nonApre && !(nome && entra)) continue;
              if (predefinito && chiave.pin && !forte) continue;
              if (nome ? !(alPostoDelCodice(z, m, inTesta, forte || pin, risposta, entra) || (!lettere && (m[1] || m[3] || INTRODOTTO.test(prima))))
                : !(m[1] || m[3] || INTRODOTTO.test(prima))) continue;
              // Un anno resta, tranne subito dopo il nome di quello che apre: «Il codice del cancello è 1990».
              if (!lettere && !m[2] && ANNO.test(v) && !chiave.solo) continue;
              // A coppie («48-29-13») somiglia a una data: conta solo dove la frase parla di entrare.
              if (/^\d\d-/.test(v) && !entra) continue;
              if (nome && !entra && etichettaDiUnIdentificativo(etichetta)) continue;
              // Un pezzo di un numero più lungo («+39 333 1234567», «Chiama 02 4829 1736») è un telefono, non il codice;
              // così le cifre finali di un numero coperto o annunciate come tali («al ***4567», «che termina con 4567»).
              if (/(?:\+|\d)[ .]?$/.test(prima) || FINE_DI_UN_NUMERO.test(prima)) continue;
              out.push(conCheApre({ valore: v, regola: 'codice' }, (chiave.apre && !chiave.pin) || (!nome && perAprire)));
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
  // Un pezzo d'indirizzo senza lo schema («?q=password%3A%20…», «www.x.it/la%20password…»); con lo schema è un INDIRIZZO.
  const CODIFICATO = /[^\s<>"'`()[\]«»]*%[0-9A-Fa-f]{2}[^\s<>"'`()[\]«»]*/g;
  // Le password accanto a un'etichetta. La regola generale è il posto del valore (alPostoDelValore): dopo il separatore o
  // il verbo che chiude l'etichetta, subito dopo di lei, sulla riga sotto. Mai il resto della riga: «la password di
  // Office365», un nome utente, un indirizzo di campo o una riga di codice vicini all'etichetta non sono il valore.
  // Le parole senza la forma di una password («Password: hunter», la cella, la colonna) contano solo da sole al posto del
  // valore, con l'etichetta in testa alla riga o alla cella: «un campo password o carta: …» resta.
  // Le etichette: anche la password del wifi del router, il codice di accesso e le altre lingue, che porta urlExfil.js
  // (PRESENTA) col loro confine; quelle non latine vengono da campiSegreti.js (ETICHETTE_NON_LATINE). ETICHETTA_NUDA
  // vale anche attaccata a un prefisso («login_password»). Le stesse riconoscono i campi dei moduli (campiSegreti.js le
  // prende da ETICHETTE, #1403.19).
  if (!global.SN_URL_EXFIL && typeof require === 'function') require('./urlExfil.js');
  const ALTRE_LINGUE = global.SN_URL_EXFIL && global.SN_URL_EXFIL.PRESENTA ? `|${global.SN_URL_EXFIL.PRESENTA.altreLingue}` : '';
  const NOMI = '(?:password|passwd|passcode|passphrase|parola\\s+d[\'’]ordine|pwd|pswd?'
    + '|chiave\\s+(?:di\\s+)?(?:rete|sicurezza(?:\\s+di\\s+rete)?|wi-?fi|wpa2?|wlan)|(?:wpa[23]?(?:-psk)?|wi-?fi|wlan|network|security)\\s+key'
    + '|codice\\s+(?:di\\s+)?(?:accesso|segreto))\\b';
  // La chiave del wifi come la chiamano i router nelle altre lingue (#1403.19): «Ключ сети», «暗号化キー». Il confine
  // come in urlExfil.js: \b non vede le lettere fuori dall'ASCII.
  const FUORI = `(?![${LETTERE}])`;
  const CHIAVI_DI_RETE = `|(?<![${LETTERE}])(?:`
    + '(?:ключ(?:а|ом|у)?|klucz(?:a|em|u)?)\\s+(?:сети|безопасности(?:\\s+сети)?|шифрования|sieci(?:\\s+bezprzewodowej)?|zabezpiecze[ńn]|wi-?fi|wlan|wpa[23]?(?:-psk)?)'
    + '|сетевой\\s+ключ|(?:netwerk|beveiligings|wpa[23]?(?:-psk)?-?|wi-?fi-?|wlan-?)sleutel'
    + `)${FUORI}|密[钥鑰]|暗号化キー|セキュリティ\\s*キー|ネットワーク\\s*キー|事前共有キー|(?:네트워크\\s*)?보안\\s*키|(?:네트워크|무선|wpa[23]?(?:-psk)?|wi-?fi)\\s*키`;
  // Le parole che dopo «password» ne dicono una proprietà, non il valore: nel testo e nei nomi delle chiavi (tipoDiNome).
  const PROPRIETA_PASSWORD = global.SN_GUARDIANO_STATICO.PROPRIETA_PASSWORD;
  const NON_ETICHETTA = `(?!\\s*(?:(?:${PROPRIETA_PASSWORD})\\b|マネージャ|管理|관리))`;
  const ETICHETTA = `(?:\\b${NOMI}${ALTRE_LINGUE}${CHIAVI_DI_RETE})${NON_ETICHETTA}`;
  const ETICHETTA_NUDA = `(?:${NOMI}${ALTRE_LINGUE}${CHIAVI_DI_RETE})${NON_ETICHETTA}`;
  // Cinese, giapponese e thai non staccano le parole: dove finisce il valore e le parole che lo annunciano senza i due
  // punti le tiene campiSegreti.js.
  if (!global.SN_CAMPI_SEGRETI && typeof require === 'function') require('./campiSegreti.js');
  const NON_LATINI = global.SN_CAMPI_SEGRETI.crea({}, () => false);
  const FINE_VALORE = new RegExp(`[${NON_LATINI.FINE_VALORE}]`);
  // Dopo il verbo attaccato anche i due punti o la virgola («口令是：Mima2024!»): non sono parte del valore.
  const ANNUNCI_NON_LATINI = `(?:${NON_LATINI.ANNUNCI_ATTACCATI})[ \\t]*[:：、，,]?[ \\t]*`;
  const APRE_VALORE = new RegExp(`^[${NON_LATINI.APRE_VALORE}]+`);
  const finoAllaFrase = (v) => v.replace(APRE_VALORE, '').split(FINE_VALORE)[0];
  // Cinese, giapponese e coreano non separano le parole: lì il verbo sta attaccato al nome (ATTACCATO, #1403.6).
  // Le scritture per intervalli, senza \p: col flag u insieme a i ogni passo delle regex delle etichette costa decine di
  // volte di più, e un testo lungo che ripete «암호는» fermava il processo per secondi (#1403.6).
  const CJK = '\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7AF';
  // I nomi sono le etichette non latine di campiSegreti.js che cominciano con una lettera di queste scritture.
  const NOMI_CJK = `(?=[${CJK}])(?:${NON_LATINI.ETICHETTE_NON_LATINE})`;
  // Il polacco «to» solo dopo «hasło»: in inglese «password to …» è una destinazione. Il controllo all'indietro parte
  // solo dopo «to», altrimenti si rifà a ogni passo fra etichetta e valore.
  const VERBO_PASSWORD = `(?:${global.SN_GUARDIANO_STATICO.ANNUNCIO_LARGO}|to(?<=has[łl][a-ząęó]{0,3}[^\\n]{0,40}to))`;
  // La virgola prima del verbo solo per il «c'est» francese: «le mot de passe du wifi, c'est …».
  const VIRGOLA_CEST = ',[ \\t]*(?=c[\'’]est)';
  // «Pass:», «pw:» sono anche altro («Green pass: valido»): contano solo davanti a un valore con la forma di una password.
  const ETICHETTA_CORTA = '\\b(?:pass|pw)\\b';
  // Fra etichetta e valore anche una parentesi («Password del router (admin): x») e un trattino o una freccia
  // circondati da spazi; il valore sotto l'etichetta anche dopo una riga vuota (due paragrafi), ma da solo sulla riga,
  // coi due punti o senza: «Wi-Fi password:» a capo vale quanto «Password:» a capo (#2673.3).
  const PRIMA = '(?:^|[\\n|\\t])[^\\n|\\t:：=.!?;,]{0,30}?';
  // Fra etichetta e separatore niente virgolette, uguali o parentesi di codice: in `"Password" :: #c` o in
  // `password" id="pwd1"` quello che segue è di un altro campo.
  const ACCANTO = '(?:(?!\\s(?:o|e|né|ne|or|and|nor|ma|but)\\s)[^\\n:：|=\\t?!.,;\\[\\]«»"<>{}$]){0,40}?';
  const ACCANTO_LUNGO = '(?:(?!\\s(?:o|e|né|ne|or|and|nor|ma|but)\\s)[^\\n:：|=\\t?!.,;\\[\\]«»"<>{}$]){0,90}?';
  // La freccia scritta a mano («password -> x», «=>») vale il trattino: anche lei dice il valore solo con la sua forma,
  // perché «Account -> Password -> Cambia» è un percorso di menu (#2678.7).
  const FRECCIA = '(?:-{1,2}>|=>|[⇒➔➜])';
  const UNA_FRECCIA = new RegExp(`^(?:${FRECCIA}|[-–—→])$`);
  // Nella cella coi due punti il valore sta nella cella dopo («| Password: | x |»), e vale tutta come dopo la sola barra.
  const ACCANTO_FORTE = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ ]*(${FRECCIA}|[:：=][ \\t]*\\||[:：=|\\t]|[-–—→](?=[ \\t]))[ \\t]*([^\\n|\\t]*)`, 'gid');
  const ACCANTO_DEBOLE = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}(?:(?:[ \\t]+|${VIRGOLA_CEST})${VERBO_PASSWORD}[ \\t]+|${ANNUNCI_NON_LATINI}[ \\t]*)([^\\s|\\[]{4,64})`, 'gi');
  const SOTTO = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ \\t]*[:：=]?[ \\t]*\\n(?:[ \\t]*\\n)?[ \\t]*([^\\s|\\[]{4,64})[ \\t]*(?=\\n|$)`, 'gi');
  // Dentro una frase, senza i due punti («utente mario, password Mela!Verde77»): solo un valore che non può essere una
  // parola, con lettere e cifre o un simbolo da password.
  const QUALIFICA = '(?:[ \\t]+(?:provvisori[ao]|temporane[ao]|iniziale|nuova|attuale|new|temporary|initial|current))?';
  // Anche dopo di cosa è («la password del wifi Mela!Verde77», #2678.7): il complemento non è il valore, quello dopo sì.
  const COMPLEMENTO = `(?:[ \\t]+${global.SN_GUARDIANO_STATICO.COMPLEMENTO})?`;
  const IN_FRASE = new RegExp(`${ETICHETTA}${QUALIFICA}${COMPLEMENTO}[ \\t]+${VIRGOLETTA}([^\\s|\\[${VIRGOLETTE}(),;]{6,64})`, 'gi');
  // Senza spazi il verbo o la particella stanno attaccati al nome («WiFi口令是12345678», «暗証番号はPass2024!です»,
  // «암호는 Pass2024!»), e il valore finisce dove ricomincia la scrittura della frase.
  const ATTACCATO = new RegExp(`(?:${NOMI_CJK})(?:(?:(?:就|也|还|還|都|一直)?(?:是|为|為)|は|が|も|는|은|이|가)[:：、，,]?|[:：=])[ \\t]*[「『“"']?([^\\s${CJK}「」『』“”"'。、，：；！？（）]{4,64})`, 'gu');
  const FORMA_FORTE = (v) => /\p{L}/u.test(v) && (/[0-9]/.test(v) || /[!@#$%^&*+=?~_]/.test(v));
  const INTESTAZIONE = new RegExp(`^${ETICHETTA}[^|\\t]{0,30}$`, 'i');
  // In un CSV l'intestazione è un nome di campo, anche col prefisso delle esportazioni («login_password»): al più una
  // parola in più, perché una frase con le virgole («utente, password e premi invio») non apra una colonna.
  const INTESTAZIONE_CSV = new RegExp(`^(?:[A-Za-z0-9]{1,20}[_.\\s-])?${ETICHETTA_NUDA}(?:[_.\\s-]?[A-Za-z0-9()]{1,20})?$`, 'i');
  const NOMINA_ETICHETTA = new RegExp(ETICHETTA_NUDA, 'i');
  // Le parole che una pagina mette accanto all'etichetta senza che siano la password.
  const NON_VALORE = /^(?:obbligatori[ao]|richiest[ao]|required|optional|facoltativ[ao]|dimenticat[ao]|forgot(?:ten)?|забыл[аио]?|забыт[аоы]?|ξέχασα|نسيت|שכחתי|almeno|minimo|mostra|nascondi|show|hide|non|not|errat[ao]|sbagliat[ao]|incorrect|wrong|invalid[ao]?|nuova|new|attuale|current|conferma|confirm|ripeti|repeat|inserisci|enter|digita|type|scegli|choose|cambia|change|imposta|set|chiedi|chiedila|ask|la|il|lo|una|un|the|an?|your|tu[aoe]|del|della|di|per|for|e|and|o|or|не|нет|неверн(?:ый|ая|о)|неправильн(?:ый|ая|о)|обязательн(?:ый|ая|о)|изменён|изменен|скрыт|нов(?:ый|ая)|текущ(?:ий|ая)|введите|подтвердите|λάθος|λανθασμένος|υποχρεωτικός|νέος|错误|錯誤|不正确|不正確|必填|已修改|已更改|必須|필수)$/i;

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
      // Un nome composto di password («?login_password=», «?password_login=») vale come nelle chiavi di configurazione.
      const composto = !NOME_SEGRETO.test(nome) && tipoDiNome(nome) === 'password' && valoreDiChiave(m[2]);
      if ((NOME_SEGRETO.test(nome) || composto) && valoreSegreto(composto ? 'password' : nome, m[2])) out.push({ valore: m[2], regola: 'token' });
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

  // Un indirizzo con la codifica percentuale («?q=la%20password%20%C3%A8%20Mela!Verde77») dice al modello quello che dice
  // decodificato, con le regole del controllo in uscita (urlExfil.js: giri e «+»): ogni pezzo fra «/ ? # & ; =» si legge
  // anche decodificato, ognuno per conto suo, e dal testo si toglie la sua forma codificata (#1403.74).
  // Un pezzo alla volta: messi in fila, «q» e «password» di «?q=…&oq=password» farebbero un'etichetta col suo valore.
  function codificatiNellIndirizzo(url, inizioUrl, out, giro) {
    if (!global.SN_URL_EXFIL && typeof require === 'function') require('./urlExfil.js');
    const U = global.SN_URL_EXFIL;
    if (!U || !U.giroDiDecodifica || giro >= U.GIRI_DI_DECODIFICA || !/%[0-9A-Fa-f]{2}|\+/.test(url)) return;
    const host = (url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i) || [''])[0].length;
    for (const m of url.slice(host).matchAll(/[^/?#&;=]+/g)) {
      const pezzo = host + m.index;
      let t = m[0];
      let inizi = Array.from({ length: t.length }, (_, i) => i);
      let fini = inizi.map((i) => i + 1);
      for (let livello = 0; livello < U.GIRI_DI_DECODIFICA; livello++) {
        const d = U.giroDiDecodifica(t);
        if (d.testo === t) break;
        const soloLettere = soloLettereAccentate(t, d);
        inizi = d.da.map((i) => inizi[i]);
        fini = d.a.map((j) => fini[j - 1]);
        t = d.testo;
        if (soloLettere) break;
        for (const x of trova(t, { giro: giro + 1 })) {
          const v = String(x.valore);
          const posti = Number.isInteger(x.inizio) && t.startsWith(v, x.inizio) ? [{ k: x.inizio, n: v.length }] : [];
          if (!posti.length) for (let k = t.indexOf(v); k >= 0; k = t.indexOf(v, k + 1)) posti.push({ k, n: v.length });
          // Una carta trovata torna senza spazi né trattini: si cerca com'è scritta (formaDelValore).
          if (!posti.length) for (const f of t.matchAll(new RegExp(formaDelValore(v), 'gu'))) posti.push({ k: f.index, n: f[0].length });
          if (!posti.length) out.push({ valore: v, regola: x.regola });
          for (const { k, n } of posti) {
            const da = pezzo + inizi[k];
            const a = pezzo + fini[k + n - 1];
            out.push({ valore: url.slice(da, a), regola: x.regola, ...(Number.isInteger(x.inizio) ? { inizio: inizioUrl + da } : {}) });
          }
        }
      }
    }
  }

  // Un pezzo che decodificato è una parola sola e ha solo lettere latine accentate al posto dei «%xx» («Citt%C3%A0»)
  // non dice niente di nuovo: senza separatori non c'è etichetta, e chiavi e carte sono ASCII (a parte una sequenza
  // lunga con una cifra, che la lettera attaccata può staccare). Saltarlo tiene veloci le pagine piene di collegamenti.
  function soloLettereAccentate(prima, d) {
    const testo = d.testo;
    if (!/^[\p{L}\p{M}\p{N}_.~'’-]+$/u.test(testo)) return false;
    if ((testo.match(/[A-Za-z0-9]{12,}/g) || []).some((r) => /\d/.test(r))) return false;
    for (let j = 0; j < testo.length; j++) {
      if (d.a[j] - d.da[j] === 1 && prima[d.da[j]] !== '+') continue;
      if (testo.charCodeAt(j) < 0x80 || !/\p{Script=Latin}/u.test(testo[j])) return false;
    }
    return true;
  }

  // Come si cerca un valore trovato: una carta, che torna di sole cifre, anche spezzata da spazi o trattini.
  function formaDelValore(v) {
    return /^\d{12,19}$/.test(v) ? v.split('').map(escRe).join('[ -]?') : escRe(v);
  }

  const TESTA_VALORE = new RegExp(`^[${APERTE}(]+`);
  const CODA_VALORE = new RegExp(`[.,;:)${CHIUSE}]+$`);
  function valorePassword(grezzo, { forma = false } = {}) {
    const v = finoAllaFrase(testo(grezzo).trim().replace(TESTA_VALORE, '')).replace(CODA_VALORE, '');
    if (v.length < 3 || v.startsWith('[') || NON_VALORE.test(v.split(/\s/)[0]) || CODICE_SORGENTE.test(v) || NOME_DI_TIPO.test(v)) return '';
    if (forma && SENZA_FORMA(v)) return '';
    return v;
  }

  // Una parola senza cifre, simboli né maiuscole in mezzo («Telefono», «Attiva») può essere la password solo dove sta:
  // altrove nella pagina è una parola, e il segnaposto si mette solo lì (vedi oscura). `inizio`: dove sta nel testo.
  const SENZA_FORMA = (v) => !(/[0-9]/.test(v) || /[^\p{L}]/u.test(v) || /\p{Ll}\p{Lu}/u.test(v));
  function alPosto(v, inizioGrezzo, grezzo) {
    const k = testo(grezzo).indexOf(v);
    return k >= 0 ? { valore: v, regola: 'password', inizio: inizioGrezzo + k } : { valore: v, regola: 'password' };
  }

  // Un'espressione di codice («form.password.value», «process.env.DB_PASSWORD», «input(», «getpass.getpass()») sta al
  // posto di un valore ma non lo è; così il nome di un tipo («password: str», «password: string»).
  const CODICE_SORGENTE = /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(\))?|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(.*)$/;
  const NOME_DI_TIPO = /^(?:str|string|int|integer|bool|boolean|number|bytes|any|object|char|varchar|text|unknown|void)(?:\[\])?$/i;
  // Un indirizzo o un'email sotto «Reset your password:» ha la forma di una password ma è il link per cambiarla.
  const INDIRIZZO_O_EMAIL = global.SN_GUARDIANO_STATICO.indirizzoOEmail;
  function formaVicina(pezzo) {
    const v = finoAllaFrase(pezzo.replace(/^[:=\-–—→«"'“‘(\[]+/, '')).replace(/[.,;:!?)»"'”’\]]+$/, '');
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
  const AL_POSTO = new RegExp(`${ETICHETTA}${ACCANTO}[ \\t]*[:：=][ \\t]*([^\\s|\\t\\[(]{3,64})([^\\n|\\t]*)`, 'gid');
  const DOPO = `[ \\t]*(?:${FRECCIA}|[:：=|\\t]|[-–—→](?=[ \\t])|(?:[ \\t]|${VIRGOLA_CEST})${VERBO_PASSWORD}(?=[ \\t])|${ANNUNCI_NON_LATINI})[ \\t]*([^\\s|\\t]{6,70})`;
  const DOPO_LUNGO = new RegExp(`${ETICHETTA}${ACCANTO_LUNGO}${DOPO}`, 'gi');
  const DOPO_CORTA = new RegExp(`${ETICHETTA_CORTA}${ACCANTO}[ \\t]*[:=][ \\t]*([^\\s|\\t]{6,70})`, 'gi');
  const DA_SOLA = /^[.,;!]?[ \t]*(?:$|\(|[^\s:]{1,30}:(?:\s|$)|[·•–—-]\s)/;
  // Una nota fra parentesi o quadre o un'emoji (anche una faccina scritta) dopo il valore non è del valore: «Password: casa
  // mia al mare (tutto minuscolo).», «Password: tramonto 😊 grazie» (#2678.13). Una sola regola per la parola e per la
  // frase. Dopo la nota la riga può continuare solo dopo un segno o dopo un'emoji: in «casa (mia) al mare» è la password.
  const EMOJI = '(?:[\\p{Extended_Pictographic}\\p{Regional_Indicator}][\\p{Emoji_Modifier}\\u{FE0F}\\u{20E3}]*(?:\\u{200D}\\p{Extended_Pictographic}[\\p{Emoji_Modifier}\\u{FE0F}]*)*|[0-9#*]\\u{FE0F}?\\u{20E3}|[:;=]-?[)(DPp]|<3)';
  const NOTA = `(?:[ \\t]*(?:\\([^()\\n]{0,80}\\)|\\[[^\\[\\]\\n]{0,80}\\])|[ \\t]+${EMOJI}+)`;
  const NOTA_IN_FONDO = new RegExp(`(?<![ \\t])(?:${NOTA}*[ \\t]+${EMOJI}+(?:[ \\t][^\\n]*)?|${NOTA}+)(?:[ \\t]*[.!?;,…–—-]+(?:[ \\t][^\\n]*)?)?[ \\t]*$`, 'u');
  // Solo la coda: su una riga lunga piena di emoji o parentesi la ricerca da ogni punto diventerebbe quadratica.
  const senzaNota = (resto) => {
    const k = Math.max(0, resto.length - 200);
    return resto.slice(0, k) + resto.slice(k).replace(NOTA_IN_FONDO, '');
  };
  const SOLO_ETICHETTA = new RegExp(`^[ \\t]*${ETICHETTA}${ACCANTO}[ \\t]*[:：=]?[ \\t]*$`, 'i');
  const TESTA_ETICHETTA = new RegExp(`^[ \\t]*${ETICHETTA}`, 'i');
  function alPostoDelValore(s, out) {
    const righe = s.split('\n');
    const forma = (pezzo) => { const v = formaVicina(pezzo); if (v) out.push({ valore: v, regola: 'password' }); };
    const inizi = [];
    for (let i = 0, o = 0; i < righe.length; o += righe[i].length + 1, i++) inizi.push(o);
    for (let i = 0; i < righe.length; i++) {
      for (const m of righe[i].matchAll(AL_POSTO)) {
        // Una parentesi attaccata («password = input(…)») è una chiamata nel codice, non una nota dopo il valore.
        if (!DA_SOLA.test(senzaNota(m[2])) || m[2].startsWith('(')) continue;
        const v = valorePassword(m[1]);
        if (v) out.push(alPosto(v, inizi[i] + m.indices[1][0], m[1]));
      }
      for (const re of [DOPO_LUNGO, DOPO_CORTA]) for (const m of righe[i].matchAll(re)) forma(m[1]);
      if (!SOLO_ETICHETTA.test(righe[i])) continue;
      const { riga, j, saltate } = rigaSotto(righe, i);
      const sotto = riga.trim().split(/\s+/);
      // Oltre i bottoni o i puntini (la password mostrata coperta) la riga dopo è spesso un altro campo («Telefono»):
      // lì conta solo la forma di una password, anche coi puntini o il bottone sulla riga dell'etichetta.
      const accanto = righe[i].replace(TESTA_ETICHETTA, '').replace(/[:：]/g, '');
      if (sotto.length === 1 && !saltate && !(accanto.trim() && SOLO_BOTTONI.test(accanto))) {
        const v = valorePassword(sotto[0]);
        if (v) out.push(alPosto(v, inizi[j], riga));
      } else forma(sotto[0]);
    }
  }

  // Una frase di più parole dopo i due punti, da sola sulla riga e con l'etichetta in testa («Password: casa mia al mare
  // 2019»): la password con gli spazi, quante che siano le parole (#2678.5). Toglierla toglie solo quella frase, mai una
  // parola sola altrove. Una frase che comincia come una spiegazione («disponibile alla reception», «sul retro del
  // modem», «vedi email»), anche dopo un articolo («la stessa di prima»), o che misura la password («min. 8 caratteri»)
  // dice dove trovarla o come sceglierla, e resta. Il tetto in caratteri tiene fuori un paragrafo intero.
  const FRASE_DOPO = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ \\t]*[:：=][ \\t]*([^\\n|\\t]{3,160}?)[ \\t]*(?=\\n|$)`, 'gi');
  const INIZIO_SPIEGAZIONE = /^(?:a|al|allo|alla|ai|agli|alle|da|dal|dallo|dalla|dai|dagli|dalle|in|nel|nello|nella|nei|negli|nelle|su|sul|sullo|sulla|sui|sugli|sulle|presso|tra|fra|con|senza|dentro|sotto|sopra|dietro|at|on|from|under|behind|inside|with|see|ask|check|contact|available|provided|sent|printed|same|vedi|vedere|guarda|chiedere|richiedi|richiedila|contatta|rivolgiti|disponibile|disponibili|fornita|fornito|inviata|inviato|stampata|scritta|indicata|riportata|deve|devono|può|must|should|can|minimo|min|massimo|max|stessa|stesso|quella|quello|uguale|identica|come|vuota|nessuna|nessuno|scegli|sceglila|usa|use|cambiata|cambiato|modificata|modificato|aggiornata|aggiornato|scaduta|scaduto|scade|scadrà|changed|updated|expired|expires|не|нет|должен|должна|должно|см|смотрите|спросите|минимум|максимум|от|из|на|в|у|при|без|πρέπει|δείτε)$/i;
  const MISURA = /^(?:caratter[ei]|characters?|chars?|cifre|digits?|lettere|letters?|simboli|symbols?|символ(?:а|ов)?|знак(?:а|ов)?|цифр(?:а|ы)?|букв(?:а|ы)?|χαρακτήρες)[.,;:]?$/i;
  // Quando è cambiata o scade («12 mar 2024», «2 mesi fa», «tra 30 giorni»): la data di una password non è la password.
  const TEMPO = /^(?:gen(?:naio)?|feb(?:braio)?|mar(?:zo)?|apr(?:ile)?|mag(?:gio)?|giu(?:gno)?|lug(?:lio)?|ago(?:sto)?|set(?:tembre)?|ott(?:obre)?|nov(?:embre)?|dic(?:embre)?|jan(?:uary)?|february|march|april|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|dec(?:ember)?|fa|ago|giorn[oi]|settiman[ae]|mes[ei]|ann[oi]|or[ae]|minut[oi]|days?|weeks?|months?|years?|hours?|minutes?|ieri|oggi|yesterday|today)[.,;:]?$/i;
  // Misura o data solo se, oltre al numero e alla parola di tempo o di misura, ogni parola parla della password
  // («bloccata per 30 minuti», «la devo cambiare tra due giorni», «between 8 and 64 characters»): una parola d'altro
  // («tre anni al mare», «ci vediamo tra due giorni», «il mio cane ha tre anni») la fa frase-password (#2678.14).
  const NUMERO = /^(?:\d+(?:[.,:/-]\d+)*(?:°|º|st|nd|rd|th|gg|\+)?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|quindici|venti|trenta|sessanta|novanta|two|three|four|five|six|seven|eight|nine|ten|twelve|sixteen|twenty|thirty|sixty|ninety)$/i;
  const DELLA_PASSWORD = /^(?:scad\w*|cambi\w*|modific\w*|aggiorn\w*|rinnov\w*|impost\w*|reimpost\w*|resett\w*|blocc\w*|sblocc\w*|creat[aoie]|generat[aoie]|ricevut[aoie]|inviat[aoie]|mandat[aoie]|mand[aoi]|manderò|invio|invierò|dico|dirò|diciamo|chied\w*|serv[eo]|servono|dur[ao]|durano|durata|val[eo]|valgono|valid\w*|lung[aoh]\w*|cort[ao]|dev[eio]|devono|dovrà|avere|essere|è|sono|sarà|ha|ho|hai|ultim[aoie]|nuov[aoie]|vecchi[aoe]|quell[aoie]|solit[aoie]|stess[aoie]|sempre|ancora|già|almeno|circa|minimo|massimo|min|max|oltre|meno|più|fino|entro|ogni|tra|fra|da|dal|dalla|dai|dopo|prima|per|di|del|della|il|lo|la|le|gli|l|me|te|ti|mi|ve|si|ne|non|attiv[ao]|scors[ao]|prossim[aoie]|lavorativi|esatti|password|parola|chiave|codice|pin|expir\w*|chang\w*|updat\w*|modif\w*|reset\w*|creat\w*|set|renew\w*|lock\w*|unlock\w*|block\w*|valid|lasts?|long|short|must|should|needs?|required|have|has|be|been|is|are|it|will|you|i|we|send|sent|tell|told|ask\w*|in|within|every|at|least|most|minimum|maximum|between|up|ago|last|next|since|from|on|for|after|before|of|new|old|same|than|less|only|about|around|over|lunghezza|validità|scadenza|aggiornamento|o|or|e|and|a|to|-|–)$/i;
  const misuraODate = (parole) => {
    const p = parole.flatMap((x) => x.replace(/[.,;:!]+$/, '').split(/['’]/)).filter(Boolean);
    return p.some((x) => NUMERO.test(x)) && p.some((x) => MISURA.test(x) || TEMPO.test(x))
      && p.every((x) => NUMERO.test(x) || MISURA.test(x) || TEMPO.test(x) || ARTICOLO.test(x) || DELLA_PASSWORD.test(x));
  };
  // «da tre anni vivo a Milano», «tra due giorni parto»: la preposizione col numero dopo apre un tempo, e decide la frase.
  const APRE_TEMPO = /^(?:da|dal|dai|dalle|tra|fra|in|entro|dopo|for|within|since|after)$/i;
  const ARTICOLO = /^(?:la|il|lo|i|le|gli|una?|the|an?|el|der|die|das|de|het)$/i;
  // Davanti a un verbo «la», «lo», «le» sono un pronome, e la frase dice dove trovarla: «Password: la trovi sul modem».
  const DOPO_PRONOME = /^(?:trov[aio]|trovate|troverai|troverete|ricevi|riceve|ricevete|riceverai|riceverete|mando|mandiamo|manderò|manderemo|invio|inviamo|invierò|invieremo|chiedi|chiedete|sai|sa|sanno|conosci|conosce|ha|hai|hanno|abbiamo|avete|cambi|cambia|cambierai|scegli|sceglierai|imposti|imposterai|scrivo|scriverò|dico|dirò|diamo|daremo|do|darò|one|ones)$/i;
  // La prima parola che conta: un articolo in testa non dice niente («Password: la casa al mare», #2678.5).
  const spiegazione = (parole) => {
    const p = parole.map((x) => x.replace(/[.,;:]+$/, ''));
    const articolo = ARTICOLO.test(p[0]) && p.length > 1;
    const prima = articolo ? p[1] : p[0];
    if (APRE_TEMPO.test(prima) && NUMERO.test(p[articolo ? 2 : 1] || '')) return misuraODate(parole);
    return NON_VALORE.test(prima) || INIZIO_SPIEGAZIONE.test(prima) || (articolo && DOPO_PRONOME.test(prima)) || misuraODate(parole);
  };
  // Nelle parole anche i simboli di una password («la casa al mare 77!»), non il punto di domanda di una frase.
  const PAROLA_DI_FRASE = /^[\p{L}\p{N}'’!@#$%^&*+=~_-]+[.,;:]?$/u;
  function fraseDopo(s, out) {
    for (const m of s.matchAll(FRASE_DOPO)) {
      // Le virgolette intorno alla frase («Password: «casa mia al mare»») non sono della password (#1403.27).
      const tutta = senzaNota(` ${m[1]}`).trim();
      const q = tutta.match(SOLO_FRA_VIRGOLETTE);
      const v = q ? q[3] : tutta;
      const parole = v.split(/\s+/);
      if (FINE_VALORE.test(v) || parole.length < 2 || parole.some((p) => !PAROLA_DI_FRASE.test(p)) || v.startsWith('[') || formaVicina(parole[0])) continue;
      if (spiegazione(parole)) continue;
      out.push({ valore: v.replace(/[.,;:]+$/, ''), regola: 'password' });
    }
  }

  // Fra virgolette il valore finisce alla virgoletta che chiude, qualunque cosa segua e con gli spazi dentro (#2678):
  // «la password è « Mela!Verde77 »». Niente filtri sulla prima parola né sulla lunghezza: «“la casa al mare”». Dopo i
  // due punti o il verbo è il valore salvo che la descriva («la stessa di prima», «vedi email»); senza nessuno dei due
  // più parole contano solo con la forma di una password, perché lì sono spesso una voce («password «Gestisci account»»).
  const FRA_VIRGOLETTE = `[ \\t]*(?:[${DOPPIE}](?<d>[^\\n|\\t${DOPPIE}]{1,2000})[${DOPPIE}]|[${SINGOLE}](?<s>[^\\n|\\t${SINGOLE}]{1,2000})[${SINGOLE}])`;
  const VIRGOLETTATO_DOPO = new RegExp(`${ETICHETTA}${ACCANTO}(?:[ \\t]*(?<sep>${FRECCIA}|[:=])|[ \\t]+${VERBO_PASSWORD})${FRA_VIRGOLETTE}`, 'gid');
  const VIRGOLETTATO_IN_FRASE = new RegExp(`${ETICHETTA}${QUALIFICA}${COMPLEMENTO}[ \\t]${FRA_VIRGOLETTE}`, 'gid');
  // Gli altri ponti fra il nome e il valore (#1403.67): chi l'ha messa («come password ho messo «…»»), e la risposta
  // dopo la domanda o dopo il cambio, staccata da un segno («Ti ricordi la password? Era «…»», «l'ho cambiata, ora è
  // «…»»): dopo il segno solo parole che non aprono un altro discorso, poi l'annuncio, e dopo il valore la frase finisce
  // («It's "easy" to reset» resta).
  const RIEMPI = "(?:ora|adesso|invece|now|mi[ \\t]+pare|mi[ \\t]+sembra|credo|penso|forse|i[ \\t]+think|maybe|it|that|this|s[iì],?|yes,?|beh,?|well,?|allora)";
  const RISPOSTA = `[ \\t]*(?:\\?+|[:.,;!])[ \\t]*(?:${RIEMPI}[ \\t]+){0,2}(?:it['’]s|${global.SN_GUARDIANO_STATICO.ANNUNCIO_LARGO})(?:[ \\t]*:)?`;
  const FINE_RISPOSTA = `(?=[ \\t]*(?:$|[\\n.,;:!?)]|(?:e|ed|ma|and|but|or|o)[ \\t]))`;
  const MESSA = "[ \\t]+(?:ho|hai|ha|abbiamo|avete|hanno|l['’](?:ho|hai|ha|abbiamo)|i(?:['’]ve)?|we)[ \\t]+(?:mess[ao]|scelt[ao]|usat[ao]|set|chose|picked|used|put)";
  const VIRGOLETTATO_MESSA = new RegExp(`${ETICHETTA}${ACCANTO}${MESSA}${FRA_VIRGOLETTE}`, 'gid');
  const VIRGOLETTATO_RISPOSTA = new RegExp(`${ETICHETTA}${ACCANTO}${RISPOSTA}${FRA_VIRGOLETTE}${FINE_RISPOSTA}`, 'gid');
  // Il nome fra virgolette di cosa protegge («la password di «Netflix» è «…»») non è il valore: il valore è quello dopo.
  const VIRGOLETTATO_DI = new RegExp(`${ETICHETTA}${ACCANTO}(?:[ \\t]+(?:di|del|della|dello|per|for|of|on|su|sul)|[ \\t]+dell['’][A-Za-zÀ-ÿ]*)(?:[ \\t]+[A-Za-zÀ-ÿ]+)?${FRA_VIRGOLETTE}`, 'gid');
  // Dopo la sola domanda («Ti ricordi la password? «…»») conta la forma della password, come senza verbo.
  const VIRGOLETTATO_DOMANDA = new RegExp(`${ETICHETTA}${ACCANTO}[ \\t]*\\?+${FRA_VIRGOLETTE}`, 'gid');
  const RISPOSTA_NUDA = new RegExp(`${ETICHETTA}${ACCANTO}${RISPOSTA}[ \\t]+([^\\s|\\[]{6,64})`, 'gi');
  // Dopo una password fra virgolette, nella stessa frase, la seconda che le si lega con un annuncio o una preposizione
  // («da «…» a «…»», «era «…», l'ho cambiata in «…»», «la vecchia era «…» e la nuova è «…»»). Un altro campo nominato
  // in mezzo («e il nome utente è «…»») non è la password.
  const LEGAME = `(?:[^\\n.!?:;${DOPPIE}'‘’]|(?<=[A-Za-zÀ-ÿ])['’](?=[A-Za-zÀ-ÿ]))`;
  const SEGUITO = new RegExp(`[ \\t]*,?(?<gap>${LEGAME}{0,50}?[ \\t])?(?:${global.SN_GUARDIANO_STATICO.ANNUNCIO_LARGO}|(?<prep>in|a|to|into|con|with))${FRA_VIRGOLETTE}`, 'yid');
  const SEGUITO_NUDO = /[ \t]+(?:a|to|in|into|con|with)[ \t]+([^\s|[]{6,64})/y;
  const ALTRO_CAMPO = /(?<![A-Za-zÀ-ÿ])(?:utente|username|user|nome|name|e-?mail|mail|login|account|indirizzo|address|server|ssid|rete|network|telefono|phone|numero|number)(?![A-Za-zÀ-ÿ])/i;
  const DESCRIVE = /^(?:stess[aoie]|quell[aoie]|ugual[ei]|identic[aoie]|vedi|vedere|guarda|same|see|disponibil[ei]|available|scritt[ao]|indicat[ao]|riportat[ao]|fornit[ao]|inviat[ao]|stampat[ao]|vuot[ao]|nessun[ao]?|deve|devono|può|must|should|almeno|minimo|min|massimo|max)$/i;
  const descrive = (parole) => {
    const p = parole.map((x) => x.replace(/[.,;:]+$/, ''));
    const i = ARTICOLO.test(p[0]) && p.length > 1 ? 1 : 0;
    return DESCRIVE.test(p[i]) || misuraODate(p);
  };
  function fraVirgolette(s, out) {
    const prendi = (m, separato) => {
      const k = m.groups.d !== undefined ? 'd' : 's';
      const v = m.groups[k].trim();
      if (!v || v.startsWith('[') || v.includes(SEGNAPOSTO)) return false;
      const parole = v.split(/\s+/);
      if (parole.length > 1) {
        if (!(separato ? !descrive(parole) : FORMA_FORTE(v))) return false;
        out.push({ valore: v, regola: 'password' });
        return true;
      }
      const p = valorePassword(v);
      if (!p || !(separato || FORMA_FORTE(p))) return false;
      out.push(alPosto(p, m.indices.groups[k][0], m.groups[k]));
      return true;
    };
    const fini = [];
    for (const re of [VIRGOLETTATO_DOPO, VIRGOLETTATO_IN_FRASE, VIRGOLETTATO_MESSA, VIRGOLETTATO_RISPOSTA, VIRGOLETTATO_DOMANDA]) {
      for (const m of s.matchAll(re)) {
        const separato = (re === VIRGOLETTATO_DOPO && !UNA_FRECCIA.test(m.groups.sep || '')) || re === VIRGOLETTATO_MESSA || re === VIRGOLETTATO_RISPOSTA;
        if (prendi(m, separato)) fini.push(m.index + m[0].length);
      }
    }
    for (const m of s.matchAll(VIRGOLETTATO_DI)) fini.push(m.index + m[0].length);
    for (let fine of fini) {
      for (let giri = 0; giri < 8; giri++) {
        SEGUITO.lastIndex = fine;
        const m = SEGUITO.exec(s);
        // Una preposizione da sola lega solo attaccata («da «…» a «…»»): «a «Netflix» e a «Spotify»» sono due siti.
        const gap = m && (m.groups.gap || '').trim();
        if (!m || (gap && (m.groups.prep || ALTRO_CAMPO.test(gap))) || !prendi(m, true)) break;
        fine = m.index + m[0].length;
      }
    }
    for (const m of s.matchAll(RISPOSTA_NUDA)) {
      const v = formaVicina(m[1]);
      if (v) out.push({ valore: v, regola: 'password' });
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
  // Dopo la parola password il nome dice di quale si tratta («password_login», «PASSWORD_DB», «password2»), a meno che
  // una parola dopo ne descriva una proprietà («password_label», «password_reset_timeout», «password_min_length», #2695.2).
  // «pass» è anche altro («pass_rate», «pass_count»): dopo di lui solo una conferma o un indice dicono la password.
  const DESCRIVE_PASSWORD = new RegExp(`^(?:${PROPRIETA_PASSWORD}|label|rules?|policies|score|complexity|requirements?|length|len`
    + '|min|max|minimum|maximum|chars|characters|expir\\w*|age|lifetime|ttl|timeouts?|interval|rotation|history|changed'
    + '|updated|created|last|attempts|retries|lock\\w*|hash\\w*|salt|algorithm|algo|rounds|cost|iterations|encoder'
    + '|validat\\w*|check|regexp?|pattern|format|field|input|column|selector|id|placeholder|text|title|prompt|message|msg'
    + '|help|tooltip|description|desc|errors?|invalid|mismatch|required|enabled|disabled|visible|hidden|show|hide|toggle'
    + '|protected|file|path|env|var|url|uri|link|page|form|button|icon|style|mode|type|authentication)$');
  const DOPO_PASS = /^(?:\d+|confirm\w*|again|repeat|new|old|current|plain\w*|clear|raw|value)$/;
  function tipoDiNome(nome) {
    const parti = nome.split(/[_.:\s-]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((p) => p.toLowerCase());
    const pw = parti.findIndex((p) => PAROLA_CHIAVE.test(p.replace(/\d+$/, '')) || /(?:password|passwd|passphrase)\d*$/.test(p));
    const dopo = parti.slice(pw + 1);
    if (pw >= 0 && (/^pass\d*$/.test(parti[pw]) ? dopo.every((p) => DOPO_PASS.test(p)) : !dopo.some((p) => DESCRIVE_PASSWORD.test(p)))) return 'password';
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
    if (!v || v.length < 12 || /\s/.test(v) || INDIRIZZO_O_EMAIL(v)) return '';
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

  // I due punti e l'uguale a tutta larghezza («口令：…», «암호＝…») valgono i nostri: le regole leggono una copia
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
  // Una cella che descrive la password non è il valore, come la stessa riga fuori dalla tabella: lo dice l'etichetta, una
  // sua proprietà («| Scadenza password: | 90 giorni |»), o la cella che comincia come una spiegazione («vedi sotto»).
  const PROPRIETA = /(?:^|[^\p{L}])(?:scadenza|lunghezza|recupero|requisit[io]|reimpostazione|cambio|robustezza|complessit[aà]|durata|validit[aà]|formato|regol[ae]|politica|criteri|suggeriment[oi]|expiry|expiration|length|requirements?|rules?|dimenticat[ao]|smarrit[ao]|scadut[ao]|forgotten|expired)(?![\p{L}])/iu;
  function cellaCheSpiega(etichetta, cella) {
    if (PROPRIETA.test(etichetta)) return true;
    const parole = testo(cella).trim().split(/\s+/).filter(Boolean).map((x) => x.replace(/[.,;:]+$/, ''));
    if (parole.length && DESCRIVE.test(parole[0])) return true;
    if (parole.length < 2) return false;
    return INIZIO_SPIEGAZIONE.test(parole[0]) || /^(?:(?:cambiat|modificat|aggiornat|scadut|reimpostat|resettat)[aoie]|scad(?:e|ono)|clicca|premi|click)$/i.test(parole[0])
      || (parole.some((x) => /\d/.test(x)) && parole.some((x) => MISURA.test(x) || TEMPO.test(x)));
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
      if (m[1] === ':' || m[1] === '：' || m[1] === '=') {
        const pezzi = m[2].trim().split(/\s+/);
        v = MISURA.test(pezzi[1] || '') ? '' : valorePassword(pezzi[0], { forma: pezzi.length > 1 });
      } else if (UNA_FRECCIA.test(m[1])) v = valorePassword(m[2].trim().split(/\s+/)[0], { forma: true });
      else if (!cellaCheSpiega(m[0].slice(0, m.indices[1][0] - m.index), m[2])) v = valorePassword(m[2]);
      if (v) out.push(alPosto(v, m.indices[2][0], m[2]));
    }
    for (const re of [ACCANTO_DEBOLE, SOTTO]) {
      for (const m of s.matchAll(re)) {
        const v = valorePassword(m[1], { forma: true });
        if (!v || INDIRIZZO_O_EMAIL(v)) continue;
        out.push({ valore: v, regola: 'password' });
        // «da Gatto1 a Mela!Verde77»: la nuova subito dopo la vecchia, con la sua forma.
        SEGUITO_NUDO.lastIndex = m.index + m[0].length;
        const dopo = re === ACCANTO_DEBOLE && SEGUITO_NUDO.exec(s);
        const n = dopo && formaVicina(dopo[1]);
        if (n) out.push({ valore: n, regola: 'password' });
      }
    }
    for (const m of s.matchAll(IN_FRASE)) {
      const v = valorePassword(m[1].replace(/[?!.,;:]+$/, ''));
      if (v && FORMA_FORTE(v)) out.push({ valore: v, regola: 'password' });
    }
    for (const m of s.matchAll(ATTACCATO)) {
      const v = valorePassword(m[1], { forma: true });
      if (v) out.push({ valore: v, regola: 'password' });
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

  // Fra virgolette con lo spazio dentro il valore si legge come senza spazi: gli spazi passano fuori, e la lunghezza
  // resta, così ogni posto trovato vale anche nel testo vero (#1403.11). La regex la definisce urlExfil.js.
  const Q = `${VIRGOLETTE}‚‹›「」『』`;
  const CON_SPAZI_DENTRO = new RegExp(global.SN_URL_EXFIL.VIRGOLETTE.fra, 'gu');
  const SOLO_FRA_VIRGOLETTE = new RegExp(`^(?:${global.SN_URL_EXFIL.VIRGOLETTE.fra})$`, 'u');
  const HA_VIRGOLETTE = new RegExp(`[${Q}]`, 'u');
  const TESTA_VIRGOLETTE = new RegExp(`^[${Q}]+`, 'u');
  const CODA_VIRGOLETTE = new RegExp(`[${Q}]+$`, 'u');
  const spazi = (w) => ' '.repeat(w.length);
  const virgoletteStrette = (s) => (HA_VIRGOLETTE.test(s)
    ? s.replace(CON_SPAZI_DENTRO, (_, a, w1, v, w2, c) => `${spazi(w1)}${a}${v}${c}${spazi(w2)}`) : s);
  // Un valore preso con le virgolette attaccate («»Mela!Verde77«») nel testo vero le ha staccate: si cerca senza.
  // Uno con dentro un avverbio letto come spazi («Password: casa è ancora mia») si riprende allo stesso posto.
  function nelTestoVero(x, vero, letto) {
    const v = String(x.valore);
    if (vero.includes(v)) return x;
    const k = /\s{2}/.test(v) && letto ? letto.indexOf(v) : -1;
    if (k >= 0 && letto.length === vero.length) return { ...x, valore: vero.slice(k, k + v.length) };
    const testa = (v.match(TESTA_VIRGOLETTE) || [''])[0].length;
    const y = { ...x, valore: v.slice(testa).replace(CODA_VIRGOLETTE, '') };
    if (Number.isInteger(x.inizio)) y.inizio = x.inizio + testa;
    return y;
  }

  // Le virgolette dicono dove finisce una password con gli spazi («ciao, la password è «Mela! Verde77»»): al posto del
  // valore (dopo l'etichetta e i due punti o il verbo), o con un valore trovato in testa o in coda, vale tutto quello che
  // sta fra loro (#1403.27). Una frase citata che nomina la password, o che spiega come sceglierla, resta.
  // Per il pavimento e per il correttore (correttoreRiservati.js); `valori`: stringhe o `{ valore, regola }`.
  const PAROLE_FRA_VIRGOLETTE = 8;
  const NOMINA_CORTA = new RegExp(ETICHETTA_CORTA, 'i');
  const PRIMA_DELLE_VIRGOLETTE = new RegExp(`${ETICHETTA}${ACCANTO}(?:[ \\t]*[:=]|[ \\t]+${VERBO_PASSWORD})[ \\t]*$`, 'i');
  // Senza due punti né verbo le parole fra virgolette sono spesso una voce («password «Gestisci account»», #2678).
  const PRIMA_DELLE_VIRGOLETTE_NUDA = new RegExp(`${ETICHETTA}${QUALIFICA}${COMPLEMENTO}(?:[ \\t]*${FRECCIA})?[ \\t]*$`, 'i');
  const PRIMA_DELLE_VIRGOLETTE_CORTA = new RegExp(`${ETICHETTA_CORTA}[ \\t]*[:=]?[ \\t]*$`, 'i');
  function interiFraVirgolette(vero, valori) {
    const s = testo(vero);
    const nudo = (v) => String(v).replace(TESTA_VIRGOLETTE, '').replace(CODA_VIRGOLETTE, '').toLowerCase();
    const presi = new Set((valori || []).filter((x) => typeof x === 'string' || (x && (!x.regola || x.regola === 'password')))
      .map((x) => nudo(typeof x === 'string' ? x : x.valore)).filter((v) => v.length >= 3));
    const out = [];
    if (!HA_VIRGOLETTE.test(s)) return out;
    const bordo = (p) => presi.has(nudo(p)) || presi.has(nudo(p).replace(/[.,;:!?]+$/, ''));
    for (const m of s.matchAll(CON_SPAZI_DENTRO)) {
      const v = m[3];
      const parole = v.split(/\s+/);
      if (parole.length < 2 || parole.length > PAROLE_FRA_VIRGOLETTE || NOMINA_ETICHETTA.test(v) || NOMINA_CORTA.test(v)) continue;
      const prima = s.slice(Math.max(0, m.index - 120), m.index).split('\n').pop();
      const alPostoDelValore = !spiegazione(parole)
        && (PRIMA_DELLE_VIRGOLETTE.test(prima) || (PRIMA_DELLE_VIRGOLETTE_NUDA.test(prima) && FORMA_FORTE(v))
          || (PRIMA_DELLE_VIRGOLETTE_CORTA.test(prima) && /[^\p{L}\s'’]/u.test(v)));
      if (alPostoDelValore || bordo(parole[0]) || bordo(parole[parole.length - 1])) out.push({ valore: v, regola: 'password' });
    }
    return out;
  }

  // Gli a capo di Windows e quelli col solo \r (un file di testo allegato) valgono il nostro (#2673.6): le regole leggono
  // una copia col solo \n, e `posto` riporta ogni suo carattere nel testo vero, dove torna il valore di più righe.
  const A_CAPO_ALTRI = /[\r\v\f\u0085  ]/;
  // Così gli a capo di Unicode (U+2028, U+2029, NEL) e i salti di pagina, che contano uno per uno (#2673.14).
  function aCapo(vero) {
    if (!A_CAPO_ALTRI.test(vero)) return null;
    const piano = vero.replace(/\r\n?|[\v\f\u0085  ]/g, '\n');
    const posto = new Int32Array(piano.length + 1);
    for (let i = 0, k = 0; i < vero.length; i++) {
      if (vero[i] === '\r' && vero[i + 1] === '\n') continue;
      posto[k++] = i;
    }
    posto[piano.length] = vero.length;
    return { piano, posto };
  }
  function conGliACapoVeri(x, { piano, posto }, vero) {
    const v = String(x.valore);
    const y = { ...x };
    if (Number.isInteger(x.inizio) && x.inizio >= 0 && x.inizio <= piano.length) y.inizio = posto[x.inizio];
    const k = Number.isInteger(x.inizio) && piano.startsWith(v, x.inizio) ? x.inizio : piano.indexOf(v);
    if (k < 0 || vero.includes(v)) return y;
    const da = posto[k] - (v[0] === '\n' && vero[posto[k] - 1] === '\r' ? 1 : 0);
    y.valore = vero.slice(da, posto[k + v.length - 1] + 1);
    return y;
  }

  // In una riga di tabella la cella dopo l'etichetta è il suo valore per ogni regola, non solo per la password (#2695.1):
  // la barra dopo i due punti si legge come uno spazio («| CVV: | 123 |» come «CVV: 123»), e in una riga di due celle
  // dopo il nome di un campo o di una chiave come i due punti («| login_password | x |»). Null se non cambia niente.
  const ETICHETTA_SEGRETO_SOLA = new RegExp(`^${ETICHETTA_SEGRETO}$`, 'i');
  function celleComeRighe(s) {
    if (!s.includes('|')) return null;
    let cambiato = false;
    const righe = s.split('\n').map((riga) => {
      // Anche la tabella senza la barra in testa («CVV: | 123»), come per la password.
      if (riga.length > 2000 || !/^[ \t]*\||^[^|]{1,80}[:：=][ \t]*\|/.test(riga)) return riga;
      let r = riga.replace(/(?<=[:：=][ \t]*)\|(?=[ \t]*[^|\s])/g, ' ');
      const celle = r.trim().replace(/^\||\|$/g, '').split('|');
      const piene = celle.filter((c) => c.trim());
      const nome = celle[0].trim();
      // La password nuda ha già la regola della sua cella, che sa quando la cella dopo la spiega.
      if (/^[ \t]*\|/.test(r) && celle.length === 2 && piene.length === 2 && !PAROLA_CHIAVE.test(nome)
        && ((/^[A-Za-z_][\w.-]{0,60}$/.test(nome) && tipoDiNome(nome)) || ETICHETTA_SEGRETO_SOLA.test(nome))) {
        const k = r.indexOf('|', r.indexOf('|') + 1);
        r = `${r.slice(0, k)}:${r.slice(k + 1)}`;
      }
      if (r !== riga) cambiato = true;
      return r;
    });
    return cambiato ? righe.join('\n') : null;
  }

  // `[{ valore, regola }]`: quello che in questo testo non deve uscire. Regola 'chiave' | 'password' | 'codice' |
  // 'carta' | 'cvv' | 'token'.
  // `giro`: quante codifiche di un indirizzo si sono già tolte (codificatiNellIndirizzo).
  function trova(valore, { giro = 0 } = {}) {
    const vero = testo(valore);
    if (!global.SN_RISERVATI_TESTO && typeof require === 'function') require('./riservatiNelTesto.js');
    const R = global.SN_RISERVATI_TESTO;
    const copia = aCapo(vero);
    const piano = copia ? copia.piano : vero;
    // L'enfasi del Markdown e i tag HTML fra etichetta e valore («**Password:** …», «<b>PIN:</b> …») si leggono come
    // spazi; un commento HTML in due letture, con e senza il suo testo (riservatiNelTesto.js).
    // Un avverbio fra il verbo e il valore («il pin è ancora 4821») si legge come spazi, come l'enfasi (guardianoStatico.js).
    if (!global.SN_GUARDIANO_STATICO && typeof require === 'function') require('./guardianoStatico.js');
    const G = global.SN_GUARDIANO_STATICO;
    const viste = (R ? R.vistePerLeRegole(piano) : [piano]).map((v) => G.avverbiComeSpazi(virgoletteStrette(v)));
    if (!viste[0].trim() || /^data:image\//i.test(viste[0].slice(0, 16))) return [];
    const out = [];
    for (const s of viste) {
      for (const lettura of [s, celleComeRighe(s)]) {
        if (lettura === null) continue;
        const qui = regole(lettura, giro);
        // «Il pin è 4-8-2-1», «4 8 2 1»: le regole rilette sulle cifre attaccate, e il valore torna com'è scritto (#2692.4).
        const attaccate = R && R.cifreAttaccate(lettura);
        if (attaccate) for (const x of comeScritti(regole(attaccate.piano, giro), attaccate, s)) qui.push(x);
        // La lettura delle celle ha la stessa lunghezza del testo: vale quello che nel testo c'è così com'è.
        for (const x of qui) {
          if (!x.valore) continue;
          const v = String(x.valore);
          if (lettura !== s && !(Number.isInteger(x.inizio) ? s.startsWith(v, x.inizio) : s.includes(v))) continue;
          out.push(s === piano ? x : nelTestoVero(x, piano, s));
        }
      }
    }
    return out.map((x) => (copia ? conGliACapoVeri(x, copia, vero) : x))
      .filter((x) => String(x.valore).length >= 3);
  }

  // I valori trovati sulle cifre attaccate che stanno su un tratto scandito, presi dal testo vero. Gli altri li ha già
  // trovati la lettura del testo com'è. Un valore senza posto si toglie ovunque (oscura): basta una volta per forma.
  function comeScritti(trovati, { piano, posto, tratti }, s) {
    const out = [];
    const visti = new Set();
    // I tratti sono in ordine: il primo che finisce dopo `a` dice se [a, b) ne tocca uno.
    const tocca = (a, b) => {
      let lo = 0;
      let hi = tratti.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (tratti[m][1] <= a) lo = m + 1; else hi = m; }
      return lo < tratti.length && tratti[lo][0] < b;
    };
    const prendi = (x, k, v, alPosto) => {
      const a = posto[k];
      const b = posto[k + v.length - 1] + 1;
      if (!tocca(a, b)) return;
      const valore = s.slice(a, b);
      const chiave = alPosto ? `${a}:${valore}` : `${x.regola}:${valore}`;
      if (visti.has(chiave)) return;
      visti.add(chiave);
      out.push(alPosto ? { ...x, valore, inizio: a } : { ...x, valore });
    };
    const cercati = new Set();
    for (const x of trovati) {
      const v = String(x.valore || '');
      if (!v) continue;
      if (Number.isInteger(x.inizio) && piano.startsWith(v, x.inizio)) { prendi(x, x.inizio, v, true); continue; }
      if (cercati.has(`${x.regola}:${v}`)) continue;
      cercati.add(`${x.regola}:${v}`);
      for (let k = piano.indexOf(v); k >= 0; k = piano.indexOf(v, k + v.length)) prendi(x, k, v, false);
    }
    return out;
  }

  // L'elenco del guardiano parte solo da un codice di cifre e aggiunge solo cifre: qui anche da e verso quello con le
  // lettere («è Mela77 e Pera88», «i pin sono 4829 oppure 48A9»), coi suoi separatori e le sue congiunzioni. Fra i due
  // codici al più un «anche»: una parola qualunque in mezzo farebbe un codice di ogni sigla della frase.
  const { SEPARA: SEPARA_ELENCO, CONGIUNZIONE } = global.SN_GUARDIANO_STATICO.ELENCO;
  const ANCHE = '(?:anche|pure|forse|also|maybe|perhaps|aussi|auch|vielleicht|tambi[ée]n|tamb[ée]m|te[żz]|ook)';
  const ACCANTO_CON_LETTERE = new RegExp(`["'»”)*_]{0,4}${SEPARA_ELENCO}(?:${CONGIUNZIONE}[ \\t]+)?(?:${ANCHE}[ \\t]+)?["'«“(*_]{0,4}`
    + `${PIN_O_LETTERE}(?![\\p{L}\\p{N}/@_-]|[.,:-]\\d|\\.[\\p{L}\\p{N}])`, 'iuy');
  function codiciConLettereInElenco(s, out) {
    const visti = new Set(out.map((x) => String(x.valore)));
    for (const v of [...new Set(out.filter((x) => x.regola === 'codice').map((x) => String(x.valore)))]) {
      for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + 1)) {
        if (/[\p{L}\p{N}]/u.test(s[i - 1] || '') || /[\p{L}\p{N}]/u.test(s[i + v.length] || '')) continue;
        ACCANTO_CON_LETTERE.lastIndex = i + v.length;
        let m;
        for (let n = 0; n < 40 && (m = ACCANTO_CON_LETTERE.exec(s)); n++) {
          if (!visti.has(m[1])) { visti.add(m[1]); out.push({ valore: m[1], regola: 'codice' }); }
        }
      }
    }
  }

  function regole(s, giro) {
    const out = [];
    if (!global.SN_GUARDIANO_STATICO && typeof require === 'function') require('./guardianoStatico.js');
    const G = global.SN_GUARDIANO_STATICO;
    if (G && typeof G.segretiNelTesto === 'function') {
      for (const x of G.segretiNelTesto(s)) if (REGOLE_GUARDIANO.has(x.regola)) out.push(x);
    }
    passwordAccanto(s, out);
    const conNomiCvv = nomiCvvCorretti(s);
    for (const re of [CVV, CVV_DOPO]) for (const m of conNomiCvv.matchAll(re)) out.push({ valore: m[1], regola: 'cvv' });
    for (const re of [CODICE_ACCESSO, CODICE_ACCESSO_EN]) {
      for (const m of s.matchAll(re)) if (!FINE_DI_UN_NUMERO.test(m[0].slice(0, -m[1].length))) out.push({ valore: m[1], regola: 'codice' });
    }
    for (const m of s.matchAll(PIN)) out.push({ valore: m[1], regola: 'codice' });
    codiciVicini(s, out);
    codiceDelMioApparecchio(s, out);
    codiciDiRecupero(s, out);
    for (const m of s.matchAll(BEARER)) out.push({ valore: m[1], regola: 'token' });
    for (const m of s.matchAll(INDIRIZZO)) {
      segretiNellIndirizzo(m[0], out);
      codificatiNellIndirizzo(m[0], m.index, out, giro);
    }
    for (const m of s.matchAll(CODIFICATO)) if (!m[0].includes('://')) codificatiNellIndirizzo(m[0], m.index, out, giro);
    scritteAMano(s, out);
    if (G && typeof G.codiciInElenco === 'function') out.push(...G.codiciInElenco(s, out));
    codiciConLettereInElenco(s, out);
    out.push(...interiFraVirgolette(s, out));
    return out;
  }

  // Le password scritte a mano (la risposta sotto chi la chiede, «Utente / Password: mario / …», dopo il nome della rete):
  // le forme del correttore, da un posto solo (riservatiNelTesto.js). Qui la risposta conta solo sulle righe sotto la
  // domanda, e solo un valore con una cifra o un simbolo: una parola qualunque resta (tests/unit/pavimento.test.mjs).
  // Il codice dato in risposta lo legge codiciVicini, che sa quali numeri non aprono niente (#2692).
  function riservati() {
    if (!global.SN_RISERVATI_TESTO && typeof require === 'function') require('./riservatiNelTesto.js');
    return global.SN_RISERVATI_TESTO || null;
  }
  function scritteAMano(s, out) {
    const R = riservati();
    if (!R) return;
    const basso = s.toLowerCase();
    const stesso = basso.length === s.length;
    // Fra virgolette prima del suo nome («“gattonero” è la password») vale anche di sole lettere, come dopo il nome.
    const virgolettate = new Set(R.primaDelNome(s).filter((x) => x.virgolette).map((x) => x.valore));
    for (const v of [...R.trova(s, { sotto: true }), ...virgolettate]) {
      if (!virgolettate.has(v) && !/[^\p{L}'’]/u.test(v)) continue;
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
    // L'ordine è quello della copia col solo \n (trova): un \r in più non fa passare un valore davanti a un altro.
    const lungo = (v) => v.length - (v.match(/\r\n/g) || []).length;
    const valori = [...ovunque].sort((a, b) => lungo(b) - lungo(a));
    for (const v of valori) {
      const forma = formaDelValore(v);
      // Il valore si toglie come parola intera: la password «casa» non spezza «casalinga». Una lettera cinese o
      // giapponese attaccata non è della stessa parola (FINE_VALORE), e nemmeno uno spazio codificato, anche due volte
      // («%20Mela!Verde77», «%2520Mela»: codificatiNellIndirizzo).
      const confine = /^[\p{L}\p{N}]/u.test(v) ? `(?:(?<=%(?:25){0,2}[0-9A-Fa-f]{2})|(?<!(?![${NON_LATINI.FINE_VALORE}])[\\p{L}\\p{N}]))` : '';
      const fine = /[\p{L}\p{N}]$/u.test(v) ? `(?![\\p{L}\\p{N}](?<![${NON_LATINI.FINE_VALORE}]))` : '';
      // Un valore lunghissimo non entra in un'espressione regolare: si toglie com'è, senza confini.
      try { t = t.replace(new RegExp(`${confine}${forma}${fine}`, 'gu'), SEGNAPOSTO); } catch (_) { t = t.split(v).join(SEGNAPOSTO); }
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

  // ETICHETTE, NOMI_CVV e CVV_ALTRE_LINGUE: il testo delle regole dei nomi della password e del CVV, per i campi dei
  // moduli (campiSegreti.js); NOMI_DEL_PIN per i segreti detti dall'utente che non devono uscire in un indirizzo
  // (urlExfil.js); SPIEGA, le parole che spiegano la password, per il correttore.
  const SPIEGA = { inizio: INIZIO_SPIEGAZIONE, misura: MISURA, tempo: TEMPO, descrive: DESCRIVE, nonValore: NON_VALORE };
  global.SN_PAVIMENTO = { SEGNAPOSTO, trova, oscura, oscuraTutto, interiFraVirgolette, SPIEGA, ETICHETTE: ETICHETTA_NUDA, NOMI_CVV, CVV_ALTRE_LINGUE, NOMI_DEL_PIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_PAVIMENTO;
})(typeof globalThis !== 'undefined' ? globalThis : self);
