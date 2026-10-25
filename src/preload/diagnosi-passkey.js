// Diagnostica delle passkey (#1608), solo con FILO_DIAGNOSI_PASSKEY acceso: nel mondo di ogni frame web riassume le
// richieste WebAuthn e il loro esito, mai gli id né le risposte; con «ibrido» aggiunge hybrid ai trasporti. Spenta, nella
// pagina non entra niente. Il registro lo scrive services/diagnosiPasskey.js; prove: tests/unit/diagnosiPasskey.test.mjs.

const EVENTO_PASSKEY = 'filo:passkey-diagnosi';
const VARIABILE_PASSKEY = 'FILO_DIAGNOSI_PASSKEY';

// «ibrido» è la prova del trasporto mancante; ogni altro valore non vuoto registra soltanto.
function modoDiagnosiPasskey(valore) {
  const v = String(valore == null ? '' : valore).trim().toLowerCase();
  if (!v || v === '0' || v === 'no' || v === 'off' || v === 'false') return null;
  return { ibrido: v === 'ibrido' || v === 'hybrid' };
}

// Gira serializzata nel mondo della pagina (riquadri-vuoti.js): niente di fuori da qui, tranne `comeNativo` se c'è.
function corpoPasskey(cfg) {
  'use strict';
  var crea = Object.create, defP = Object.defineProperty, isArr = Array.isArray, json = JSON.stringify, adesso = Date.now;
  var CE = window.CustomEvent, manda = window.EventTarget.prototype.dispatchEvent, poi = Promise.prototype.then;
  var nativo = typeof comeNativo === 'function' ? comeNativo : function (f) { return f; };
  var IBRIDO = !!(cfg && cfg.ibrido), EVENTO = String((cfg && cfg.evento) || '');
  var marchi = '';
  try {
    var b = navigator.userAgentData && navigator.userAgentData.brands;
    for (var k = 0; b && k < b.length && k < 8; k++) marchi += (k ? ', ' : '') + b[k].brand + ' ' + b[k].version;
  } catch (e) {}
  function leggi(o, nome) { try { return o != null && typeof o === 'object' ? o[nome] : undefined; } catch (e) { return undefined; } }
  function testo(v, max) { return typeof v === 'string' ? v.slice(0, max) : undefined; }
  function stringhe(v) {
    if (!isArr(v)) return undefined;
    var out = [];
    for (var i = 0; i < v.length && i < 16; i++) out.push(typeof v[i] === 'string' ? v[i].slice(0, 40) : typeof v[i]);
    return out;
  }
  function lunghezzaId(id) {
    try {
      if (id && typeof id.byteLength === 'number') return id.byteLength;
      if (typeof id === 'string') return id.length;
    } catch (e) {}
    return null;
  }
  function campo(o, nome, v) { defP(o, nome, { value: v, enumerable: true, writable: true, configurable: true }); }
  function registra(rec) {
    try { manda.call(window, new CE(EVENTO, { detail: json(rec) })); } catch (e) {}
  }
  // Il riassunto di ciò che va davvero a Chromium; con IBRIDO, la copia dove le credenziali coi trasporti scritti e senza
  // hybrid lo hanno in più (gli altri campi si leggono da quelli della pagina, per prototipo).
  function prepara(nome, opzioni, pk) {
    var rec = { tipo: nome, marchi: marchi, mediazione: testo(leggi(opzioni, 'mediation'), 40) };
    var chiave = nome === 'get' ? 'allowCredentials' : 'excludeCredentials';
    if (nome === 'get') {
      rec.rpId = testo(leggi(pk, 'rpId'), 255);
      rec.verifica = testo(leggi(pk, 'userVerification'), 40);
    } else {
      rec.rpId = testo(leggi(leggi(pk, 'rp'), 'id'), 255);
      var sel = leggi(pk, 'authenticatorSelection');
      rec.collegamento = testo(leggi(sel, 'authenticatorAttachment'), 40);
      rec.residente = testo(leggi(sel, 'residentKey'), 40);
      rec.verifica = testo(leggi(sel, 'userVerification'), 40);
      rec.attestazione = testo(leggi(pk, 'attestation'), 40);
    }
    var t = leggi(pk, 'timeout');
    if (typeof t === 'number') rec.timeout = t;
    rec.suggerimenti = stringhe(leggi(pk, 'hints'));
    var est = leggi(pk, 'extensions');
    if (est && typeof est === 'object') { try { rec.estensioni = Object.keys(est).slice(0, 16); } catch (e) {} }
    var lista = leggi(pk, chiave), inviate = opzioni;
    if (isArr(lista)) {
      var nuova = [], cambiata = false;
      rec.quante = lista.length;
      rec.credenziali = [];
      for (var i = 0; i < lista.length; i++) {
        var d = lista[i], tr = stringhe(leggi(d, 'transports')), voce = { lunghezzaId: lunghezzaId(leggi(d, 'id')), trasporti: tr };
        var conIbrido = false;
        if (IBRIDO && tr && tr.length) {
          conIbrido = true;
          for (var j = 0; j < tr.length; j++) if (tr[j] === 'hybrid') conIbrido = false;
        }
        if (conIbrido && d && typeof d === 'object') {
          var piu = [];
          for (var q = 0; q < tr.length; q++) piu.push(tr[q]);
          piu.push('hybrid');
          var d2 = crea(d);
          campo(d2, 'transports', piu);
          nuova.push(d2);
          voce.trasporti = piu;
          voce.aggiunto = true;
          cambiata = true;
        } else nuova.push(d);
        if (i < 64) rec.credenziali.push(voce);
      }
      if (cambiata) {
        var pk2 = crea(pk);
        campo(pk2, chiave, nuova);
        inviate = crea(opzioni);
        campo(inviate, 'publicKey', pk2);
      }
    }
    return { opzioni: inviate, rec: rec };
  }
  function esito(rec, t0, c, e) {
    rec.ms = adesso() - t0;
    if (e) {
      rec.esito = 'errore';
      rec.errore = testo(leggi(e, 'name'), 60);
      rec.messaggio = testo(leggi(e, 'message'), 300);
    } else {
      rec.esito = c ? 'ok' : 'nulla';
      rec.usato = testo(leggi(c, 'authenticatorAttachment'), 40);
      try { var r = leggi(c, 'response'); if (r && typeof r.getTransports === 'function') rec.trasportiRisposta = stringhe(r.getTransports()); } catch (x) {}
    }
    registra(rec);
  }
  function metti(o, nome, f) {
    try { defP(o, nome, { value: nativo(f, o[nome], nome), writable: true, configurable: true, enumerable: true }); } catch (e) {}
  }
  return function (w) {
    var CC = w.CredentialsContainer && w.CredentialsContainer.prototype;
    ['get', 'create'].forEach(function (nome) {
      var f = CC && CC[nome];
      if (typeof f !== 'function') return;
      metti(CC, nome, { [nome](opzioni) {
        var pk = leggi(opzioni, 'publicKey');
        if (!pk || typeof pk !== 'object') return f.apply(this, arguments);
        var pronta;
        try { pronta = prepara(nome, opzioni, pk); } catch (e) { pronta = { opzioni: opzioni, rec: { tipo: nome, marchi: marchi, riassunto: 'non riuscito' } }; }
        var t0 = adesso(), p;
        try { p = f.call(this, pronta.opzioni); } catch (e) { esito(pronta.rec, t0, null, e); throw e; }
        try { poi.call(p, function (c) { esito(pronta.rec, t0, c, null); }, function (e) { esito(pronta.rec, t0, null, e); }); } catch (e) {}
        return p;
      } }[nome]);
    });
    // Le domande con cui un sito sceglie che accesso proporre: cosa ha chiesto e cosa gli è stato risposto.
    var PKC = w.PublicKeyCredential;
    ['isUserVerifyingPlatformAuthenticatorAvailable', 'isConditionalMediationAvailable', 'getClientCapabilities'].forEach(function (nome) {
      var f = PKC && PKC[nome];
      if (typeof f !== 'function') return;
      metti(PKC, nome, { [nome]() {
        var p = f.apply(this, arguments);
        try {
          poi.call(p, function (v) {
            var risposta = v;
            if (v && typeof v === 'object') { risposta = {}; for (var c in v) if (typeof v[c] === 'boolean') risposta[c] = v[c]; }
            registra({ tipo: 'capacita', nome: nome, marchi: marchi, risposta: risposta });
          }, function (e) { registra({ tipo: 'capacita', nome: nome, marchi: marchi, errore: testo(leggi(e, 'name'), 60) }); });
        } catch (e) {}
        return p;
      } }[nome]);
    });
  };
}

function buildPasskeyCorpo(modo) {
  return `(${corpoPasskey.toString()})(${JSON.stringify({ ibrido: !!(modo && modo.ibrido), evento: EVENTO_PASSKEY })})`;
}

module.exports = { buildPasskeyCorpo, corpoPasskey, modoDiagnosiPasskey, EVENTO_PASSKEY, VARIABILE_PASSKEY };
