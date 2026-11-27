// Le password scritte a mano, fuori dall'etichetta di un modulo: la risposta a chi la chiede in chat e le forme libere
// (#1446, #1649). Un posto solo per il correttore (correttoreRiservati.js) e per il pavimento (pavimento.js): una forma
// corretta qui vale per tutti e due (#1589.8). Logica pura; prove in tests/unit/correttoreRiservati.test.mjs.

(function (global) {
'use strict';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function exfil() {
  if (!globalThis.SN_URL_EXFIL && typeof require === 'function') require('./urlExfil.js');
  return globalThis.SN_URL_EXFIL;
}
function guardiano() {
  if (!globalThis.SN_GUARDIANO_STATICO && typeof require === 'function') require('./guardianoStatico.js');
  return globalThis.SN_GUARDIANO_STATICO;
}

// Chi risponde a chi chiede una password o un codice non lo annuncia («certo, Gatto2024»): lo annuncia la domanda, o la
// richiesta senza punto di domanda, che in chat è la forma comune («mi mandi la password», «mandami il pin», «hai la
// password del wifi», «qual è il codice», «send me the code»). Prove: tests/unit/correttoreRiservati.test.mjs.
const RICHIESTA = new RegExp([
  '(?:(?:(?:mand|invi|pass|gir|ricord)a|scriv[ei])r?|d[ai][rm])m(?:i|el[ao])',
  '(?:mi|ci|me\\s*l[aoe\'’]?|ce\\s*l[aoe\'’]?)\\s*(?:(?:mand|invi|scriv|gir|pass|ricord|prest|condivid|mostr|dett|incoll|cop)(?:i|ate|ete|eresti|ereste)|dic?i|dite|da[it]?e?|daresti|diresti)',
  '(?:puoi|può|potresti|potete|potreste|riesci|riusciresti|sai|sapete|sapresti|hai|avete|conosci|ce\\s*l[\'’]?hai|qual(?:e|[\'’]\\s*è)?|(?:com|cos)[\'’]\\s*è)',
  '(?:(?:mi|ci) serv(?:e|irebbe)|ho bisogno|per\\s*favore|perfavore|x\\s*favore|pls|plz|please)',
  '(?:send|give|tell|share|what|need|can\\s+you|could\\s+you|do\\s+you)',
  // «ti ricordi la password», «come è la password», «che password ha il wifi», «e la password del wifi».
  '(?:(?:ti|vi)\\s+ricord(?:i|ate)|ricordi\\s+(?:la|il)|come\\s+(?:è|e[\'’]|era)|che\\s+(?:password|pw|pass|pin|codice)|(?<=^|:\\s*)e\\s+(?:la|il))',
  // Le lingue dei nomi della password (urlExfil.js, PRESENTA): «скинь пароль от wifi», «vad är lösenordet».
  // Come in italiano anche chi ricorda, chi può, chi ce l'ha e chi sa («напомни», «можешь», «есть», «θυμάσαι», «έχεις»).
  '(?:скинь(?:те)?|кинь(?:те)?|дай(?:те)?|скажи(?:те)?|напиши(?:те)?|пришли(?:те)?|отправь(?:те)?|подскажи(?:те)?|надішли(?:ть)?|какой|какая|какое|який|яка|нужен|нужна|кажи|прати|пошаљи|реци)',
  '(?:напомни(?:те)?|нагадай(?:те)?|підкажи(?:ть)?|скажіть|можешь|можете|можно|може(?:ш|те)?|у\\s+(?:тебя|вас)\\s+есть|(?<!(?:меня|нас|него|неё|них)\\s+)есть(?=\\s+(?:ли\\s+)?парол)|знаешь|знаете|знаєш|скинуть|кинуть|дать|сказать|прислать|написать|отправить|подсказать)',
  '(?:πες|πείτε|δώσε|δώστε|στείλε|στείλτε|ποιος|ποια|ποιο|χρειάζομαι|ξέρεις|ξέρετε|θυμάσαι|θυμάστε|λες|λέτε|έχεις|έχετε|μπορείς|μπορείτε|τι\\s+(?:κωδικ|συνθηματικ)\\p{L}*)',
  '(?:skicka|ge\\s+mig|säg|vad\\s+är|gi\\s+meg|hva\\s+er|hvad\\s+er|giv\\s+mig|lähetä|kerro|mikä|küldd?|küldj|add\\s+meg|mondd|pošli|pošlete|dej|dejte|řekni|daj|reci|pošalji|koja\\s+je|gönder|söyle|nedir|trimite|spune|dă-mi|care\\s+este|gửi|cho\\s+(?:mình|tôi|em|anh)|là\\s+gì|kirim|kasih|minta|berapa)',
  '(?:kan\\s+(?:du|jeg|jag|i)|sende|sänd|atar\\s+m[ıi]s[ıi]n|m[ıi]s[ıi]n|musun|müsün|kaç|ne(?=[^\\p{L}]*$)|care\\s+e|da-mi|zi-mi|[șşs]tii)',
  '(?:(?:schick|gib|sag)\\s+mir|was\\s+ist|wie\\s+ist|envoie|donne|dis-moi|quel\\s+est|c[\'’]est\\s+quoi|mándame|pásame|dame|dime|cuál\\s+es|me\\s+passa|stuur|geef|wat\\s+is|wyślij|podaj|jakie\\s+jest)',
  // In francese, tedesco, spagnolo e portoghese: «envoie-moi le mot de passe», «gib mir das Passwort» (#1403.14).
  '(?:(?:envoie|donne|dis|file|passe)[-\\s]?moi|tu\\s+(?:peux|pourrais|as|aurais|connais)|vous\\s+(?:pouvez|pourriez|avez)'
    + '|t[\'’]as|c[\'’]est\\s+quoi|quel\\s+est|j[\'’]ai\\s+besoin|(?:schick|gib|sag|nenn)(?:e|st)?\\s+mir'
    + '|(?:kannst|könntest|hast|weißt|weisst)\\s+du|wie\\s+(?:ist|lautet|war)|was\\s+ist|ich\\s+brauche'
    + '|(?:m[aá]nda|p[aá]sa|env[ií]a|d[aá]|di)me(?:l[ao])?|me\\s+(?:pasas|mandas|das|dices|env[ií]as|passa|manda|diz|envia)'
    // «preciso» da solo è anche italiano («preciso che la password scade…»): conta col «da/do/de» del portoghese.
    + '|puedes|podr[ií]as|tienes|sabes|necesito|pode|podes|poderia|tem|preciso\\s+d[aoe]s?|cu[aá]l\\s+es)',
].map((s) => `(?<!\\p{L})${s}(?!\\p{L})`).join('|')
  // Le scritture senza spazi non hanno confine fra le parole: «密码是多少».
  // 吗 e 呢 chiudono la domanda al posto del punto di domanda: «你知道wifi密码吗», «密码呢».
  + '|多少|什么|是啥|告诉我|发我|给我|发一下|发下|请问|知道|吗|呢|教えて|何ですか|알려|뭐야|뭐예요', 'iu');
// Un elenco solo per il saluto in testa alla risposta e per quello prima della richiesta corta (#2638.1).
const SALUTI = 'ciao+|ehi|ehilà|hey|hi|hello|salve|buongiorno|buonasera';
const SALUTO = new RegExp(`^(?:${SALUTI})$`, 'u');
// La richiesta più corta è il solo nome in fondo al messaggio («sono arrivato, password del wifi», «Marco: pw di casa»):
// sulla riga, prima, chi parla o un'altra frase, poi al più un articolo o un saluto; dopo il nome solo di cosa è e la
// fine della riga. «Password del wifi» da sola è l'etichetta di una pagina, «password dimenticata» non chiede (#2638.1).
// Le altre lingue come l'italiano: «Marco: пароль от wifi», «τον κωδικό του wifi», «wifi密码» (attaccato, senza spazio),
// «le mot de passe du wifi stp», «das WLAN-Passwort bitte» (#1403.14).
const ELLITTICA_PRIMA = new RegExp(`^\\s*(?:(?:l['’]|(?:la|il|lo|le|les|i|the|your|tua|vostra|el|tu|o|a|teu|das|der|die|dein|deine|ton|ta|votre|${SALUTI}|wi-?fi|wlan|router|home|а|и|τον|το|την|τη|ο|η)(?:\\s+|-|(?=的?$))))*的?$`, 'u');
const DI_COSA = String.raw`(?:(?:(?:del(?:la|lo)?|di|de|du|des|do|da|per|for|of|vom|von|für|fürs|от|для|к|від|του|της|των|til|till|för|af|na|za|pentru|untuk)\s+|dell['’]\s*)(?:(?:la|il|lo|the|my|mio|mia|tuo|tua|le|el|o|a|das|dem|den|der|ton|ta|mon|ma|tu|teu|mi|το)\s+|l['’]\s*)?[\p{L}\p{N}][\p{L}\p{N}_-]*|wi-?fi|wlan|router|rete|modem|casa|home)`;
const CORTESIA = "grazie|thanks|thx|please|pls|plz|per\\s+favore|stp|svp|s['’]il\\s+(?:te|vous)\\s+pla[iî]t|merci|bitte|danke"
  + '|por\\s+favor|porfa|gracias|obrigad[oa]|пожалуйста|спасибо';
const ELLITTICA_DOPO = new RegExp(`^(?:\\s+${DI_COSA}){0,3}(?:\\s+(?:${CORTESIA}))?[^\\p{L}\\p{N}]*$`, 'u');
// La fine di una frase, un elenco solo per tutto il file: i punti che vogliono lo spazio dopo e quelli delle scritture
// senza spazi. Il punto di domanda greco qui è già «?» (minuscolo()).
const PUNTI = '.!?؟;';
const PUNTI_CJK = '。！？';
const SPEZZA_FRASE = new RegExp(`[${PUNTI}]+\\s|[${PUNTI_CJK}]+|\\n`, 'u');
const CHIUDE_PAROLA = new RegExp(`[${PUNTI}${PUNTI_CJK}]$`, 'u');
const INCISO = new RegExp(`[,;]\\s|[，；、]|[${PUNTI}]+(?=\\s|$)|[${PUNTI_CJK}]+|\\n`, 'u');
const ellittica = (testa, dopo) => {
  const pezzi = testa.split(new RegExp(`[,;:，；：、]|[${PUNTI}]+\\s|[${PUNTI_CJK}]+|\\s[-–—]\\s`, 'u'));
  return pezzi.length > 1 && /[\p{L}\p{N}]/u.test(pezzi.slice(0, -1).join(''))
    && ELLITTICA_PRIMA.test(pezzi[pezzi.length - 1]) && ELLITTICA_DOPO.test(dopo);
};
// In chat la password si chiama anche così: «pass» solo con l'articolo o col wifi, da solo è anche l'inglese «to pass».
// Nelle altre lingue (#1403.14): «mdp», «la clave del wifi», «WLAN-Schlüssel», e i composti attaccati del tedesco
// («Wlanpasswort», «Routerpasswort»).
const ETICHETTE_CORTE = '(?<![\\p{L}\\p{N}])(?:pw|(?:l[ae]|mia|tua|sua)\\s+pass|pass\\s+(?:del(?:la)?\\s+)?wi-?fi'
  + '|chiave\\s+(?:(?:del(?:la)?|di)\\s+)?(?:wi-?fi|rete|router)|mdp'
  + '|clave\\s+(?:(?:del|de\\s+la|de)\\s+)?(?:wi-?fi|red|router)|(?:wlan|wi-?fi|router|netzwerk)-?schlüssel'
  + '|\\p{L}{2,20}(?:passwort|kennwort))(?![\\p{L}\\p{N}])';
const CHIESTA_IN_CHAT = `${ETICHETTE_CORTE}|(?<![\\p{L}\\p{N}])credenziali(?![\\p{L}\\p{N}])`;
// Il punto di domanda anche delle altre scritture: quello a tutta larghezza, l'arabo, il greco.
const DOMANDA = new RegExp('[?？؟\\u037E]', 'u');
const FINE_FRASE = new RegExp(`[${PUNTI}]+(?=\\s|$)|[${PUNTI_CJK}]+|\\n`, 'gu');
// L'enfasi del Markdown («**Password:** …», «__PIN:__ …», «- **Wi-Fi password:**») è forma, non testo: le regole la
// leggono come spazi, con gli stessi indici. Solo i segni a confine di parola e sulla stessa riga (#2673.5).
const ENFASI = /(?<![^\s|>(\[«"'“‘-])(\*{1,3}|_{1,3})(?=[^\s*_])((?:(?!\1)[^\n]){1,120}?)(?<=[^\s*_])\1(?![\p{L}\p{N}*_])/gu;
const senzaEnfasi = (t) => {
  const s = String(t == null ? '' : t);
  return /[*_]/.test(s) ? s.replace(ENFASI, (_, segno, dentro) => ' '.repeat(segno.length) + dentro + ' '.repeat(segno.length)) : s;
};
// Il testo come lo leggono le regole: senza enfasi, minuscolo, i due punti a tutta larghezza come i nostri, e il punto e
// virgola di una riga in greco come punto di domanda (in greco è quello). Stessa lunghezza: le posizioni restano.
const minuscolo = (t) => senzaEnfasi(t).toLowerCase().replace(/：/g, ':')
  .replace(/^.*\p{Script=Greek}.*$/gmu, (riga) => riga.replace(new RegExp('[;\\u037E]', 'gu'), '?'));
const FRASE_MAX = 300;
// Come apre una risposta, prima del dato: «certo, …», «eccola: …».
const AVVII = new Set(['certo', 'certa', 'certamente', 'sicuro', 'sicura', 'ovvio', 'ovviamente', 'eccola', 'eccolo',
  'eccoti', 'eccotela', 'eccotelo', 'tieni', 'allora', 'dunque', 'comunque', 'subito', 'volentieri', 'figurati', 'prego',
  'grazie', 'scusa', 'scusami', 'aspetta', 'guarda', 'okay', 'sure', 'there', 'sorry', 'thanks', 'ecco',
  'volontiers', 'voilà', 'voila', 'tiens', 'natürlich', 'gerne', 'bitte', 'claro', 'aquí', 'aqui']);
// Le parole che annunciano il dato subito dopo («…non me la ricordo mai, era gattonero», «c'est …»): l'elenco del
// guardiano, lo stesso del pavimento (#1403.33).
const ANNUNCI = guardiano().ANNUNCI;
const ANNUNCIO = `(?:${ANNUNCI.map(esc).join('|')})(?!\\p{L})`;
const PRESENTA_DATO = new Set([...ANNUNCI, '=', 'eccola', 'eccolo', 'eccotela', 'eccotelo']);
// Dentro una risposta queste aprono quasi sempre altro («sono stanco», «vale poco», «a domani sera», «war»): non
// presentano la parola dopo, né fanno di una riga la risposta.
const NON_IN_RISPOSTA = new Set(['sono', 'are', 'vale', 'risulta', 'here', 'sera', 'war', 'jest']);
const PRESENTA_RISPOSTA = new Set([...PRESENTA_DATO].filter((w) => !NON_IN_RISPOSTA.has(w)));
// «check-in», «self-service»: parole col trattino, non password.
const formaDiPassword = (v) => !!guardiano().sembraPassword(v) && !/^\p{L}+(?:-\p{L}+)+$/u.test(v);
// Una parola di sole lettere conta come password solo nelle prime parole della risposta o dopo PRESENTA_DATO: più in là
// è il resto del messaggio. Quelle con cifre o simboli contano nella frase del dato; dopo, fino a RISPOSTA_MAX, solo
// quelle con la forma di una password (una seconda password sì, un orario no).
const PAROLE_RISPOSTA = 12;
const RISPOSTA_MAX = 2000;
// Il campo risponde all'ultimo messaggio che nomina la password finché sopra non c'è già una risposta (chiusa) e non
// c'è molto altro: solleciti, seconde domande e altre persone non sciolgono il legame (#1446.4). Nella pagina vera fra
// i solleciti stanno orari e messaggi senza nome: il tetto regge una decina di messaggi.
const DOPO_LA_RICHIESTA = 1000;
// Le cifre dette una alla volta («4-8-2-1», «4 8 2 1», «4.8.2.1») sono un numero solo: le regole leggono una copia con le
// cifre attaccate, e `posto` riporta ogni carattere nel testo vero (#2692.4). Lo stesso separatore fra tutte; un pezzo di
// un numero più lungo, una data («4-8-2021») o un indirizzo IP restano come sono. Prove: tests/unit/cifreScandite.test.mjs.
const SEPARA_CIFRE = '[ .\\-–]';
const CIFRE_SCANDITE = new RegExp(`(?<![\\p{L}\\p{N}]|\\d${SEPARA_CIFRE})\\d(${SEPARA_CIFRE})\\d(?:\\1\\d)+(?![\\p{L}\\p{N}]|${SEPARA_CIFRE}\\d)`, 'gu');
const FORSE_SCANDITE = new RegExp(`\\d${SEPARA_CIFRE}\\d${SEPARA_CIFRE}\\d`, 'u');
function cifreAttaccate(testo) {
  const s = String(testo == null ? '' : testo);
  if (!FORSE_SCANDITE.test(s)) return null;
  const tratti = [...s.matchAll(CIFRE_SCANDITE)];
  if (!tratti.length) return null;
  const posto = new Int32Array(s.length + 1);
  let piano = '';
  let i = 0;
  let k = 0;
  for (const m of tratti) {
    piano += s.slice(i, m.index);
    for (; i < m.index; i++) posto[k++] = i;
    for (let j = m.index; j < m.index + m[0].length; j += 2) { piano += s[j]; posto[k++] = j; }
    i = m.index + m[0].length;
  }
  piano += s.slice(i);
  for (; i < s.length; i++) posto[k++] = i;
  posto[k] = s.length;
  return { piano, posto, tratti: tratti.map((m) => [m.index, m.index + m[0].length]) };
}

// «Marco: …» a inizio riga: chi scrive il messaggio.
const PARLA = /^[^\S\n]*(\p{L}[\p{L}\p{N} ._'’-]{0,30}?)[^\S\n]*:\s/u;

function presenta() {
  const P = exfil() && exfil().PRESENTA;
  return P ? [[new RegExp(P.password, 'gu'), 'password'], [new RegExp(CHIESTA_IN_CHAT, 'gu'), 'password'], [new RegExp(P.codice, 'gu'), 'codice']] : [];
}

// «pasword», «passowrd», «pssword»: chi chiede in chat sbaglia la parola e non la corregge. Al più due errori, e la
// parola resta quella che comincia per p e finisce per d («passport» no).
const NOVITA = () => globalThis.SN_NOVITA || (require('./novita.js'), globalThis.SN_NOVITA);
function refusoDiPassword(w) {
  if (w === 'password' || w.length < 6 || w.length > 10 || w[0] !== 'p' || !w.endsWith('d')) return false;
  return NOVITA().distanza(w, 'password', 2) <= 2;
}

// I nomi della password: quelli che il filtro riconosce già (urlExfil), «pw», «pass» e i refusi di «password».
let soloNomePassword = null;
function nomeDiPassword(w) {
  const P = exfil() && exfil().PRESENTA;
  if (!soloNomePassword && P) soloNomePassword = new RegExp(`^(?:${P.password}|pw|pass)$`, 'u');
  return (soloNomePassword ? soloNomePassword.test(w) : w === 'password') || refusoDiPassword(w);
}

// Dove il testo (già minuscolo) nomina una password o un codice.
function menzioni(l) {
  const out = [];
  const P = presenta();
  for (const [re, tipo] of P) for (const m of l.matchAll(re)) out.push({ i: m.index, j: m.index + m[0].length, tipo });
  if (P.length) for (const m of l.matchAll(/(?<![\p{L}\p{N}])p\p{L}{4,9}(?![\p{L}\p{N}])/gu)) {
    if (refusoDiPassword(m[0])) out.push({ i: m.index, j: m.index + m[0].length, tipo: 'password' });
  }
  return out;
}

// Dove finisce ogni frase che chiede una password o un codice (con `tutte`, anche ogni frase che nomina una password).
function richieste(l, tutte = false) {
  const out = [];
  for (const m of menzioni(l)) {
    // La frase si cerca in un tratto corto: un testo lungo senza punti, con la parola ripetuta, non diventa quadratico.
    const f = new RegExp(FINE_FRASE.source, 'g').exec(l.slice(m.j, m.j + FRASE_MAX));
    const a = f ? m.j + f.index + f[0].length : Math.min(l.length, m.j + FRASE_MAX);
    const prima = () => l.slice(Math.max(0, m.i - FRASE_MAX), m.i).split(SPEZZA_FRASE).pop();
    const riga = l.slice(m.j, m.j + FRASE_MAX).split('\n')[0];
    const testa = l.slice(Math.max(0, m.i - FRASE_MAX), m.i).split('\n').pop();
    // Il punto di domanda conta nell'inciso che nomina la password: «la password è gattonero, tu quando arrivi?» la dà.
    const inciso = INCISO.exec(l.slice(m.j, a));
    const chiesta = !!((inciso && DOMANDA.test(inciso[0])) || RICHIESTA.test(prima() + l.slice(m.i, a)) || ellittica(testa, riga));
    if (chiesta || (tutte && m.tipo === 'password')) out.push({ inizio: m.i, nome: m.j, fine: a, tipo: m.tipo, chiesta });
  }
  return out;
}

// Le parole della risposta (già minuscola) contano come quelle dopo la parola che presenta il dato (segretiDetti):
// quelle con cifre o simboli fino alla frase che porta il dato; quelle di sole lettere, per una password chiesta, nelle
// prime PAROLE_RISPOSTA o dopo PRESENTA_DATO. `data`: la risposta sta già sopra, e qui contano solo le parole con la
// forma di una password.
function valoriRisposta(risposta, tipo, chiesta = true, data = false) {
  const X = exfil();
  if (!X || !X.segretiDetti) return [];
  // «4 8 2 1» dato in risposta è un valore solo, non quattro parole corte.
  const attaccate = cifreAttaccate(risposta);
  if (attaccate) risposta = attaccate.piano;
  const presentata = presenta().map(([re]) => new RegExp(`^(?:${re.source})$`, 'u'));
  const out = [];
  let lettere = tipo === 'password' && chiesta && !data;
  let saluto = false;
  let trovato = false;
  // Un dato con cifre o simboli è la risposta: dopo la sua frase il messaggio parla d'altro, e può portarne solo un altro
  // con la stessa forma («Gatto2024. Anzi no, l'ho cambiata: Gatto2025»).
  let forte = false;
  let soloForma = data;
  let dopoPresenta = false;
  let n = 0;
  // Le parole di un nome in più parole («le mot de passe est …») sono il nome, non il dato.
  const nomi = menzioni(risposta);
  for (const m of risposta.matchAll(/(\S+)(\s*)/g)) {
    const [, w, spazio] = m;
    n += 1;
    const t = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const da = m.index + w.length - w.replace(/^[^\p{L}\p{N}]+/u, '').length;
    const nelNome = nomi.some((x) => da >= x.i && da + t.length <= x.j);
    // «Ciao Marco!» non è la password: la frase del saluto non conta per le parole di sole lettere.
    if (!trovato && SALUTO.test(t)) saluto = true;
    // «Marco:», «eccola:» presentano, non sono il dato.
    const candidata = t && !nelNome && !w.endsWith(':') && !AVVII.has(t) && !PRESENTA_DATO.has(t) && !presentata.some((re) => re.test(t));
    const segni = /[^\p{L}'’]/u.test(t);
    const qualunque = tipo === 'password' && !saluto && !forte && ((lettere && n <= PAROLE_RISPOSTA) || dopoPresenta);
    if (soloForma) {
      if (candidata && formaDiPassword(t)) out.push({ valore: t });
    } else if (candidata && (segni || qualunque)) {
      const v = X.segretiDetti(`${tipo} ${t}`);
      if (v.length) { trovato = true; if (segni) forte = true; }
      out.push(...v);
    }
    dopoPresenta = w.endsWith(':') || PRESENTA_RISPOSTA.has(t);
    if (CHIUDE_PAROLA.test(w) || spazio.includes('\n')) {
      if (saluto) saluto = false;
      else if (forte) soloForma = true;
      else if (trovato) lettere = false;
    }
  }
  return out;
}

const chiParla = (riga) => { const m = riga.match(PARLA); return m ? m[1].trim() : null; };
// La riga di una conversazione copiata, anche con l'orario davanti come la copia WhatsApp o Telegram
// («[15:42, 26/11/2026] Luc: …», «26/11/26, 15:42 - Luc: …»): { chi, resto } o null. Per il pavimento (#2692).
const ORARIO_CHAT = /^[^\S\n]*(?:\[[^\]\n]{1,40}\]|\d{1,2}[./-]\d{1,2}[./-]\d{2,4},?[^\S\n]+\d{1,2}[.:]\d{2}(?::\d{2})?(?:[^\S\n]*[-–])?)/u;
function parlaInChat(riga) {
  const s = String(riga || '').replace(ORARIO_CHAT, '');
  const m = s.match(PARLA);
  return m ? { chi: m[1].trim().toLowerCase(), resto: s.slice(m[0].length) } : null;
}
// La riga chiede una password o un codice («qual è il pin?», «mandami il codice del cancello»), con le regole della
// richiesta di questo file: il pavimento legge la risposta sotto come quella a chi chiede la password (#2692).
function chiede(riga) {
  try { return richieste(minuscolo(riga)).some((r) => r.chiesta); } catch (_) { return false; }
}
// Chi scrive il campo si firma così nelle conversazioni copiate; le pagine di chat non mettono nomi, e un altro nome
// può essere chiunque del gruppo.
const CHI_SCRIVE = new Set(['io', 'tu', 'me', 'you', 'i']);
// Anche le virgolette davanti: «pass «Mela!Verde77»» ha il valore fra loro (#2678.7).
const pulito = (v) => String(v || '').replace(/^[«“„‘"'(\[]+/u, '').replace(/[.,;:!?)\]»”"'’]+$/u, '');
// La riga porta già il dato: in testa («Gatto2024 (con la G maiuscola)», «certo, Gatto2024») o dopo una parola che lo
// presenta («è gattonero tutto minuscolo», «eccola: gattonero»). Il nome di chi parla non presenta. Una domanda non porta,
// ma solo nel suo inciso: «è gattonero?» no, «Gatto2024. Tu a che ora arrivi?» e «sì: Gatto2024 ma…, ok?» sì.
// 'debole' quando il dato è di sole lettere: «è urgente» ha la stessa forma.
// `dopoIlNome`: la riga segue il nome della password, e lì vale tutto l'elenco degli annunci («la pass risulta …»).
function portaIlDato(riga, tipo, inTesta, dopoIlNome = false) {
  const annuncia = dopoIlNome ? PRESENTA_DATO : PRESENTA_RISPOSTA;
  const X = exfil();
  const chi = chiParla(riga);
  const testo = chi !== null && !AVVII.has(chi) && !PRESENTA_DATO.has(chi) ? riga.replace(PARLA, '') : riga;
  if (!X || !X.segretiDetti) return false;
  const parole = testo.split(/\s+/);
  const inDomanda = [];
  let q = false;
  for (let k = parole.length - 1; k >= 0; k--) {
    const p = parole[k].replace(/[)\]»”"'’]+$/u, '');
    if (CHIUDE_PAROLA.test(p) || /[,;，；]$/u.test(p)) q = DOMANDA.test(p.slice(-1));
    inDomanda[k] = q;
  }
  let testa = inTesta;
  let presentato = false;
  for (const [k, w] of parole.entries()) {
    const t = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (w.endsWith(':') || w === '=' || annuncia.has(t)) { presentato = true; continue; }
    if (!t || (testa && (AVVII.has(t) || SALUTO.test(t)))) continue;
    if (!inDomanda[k]) {
      if ((testa || presentato) && formaDiPassword(t)) return true;
      if (presentato && X.segretiDetti(`${tipo} ${t}`).length) return /\d/.test(t) ? true : 'debole';
    }
    testa = false;
    presentato = false;
  }
  return false;
}

// Sotto un dato di sole lettere ci vuole la reazione di chi l'ha ricevuto: un grazie, un ok, un messaggio vero. Un
// sollecito corto («dai», «sbrigati», «non va») no.
const CONFERMA = /(?<![\p{L}\p{N}])(?:grazie|thanks|thx|ok|okay|perfetto|perfect|fatto|ricevut[ao]|entrat[oa]|connesso|connessa)(?![\p{L}\p{N}])|👍|🙏/u;
const conferma = (riga) => {
  const s = riga.replace(PARLA, '');
  return !NON_VA.test(s) && (CONFERMA.test(s) || s.split(/\s+/).filter(Boolean).length >= 4);
};
// Chi ha chiesto dice che la password non va: la correzione che segue è ancora la risposta.
const NON_VA = /(?<![\p{L}\p{N}])(?:non\s+(?:va|funziona|entra|prende|si\s+collega|mi\s+fa\s+entrare|(?:è|e['’])\s+(?:giusta|quella))|sbagliat[ao]|errat[ao]|(?:does|is)n['’]?t\s+work|wrong)(?![\p{L}\p{N}])/u;

// Sotto la richiesta `r` c'è già la risposta: nella frase che nomina la password («la password è gattonero»), in una
// riga di chi scrive, in una riga corta con un valore dalla forma di password o in una che porta il dato. Un «PS:», un
// orario, un altro del gruppo o un sollecito di chi ha chiesto non la chiudono (#1723); un dato di sole lettere solo se
// sotto c'è già la reazione di chi l'ha ricevuto (conferma), perché in una chat senza nomi anche «è urgente» lo sembra.
// Chiusa, dà il testo sotto la riga che la chiude (anche vuoto); aperta, null.
function chiusa(l, r) {
  const richiedente = chiParla(l.slice(l.lastIndexOf('\n', r.inizio - 1) + 1, r.fine));
  const righe = l.slice(r.fine).split('\n');
  if (r.fine > 0 && l[r.fine - 1] !== '\n') righe.shift();
  const confermata = (i) => righe.slice(i).some((s) => s.trim() && conferma(s));
  const dopo = (i) => righe.slice(i).join('\n');
  const datoNellaFrase = r.chiesta ? false : portaIlDato(l.slice(r.nome, r.fine), r.tipo, false, true);
  if (datoNellaFrase === true || (datoNellaFrase === 'debole' && confermata(0))) return dopo(0);
  for (const [i, riga] of righe.entries()) {
    const chi = chiParla(riga);
    if (chi !== null && CHI_SCRIVE.has(chi)) return dopo(i + 1);
    if (chi !== null && chi === richiedente) continue;
    const parole = (chi === null ? riga : riga.replace(PARLA, '')).split(/\s+/).filter(Boolean);
    if (parole.length <= 4 && parole.some((w) => formaDiPassword(pulito(w)))) return dopo(i + 1);
    const dato = portaIlDato(riga, r.tipo, true);
    if (dato === true || (dato === 'debole' && confermata(i + 1))) return dopo(i + 1);
  }
  return null;
}

// Dopo la risposta, un «non va» di chi ha chiesto riapre il legame finché sotto non c'è una risposta nuova.
function chiusaDavvero(l, r) {
  let dopo = chiusa(l, r);
  for (let giri = 0; dopo !== null && giri < 20; giri += 1) {
    const m = NON_VA.exec(dopo);
    if (!m) return true;
    const p = l.length - dopo.length + m.index;
    const fine = l.indexOf('\n', p) < 0 ? l.length : l.indexOf('\n', p);
    dopo = chiusa(l, { inizio: p, nome: p, fine, tipo: r.tipo, chiesta: true });
  }
  return false;
}

// Il messaggio sopra il campo a cui il campo risponde: { tipo, chiesta, data } o null. Con la risposta già sopra
// (`data`) il campo perde solo le parole con la forma di una password: una seconda password sì, le parole normali no.
function richiestaAperta(sopra) {
  const l = minuscolo(sopra);
  const tutte = richieste(l, true);
  let ultima = null;
  for (const r of tutte) {
    const meglio = !ultima || r.fine > ultima.fine
      || (r.fine === ultima.fine && (r.tipo === 'password') > (ultima.tipo === 'password'))
      || (r.fine === ultima.fine && r.tipo === ultima.tipo && r.chiesta && !ultima.chiesta);
    if (meglio) ultima = r;
  }
  if (!ultima || l.slice(ultima.fine).trim().length > DOPO_LA_RICHIESTA) return null;
  if (chiusaDavvero(l, ultima)) return { tipo: ultima.tipo, chiesta: false, data: true };
  // Una richiesta vera prima di un sollecito che rinomina la password vale ancora: conta come chiesta. Riaperta da un
  // «non va», anche.
  const riaperta = chiusa(l, ultima) !== null;
  const chiesta = riaperta || tutte.some((r) => r.chiesta && r.tipo === ultima.tipo && !chiusaDavvero(l, r));
  return { tipo: ultima.tipo, chiesta, data: false };
}

// Le password scritte a mano fuori dal posto di un'etichetta (#1649): accanto al nome utente, dopo il nome della rete,
// dopo «pw» o «la pass» in una frase, dopo «, è». Conta solo il posto del valore, mai le parole vicine all'etichetta: i
// nomi di prodotto e il codice intorno restano (#1589). Prove: tests/unit/correttorePasswordAMano.test.mjs.
// Un nome della password si cerca largo (anche «parola chiave» e i refusi) e si conferma con nomeDiPassword.
const PW = "(?:p\\p{L}{1,9}|parola\\s+(?:chiave|d['’]ordine))";
const UTENTE = '(?:username|user|utente|nome\\s+utente|login|e-?mail|mail|account)';
// Fra nome utente e password: la barra, la stanghetta o il trattino fra spazi («mario - Girasole2024»).
const FRA = '(?:\\s*[/|]\\s*|\\s+[-–—]\\s+)';
// I tratti senza spazi hanno un tetto: un campo lungo che ripete l'etichetta non rilegge la riga da capo a ogni volta.
const LIBERE = {
  // «Username / Password: mario / Girasole2024»: il valore sta al posto dell'etichetta della password.
  coppia: new RegExp(`(?<![\\p{L}\\p{N}])(${UTENTE}|${PW})${FRA}(${UTENTE}|${PW})\\s*[:=]\\s*(\\S{1,128}?)${FRA}(\\S+)`, 'gu'),
  credenziali: new RegExp(`(?<![\\p{L}\\p{N}])(?:credenziali|credentials|dati\\s+(?:di\\s+)?(?:accesso|login))(?:\\s+${ANNUNCIO})?\\s*[:=]?\\s*(\\S{1,128}?)${FRA}(\\S+)`, 'gu'),
  // «Credenziali: mario Girasole2024»: senza la barra il secondo valore deve avere la forma di una password.
  credenzialiSpazio: new RegExp(`(?<![\\p{L}\\p{N}])(?:credenziali|credentials|dati\\s+(?:di\\s+)?(?:accesso|login))(?:\\s+${ANNUNCIO})?\\s*[:=]?\\s*\\S{1,128}?\\s+(\\S+)`, 'gu'),
  // «Pass: Girasole2024», «user mario pass Girasole2024»: senza articolo «pass» è anche il pass del concerto, e il
  // valore deve avere la forma di una password.
  pass: new RegExp(`(?<![\\p{L}\\p{N}])pass(?![\\p{L}\\p{N}])\\s*(?:[:=]|${ANNUNCIO})?\\s*(\\S+)`, 'gu'),
  // «Login: mario / Girasole2024»: etichette più generiche, il valore deve avere la forma di una password.
  accesso: new RegExp(`(?<![\\p{L}\\p{N}])(?:login|account|accesso|utenza|access)\\s*[:=]\\s*(\\S{1,128}?)${FRA}(\\S+)`, 'gu'),
  accedi: /(?<![\p{L}\p{N}])(?:accedi|entra|login|log\s*in|sign\s*in)\s+(?:con|with)\s*:?\s*(\S{1,128}?)\s*\/\s*(\S+)/gu,
  // «Wi-Fi: CasaRossi - Faro7Blu55», «WiFi CasaRossi - …», «Rete: CasaRossi, …»: prima la rete (32 caratteri al più),
  // poi la chiave. La virgola separa solo dopo i due punti: in una frase («il wifi non va, AX1800…») è altro.
  rete: /(?<![\p{L}\p{N}])(?:(?:wi-?fi|wlan|ssid|rete|network)\s*[:=]\s*[^\n]{1,32}?(?:\s+[-–—/|]\s+|\s*,\s*)|(?:wi-?fi|wlan|ssid)\s+[^\n]{1,32}?\s+[-–—/|]\s+)(\S+)/gu,
  // «SSID: CasaRossi» e sotto «Key: Brezza7Mare», o sulla stessa riga.
  chiaveRete: /(?<![\p{L}\p{N}])(?:ssid|nome\s+(?:della\s+)?rete|network(?:\s+name)?|wi-?fi|wlan)\s*[:=][^\n]{0,64}?(?:[^\S\n]*[,;|/][^\S\n]*|[^\S\n]+|[^\S\n]*\n(?:[^\S\n]*\n)?[^\S\n]*)(?:key|chiave(?:\s+(?:di\s+rete|wpa2?))?|password|pass|pw|psk|wpa2?(?:\s+key)?)\s*[:=]\s*(\S+)/gu,
  corte: new RegExp(ETICHETTE_CORTE, 'gu'),
  // «la password su whatsapp, (comunque) è Girasole2024»: il valore dopo la virgola.
  virgola: new RegExp(`(?<![\\p{L}\\p{N}])(${PW}|${ETICHETTE_CORTE})[^\\n${PUNTI}${PUNTI_CJK}]{0,80}?,\\s*(?:[\\p{L}'’]+\\s+){0,2}?${ANNUNCIO}\\s+(\\S+)`, 'gu'),
};
const SOLO_CORTE = new RegExp(`^${ETICHETTE_CORTE}$`, 'u');
const nomePw = (s) => nomeDiPassword(s.replace(/\s+/g, ' '));
// Dopo un'etichetta corta una parola qualunque è il resto della frase («la pass giornaliera», «il pw del documento»):
// conta se ha la forma di una password, o se la presenta un annuncio o i due punti; dopo «pw» anche se viene subito.
// Come dopo «password»: anche con un avverbio («la pass ora è …», «la pass è ancora …») o un verbo di cambio («pw
// diventa …») in mezzo. L'annuncio largo, i modali, gli avverbi e i verbi di cambio stanno nel guardiano, con l'elenco
// degli annunci: anche il participio da solo («pw rimasta …», «pw became …») presenta il valore e non lo è (#1403.67).
const AVVERBI = guardiano().AVVERBIO;
const CAMBIATA = `${guardiano().PARTICIPI}|${guardiano().PASSATI}`;
const PRESENTATA = new RegExp(`^\\s*(?:${guardiano().COMPLEMENTO}\\s*)?(?:${AVVERBI}\\s+)?(?:[:=]|(?<!\\p{L})(?:${guardiano().ANNUNCIO_LARGO}|${CAMBIATA})(?!\\p{L}))`
  + `(?:\\s+${AVVERBI}(?!\\p{L})){0,3}\\s*$`, 'u');
const PONTE = new RegExp(`^(?:${AVVERBI}|${guardiano().AVVERBI}|${guardiano().MODALI}|${ANNUNCIO}|${CAMBIATA}|${guardiano().CAMBI})$`, 'u');
const ACCANTO = /^\s*$/u;

function formeLibere(testo) {
  const X = exfil();
  const G = guardiano();
  if (!X || !X.segretiDetti) return [];
  const l = minuscolo(testo);
  const valore = (v) => X.segretiDetti(`password ${pulito(v)}`);
  const forma = (v) => (G && G.sembraPassword && formaDiPassword(pulito(v)) ? [{ valore: pulito(v) }] : []);
  const out = [];
  const utente = new RegExp(`^${UTENTE}$`, 'u');
  // Il nome della password si cerca largo: una parola scartata («per la password, è …») non deve coprire quella dopo.
  const conNome = (re, ok, prendi) => {
    const r = new RegExp(re.source, re.flags);
    let m;
    while ((m = r.exec(l))) {
      if (ok(m)) prendi(m); else r.lastIndex = m.index + 1;
    }
  };
  conNome(LIBERE.coppia, (m) => nomePw(m[1]) !== nomePw(m[2]) && utente.test(nomePw(m[1]) ? m[2] : m[1]),
    (m) => out.push(...valore(nomePw(m[2]) ? m[4] : m[3])));
  for (const m of l.matchAll(LIBERE.credenziali)) out.push(...valore(m[2]));
  for (const m of l.matchAll(LIBERE.credenzialiSpazio)) out.push(...forma(m[1]));
  for (const m of l.matchAll(LIBERE.accesso)) out.push(...forma(m[2]));
  for (const m of l.matchAll(LIBERE.accedi)) out.push(...forma(m[2]));
  for (const m of l.matchAll(LIBERE.pass)) out.push(...forma(m[1]));
  for (const m of l.matchAll(LIBERE.rete)) out.push(...forma(m[1]));
  for (const m of l.matchAll(LIBERE.chiaveRete)) out.push(...valore(m[1]));
  for (const m of l.matchAll(LIBERE.corte)) {
    const coda = l.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const pw = /^pw$/u.test(m[0]);
    for (const v of X.segretiDetti(`password ${coda}`)) {
      const s = valoreDi(v);
      const fra = coda.slice(0, Math.max(0, coda.indexOf(s)));
      if (v.rinvio || forma(s).length || PRESENTATA.test(fra) || (pw && ACCANTO.test(fra) && !PONTE.test(s))) out.push(v);
    }
  }
  conNome(LIBERE.virgola, (m) => nomePw(m[1]) || SOLO_CORTE.test(m[1]), (m) => out.push(...forma(m[2])));
  // La password nella frase dopo, che la rimanda senza nominarla (urlExfil.js, segretiDetti): qui quella con la forma di
  // una password; di sole lettere la prende il correttore dalla sua lettura, che sa quali parole spiegano.
  for (const v of X.segretiDetti(l)) if (v.rinvio) out.push(...forma(v.valore));
  return out;
}

const valoreDi = (x) => String((x && x.valore) || '');
const lunghi = (vs) => vs.map(valoreDi).filter((v) => v.length >= 4);

// I valori (minuscoli, da quattro caratteri) che in questo testo sono una password scritta a mano: le forme libere e
// la risposta sotto chi la chiede. Mai un throw. Con `sotto` (una pagina intera, non un campo che risponde) vale solo la
// risposta a chi chiede una password, sulle righe dopo la domanda: «Come cambio la password di Gmail? Ordine 1234…» resta.
function trova(testo, { sotto = false } = {}) {
  const out = [];
  const l = minuscolo(testo);
  if (!l.trim()) return [];
  try { out.push(...formeLibere(l)); } catch (_) {}
  try {
    // Un testo lungo che ripete la stessa domanda e la stessa risposta si legge una volta sola.
    const viste = new Set();
    for (const r of richieste(l)) {
      if (sotto && (r.tipo !== 'password' || !(l[r.fine - 1] === '\n' || /^[^\S\n]*\n/.test(l.slice(r.fine, r.fine + 200))))) continue;
      const risposta = l.slice(r.fine, r.fine + RISPOSTA_MAX);
      const k = `${r.tipo}:${risposta}`;
      if (!viste.has(k)) { viste.add(k); out.push(...valoriRisposta(risposta, r.tipo)); }
    }
  } catch (_) {}
  return lunghi(out);
}

global.SN_RISERVATI_TESTO = { RISPOSTA_MAX, SEPARA_CIFRE, cifreAttaccate, senzaEnfasi, minuscolo, trova, formeLibere, valoriRisposta, richiestaAperta, lunghi, parlaInChat, chiede, PRESENTA_DATO };
if (typeof module !== 'undefined' && module.exports) module.exports = global.SN_RISERVATI_TESTO;
})(typeof globalThis !== 'undefined' ? globalThis : self);
