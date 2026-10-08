// Motore di decisione: dai segnali (locali sincroni + dati asincroni di rete,
// quando disponibili) calcola UN verdetto con livello e messaggio specifico.
//
// Livelli (esattamente due avvisi, vedi spec):
//   'safe'       — nessun avviso.
//   'sospetto'   — banner chiudibile con "ok".
//   'pericoloso' — interstitial bloccante (scrivere "confermo").
//
// Principio: "pericoloso" poggia SOLO su segnali che l'attaccante non può
// nascondere (blacklist, dominio, certificato, età). Il contenuto rinforza,
// mai da solo. L'LLM è monotòno: può alzare a "sospetto", mai a "pericoloso",
// mai dichiarare sicuro (applicato da chi orchestra, non qui).

'use strict';

const { normalize } = require('./normalize');
const { isWhitelisted, hostedPlatform, pagePath } = require('./whitelist');
const { localSignals } = require('./signals');

const ESE = globalThis.SN_ESEGUIBILI || (require('../../../shared/eseguibili.js'), globalThis.SN_ESEGUIBILI);

const YOUNG_DOMAIN_DAYS = 30;     // sotto: dominio "giovane" → rinforzo sospetto
const VERY_YOUNG_DOMAIN_DAYS = 7; // sotto: rinforzo forte (combinato → pericoloso)
const CERT_BAD = new Set(['expired', 'mismatch', 'self_signed', 'untrusted', 'absent', 'revoked']);

