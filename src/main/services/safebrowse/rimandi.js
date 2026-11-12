// Link accorciati e rimandi noti (#966): gli unici link su cui il puntatore fermo fa partire controlli di rete prima
// del clic. Un rimando che porta la destinazione nell'indirizzo si legge da qui, senza aprirlo; un accorciato no.
// Regole: tests/unit/safebrowseLinkAccorciati.test.mjs

'use strict';

// Accorciatori pubblici: chiunque ci fa puntare un indirizzo qualsiasi. Quelli di un marchio verso i suoi siti
// (youtu.be, amzn.to) restano fuori: la destinazione è già nota.
const ACCORCIATORI = new Set([
  'bit.ly', 'bitly.com', 'j.mp', 'bit.do', 'tinyurl.com', 'tiny.cc', 'tiny.one', 'is.gd', 'v.gd', 'x.gd',
  'ow.ly', 'buff.ly', 't.co', 'lnkd.in', 'rebrand.ly', 'rb.gy', 'cutt.ly', 'shorturl.at', 't.ly', 'bl.ink',
  'short.gy', 's.id', 'dub.sh', 'ift.tt', 'dlvr.it', 'trib.al', 'hubs.ly', 'hubs.la', 'mailchi.mp', 'goo.gl',
  'shorte.st', 'sh.st', 'adf.ly', 'ouo.io', 'bc.vc', 'clck.ru', 'u.to', 'vk.cc', 'gg.gg', 'qrco.de', 'urlz.fr',
  'kutt.it', 't2m.io', 'surl.li', 'me2.do', 'han.gl', 'tny.im', 'soo.gd', 'cli.gs', 'po.st',
]);

// Rimandi che non scrivono la destinazione nell'indirizzo: come un accorciato, si scoprono solo aprendoli.
const TRACCIATORI = [
  { host: /(^|\.)list-manage\.com$/, path: /^\/track\/click/ },
  { host: /(^|\.)ct\.sendgrid\.net$/, path: /^\/ls\/click/ },
];

const GOOGLE = /^(www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
// `param`: i parametri dove sta la destinazione, nell'ordine; `decodifica`: per chi la scrive in un suo formato.
const RIMANDI = [
  { host: GOOGLE, path: /^\/url$/, param: ['q', 'url'] },
  { host: /^(l|lm)\.facebook\.com$/, path: /^\/l\.php$/, param: ['u'] },
  { host: /^l\.messenger\.com$/, path: /^\/l\.php$/, param: ['u'] },
  { host: /^l\.(instagram\.com|threads\.net)$/, path: /^\/$/, param: ['u'] },
  { host: /^(www\.|m\.)?youtube\.com$/, path: /^\/redirect$/, param: ['q'] },
  { host: /^out\.reddit\.com$/, path: /^\//, param: ['url'] },
  { host: /^(www\.)?linkedin\.com$/, path: /^\/(redir\/redirect|safety\/go)\/?$/, param: ['url'] },
  { host: /^(m\.)?vk\.com$/, path: /^\/away\.php$/, param: ['to'] },
  { host: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, param: ['url', 'u'] },
  { host: /^slack-redir\.net$/, path: /^\/link$/, param: ['url'] },
  { host: /\.safelinks\.protection\.outlook\.com$/, path: /^\//, param: ['url'] },
  { host: /^duckduckgo\.com$/, path: /^\/l\/?$/, param: ['uddg'] },
  { host: /^t\.umblr\.com$/, path: /^\/redirect$/, param: ['z'] },
  { host: /^exit\.sc$/, path: /^\//, param: ['url'] },
  { host: /^go\.redirectingat\.com$/, path: /^\//, param: ['url'] },
  { host: /^click\.linksynergy\.com$/, path: /^\//, param: ['murl'] },
  { host: /^(www\.)?awin1\.com$/, path: /^\/cread\.php$/, param: ['ued', 'p'] },
  { host: /^href\.li$/, path: /^\/$/, decodifica: (u) => decodeURIComponent(u.search.slice(1)) },
  // Proofpoint: v2 scrive l'indirizzo in `u` con «-» al posto di «%» e «_» al posto di «/»; v3 lo tiene fra «__».
  { host: /^urldefense\.proofpoint\.com$/, path: /^\/v2\/url$/, decodifica: (u) => decodeURIComponent(String(u.searchParams.get('u') || '').replace(/-/g, '%').replace(/_/g, '/')) },
  { host: /^urldefense\.(com|proofpoint\.com)$/, path: /^\/v3\/__/, decodifica: (u) => (/^\/v3\/__(.+?)__;/.exec(u.pathname + u.search + u.hash) || [])[1] },
];

function web(s) {
  try {
    const u = new URL(String(s || '').trim());
    return /^https?:$/.test(u.protocol) && u.hostname ? u.href : null;
  } catch (_) { return null; }
}

const hostDi = (u) => u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

// null: un link qualunque. { tipo: 'accorciato' }: la destinazione si scopre solo aprendolo.
// { tipo: 'rimando', destinazione }: la destinazione è scritta nell'indirizzo.
function tipo(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return null;
  const host = hostDi(u);
  const percorso = u.pathname || '/';
  // La radice di un accorciatore è il suo sito, non un link.
  if (ACCORCIATORI.has(host)) return percorso.length > 1 ? { tipo: 'accorciato' } : null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (TRACCIATORI.some((r) => r.host.test(h) && r.path.test(percorso))) return { tipo: 'accorciato' };
  for (const r of RIMANDI) {
    if (!r.host.test(h) || !r.path.test(percorso)) continue;
    let dest = null;
    try {
      if (r.decodifica) dest = web(r.decodifica(u));
      else for (const p of r.param) { dest = web(u.searchParams.get(p)); if (dest) break; }
    } catch (_) { dest = null; }
    return dest ? { tipo: 'rimando', destinazione: dest } : null;
  }
  return null;
}

// La finestra nascosta prosegue solo attraverso gli accorciati: un rimando che scrive la destinazione si legge, non si visita.
function siApre(url) {
  const t = tipo(url);
  return !!t && t.tipo === 'accorciato';
}

module.exports = { tipo, siApre, ACCORCIATORI };
