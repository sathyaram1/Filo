// Forma canonica del dominio: un sito camuffato va confrontato per ciò che è, non per come
// appare nella barra. Host senza porta, IDNA nei due sensi, NFC, eTLD+1 dalla PSL.
// Si usano domainToASCII/Unicode di node:url (ICU) invece del modulo punycode, deprecato.

'use strict';

const { domainToASCII, domainToUnicode } = require('node:url');
const { getDomainInfo, isIpAddress } = require('./psl');

// Accetta un URL completo o un host nudo; { host, protocol, port } o null se non parsabile.
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

// null se l'input non ha un hostname analizzabile (about:, data:, javascript:, file).
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
  // NFC più minuscole: le varianti di compatibilità collassano, ma la «Е» cirillica resta
  // distinta dalla latina.
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