function agePhrase(days) {
  if (days == null) return '';
  if (days < 1) return 'oggi';
  if (days < 2) return 'ieri';
  if (days < 60) return `${Math.round(days)} giorni fa`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} mesi fa`;
  return `${Math.round(days / 365)} anni fa`;
}

function certText(status) {
  switch (status) {
    case 'expired': return 'il certificato è scaduto';
    case 'mismatch': return 'il certificato non corrisponde al dominio';
    case 'self_signed': return 'il certificato è autofirmato';
    case 'untrusted': return 'il certificato non è attendibile';
    case 'revoked': return 'il certificato è stato revocato';
    case 'absent': return 'la connessione non è cifrata';
    default: return 'il certificato presenta un problema';
  }
}

function gsbText(category) {
  switch (category) {
    case 'malware': return 'distribuzione di malware';
    case 'unwanted': return 'software indesiderato';
    case 'social_engineering':
    case 'phishing': return 'phishing (furto di credenziali)';
    default: return 'sito pericoloso';
  }
}

// Il nome lo sceglie chi serve il file: si mostra senza i caratteri che ne cambiano la lettura, e uno lunghissimo tiene
// l'inizio e la fine, dove sta l'estensione.
function nomeFile(n) {
  const v = ESE.nomeVisibile(n).trim();
  return v.length > 60 ? `${v.slice(0, 36)}…${v.slice(-20)}` : v;
}

// I segnali che non dipendono da chi è il sito: `sola` apre l'avviso, `coda` si mette in fila ai fatti di un'impersonazione.
function fattiPagina({ dom, autoDl, doubleExt, insecureForm }) {
  const out = [];
  const travestito = (n) => `«${nomeFile(n)}», che sembra un documento ma è un programma`;
  const stesso = !!(autoDl && doubleExt && doubleExt.where === 'download' && doubleExt.name === autoDl.name);
  if (autoDl) {
    const cosa = stesso ? travestito(autoDl.name) : `un programma${autoDl.name ? ` («${nomeFile(autoDl.name)}»)` : ''}`;
    out.push({
      titolo: 'Scaricamento partito da solo',
      sola: `Questa pagina di ${dom} ha avviato da sola lo scaricamento di ${cosa}.`,
      coda: `la pagina ha avviato da sola lo scaricamento di ${cosa}`,
    });
  }
  if (doubleExt && !stesso) {
    const t = travestito(doubleExt.name);
    out.push(doubleExt.where === 'url'
      ? { titolo: 'Programma travestito da documento', sola: `L'indirizzo di ${dom} finisce con ${t}.`, coda: `l'indirizzo finisce con ${t}` }
      : { titolo: 'Programma travestito da documento', sola: `Questa pagina di ${dom} ti fa scaricare ${t}.`, coda: `la pagina ti fa scaricare ${t}` });
  }
  if (insecureForm) {
    out.push({
      titolo: 'Dati in chiaro',
      sola: `I dati che scrivi qui viaggiano in chiaro: il modulo di ${dom} li manda a un indirizzo non cifrato.`,
      coda: 'i dati che scrivi qui viaggiano in chiaro',
    });
  }
  return out;
}

// Costruisce il messaggio specifico dai segnali fidati. `lead` è il segnale
// guida; gli altri diventano frasi di rinforzo.
function buildMessage({ level, norm, gsb, imp, ageDays, cert, hasPassword, hasPayment, sandbox, hosted, autoDl, doubleExt, insecureForm }) {
  const dom = hosted ? (norm.hostUnicode || norm.host) : (norm.registrableUnicode || norm.registrable || norm.host);
  // 1) Blacklist: prevale su tutto.
  if (gsb && gsb.listed) {
    return {
      title: 'Sito segnalato come pericoloso',
      body: `Google Safe Browsing classifica ${dom} come ${gsbText(gsb.category)}.`,
    };
  }
  const young = ageDays != null && ageDays < YOUNG_DOMAIN_DAYS;
  const certBad = !!(cert && CERT_BAD.has(cert.status));
  const sandboxBad = !!(sandbox && sandbox.verdict === 'dangerous');
  const pagina = fattiPagina({ dom, autoDl, doubleExt, insecureForm });
  const facts = [];
  if (young) facts.push(`registrato ${agePhrase(ageDays)}`);
  if (certBad) facts.push(certText(cert.status));
  for (const p of pagina) facts.push(p.coda);
  if (hasPassword) facts.push('ti sta chiedendo la password');
  else if (hasPayment) facts.push('ti chiede i dati di pagamento');
  if (sandboxBad) facts.push('analizzato in isolamento, mostra comportamento ingannevole');
  const tail = facts.length ? (', ' + joinIt(facts) + '.') : '.';

  // 2) Impersonazione stretta (e typo su brand corto quando un altro segnale conferma).
  const somiglianzaSola = imp && imp.kind === 'weak_typo' && level !== 'pericoloso';
  if (imp && imp.kind !== 'broad_impersonation' && !somiglianzaSola) {
    return {
      title: `Attenzione: questo non è ${imp.brand.display}`,
      body: `Questo non è ${imp.brand.display}. Il dominio è ${dom}${tail}`,
    };
  }
  // 2bis) Solo somiglianza: accusare un sito vero di essere un falso sarebbe peggio del rischio (#728).
  if (somiglianzaSola) {
    return {
      title: `${imp.brand.display}? Controlla l'indirizzo`,
      body: `${dom} assomiglia all'indirizzo di ${imp.brand.display}, ma non è un suo indirizzo ufficiale${tail}`,
    };
  }
  // 3) Impersonazione larga.
  if (imp && imp.kind === 'broad_impersonation') {
    return {
      title: `${imp.brand.display}? Controlla l'indirizzo`,
      body: `${dom} usa il nome "${imp.brand.display}" ma non è un indirizzo ufficiale di ${imp.brand.display}${tail}`,
    };
  }
  // 4) Un file o un modulo della pagina: dice cosa sta succedendo, gli altri fatti seguono.
  if (pagina.length) {
    const [prima, ...poi] = pagina;
    const altri = [];
    if (young) altri.push(`il dominio è stato registrato ${agePhrase(ageDays)}`);
    if (certBad) altri.push(certText(cert.status));
    for (const p of poi) altri.push(p.coda);
    if (hasPassword) altri.push('la pagina ti chiede la password');
    else if (hasPayment) altri.push('la pagina ti chiede i dati di pagamento');
    if (sandboxBad) altri.push('aperta in isolamento, mostra un comportamento ingannevole');
    const seguito = altri.length ? ` ${joinIt(altri).replace(/^./, (c) => c.toUpperCase())}.` : '';
    return { title: prima.titolo, body: prima.sola + seguito };
  }
  // 5) Solo segnali non legati all'identità.
  if (certBad) {
    return { title: 'Connessione non sicura', body: `La connessione a ${dom} non è protetta: ${certText(cert.status)}.` };
  }
  if (young) {
    return { title: 'Dominio registrato da poco', body: `Il dominio ${dom} è stato registrato ${agePhrase(ageDays)}.` };
  }
  if (sandboxBad) {
    return { title: 'Comportamento sospetto', body: `Aperto in isolamento, ${dom} mostra un comportamento ingannevole.` };
  }
  return { title: 'Sito potenzialmente sospetto', body: `Fai attenzione su ${dom}.` };
}

