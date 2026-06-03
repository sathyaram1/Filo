// Stage 0 della pipeline: normalizzazione del dominio.
//
// Prima di QUALSIASI confronto serve una forma canonica del dominio. Un sito
// camuffato va confrontato per ciò che è davvero, non per come appare nella
// barra degli indirizzi. Qui:
//   - estraiamo l'hostname dall'URL (senza porta, userinfo, path)
//   - decodifichiamo punycode/IDNA in entrambe le direzioni (ascii ⇄ unicode)
//   - applichiamo Unicode NFC + case-folding
//   - estraiamo il dominio registrabile (eTLD+1) con la Public Suffix List
//
// Usiamo `domainToASCII`/`domainToUnicode` di `node:url` (basati su ICU, NON
// deprecati) invece del modulo `punycode` (DEP0040). domainToASCII applica già
// l'IDNA UTS-46 e ritorna stringa vuota su input non valido.

'use strict';

const { domainToASCII, domainToUnicode } = require('node:url');
const { getDomainInfo, isIpAddress } = require('./psl');

// Estrae l'hostname da una stringa che può essere un URL completo o un bare
// host. Ritorna { host, protocol, port } oppure null se non parsabile.
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
  // Solo schemi "navigabili" hanno un dominio sensato da analizzare.
  const proto = u.protocol.replace(/:$/, '');
  let host = u.hostname || '';
  // URL.hostname per IPv6 arriva fra parentesi quadre: toglile.
  host = host.replace(/^\[|\]$/g, '');
  if (!host) return null;
  return { host: host.toLowerCase(), protocol: proto, port: u.port || '' };
}

// Normalizza un URL/host in forma canonica per tutti i confronti a valle.
// Ritorna null se l'input non contiene un hostname analizzabile (es. about:,
// data:, javascript:, file senza host).
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

  // Forma ASCII (punycode) canonica: domainToASCII applica IDNA UTS-46. Se
  // fallisce (input degenere) ricadiamo sull'host così com'è.
  const ascii = (domainToASCII(host) || host).toLowerCase();
  // Forma Unicode leggibile: NFC + lowercase, così "Е" (cirillico) e simili
  // restano distinti dai latini ma le varianti di compatibilità collassano.
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
