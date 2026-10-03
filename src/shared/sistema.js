// Ora, batteria, rete e Bluetooth come Filo li dice: dalla lettura del sistema ai testi della home e alle righe del prompt.
// Logica pura: chi legge il computer è src/main/services/statoSistema.js; un dato che manca resta null e non si inventa.
// Prove: tests/unit/sistema.test.mjs.

(function (global) {
  'use strict';

  const VOCI = ['ora', 'batteria', 'rete', 'bluetooth'];
  // Un SSID sta in 32 byte; un nome Bluetooth arriva a 248. Oltre, il taglio si vede.
  const NOME_MAX = 64;
  const DISPOSITIVI_MAX = 30;

  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
    'settembre', 'ottobre', 'novembre', 'dicembre'];

  // Il nome di una rete o di un dispositivo lo sceglie chi la gestisce: niente caratteri invisibili né a capo.
  function pulisciNome(v) {
    if (typeof v !== 'string') return null;
    const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏ -‮⁠-⁯﻿]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const lettere = Array.from(s);
    return lettere.length > NOME_MAX ? `${lettere.slice(0, NOME_MAX - 1).join('')}…` : s;
  }

  function normalizzaBatteria(b) {
    if (!b || typeof b !== 'object') return null;
    const n = Number(b.livello);
    if (b.livello === null || b.livello === '' || !Number.isFinite(n)) return null;
    const inCarica = b.inCarica === true;
    return {
      livello: Math.max(0, Math.min(100, Math.round(n))),
      inCarica,
      collegata: inCarica || b.collegata === true,
    };
  }

  function normalizzaRete(r) {
    if (!r || typeof r !== 'object' || typeof r.online !== 'boolean') return null;
    if (!r.online) return { online: false, tipo: null, nome: null };
    const tipo = r.tipo === 'wifi' || r.tipo === 'cavo' ? r.tipo : null;
    return { online: true, tipo, nome: tipo === 'wifi' ? pulisciNome(r.nome) : null };
  }

  function normalizzaBluetooth(b) {
    if (!b || typeof b !== 'object' || typeof b.acceso !== 'boolean') return null;
    if (!b.acceso) return { acceso: false, dispositivi: [] };
    let lista = b.dispositivi;
    if (typeof lista === 'string') lista = [lista];
    if (!Array.isArray(lista)) return { acceso: true, dispositivi: null };
    const visti = new Set();
    const dispositivi = [];
    for (const d of lista) {
      const nome = pulisciNome(d);
      if (!nome || visti.has(nome)) continue;
      visti.add(nome);
      dispositivi.push(nome);
    }
    return { acceso: true, dispositivi };
  }

  // Una lettura che arriva da fuori (un lettore di piattaforma, una prova) nella forma che il resto conosce.
  function normalizza(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      batteria: normalizzaBatteria(r.batteria),
      rete: normalizzaRete(r.rete),
      bluetooth: normalizzaBluetooth(r.bluetooth),
    };
  }

  const due = (n) => String(n).padStart(2, '0');

  function descriviOra(adesso) {
    const d = adesso instanceof Date ? adesso : new Date(adesso);
    const giorno = `${GIORNI[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}`;
    const ore = `${due(d.getHours())}:${due(d.getMinutes())}`;
    return {
      testo: ore,
      hover: giorno,
      icona: null,
      dettaglio: [`${giorno.charAt(0).toUpperCase()}${giorno.slice(1)} ${d.getFullYear()}`, `Ore ${ore}`],
      copia: `${giorno} ${d.getFullYear()}, ore ${ore}`,
    };
  }

  function descriviBatteria(b) {
    if (!b) return null;
    const stato = b.inCarica ? 'In carica' : b.collegata ? 'Collegata' : 'A batteria';
    const frase = b.inCarica ? 'in carica'
      : b.collegata ? 'collegata alla corrente, non in carica' : 'non collegata alla corrente';
    return {
      testo: `${b.livello}%`,
      hover: stato,
      icona: b.inCarica ? 'batteryCharging' : 'battery',
      livello: b.livello,
      bassa: !b.collegata && b.livello <= 15,
      dettaglio: [`Batteria al ${b.livello}%`, `${frase.charAt(0).toUpperCase()}${frase.slice(1)}`],
      copia: `Batteria al ${b.livello}%, ${frase}`,
    };
  }

  function descriviRete(r) {
    if (!r) return null;
    if (!r.online) {
      return {
        testo: 'offline',
        hover: 'Offline',
        icona: 'wifiOff',
        offline: true,
        dettaglio: ['Offline', 'Il computer non è collegato a nessuna rete'],
        copia: 'Offline: il computer non è collegato a nessuna rete',
      };
    }
    if (r.tipo === 'wifi') {
      const dove = r.nome ? `Wi-Fi «${r.nome}»` : 'Wi-Fi';
      return {
        testo: r.nome || '',
        hover: 'Wi-Fi',
        icona: 'wifi',
        offline: false,
        dettaglio: [`Collegato al ${dove}`],
        copia: `Collegato al ${dove}`,
      };
    }
    if (r.tipo === 'cavo') {
      return { testo: '', hover: 'Cavo', icona: 'ethernet', offline: false, dettaglio: ['Collegato via cavo'], copia: 'Collegato via cavo' };
    }
    return { testo: '', hover: 'Collegato', icona: 'globe', offline: false, dettaglio: ['Collegato alla rete'], copia: 'Collegato alla rete' };
  }

  function descriviBluetooth(b) {
    if (!b) return null;
    if (!b.acceso) {
      return { testo: '', hover: 'Bluetooth spento', icona: 'bluetoothOff', spento: true, dettaglio: ['Bluetooth spento'], copia: 'Bluetooth spento' };
    }
    const lista = b.dispositivi;
    let righe;
    if (lista === null) righe = ['Bluetooth acceso'];
    else if (!lista.length) righe = ['Bluetooth acceso', 'Nessun dispositivo collegato'];
    else righe = ['Bluetooth acceso', `Collegati: ${lista.join(', ')}`];
    return {
      testo: lista && lista.length ? String(lista.length) : '',
      hover: 'Bluetooth acceso',
      icona: 'bluetooth',
      spento: false,
      dettaglio: righe,
      copia: righe.join(': '),
    };
  }

  // Le voci della home: null dove il dato manca, e la voce non compare.
  function descrivi(stato, adesso = new Date()) {
    const s = normalizza(stato);
    return {
      ora: descriviOra(adesso),
      batteria: descriviBatteria(s.batteria),
      rete: descriviRete(s.rete),
      bluetooth: descriviBluetooth(s.bluetooth),
    };
  }

  // Le righe del prompt: `righe` sono parole di Filo, `nomi` li sceglie chi gestisce la rete o il dispositivo e
  // vanno recintati da chi compone il prompt.
  function righePrompt(stato) {
    const s = normalizza(stato);
    const righe = [];
    const nomi = [];
    const b = s.batteria;
    if (!b) righe.push('Batteria: nessuna (computer fisso, o il sistema non la dice).');
    else if (b.inCarica) righe.push(`Batteria: ${b.livello}%, in carica.`);
    else if (b.collegata) righe.push(`Batteria: ${b.livello}%, collegata alla corrente (non in carica).`);
    else righe.push(`Batteria: ${b.livello}%, non collegata alla corrente.`);
    const r = s.rete;
    if (!r) righe.push('Rete: il sistema non lo dice.');
    else if (!r.online) righe.push('Rete: OFFLINE, il computer non è collegato a nessuna rete.');
    else if (r.tipo === 'wifi') {
      righe.push(`Rete: collegato via Wi-Fi${r.nome ? ' (nome della rete qui sotto)' : ''}.`);
      if (r.nome) nomi.push(`Rete Wi-Fi: ${r.nome}`);
    } else if (r.tipo === 'cavo') righe.push('Rete: collegato via cavo.');
    else righe.push('Rete: collegato.');
    const bt = s.bluetooth;
    if (!bt) righe.push('Bluetooth: nessun adattatore (o il sistema non lo dice).');
    else if (!bt.acceso) righe.push('Bluetooth: spento.');
    else if (bt.dispositivi === null) righe.push('Bluetooth: acceso (quali dispositivi sono collegati il sistema non lo dice).');
    else if (!bt.dispositivi.length) righe.push('Bluetooth: acceso, nessun dispositivo collegato.');
    else {
      const n = bt.dispositivi.length;
      righe.push(`Bluetooth: acceso, ${n === 1 ? '1 dispositivo collegato' : `${n} dispositivi collegati`} (nomi qui sotto).`);
      const elenco = bt.dispositivi.slice(0, DISPOSITIVI_MAX).join(', ');
      const resto = n > DISPOSITIVI_MAX ? ` e altri ${n - DISPOSITIVI_MAX}` : '';
      nomi.push(`Dispositivi Bluetooth collegati: ${elenco}${resto}`);
    }
    return { righe, nomi };
  }

  // Le voci che l'utente tiene nella home (Preferenze, chat, tasto destro): senza scelta, tutte.
  function vociVisibili(settings) {
    const scelte = (settings && settings.homeSistema) || {};
    const out = {};
    for (const v of VOCI) out[v] = scelte[v] !== false;
    return out;
  }

  global.SN_SISTEMA = { VOCI, NOME_MAX, normalizza, descrivi, righePrompt, vociVisibili, pulisciNome };
})(typeof globalThis !== 'undefined' ? globalThis : self);
