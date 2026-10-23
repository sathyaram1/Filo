// Stage 5 (detonation): apre un link in una finestra NASCOSTA e ISOLATA, senza i dati dell'utente, e guarda dove porta.
// Solo un link non ancora aperto, mai una pagina già aperta (regola in index.js); non blocca mai il clic. Finestre
// vive, coda e vita massima hanno un tetto (#591, #966): una finestra alla volta, niente aperture a volontà.

'use strict';

const Permessi = require('../permessiPagine');
const ProxyTab = require('../proxyTab');

// Una sola finestra nascosta viva, qualunque cosa la chieda (#966).
const MAX_CONCURRENT = 1;
// Oltre questa coda un link nuovo resta senza detonation (il verdetto locale vale comunque) e lo si scrive nel log.
const MAX_QUEUE = 50;
const LOAD_TIMEOUT_MS = 9000;
// Vale anche dopo la fine del caricamento: qualunque cosa faccia la pagina, la finestra muore entro questo tempo.
const MAX_LIFETIME_MS = 15000;
// La ricerca della destinazione di un link accorciato: pochi secondi, poi resta il controllo all'apertura.
const VITA_DESTINAZIONE_MS = 6000;
// Un accorciato che risponde con una pagina sua rimanda di solito da script subito dopo: oltre, la destinazione è ignota.
const ATTESA_RIMANDO_MS = 2500;
const MAX_PASSI = 8;
// Lo svuotamento della memoria fra due controlli non deve poter tenere fermo il posto.
const CLEAR_TIMEOUT_MS = 3000;
let detonators = 0;
const wait = (ms) => new Promise((ok) => { const t = setTimeout(ok, ms); if (t && t.unref) t.unref(); });

let _electron = null;
function realElectron() {
  if (_electron === null) {
    try { _electron = require('electron'); } catch (_) { _electron = false; }
  }
  return _electron;
}

