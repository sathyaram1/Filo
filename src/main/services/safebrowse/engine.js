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
const { isWhitelisted } = require('./whitelist');
const { localSignals } = require('./signals');

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

// Costruisce il messaggio specifico dai segnali fidati. `lead` è il segnale
// guida; gli altri diventano frasi di rinforzo.
function buildMessage({ level, norm, gsb, imp, ageDays, cert, hasPassword, hasPayment, sandbox }) {
  const dom = norm.registrableUnicode || norm.registrable || norm.host;
  // 1) Blacklist: prevale su tutto.
  if (gsb && gsb.listed) {
    return {
      title: 'Sito segnalato come pericoloso',
      body: `Google Safe Browsing classifica ${dom} come ${gsbText(gsb.category)}.`,
    };
  }
  const facts = [];
  if (ageDays != null && ageDays < YOUNG_DOMAIN_DAYS) facts.push(`registrato ${agePhrase(ageDays)}`);
  if (cert && CERT_BAD.has(cert.status)) facts.push(certText(cert.status));
  if (hasPassword) facts.push('ti sta chiedendo la password');
  else if (hasPayment) facts.push('ti chiede i dati di pagamento');
  if (sandbox && sandbox.verdict === 'dangerous') facts.push('analizzato in isolamento, mostra comportamento ingannevole');
  const tail = facts.length ? (', ' + joinIt(facts) + '.') : '.';

  // 2) Impersonazione stretta.
  if (imp && imp.kind === 'strict_impersonation') {
    return {
      title: `Attenzione: questo non è ${imp.brand.display}`,
      body: `Questo non è ${imp.brand.display}. Il dominio è ${dom}${tail}`,
    };
  }
  // 3) Impersonazione larga.
  if (imp && imp.kind === 'broad_impersonation') {
    return {
      title: `${imp.brand.display}? Controlla l'indirizzo`,
      body: `${dom} usa il nome "${imp.brand.display}" ma non è un indirizzo ufficiale di ${imp.brand.display}${tail}`,
    };
  }
  // 4) Solo segnali non legati all'identità.
  if (cert && CERT_BAD.has(cert.status)) {
    return { title: 'Connessione non sicura', body: `La connessione a ${dom} non è protetta: ${certText(cert.status)}.` };
  }
  if (ageDays != null && ageDays < YOUNG_DOMAIN_DAYS) {
    return { title: 'Dominio registrato da poco', body: `Il dominio ${dom} è stato registrato ${agePhrase(ageDays)}.` };
  }
  if (sandbox && sandbox.verdict === 'dangerous') {
    return { title: 'Comportamento sospetto', body: `Aperto in isolamento, ${dom} mostra un comportamento ingannevole.` };
  }
  return { title: 'Sito potenzialmente sospetto', body: `Fai attenzione su ${dom}.` };
}

function joinIt(arr) {
  if (arr.length <= 1) return arr.join('');
  return arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
}

