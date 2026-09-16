// Stage 0: forma canonica del dominio. Prima di QUALSIASI confronto serve, perché un sito camuffato va confrontato per ciò che è davvero, non per come appare nella barra degli indirizzi.
// Hostname senza porta/userinfo/path, punycode/IDNA in entrambe le direzioni, Unicode NFC + case-folding, eTLD+1 dalla Public Suffix List.
// Si usano `domainToASCII`/`domainToUnicode` di node:url (ICU, non deprecati) invece del modulo `punycode` (DEP0040): applicano già IDNA UTS-46 e tornano stringa vuota su input non valido.

'use strict';

const { domainToASCII, domainToUnicode } = require('node:url');
const { getDomainInfo, isIpAddress } = require('./psl');

// Accetta un URL completo o un host nudo. Ritorna { host, protocol, port } oppure null se non parsabile.
function parseHost(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  let u = null;
  try {
    u = new URL(s);
  } catch (_) {
    // Niente schema: prova come host nudo dietro http://.
    try { u = new URL('http://' + s); } catch (_) { return null; }
  }
  // Solo gli schemi "navigabili" hanno un dominio sensato da analizzare.
  const proto = u.protocol.replace(/:$/, '');
  let host = u.hostname || '';
  // URL.hostname per IPv6 arriva fra parentesi quadre: si tolgono.
  host = host.replace(/^\[|\]$/g, '');
  if (!host) return null;
  return { host: host.toLowerCase(), protocol: proto, port: u.port || '' };
}

// null se l'input non contiene un hostname analizzabile (about:, data:, javascript:, file senza host).
function normalize(input) {
  const parsed = parseHost(input);
  if (!parsed) return null;
  const { host, protocol, port } = parsed;

  // IP: nessun eTLD+1, nessuna impersonazione di brand via dominio.
  if (isIpAddress(host)) {
    return {
      ok: true,
      protocol,
      port,
      isIp: true,
      host,
      hostUnicode: host,
      registrable: host,
      registrableUnicode: host,
      publicSuffix: '',
      sld: host,
      sldUnicode: host,
      labels: [host],
      secure: protocol === 'https',
    };
  }

  // Se domainToASCII fallisce (input degenere) si ricade sull'host così com'è.
  const ascii = (domainToASCII(host) || host).toLowerCase();
  // Forma Unicode leggibile: NFC + lowercase, così le varianti di compatibilità collassano ma "Е" cirillico resta distinto dal latino.
  let unicode = domainToUnicode(ascii) || host;
  unicode = unicode.normalize('NFC').toLowerCase();

  const info = getDomainInfo(ascii);
  if (!info) return null;

  const registrable = info.registrable;
  const sld = info.sld || '';
  const registrableUnicode = registrable ? (domainToUnicode(registrable) || registrable).normalize('NFC').toLowerCase() : registrable;
  // sld è una singola label: domainToUnicode su una label sola decodifica xn--.
  const sldUnicode = sld ? (domainToUnicode(sld) || sld).normalize('NFC').toLowerCase() : sld;

  return {
    ok: true,
    protocol,
    port,
    isIp: false,
    single: !!info.single,
    suffixOnly: !!info.suffixOnly,
    host: ascii,
    hostUnicode: unicode,
    registrable,
    registrableUnicode,
    publicSuffix: info.publicSuffix,
    sld,
    sldUnicode,
    labels: info.labels,
    secure: protocol === 'https',
  };
}

module.exports = { normalize, parseHost };