function createDetonator({
  electron = realElectron,
  maxConcurrent = MAX_CONCURRENT,
  maxQueue = MAX_QUEUE,
  loadTimeoutMs = LOAD_TIMEOUT_MS,
  maxLifetimeMs = MAX_LIFETIME_MS,
  vitaDestinazioneMs = VITA_DESTINAZIONE_MS,
  attesaRimandoMs = ATTESA_RIMANDO_MS,
} = {}) {
  const el = () => (typeof electron === 'function' ? electron() : electron);
  let live = 0;
  const queue = [];
  const running = new Set();
  // Una memoria isolata per posto, riusata e svuotata fra un controllo e l'altro: Electron non ne libera mai una creata.
  const detonatorId = ++detonators;
  const freeSlots = Array.from({ length: maxConcurrent }, (_, i) => `filo-detonate-${detonatorId}-${i}`);
  // La rete con cui esce ogni posto: le regole del proxy dell'ultima scheda servita, '' per quella del sistema.
  const retiDeiPosti = new Map();

  function pump() {
    while (freeSlots.length && queue.length) {
      const job = queue.shift();
      const partition = freeSlots.shift();
      live++;
      running.add(job);
      Promise.resolve()
        .then(() => job.run(partition, job))
        .catch(() => ({ result: null, cleared: null }))
        .then(({ result, cleared }) => Promise.race([Promise.resolve(cleared).catch(() => {}), wait(CLEAR_TIMEOUT_MS)])
          .then(() => {
            live--;
            running.delete(job);
            freeSlots.push(partition);
            job.resolve(result);
            pump();
          }));
    }
  }

  function enqueue(job) {
    const e = el();
    if (!e || !e.BrowserWindow || !e.session) return Promise.resolve(null);
    if (queue.length >= maxQueue) {
      console.warn(`[safebrowse] coda della sandbox piena (${maxQueue}): ${job.url} resta col solo verdetto locale`);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      queue.push({ ...job, resolve });
      pump();
    });
  }

  // `evaluateFinal(finalUrl)` è iniettata: ri-valuta l'URL finale con i segnali locali.
  // `rete`: il proxy della scheda da cui parte il link (ProxyTab.reteDellaSessione), o null.
  function detonate(url, evaluateFinal, { rete = null } = {}) {
    return enqueue({ url, run: (partition) => runOne(url, evaluateFinal, partition, rete) });
  }

  // La destinazione vera di un link accorciato: si seguono i rimandi finché `prosegue(url)` dice che il passo è ancora
  // un rimando, e ci si ferma PRIMA del primo che non lo è, che è la destinazione: il sito d'arrivo non riceve visite.
  // Conta solo l'ultimo link chiesto: quello prima, in coda o già aperto, lascia il posto.
  function destinazione(url, prosegue, { rete = null } = {}) {
    for (const j of queue.filter((x) => x.corsia === 'destinazione')) {
      queue.splice(queue.indexOf(j), 1);
      j.resolve(null);
    }
    for (const j of running) if (j.corsia === 'destinazione' && j.annulla) j.annulla();
    return enqueue({ url, corsia: 'destinazione', run: (partition, job) => runDestinazione(url, prosegue, partition, job, rete) });
  }

  // La finestra esce come la scheda da cui parte il link (#753.1): da una scheda col proxy, dallo stesso proxy, o il sito
  // vedrebbe l'indirizzo vero. Torna null se non c'è niente da cambiare, altrimenti la promessa del cambio: finché non
  // è applicato non si carica niente, e se fallisce la pagina non si apre.
  function impostaRete(ses, partition, rete) {
    const chiave = rete ? JSON.stringify([rete.proxyRules, rete.proxyBypassRules || '']) : '';
    // Lo stesso proxy con le credenziali di un altro paese: le vecchie si dimenticano prima di caricare.
    let dimentica = null;
    if (rete) dimentica = ProxyTab.registraRete(partition, ses, { proxyRules: rete.proxyRules, bypassRules: rete.proxyBypassRules, auth: rete.auth });
    else ProxyTab.clearPartitionAuth(partition);
    if ((retiDeiPosti.get(partition) || '') === chiave) return dimentica;
    if (typeof ses.setProxy !== 'function') return Promise.reject(new Error('proxy non applicabile'));
    const config = rete ? { proxyRules: rete.proxyRules, ...(rete.proxyBypassRules ? { proxyBypassRules: rete.proxyBypassRules } : {}) } : { mode: 'system' };
    retiDeiPosti.delete(partition);
    return Promise.resolve(ses.setProxy(config))
      .then(() => (typeof ses.closeAllConnections === 'function' ? ses.closeAllConnections() : null))
      .then(() => dimentica)
      .then(() => { retiDeiPosti.set(partition, chiave); });
  }

  function finestra(partition, rete = null) {
    const e = el();
    const ses = e.session.fromPartition(partition, { cache: false });
    let pronta = null;
    try { pronta = impostaRete(ses, partition, rete); } catch (err) { pronta = Promise.reject(err); }
    if (pronta) pronta.catch(() => {});
    // Una pagina riaperta di nascosto: nessuno può rispondere a una sua domanda, microfono e appunti compresi.
    Permessi.negaTutto(ses);
    const download = { started: false, name: '' };
    const onDownload = (ev, item) => {
      download.started = true;
      try { download.name = item.getFilename(); } catch (_) {}
      ev.preventDefault(); // non scaricare davvero nulla
    };
    try { ses.on('will-download', onDownload); } catch (_) {}
    const win = new e.BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        session: ses,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        javascript: true,
        images: false,
        webgl: false,
        // niente preload: la pagina gira nuda, isolata dall'app.
      },
    });
    const wc = win.webContents;
    // Come nella scheda col proxy: niente UDP fuori dal proxy, o WebRTC direbbe l'indirizzo vero.
    if (rete) { try { wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch (_) {} }
    try {
      wc.on('did-create-window', (child) => { try { child.destroy(); } catch (_) {} }); // niente popup
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    } catch (_) {}
    const cleanup = () => {
      try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
      try { if (typeof ses.removeListener === 'function') ses.removeListener('will-download', onDownload); } catch (_) {}
      try { return Promise.resolve(ses.clearStorageData()).catch(() => {}); } catch (_) { return null; }
    };
    return { wc, download, cleanup, pronta };
  }

  // Carica `url` appena la rete è pronta (`fallito`: il caricamento rifiutato); se non lo diventa, `senzaRete()`.
  function carica(wc, url, pronta, fallito, senzaRete) {
    const vai = () => { Promise.resolve(wc.loadURL(url)).catch(fallito); };
    if (!pronta) vai();
    else pronta.then(vai, senzaRete);
  }

  function runOne(url, evaluateFinal, partition, rete = null) {
    const { wc, download, cleanup, pronta } = finestra(partition, rete);
    const redirects = [];
    let finalUrl = url;
    let finished = false;
    let cleared = null;

    return new Promise((resolve) => {
      let loadTimer = null;
      let lifeTimer = null;
      const done = (verdict, extra = {}) => {
        if (finished) return;
        finished = true;
        clearTimeout(loadTimer);
        clearTimeout(lifeTimer);
        cleared = cleanup();
        resolve({ result: { verdict, finalUrl, redirects, download: download.started ? (download.name || true) : false, ...extra }, cleared });
      };
      const byNow = () => (download.started ? 'dangerous' : 'clean');

      const nessunEsito = () => {
        if (!finished) { finished = true; clearTimeout(loadTimer); clearTimeout(lifeTimer); cleared = cleanup(); resolve({ result: null, cleared }); }
      };

      loadTimer = setTimeout(() => done(byNow()), loadTimeoutMs);
      lifeTimer = setTimeout(() => done(byNow(), { expired: true }), maxLifetimeMs);

      try {
        wc.on('did-redirect-navigation', (_e, u) => { if (u) { redirects.push(u); finalUrl = u; } });
        wc.on('did-navigate', (_e, u) => { if (u) finalUrl = u; });

        wc.on('did-stop-loading', async () => {
          clearTimeout(loadTimer);
          // Download forzato → pericoloso; altrimenti conta dove porta davvero il link.
          if (download.started) return done('dangerous');
          let verdict = 'clean';
          if (typeof evaluateFinal === 'function' && finalUrl && finalUrl !== url) {
            try {
              const v = await evaluateFinal(finalUrl);
              if (v && v.level === 'pericoloso') verdict = 'dangerous';
              else if (v && v.level === 'sospetto') verdict = 'suspicious';
            } catch (_) {}
          }
          done(verdict);
        });

        wc.on('did-fail-load', (_e, code) => {
          // -3 = ABORTED (spesso per un download intercettato): decidono will-download e i timer.
          if (code === -3 && download.started) return;
        });

        carica(wc, url, pronta, () => done(byNow()), nessunEsito);
      } catch (_) {
        nessunEsito();
      }
    });
  }

  function runDestinazione(url, prosegue, partition, job, rete = null) {
    const { wc, cleanup, pronta } = finestra(partition, rete);
    const passi = [url];
    return new Promise((resolve) => {
      let finito = false;
      let attesa = null;
      let vita = null;
      const fine = (dest, extra = {}) => {
        if (finito) return;
        finito = true;
        clearTimeout(vita);
        clearTimeout(attesa);
        resolve({ result: { destinazione: dest, passi, ...extra }, cleared: cleanup() });
      };
      job.annulla = () => fine(null, { annullato: true });
      vita = setTimeout(() => fine(null, { expired: true }), vitaDestinazioneMs);
      const passo = (ev, u) => {
        if (finito || !u) return;
        clearTimeout(attesa);
        passi.push(u);
        let ancora = false;
        try { ancora = !!prosegue(u); } catch (_) {}
        if (ancora && passi.length <= MAX_PASSI) return;
        try { ev.preventDefault(); } catch (_) {}
        fine(ancora ? null : u);
      };
      try {
        wc.on('will-redirect', (ev, u, _inPlace, principale) => {
          if (principale === false || (ev && ev.isMainFrame === false)) return;
          passo(ev, (ev && ev.url) || u);
        });
        // Il rimando da script o da <meta> della pagina dell'accorciatore.
        wc.on('will-navigate', (ev, u) => passo(ev, (ev && ev.url) || u));
        wc.on('did-stop-loading', () => {
          if (finito) return;
          clearTimeout(attesa);
          attesa = setTimeout(() => fine(null), attesaRimandoMs);
        });
        carica(wc, url, pronta, () => {}, () => fine(null));
      } catch (_) {
        fine(null);
      }
    });
  }

  return { detonate, destinazione, stats: () => ({ live, queued: queue.length }) };
}

const shared = createDetonator();

module.exports = {
  detonate: shared.detonate,
  destinazione: shared.destinazione,
  stats: shared.stats,
  createDetonator,
  MAX_CONCURRENT,
  MAX_QUEUE,
  LOAD_TIMEOUT_MS,
  MAX_LIFETIME_MS,
  VITA_DESTINAZIONE_MS,
};