function joinIt(arr) {
  if (arr.length <= 1) return arr.join('');
  return arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
}

// Valutazione completa. `asyncData` opzionale: { gsb, ageDays, cert, ctAgeDays, sandbox, llm }. `ctx` opzionale: gli
// indizi della pagina e della scheda letti da localSignals (signals.js).
function evaluate(url, ctx = {}, asyncData = {}) {
  const norm = normalize(url);
  if (!norm || !norm.ok) {
    return { level: 'safe', reasons: ['unparsable'], norm: null, message: null, needsLlm: false };
  }
  // Schemi/URL non navigabili o host locali: nessun avviso.
  if (norm.single || norm.suffixOnly) {
    return { level: 'safe', reasons: ['local_host'], norm, message: null, needsLlm: false };
  }

  const { gsb, ageDays, cert, sandbox, llm } = asyncData;
  const page = pagePath(norm.host, url);
  const hosted = hostedPlatform(norm.host, page);
  // Conferma e chiusura di un avviso valgono per il sito; su una pagina ospitata solo per quella pagina.
  const scope = hosted ? norm.host + page : norm.registrable;
  const whitelisted = !hosted && isWhitelisted(norm.registrable);
  let urlPath = '';
  try { urlPath = new URL(String(url)).pathname; } catch (_) {}
  const sigs = localSignals(norm, { ...ctx, urlPath });
  const reasons = sigs.map((s) => s.kind).concat(hosted ? ['hosted_content'] : []);

  // Blacklist: prevale su tutto, anche sulla whitelist.
  if (gsb && gsb.listed) {
    const message = buildMessage({ level: 'pericoloso', norm, gsb, hosted });
    return { level: 'pericoloso', reasons: ['gsb_' + (gsb.category || 'listed')], norm, message, gsb, needsLlm: false, whitelisted, hosted, scope };
  }

  const strict = sigs.find((s) => s.kind === 'strict_impersonation') || null;
  const weakTypo = sigs.find((s) => s.kind === 'weak_typo') || null;
  const broad = sigs.find((s) => s.kind === 'broad_impersonation') || null;
  const imp = strict || weakTypo || broad;
  const hasPassword = !!ctx.hasPassword;
  const hasPayment = !!ctx.hasPayment;
  const certBad = cert && CERT_BAD.has(cert.status);
  const young = ageDays != null && ageDays < YOUNG_DOMAIN_DAYS;
  const veryYoung = ageDays != null && ageDays < VERY_YOUNG_DOMAIN_DAYS;
  const sandboxBad = sandbox && sandbox.verdict === 'dangerous';
  const sandboxSus = sandbox && sandbox.verdict === 'suspicious';
  const doubleExt = sigs.find((s) => s.kind === 'double_extension') || null;
  const autoDl = sigs.find((s) => s.kind === 'auto_download') || null;
  const insecureForm = sigs.some((s) => s.kind === 'insecure_form');
  const fileRisk = !!(doubleExt || autoDl);
  const sensitive = hasPassword || hasPayment;
  const fatti = { autoDl, doubleExt, insecureForm };

  // La whitelist certifica l'IDENTITÀ: niente impersonazione/LLM. Restano i controlli indipendenti dal contenuto:
  // certificato, file della pagina, modulo in chiaro.
  if (whitelisted) {
    const level = (fileRisk && certBad) ? 'pericoloso' : (certBad || fileRisk || insecureForm) ? 'sospetto' : 'safe';
    if (level === 'safe') return { level, reasons: ['whitelisted'], norm, message: null, needsLlm: false, whitelisted };
    const message = buildMessage({ level, norm, cert, hasPassword, hasPayment, ...fatti });
    return {
      level, reasons: reasons.concat(certBad ? ['cert_' + cert.status] : [], ['whitelisted']),
      norm, message, cert, needsLlm: false, whitelisted, scope,
    };
  }

  // ── PERICOLOSO ────────────────────────────────────────────────────────
  // strict impersonation da sola basta; oppure rinforzi forti combinati.
  const strongCombo =
    (broad && (young || certBad)) ||
    // #728 — il typo su un brand corto blocca solo col secondo segnale.
    (weakTypo && (young || certBad || sensitive)) ||
    (sandboxBad) ||
    (imp && sensitive && certBad) ||
    (fileRisk && (young || certBad));
  if (strict || strongCombo) {
    const message = buildMessage({ level: 'pericoloso', norm, imp, ageDays: young ? ageDays : null, cert, hasPassword, hasPayment, sandbox, hosted, ...fatti });
    return {
      level: 'pericoloso',
      reasons: reasons.concat(young ? ['young_domain'] : [], certBad ? ['cert_' + cert.status] : [], sandboxBad ? ['sandbox_dangerous'] : []),
      norm, message, imp, ageDays, cert, needsLlm: false, whitelisted, hosted, scope,
    };
  }

  // ── SOSPETTO ──────────────────────────────────────────────────────────
  const llmSus = llm && llm.suspicious;
  const impSus = weakTypo || broad;
  const suspectTriggers = !!(impSus || young || certBad || (sigs.some((s) => s.kind === 'insecure_transport') && sensitive) || fileRisk || insecureForm || sandboxSus || llmSus);
  if (suspectTriggers) {
    let message = buildMessage({ level: 'sospetto', norm, imp: impSus, ageDays: young ? ageDays : null, cert, hasPassword, hasPayment, sandbox, hosted, ...fatti });
    // Su una pagina ospitata il dominio è della piattaforma: nominarlo farebbe credere che la pagina sia sua.
    if (hosted && !impSus && !certBad && !fileRisk && !insecureForm) {
      message = {
        title: 'Pagina pubblicata da un utente',
        body: `Questa pagina è su ${hosted}, dove chiunque può pubblicare: non l'ha scritta chi gestisce ${norm.hostUnicode || norm.host}.`,
      };
    }
    // LLM rinforza il testo se ha una motivazione fissa.
    if (llmSus && llm.reason && !impSus && !young && !certBad) {
      message.body = `${message.body} ${llm.reason}`.trim();
    }
    return {
      level: 'sospetto',
      reasons: reasons.concat(young ? ['young_domain'] : [], certBad ? ['cert_' + cert.status] : [], llmSus ? ['llm'] : []),
      norm, message, imp: impSus, ageDays, cert, needsLlm: false, whitelisted, hosted, scope,
    };
  }

  // ── SAFE ──────────────────────────────────────────────────────────────
  // needsLlm: c'è un segnale non conclusivo che merita il giudizio LLM (mai su
  // siti puliti senza alcun indizio, mai whitelist). Qui scatta se c'è un
  // indizio debole isolato (es. http+nessun altro) e mancano i dati di rete.
  // Su una pagina ospitata l'età del dominio è quella della piattaforma: non dice niente su chi chiede la password.
  const weakHint = sigs.some((s) => s.kind === 'insecure_transport') || (ageDays == null && (broad || sensitive))
    || (hosted && sensitive);
  return { level: 'safe', reasons: reasons.length ? reasons : ['clean'], norm, message: null, needsLlm: !!weakHint && !whitelisted, whitelisted, hosted };
}

function checkSync(url, ctx = {}) {
  return evaluate(url, ctx, {});
}

module.exports = { evaluate, checkSync, buildMessage, agePhrase, YOUNG_DOMAIN_DAYS, VERY_YOUNG_DOMAIN_DAYS };
