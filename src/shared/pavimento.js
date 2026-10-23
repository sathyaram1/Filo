// Il pavimento della privacy (#1589): cosa non arriva mai a un modello né al servizio di ricerca, a nessun livello e
// nemmeno chiesto in chat. Regole fisse, senza modelli: password, carte e CVV, codici usa e getta, chiavi e token anche
// dentro un indirizzo. Lo applicano il cancello dei modelli e la ricerca web; prove in tests/unit/pavimento.test.mjs.

(function (global) {
  'use strict';

  const SEGNAPOSTO = '[dato riservato]';
  // Le forme del guardiano che contano qui: l'IBAN no, si spiega, si copia e si chiede come un indirizzo. La password
  // nemmeno: il guardiano la cerca fra le parole vicine all'etichetta (indirizzi di campo, codice), qui conta il suo posto.
  const REGOLE_GUARDIANO = new Set(['chiave', 'codice', 'carta']);

  // «CVV 123», «CVC: 4821», «Codice di sicurezza 318»: tre o quattro cifre annunciate dal nome del codice della carta.
  const CVV = /\b(?:cvv2?|cvc2?|csc|cid|(?:card\s+)?security\s+code|codice\s+(?:di\s+)?sicurezza(?:\s+della\s+carta)?)\b\s*(?:[:=]|è|e'|is)?\s*(\d{3,4})(?![\d/]|[.,:-]\d)/gi;
  // Il codice che una mail o un SMS manda per entrare: il guardiano riconosce solo i marchi del monouso, perché lì un
  // falso allarme ferma un'azione; qui un falso allarme toglie un numero, e il codice di verifica non esce.
  // Le cifre in coda a una parola («Girasole2024») non sono il codice: è la password intera, e la toglie la regola delle
  // etichette; togliere solo «2024» lascerebbe il resto e cancellerebbe l'anno da tutto il messaggio.
  const CODICE_ACCESSO = /\b(?:codice|code|pin)\b(?:\s+(?:di|da|per|the|your|il|tuo))*\s+(?:verifica|accesso|conferma|sicurezza|autenticazione|autorizzazione|login|verification|security|confirmation|access|sign-?in)\b[^\d\n]{0,24}?(?<![A-Za-zÀ-ÿ])(\d{4,8})\b/gi;
  const CODICE_ACCESSO_EN = /\b(?:verification|security|confirmation|access|login|sign-?in|one-?time|otp|2fa)\s+(?:code|codice|pin)\b[^\d\n]{0,24}?(?<![A-Za-zÀ-ÿ])(\d{4,8})\b/gi;
  const PIN = /\bpin\b\s*(?:[:=]|è|e'|is)?\s*(\d{4,8})\b/gi;
  // La regola sulla forma, per i codici: un numero con la forma di un codice (quattro-otto cifre, o due-tre gruppi) nella
  // frase che lo nomina, prima o dopo di lui, o sulla riga sotto. Col nome del codice («Telegram code: 48291») conta, a
  // meno che la frase lo dica un identificativo che non apre niente (cliente, ordine, prenotazione) senza parole
  // dell'entrare (verifica, autorizza, accedi, sblocca); senza nome conta solo dopo «usa», «inserisci», «enter» o col
  // prefisso («Use 337164 to verify», «G-482913»), perché «Verificato da 1532 utenti» non è un codice. Un anno resta.
  const NOME_CODICE = /\b(?:codic[ei]|codes?|pin|puk|passcode|otp|2fa|mfa)\b/i;
  const SEGNO_FORTE = /\b(?:verific\w*|verif(?:y|ied|ies|ication)\w*|autorizz\w*|authori[sz]\w*|autentic\w*|authentic\w*|sblocc\w*|unlock\w*|acced\w*|accesso|access|log-?in|log\s+in|sign-?in|sign\s+in|monouso|one-?time|usa\s+e\s+getta|otp|passcode|2fa|mfa)\b/i;
  const NON_APRE = /\b(?:client[ei]|customer|client|ordin[ei]|orders?|prenotazion[ei]|booking|reservation|pratica|scont[oi]|discount|promo\w*|coupon|fiscale|postale|postal|zip|cap|prodott[oi]|products?|articol[oi]|items?|sku|tracking|spedizion[ei]|shipp?(?:ing|ment)|fattur[ae]|invoices?|riferimento|reference|tribut[oi]|civile|penale|strada|procedura|error[ei]?|errors?|status|http|abi|cab|ateco|ean|isbn|iban|swift|bic|ticket|bigliett[oi]|vol[oi]|flights?|ricetta|esenzione|destinatario|sdi|cig|cup|colore|colou?r|sorgente|source|paese|country|comune|catastale|matricola|tessera|socio|membro|member|telefono|phone|tel|numero\s+verde|chiam\w*|call)\b/i;
  const INTRODOTTO = /\b(?:use|usa|utilizza|inserisci|immetti|digita|enter|type)\s+$/i;
  const FORMA_CODICE = /(?<![\w./:€$£-])(?:([A-Z]{1,3}-)?(\d{3,4}(?:[ -]\d{3,4}){1,2}|\d{2}-\d{2}-\d{2})|([A-Z]{1,3}-)?(\d{4,8}))(?![\w/]|[.,:]\d|-\d|\s?(?:€|%|euro\b|eur\b|usd\b))/g;
  const ANNO = /^(?:19|20)\d\d$/;
  const FINE_DI_UN_NUMERO = /(?:[*•·xX]{2,}[ .-]?|\b(?:termin\w*|finisc\w*|ending|ends?)\s+(?:con|in|with|per)\s+(?:le\s+cifre\s+)?)$/i;
  function codiciVicini(s, out) {
    const righe = s.split('\n');
    const frasi = (riga) => riga.split(/(?<=[.!?;])\s+(?=[A-ZÀ-Ý«"])|[|\t]/);
    for (let i = 0; i < righe.length; i++) {
      for (const frase of frasi(righe[i])) {
        const nome = NOME_CODICE.test(frase);
        const forte = SEGNO_FORTE.test(frase);
        if (!nome && !forte) continue;
        const zona = [frase];
        if (righe[i].trim().length <= 80) {
          for (let j = i + 1, vuote = 0; j < righe.length && vuote <= 2; j++) {
            if (!righe[j].trim()) { vuote++; continue; }
            zona.push(righe[j]);
            break;
          }
        }
        for (const z of zona) {
          const nonApre = NON_APRE.test(`${frase} ${z}`);
          if (nonApre && !(nome && forte)) continue;
          for (const m of z.matchAll(FORMA_CODICE)) {
            const v = m[2] || m[4];
            if (!m[2] && ANNO.test(v)) continue;
            // A coppie («48-29-13») somiglia a una data: conta solo dove la frase parla di entrare.
            if (/^\d\d-/.test(v) && !forte) continue;
            if (!nome && !(m[1] || m[3] || INTRODOTTO.test(z.slice(0, m.index)))) continue;
            // Un pezzo di un numero più lungo («+39 333 1234567», «Chiama 02 4829 1736») è un telefono, non il codice;
            // così le cifre finali di un numero coperto o annunciate come tali («al ***4567», «che termina con 4567»).
            if (/(?:\+|\d)[ .]?$/.test(z.slice(0, m.index)) || FINE_DI_UN_NUMERO.test(z.slice(0, m.index))) continue;
            out.push({ valore: v, regola: 'codice' });
          }
        }
      }
    }
  }
  // Un token col suo formato: JWT e «Bearer …».
  const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
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
  // Le etichette: anche la password del wifi del router, il codice di accesso e sei lingue straniere.
  const ETICHETTA = '\\b(?:password|passwd|passcode|passphrase|parola\\s+d[\'’]ordine|pwd|pswd?'
    + '|chiave\\s+(?:di\\s+)?(?:rete|sicurezza(?:\\s+di\\s+rete)?|wi-?fi|wpa2?|wlan)|(?:wpa[23]?(?:-psk)?|wi-?fi|wlan|network|security)\\s+key'
    + '|codice\\s+(?:di\\s+)?(?:accesso|segreto)|mot\\s+de\\s+passe|passwort|kennwort|contrase[ñn]a|senha|wachtwoord|has[łl]o)\\b'
    + '(?!\\s*(?:managers?|policy|reset|recovery|generator|hint|strength)\\b)';
  // «Pass:», «pw:» sono anche altro («Green pass: valido»): contano solo davanti a un valore con la forma di una password.
  const ETICHETTA_CORTA = '\\b(?:pass|pw)\\b';
  // Fra etichetta e valore anche una parentesi («Password del router (admin): x») e un trattino o una freccia
  // circondati da spazi; il valore sotto l'etichetta anche dopo una riga vuota (due paragrafi), ma da solo sulla riga.
  const PRIMA = '(?:^|[\\n|\\t])[^\\n|\\t:=.!?;,]{0,30}?';
  // Fra etichetta e separatore niente virgolette, uguali o parentesi di codice: in `"Password" :: #c` o in
  // `password" id="pwd1"` quello che segue è di un altro campo.
  const ACCANTO = '(?:(?!\\s(?:o|e|né|ne|or|and|nor|ma|but)\\s)[^\\n:|=\\t?!.,;\\[\\]«»"<>{}$]){0,40}?';
  const ACCANTO_LUNGO = '(?:(?!\\s(?:o|e|né|ne|or|and|nor|ma|but)\\s)[^\\n:|=\\t?!.,;\\[\\]«»"<>{}$]){0,90}?';
  const ACCANTO_FORTE = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ ]*([:=|\\t]|[-–—→](?=[ \\t]))[ \\t]*([^\\n|\\t]*)`, 'gid');
  const ACCANTO_DEBOLE = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ \\t]+(?:è|e'|is|was|era)[ \\t]+([^\\s|\\[]{4,64})`, 'gi');
  const SOTTO = new RegExp(`${PRIMA}${ETICHETTA}${ACCANTO}[ \\t]*\\n(?:[ \\t]*\\n)?[ \\t]*([^\\s|\\[]{4,64})[ \\t]*(?=\\n|$)`, 'gi');
  // Dentro una frase, senza i due punti («utente mario, password Mela!Verde77»): solo un valore che non può essere una
  // parola, con lettere e cifre o un simbolo da password.
  const IN_FRASE = new RegExp(`${ETICHETTA}(?:[ \\t]+(?:provvisori[ao]|temporane[ao]|iniziale|nuova|attuale|new|temporary|initial|current))?[ \\t]+([^\\s|\\[«»"'(),;]{6,64})`, 'gi');
  const FORMA_FORTE = (v) => /[A-Za-zÀ-ÿ]/.test(v) && (/[0-9]/.test(v) || /[!@#$%^&*+=?~_]/.test(v));
  const INTESTAZIONE = new RegExp(`^${ETICHETTA}[^|\\t]{0,30}$`, 'i');
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
  }

  function valorePassword(grezzo, { forma = false } = {}) {
    const v = testo(grezzo).trim().replace(/^[«"'(]+/, '').replace(/[.,;:)»"']+$/, '');
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
  function formaVicina(pezzo) {
    const v = pezzo.replace(/^[:=\-–—→«"'“‘(\[]+/, '').replace(/[.,;:!?)»"'”’\]]+$/, '');
    if (v.length < 6 || v.length > 64 || v.includes(SEGNAPOSTO) || /:\/\/|^www\./i.test(v) || EMAIL.test(v) || CODICE_SORGENTE.test(v)) return '';
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
  const DOPO = '[ \\t]*(?:[:=|\\t]|[-–—→](?=[ \\t])|[ \\t](?:è|e\'|is|was|era)(?=[ \\t]))[ \\t]*([^\\s|\\t]{6,70})';
  const DOPO_LUNGO = new RegExp(`${ETICHETTA}${ACCANTO_LUNGO}${DOPO}`, 'gi');
  const DOPO_CORTA = new RegExp(`${ETICHETTA_CORTA}${ACCANTO}[ \\t]*[:=][ \\t]*([^\\s|\\t]{6,70})`, 'gi');
  const DA_SOLA = /^[.,;!]?[ \t]*(?:$|\(|[^\s:]{1,30}:(?:\s|$)|[·•–—-]\s)/;
  const SOLO_ETICHETTA = new RegExp(`^[ \\t]*${ETICHETTA}${ACCANTO}[ \\t]*:?[ \\t]*$`, 'i');
  function alPostoDelValore(s, out) {
    const righe = s.split('\n');
    const forma = (pezzo) => { const v = formaVicina(pezzo); if (v) out.push({ valore: v, regola: 'password' }); };
    const inizi = [];
    for (let i = 0, o = 0; i < righe.length; o += righe[i].length + 1, i++) inizi.push(o);
    for (let i = 0; i < righe.length; i++) {
      for (const m of righe[i].matchAll(AL_POSTO)) {
        if (!DA_SOLA.test(m[2])) continue;
        const v = valorePassword(m[1]);
        if (v) out.push(alPosto(v, inizi[i] + m.indices[1][0], m[1]));
      }
      for (const re of [DOPO_LUNGO, DOPO_CORTA]) for (const m of righe[i].matchAll(re)) forma(m[1]);
      if (!SOLO_ETICHETTA.test(righe[i])) continue;
      const { riga, j, saltate } = rigaSotto(righe, i);
      const sotto = riga.trim().split(/\s+/);
      // Oltre i bottoni o i puntini (la password mostrata coperta) la riga dopo è spesso un altro campo («Telefono»):
      // lì conta solo la forma di una password.
      if (sotto.length === 1 && !saltate) {
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
  function fraseDopo(s, out) {
    for (const m of s.matchAll(FRASE_DOPO)) {
      const v = m[1].trim();
      const parole = v.split(/\s+/);
      if (parole.length < 2 || parole.length > 6 || parole.some((p) => !/^[\p{L}\p{N}'’]+[.,;:]?$/u.test(p)) || v.startsWith('[') || NON_VALORE.test(parole[0]) || formaVicina(parole[0])) continue;
      if (INIZIO_SPIEGAZIONE.test(parole[0].replace(/[.,;:]+$/, '')) || parole.some((p) => MISURA.test(p) || TEMPO.test(p))) continue;
      out.push({ valore: v.replace(/[.,;:]+$/, ''), regola: 'password' });
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
    const pw = parti.findIndex((p) => PAROLA_CHIAVE.test(p) || /(?:password|passwd|passphrase)$/.test(p));
    if (pw >= 0) return parti.slice(pw + 1).every((p) => DOPO_PASSWORD.test(p)) ? 'password' : '';
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
  function chiaviInChiaro(s, out) {
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

  function passwordAccanto(s, out) {
    alPostoDelValore(s, out);
    fraseDopo(s, out);
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
        if (v) out.push({ valore: v, regola: 'password' });
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
  }

  // `[{ valore, regola }]`: quello che in questo testo non deve uscire. Regola 'chiave' | 'password' | 'codice' |
  // 'carta' | 'cvv' | 'token'.
  function trova(valore) {
    const s = testo(valore);
    const out = [];
    if (!s.trim() || /^data:image\//i.test(s.slice(0, 16))) return out;
    if (!global.SN_GUARDIANO_STATICO && typeof require === 'function') require('./guardianoStatico.js');
    const G = global.SN_GUARDIANO_STATICO;
    if (G && typeof G.segretiNelTesto === 'function') {
      for (const x of G.segretiNelTesto(s)) if (REGOLE_GUARDIANO.has(x.regola)) out.push(x);
    }
    passwordAccanto(s, out);
    for (const m of s.matchAll(CVV)) out.push({ valore: m[1], regola: 'cvv' });
    for (const re of [CODICE_ACCESSO, CODICE_ACCESSO_EN]) {
      for (const m of s.matchAll(re)) if (!FINE_DI_UN_NUMERO.test(m[0].slice(0, -m[1].length))) out.push({ valore: m[1], regola: 'codice' });
    }
    for (const m of s.matchAll(PIN)) out.push({ valore: m[1], regola: 'codice' });
    codiciVicini(s, out);
    for (const m of s.matchAll(JWT)) out.push({ valore: m[0], regola: 'token' });
    for (const m of s.matchAll(BEARER)) out.push({ valore: m[1], regola: 'token' });
    for (const m of s.matchAll(INDIRIZZO)) segretiNellIndirizzo(m[0], out);
    return out.filter((x) => x.valore && String(x.valore).length >= 3);
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
