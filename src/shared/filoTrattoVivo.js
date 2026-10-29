// Il tratto vivo della chat (SPEC-CONTESTO fase 3): il CONTESTO dell'utente a sezioni, fotografato, e prima di ogni
// messaggio dell'utente quello che è successo dal messaggio prima e le sezioni cambiate. Logica pura: fotografie e
// letture del filo stanno in src/main/services/contestoFilo.js. Sentinella: tests/unit/richiestaChat.test.mjs.

(function (global) {
  'use strict';

  const C = () => global.SN_CONST;
  const P = () => global.SN_CONST.PROMPTS;
  function E() {
    if (!global.SN_ESTERNO && typeof require === 'function') require('./contenutoEsterno.js');
    return global.SN_ESTERNO;
  }
  const stringa = (s) => typeof s === 'string' && s.length > 0;

  // ── Il CONTESTO dell'utente (blocco 3) ─────────────────────────────────────
  // Una sezione: `chiave`, `testo`, `confronto` (cosa deve cambiare perché la chat la riceva di nuovo), `righe` (la
  // memoria, che si confronta riga per riga), `perId` (i file, per id), `rifai` (un cambio rifà la fotografia).
  const RIGHE_NEUTRE = /^(PROFILO UTENTE:|PREFERENZE:|LEZIONI RECENTI:|\(vuoto\))$/;

  function righeMemoria({ profilo, preferenze, espansioni, lezioni }) {
    return [profilo, preferenze, espansioni, lezioni]
      .flatMap((t) => String(t || '').split('\n'))
      .map((r) => r.trim())
      .filter((r) => r && !RIGHE_NEUTRE.test(r));
  }

  function sezioniUtente({
    sistema, capacita = '', stile = '', modelName = '', profilo = '', preferenze = '', espansioni = '', lezioni = '',
    statoSezioni = null, stato = '', cambi = '', files = '', filesList = null,
  } = {}) {
    const out = [];
    const metti = (chiave, testo, extra = {}) => {
      const t = String(testo || '').trim();
      if (t) out.push({ chiave, testo: t, ...extra });
    };
    metti('COMPUTER', P().filoChatComputer(sistema));
    metti('CAPACITA', capacita ? P().filoChatCapacita(capacita) : '', { rifai: true });
    // Lo stile cambia di rado e vale per ogni risposta: cambiato, si rifà la fotografia invece di dirlo in un messaggio.
    metti('STILE', P().filoChatStile(stile), { rifai: true });
    metti('MODELLO', C().rigaNomeModello(modelName));
    metti('MEMORIA', C().memoriaImbustata({ profilo, preferenze, espansioni, lezioni }), {
      righe: righeMemoria({ profilo, preferenze, espansioni, lezioni }),
    });
    const sezStato = Array.isArray(statoSezioni) ? statoSezioni : (stato ? [{ chiave: 'STATO', testo: stato }] : []);
    for (const x of sezStato) {
      if (x && stringa(x.chiave)) metti(`STATO:${x.chiave}`, x.testo, { stato: true, ...(x.confronto != null ? { confronto: x.confronto } : {}) });
    }
    metti('CAMBI', P().filoChatCambiValute(cambi));
    const lista = Array.isArray(filesList) ? filesList.filter((f) => f && stringa(String(f.id || ''))) : null;
    metti('FILE', P().filoChatFile(files), lista ? { perId: lista.map((f) => [String(f.id), `- [${f.id}] ${f.title}: ${f.summary}`]) } : {});
    return out;
  }

  function quando(ts) {
    const FC = global.SN_FILO_CONTESTO;
    return FC && typeof FC.quando === 'function' ? FC.quando(ts) : new Date(ts).toISOString();
  }

  // Il testo del blocco 3: la data della fotografia in testa, lo STATO raccolto sotto il suo titolo.
  function parteUtente(sezioni, { ts = null } = {}) {
    const lista = Array.isArray(sezioni) ? sezioni : [];
    const q = ts != null && Number.isFinite(Date.parse(ts) || Number(ts)) ? quando(ts) : '';
    const parti = [`${C().INIZIO_PARTE_UTENTE}${q ? ` il ${q}` : ''}; quello che cambia dopo arriva nei messaggi dell'utente) ═══`];
    let statoAperto = false;
    for (const s of lista) {
      if (s.stato && !statoAperto) { parti.push('STATO:'); statoAperto = true; }
      parti.push(s.testo);
    }
    parti.push(P().filoChatRicorda());
    return parti.join('\n\n');
  }

  // Cosa è cambiato dalle sezioni già viste (`viste`: Map chiave → { confronto, righe, perId, rifai }). `rifai`: un
  // cambio che non si dice con un'aggiunta (una riga di memoria tolta, le capacità), e la fotografia si rifà: una riga
  // dimenticata non deve restare davanti al modello con accanto «tolta».
  function confronta(viste, sezioni) {
    const prima = viste instanceof Map ? viste : new Map();
    const nuove = new Map();
    const cambiate = [];
    let rifai = false;
    for (const s of Array.isArray(sezioni) ? sezioni : []) {
      const conf = s.confronto != null ? s.confronto : s.testo;
      nuove.set(s.chiave, { confronto: conf, righe: s.righe || null, perId: s.perId || null, rifai: !!s.rifai });
      const v = prima.get(s.chiave);
      if (v && v.confronto === conf) continue;
      if (s.rifai) { rifai = true; continue; }
      if (!v) { cambiate.push({ sezione: s }); continue; }
      if (Array.isArray(s.righe) && Array.isArray(v.righe)) {
        const ora = new Set(s.righe);
        if (v.righe.some((r) => !ora.has(r))) { rifai = true; continue; }
        const vecchie = new Set(v.righe);
        const aggiunte = s.righe.filter((r) => !vecchie.has(r));
        if (aggiunte.length) cambiate.push({ sezione: s, aggiunte });
        continue;
      }
      if (Array.isArray(s.perId) && Array.isArray(v.perId)) {
        const vecchi = new Map(v.perId);
        const ora = new Map(s.perId);
        const aggiornati = s.perId.filter(([id, r]) => vecchi.get(id) !== r).map(([, r]) => r);
        const tolti = v.perId.filter(([id]) => !ora.has(id)).map(([id]) => id);
        if (aggiornati.length || tolti.length) cambiate.push({ sezione: s, aggiornati, tolti });
        continue;
      }
      cambiate.push({ sezione: s });
    }
    for (const [k, v] of prima) {
      if (nuove.has(k)) continue;
      if (v.rifai || Array.isArray(v.righe)) rifai = true;
      else cambiate.push({ tolta: k });
    }
    return { cambiate, rifai, viste: nuove };
  }

  const NOMI_SEZIONI = { STILE: 'Lo stile di scrittura salvato', MODELLO: 'Il nome del modello', CAMBI: 'I cambi delle valute', FILE: 'I file dell\'editor' };
  function nomeSezione(chiave) {
    return String(chiave).startsWith('STATO:') ? String(chiave).slice(6) : (NOMI_SEZIONI[chiave] || chiave);
  }

  function rendiCambiate(cambiate) {
    const parti = [];
    for (const c of Array.isArray(cambiate) ? cambiate : []) {
      if (c.tolta) { parti.push(`${nomeSezione(c.tolta)}: non c'è più.`); continue; }
      const s = c.sezione;
      if (c.aggiunte) {
        parti.push(`MEMORIA, righe nuove (si aggiungono a quelle del CONTESTO):\n${E().imbusta({ tipo: 'MEMORIA_FILO', testo: c.aggiunte.join('\n'), conIntestazione: true })}`);
      } else if (c.aggiornati) {
        const righe = [];
        if (c.aggiornati.length) {
          righe.push(`FILE DELL'EDITOR nuovi o cambiati:\n${E().imbusta({ tipo: 'TESTO_SALVATO', conIntestazione: true, testo: c.aggiornati.map((r) => E().neutralizza(r, { unaRiga: true })).join('\n') })}`);
        }
        if (c.tolti.length) righe.push(`FILE DELL'EDITOR tolti: ${c.tolti.map((id) => `[${E().neutralizza(id, { unaRiga: true })}]`).join(', ')}`);
        parti.push(righe.join('\n'));
      } else parti.push(s.testo);
    }
    return parti.join('\n\n');
  }

  // ── Quello che è successo prima di un messaggio ───────────────────────────
  // Le azioni di una chat dentro un suo turno le racconta già il turno (strumenti ed esiti): qui no. Fuori da un turno
  // (una conferma data dopo, un tasto della home, l'Aiuto) sì.
  function turniDi(lista) {
    const turni = new Map();
    const aperti = new Map();
    const metti = (chat, u, r) => { if (!turni.has(chat)) turni.set(chat, []); turni.get(chat).push([u, r]); };
    for (const m of Array.isArray(lista) ? lista : []) {
      if (!m || m.riga || !m.chat) continue;
      const t = Date.parse(m.ts);
      if (!Number.isFinite(t)) continue;
      if (m.role === 'user') { if (!aperti.has(m.chat)) aperti.set(m.chat, t); } else if (aperti.has(m.chat)) {
        metti(m.chat, aperti.get(m.chat), t);
        aperti.delete(m.chat);
      }
    }
    for (const [chat, u] of aperti) metti(chat, u, Infinity);
    return turni;
  }

  const DI_UNA_CHAT = new Set(['azione', 'ricerca']);
  // Gli eventi di ogni messaggio dell'utente (chiave → eventi in ordine), quelli dopo il messaggio dell'utente prima,
  // di qualunque chat, e fino al suo. `da`: da dove parte il primo. Un seguito (#1296) sta dentro il turno che segue.
  function eventiPerMessaggi(lista, eventi, { da = null, chiave = (m) => `${m.chat}|${m.ts}` } = {}) {
    const out = new Map();
    const turni = turniDi(lista);
    const nelTurno = (ev, t) => DI_UNA_CHAT.has(ev.tipo) && stringa(ev.chat)
      && (turni.get(ev.chat) || []).some(([u, r]) => t >= u && t <= r);
    const ordinati = (Array.isArray(eventi) ? eventi : [])
      .map((ev, i) => ({ ev, i, t: Date.parse(ev && ev.ts) }))
      .filter((x) => x.ev && Number.isFinite(x.t) && !nelTurno(x.ev, x.t))
      .sort((a, b) => (a.t - b.t) || (a.i - b.i));
    let prec = da == null ? -Infinity : Date.parse(da);
    if (!Number.isFinite(prec)) prec = -Infinity;
    let k = 0;
    while (k < ordinati.length && ordinati[k].t <= prec) k++;
    for (const m of Array.isArray(lista) ? lista : []) {
      if (!m || m.riga || m.role !== 'user' || m.seguito) continue;
      const t = Date.parse(m.ts);
      if (!Number.isFinite(t)) continue;
      const presi = [];
      while (k < ordinati.length && ordinati[k].t <= t) presi.push(ordinati[k++].ev);
      out.set(chiave(m), presi);
    }
    return out;
  }

  const MAX_RIGHE_EVENTI = 60;
  const MAX_CAMPO = 200;
  const p2 = (n) => String(n).padStart(2, '0');
  function oraDi(ts, rif) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const hh = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const r = rif != null ? new Date(rif) : null;
    const stessoGiorno = r && !Number.isNaN(r.getTime()) && r.toDateString() === d.toDateString();
    return stessoGiorno ? hh : `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${hh}`;
  }
  const campo = (s, max = MAX_CAMPO) => {
    const t = E().neutralizza(String(s == null ? '' : s), { unaRiga: true });
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };
  function hostDi(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
  }

  function rigaAzione(ev) {
    const chi = ev.autore === 'utente' ? 'l\'utente' : (ev.autore === 'automazione' ? 'Filo da sé' : 'Filo');
    let par = '';
    try { par = ev.parametri && Object.keys(ev.parametri).length ? ` ${JSON.stringify(ev.parametri)}` : ''; } catch (_) { par = ''; }
    const e = ev.esito || {};
    let esito;
    if (e.eseguita) esito = stringa(e.fatto) ? `fatta: ${e.fatto}` : 'fatta';
    else if (e.chiede != null) esito = e.chiede === 'conferma scritta' ? 'aspetta la conferma scritta dell\'utente' : 'aspetta la conferma dell\'utente';
    else if (e.rifiutata) esito = 'rifiutata';
    else if (stringa(e.fermata)) esito = `fermata (${e.fermata})`;
    else esito = stringa(e.errore) ? `non riuscita: ${e.errore}` : 'non fatta';
    const cambi = Array.isArray(e.cambi) && e.cambi.length ? ` (cambio ${e.cambi.join(', ')})` : '';
    return `${chi}: ${campo(ev.nome, 60)}${campo(par)} → ${campo(esito)}${cambi}`;
  }

  function rigaCambio(e) {
    const K = global.SN_CAMBI;
    const frase = K && typeof K.frase === 'function' ? K.frase(e, 6) : '';
    const da = K && typeof K.provenienza === 'function' ? K.provenienza(e) : '';
    const no = K && typeof K.annullabile === 'function' && !K.annullabile(e) ? ' (non si annulla: il valore non è conservato)' : '';
    return `cambio ${da ? `${da} ` : ''}${campo(e.id, 60)}${stringa(e.annulla) ? ` (annulla ${campo(e.annulla, 60)})` : ''}: ${campo(frase, 400)}${no}`;
  }

  // Una riga per evento, ognuna con l'ora; null se l'evento non si racconta (le pagine visitate, che entrano solo
  // cercate; la scheda portata davanti, che dice TAB APERTE).
  function rigaDi(ev) {
    switch (ev.tipo) {
      case 'azione': return rigaAzione(ev);
      case 'cambio': return rigaCambio(ev.cambio || ev);
      case 'scheda.aperta':
      case 'scheda.chiusa': {
        if (!stringa(ev.interna)) return null;
        return `${ev.tipo === 'scheda.aperta' ? 'aperta' : 'chiusa'} la pagina di Filo «${campo(hostDi(ev.interna) || ev.interna, 80)}»`;
      }
      case 'ricerca':
        if (stringa(ev.visita)) return null;
        return `ricerca sul web «${campo(ev.testo)}»${Number.isFinite(ev.risultati) ? ` (${ev.risultati} risultati)` : ''}`;
      case 'download': return `scaricamento «${campo(ev.file || ev.scaricamento)}»: ${campo(ev.stato, 40)}`;
      case 'file': {
        const prima = stringa(ev.prima) ? ` (prima «${campo(ev.prima)}»)` : '';
        return `documento dell'Editor «${campo(ev.titolo || ev.file)}» ${campo(ev.azione, 40)}${prima}`;
      }
      case 'timer.scattato': return `${ev.genere === 'sveglia' ? 'suonata la sveglia' : 'suonato il timer'} «${campo(ev.nome || '')}»`;
      case 'notifica': return `avviso di Filo: «${campo(ev.testo, 400)}»`;
      case 'sistema':
        if (ev.cosa === 'rete') return ev.online ? `rete tornata${stringa(ev.nome) ? ` (Wi-Fi «${campo(ev.nome, 80)}»)` : ''}` : 'rete caduta: il computer è offline';
        if (ev.cosa === 'batteria') return `batteria al ${Number(ev.livello)}%, sotto il ${Number(ev.soglia)}%`;
        if (ev.cosa === 'bluetooth') return `Bluetooth: ${ev.collegato ? 'collegato' : 'scollegato'} «${campo(ev.dispositivo, 80)}»`;
        return `computer: ${campo(ev.cosa, 40)}`;
      default: return null;
    }
  }

  // Le righe degli eventi di un messaggio, dentro una busta: con l'ora (e il giorno se non è quello del messaggio) e,
  // oltre il tetto, il numero di quelle più vecchie che non ci sono. `ids`: gli eventi raccontati, per sapere se uno è
  // stato cancellato dopo.
  function rendiEventi(eventi, { rif = null } = {}) {
    const lista = Array.isArray(eventi) ? eventi : [];
    const ultimiDownload = new Map();
    lista.forEach((ev, i) => { if (ev && ev.tipo === 'download' && ev.scaricamento) ultimiDownload.set(ev.scaricamento, i); });
    let schede = { aperte: 0, chiuse: 0 };
    const righe = [];
    const ids = [];
    lista.forEach((ev, i) => {
      if (!ev) return;
      if (ev.id) ids.push(ev.id);
      if (ev.tipo === 'download' && ultimiDownload.get(ev.scaricamento) !== i) return;
      if ((ev.tipo === 'scheda.aperta' || ev.tipo === 'scheda.chiusa') && !stringa(ev.interna)) {
        schede = { ...schede, [ev.tipo === 'scheda.aperta' ? 'aperte' : 'chiuse']: schede[ev.tipo === 'scheda.aperta' ? 'aperte' : 'chiuse'] + 1 };
        return;
      }
      const r = rigaDi(ev);
      if (r) righe.push(`- ${oraDi(ev.ts, rif)} ${r}`);
    });
    if (schede.aperte || schede.chiuse) {
      const pezzi = [schede.aperte ? `${schede.aperte} apert${schede.aperte === 1 ? 'a' : 'e'}` : '', schede.chiuse ? `${schede.chiuse} chius${schede.chiuse === 1 ? 'a' : 'e'}` : ''].filter(Boolean);
      righe.push(`- schede dei siti: ${pezzi.join(', ')} (quelle aperte adesso le dice TAB APERTE)`);
    }
    if (!righe.length) return { testo: '', ids };
    const tenute = righe.slice(-MAX_RIGHE_EVENTI);
    const fuori = righe.length - tenute.length;
    const testa = fuori ? [`- (prima di queste, altre ${fuori} cose successe dal messaggio prima: qui non ci sono)`] : [];
    const busta = E().imbusta({ tipo: 'FILO_ACCADUTI', conIntestazione: true, testo: [...testa, ...tenute].join('\n') });
    return { testo: `Successo dal messaggio prima:\n${busta}`, ids };
  }

  // Il blocco che Filo scrive in un messaggio dell'utente, dopo l'ora e la chat: vuoto se non c'è niente da dire.
  function preambolo({ eventi = '', stato = '', turno = '' } = {}) {
    const parti = [eventi, stato ? `Cambiato da quando è stato scritto il CONTESTO (vale questo):\n${stato}` : '', turno]
      .map((x) => String(x || '').trim()).filter(Boolean);
    if (!parti.length) return '';
    return `${C().INIZIO_DA_FILO}\n${parti.join('\n\n')}\n${C().INIZIO_MESSAGGIO_UTENTE}`;
  }

  global.SN_TRATTO_VIVO = {
    MAX_RIGHE_EVENTI, sezioniUtente, parteUtente, confronta, rendiCambiate, turniDi, eventiPerMessaggi, rendiEventi, rigaDi,
    preambolo, righeMemoria,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
