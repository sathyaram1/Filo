// La coda del giro di lettura della posta (#535): quanti compiti insieme, quanti tentativi, il contatore.
// Non legge e non chiama modelli: il compito lo passa chi la usa (`esegui`). Una caduta non resta mai muta.
// Sentinella: tests/unit/postaCoda.test.mjs.

(function (global) {
  'use strict';

  const PARALLELO = 3;
  // La prima prova più due riprove: alla terza caduta la mail resta «non letta da Filo».
  const TENTATIVI = 3;
  const ATTESE_MS = Object.freeze([2000, 8000]);
  // Troppe richieste non è colpa della mail: si rallenta senza consumarle i tentativi, ma non all'infinito.
  const ATTESE_TROPPE_MAX = 5;
  const ATTESA_TROPPE_MS = 15000;

  const attendiDavvero = (ms) => new Promise((r) => setTimeout(r, ms));

  function troppe(err) {
    return !!err && (err.troppe === true || err.status === 429 || err.code === 429);
  }

  // Crediti finiti, modello che non esiste, chiave mancante: riprovare la mail dopo non cambia niente.
  function ferma(err) {
    return !!err && err.ferma === true;
  }

  function messaggio(err) {
    const m = err && (err.message || err.messaggio);
    return String(m || err || 'errore sconosciuto').slice(0, 300);
  }

  function interoTra(v, min, max, def) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= min ? Math.min(n, max) : def;
  }

  function crea({ esegui, parallelo = PARALLELO, tentativi = TENTATIVI, attendi = attendiDavvero, aggiornato = null } = {}) {
    if (typeof esegui !== 'function') throw new TypeError('postaCoda: manca il compito da eseguire');
    let limite = interoTra(parallelo, 1, 20, PARALLELO);
    const massimo = interoTra(tentativi, 1, 10, TENTATIVI);
    const voci = new Map();
    const fila = [];
    let inCorso = 0;
    let fermata = '';
    let spenta = false;
    let attese = [];

    function stato() {
      let lette = 0; let daLeggere = 0; let fallite = 0;
      const nonLette = [];
      for (const v of voci.values()) {
        if (v.stato === 'letta') lette++;
        else if (v.stato === 'fallita') { fallite++; nonLette.push({ id: v.id, mail: v.mail, errore: v.errore, tentativi: v.tentativi }); }
        else daLeggere++;
      }
      const finito = inCorso === 0 && (fila.length === 0 || !!fermata || spenta);
      return { lette, daLeggere, fallite, inCorso, parallelo: limite, fermata, finito, nonLette };
    }

    function avvisa() {
      const s = stato();
      if (typeof aggiornato === 'function') { try { aggiornato(s); } catch (_) {} }
      if (s.finito && attese.length) {
        const chi = attese; attese = [];
        for (const r of chi) r(s);
      }
    }

    async function lavora(v) {
      inCorso++;
      v.stato = 'corso';
      v.tentativi++;
      avvisa();
      try {
        v.esito = await esegui(v.mail, v.tentativi);
        v.stato = 'letta';
        v.errore = '';
      } catch (err) {
        v.errore = messaggio(err);
        if (ferma(err)) {
          // La mail non ha colpa: torna in testa senza perdere un tentativo, e il giro si ferma col motivo.
          v.tentativi--;
          v.stato = 'attesa';
          fila.unshift(v.id);
          fermata = v.errore;
        } else if (troppe(err) && v.troppe < ATTESE_TROPPE_MAX) {
          v.tentativi--;
          v.troppe++;
          limite = Math.max(1, limite - 1);
          v.stato = 'pausa';
          inCorso--;
          avvisa();
          await attendi(ATTESA_TROPPE_MS * v.troppe);
          v.stato = 'attesa';
          fila.unshift(v.id);
          pompa();
          return;
        } else if (v.tentativi < massimo) {
          v.stato = 'pausa';
          inCorso--;
          avvisa();
          await attendi(ATTESE_MS[Math.min(v.tentativi - 1, ATTESE_MS.length - 1)]);
          v.stato = 'attesa';
          fila.unshift(v.id);
          pompa();
          return;
        } else {
          v.stato = 'fallita';
        }
      }
      inCorso--;
      pompa();
    }

    function pompa() {
      while (!fermata && !spenta && inCorso < limite && fila.length) {
        const v = voci.get(fila.shift());
        if (v && v.stato === 'attesa') lavora(v);
      }
      avvisa();
    }

    // Le mail già viste in questo giro non rientrano: una lista che si riaggiorna non raddoppia i compiti.
    function aggiungi(mails) {
      let nuove = 0;
      for (const mail of Array.isArray(mails) ? mails : [mails]) {
        const id = mail && mail.id != null ? String(mail.id) : '';
        if (!id || voci.has(id)) continue;
        voci.set(id, { id, mail, stato: 'attesa', tentativi: 0, troppe: 0, errore: '', esito: null });
        fila.push(id);
        nuove++;
      }
      if (nuove) pompa();
      return nuove;
    }

    // Una mail «non letta da Filo» si rimette in coda solo a richiesta, con tutti i tentativi.
    function riprova(id) {
      const v = voci.get(String(id));
      if (!v || v.stato !== 'fallita') return false;
      Object.assign(v, { stato: 'attesa', tentativi: 0, troppe: 0, errore: '' });
      fila.push(v.id);
      pompa();
      return true;
    }

    // Dopo una fermata (crediti ricaricati, modello cambiato) il giro riparte da dove era.
    function riparti() {
      if (spenta) return false;
      fermata = '';
      pompa();
      return true;
    }

    // L'interruttore spento: i compiti già partiti finiscono, i nuovi no.
    function spegni() {
      spenta = true;
      avvisa();
    }

    function finito() {
      const s = stato();
      if (s.finito) return Promise.resolve(s);
      return new Promise((r) => attese.push(r));
    }

    return { aggiungi, riprova, riparti, spegni, stato, finito, esito: (id) => (voci.get(String(id)) || {}).esito ?? null };
  }

  function plurale(n, uno, molti) {
    return `${n} ${n === 1 ? uno : molti}`;
  }

  // «posta: 12 lette, 2 da leggere, 1 fallita»: finché il giro non è finito, o finché qualcosa è caduto.
  function etichetta(s) {
    if (!s) return '';
    const parti = [plurale(s.lette, 'letta', 'lette')];
    if (s.daLeggere) parti.push(`${s.daLeggere} da leggere`);
    if (s.fallite) parti.push(plurale(s.fallite, 'fallita', 'fallite'));
    const testo = `posta: ${parti.join(', ')}`;
    return s.fermata ? `${testo} · fermo: ${s.fermata}` : testo;
  }

  function daMostrare(s) {
    return !!s && (!s.finito || s.fallite > 0 || !!s.fermata);
  }

  global.SN_POSTA_CODA = Object.freeze({ PARALLELO, TENTATIVI, ATTESE_MS, crea, etichetta, daMostrare });
})(typeof globalThis !== 'undefined' ? globalThis : this);