// Valutazione completa. `asyncData` opzionale: { gsb, ageDays, cert, ctAgeDays,
// sandbox, llm }. `ctx` opzionale (indizi pagina): { hasPassword, hasPayment,
// mixedContent, autoDownload, urlPath }.
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
  const whitelisted = isWhitelisted(norm.registrable);
  const sigs = localSignals(norm, ctx);
  const reasons = sigs.map((s) => s.kind);

  // Blacklist: prevale su tutto, anche sulla whitelist.
  if (gsb && gsb.listed) {
    const message = buildMessage({ level: 'pericoloso', norm, gsb });
    return { level: 'pericoloso', reasons: ['gsb_' + (gsb.category || 'listed')], norm, message, gsb, needsLlm: false, whitelisted };
  }

  const strict = sigs.find((s) => s.kind === 'strict_impersonation') || null;
  const broad = sigs.find((s) => s.kind === 'broad_impersonation') || null;
  const imp = strict || broad;
  const hasPassword = !!ctx.hasPassword;
  const hasPayment = !!ctx.hasPayment;
  const certBad = cert && CERT_BAD.has(cert.status);
  const young = ageDays != null && ageDays < YOUNG_DOMAIN_DAYS;
  const veryYoung = ageDays != null && ageDays < VERY_YOUNG_DOMAIN_DAYS;
  const sandboxBad = sandbox && sandbox.verdict === 'dangerous';
  const sandboxSus = sandbox && sandbox.verdict === 'suspicious';
  const doubleExt = sigs.some((s) => s.kind === 'double_extension');
  const sensitive = hasPassword || hasPayment;

  // La whitelist certifica l'IDENTITÀ: niente impersonazione/LLM. Restano i
  // controlli indipendenti dal contenuto (certificato, trasporto).
  if (whitelisted) {
    if (certBad) {
      const message = buildMessage({ level: 'sospetto', norm, cert });
      return { level: 'sospetto', reasons: ['cert_' + cert.status], norm, message, cert, needsLlm: false, whitelisted };
    }
    return { level: 'safe', reasons: ['whitelisted'], norm, message: null, needsLlm: false, whitelisted };
  }

  // ── PERICOLOSO ────────────────────────────────────────────────────────
  // strict impersonation da sola basta; oppure rinforzi forti combinati.
  const strongCombo =
    (broad && (young || certBad)) ||
    (sandboxBad) ||
    (imp && sensitive && certBad) ||
    (doubleExt && (young || certBad));
  if (strict || strongCombo) {
    const message = buildMessage({ level: 'pericoloso', norm, imp, ageDays: young ? ageDays : null, cert, hasPassword, hasPayment, sandbox });
    return {
      level: 'pericoloso',
      reasons: reasons.concat(young ? ['young_domain'] : [], certBad ? ['cert_' + cert.status] : [], sandboxBad ? ['sandbox_dangerous'] : []),
      norm, message, imp, ageDays, cert, needsLlm: false, whitelisted,
    };
  }

  // ── SOSPETTO ──────────────────────────────────────────────────────────
  const llmSus = llm && llm.suspicious;
  const suspectTriggers = !!(broad || young || certBad || (sigs.some((s) => s.kind === 'insecure_transport') && sensitive) || doubleExt || sandboxSus || llmSus);
  if (suspectTriggers) {
    const message = buildMessage({ level: 'sospetto', norm, imp: broad, ageDays: young ? ageDays : null, cert, hasPassword, hasPayment, sandbox });
    // LLM rinforza il testo se ha una motivazione fissa.
    if (llmSus && llm.reason && !broad && !young && !certBad) {
      message.body = `${message.body} ${llm.reason}`.trim();
    }
    return {
      level: 'sospetto',
      reasons: reasons.concat(young ? ['young_domain'] : [], certBad ? ['cert_' + cert.status] : [], llmSus ? ['llm'] : []),
      norm, message, imp: broad, ageDays, cert, needsLlm: false, whitelisted,
    };
  }

  // ── SAFE ──────────────────────────────────────────────────────────────
  // needsLlm: c'è un segnale non conclusivo che merita il giudizio LLM (mai su
  // siti puliti senza alcun indizio, mai whitelist). Qui scatta se c'è un
  // indizio debole isolato (es. http+nessun altro) e mancano i dati di rete.
  const weakHint = sigs.some((s) => s.kind === 'insecure_transport') || (ageDays == null && (broad || sensitive));
  return { level: 'safe', reasons: reasons.length ? reasons : ['clean'], norm, message: null, needsLlm: !!weakHint && !whitelisted, whitelisted };
}

function checkSync(url, ctx = {}) {
  return evaluate(url, ctx, {});
}

module.exports = { evaluate, checkSync, buildMessage, agePhrase, YOUNG_DOMAIN_DAYS, VERY_YOUNG_DOMAIN_DAYS };
