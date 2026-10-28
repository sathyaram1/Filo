// Le icone del desktop del computer in ordine a comando (#1621): uno script fisso le legge e le sposta, l'ordine e la
// griglia li decide JavaScript, e ogni disposizione è un cambio che si annulla. Solo Windows: su Mac e Linux lo dice.
// Regole: patterns/il-computer-si-comanda-con-script-fissi.md (§ Le icone del desktop); prove: tests/unit/iconeDesktop.test.mjs.

'use strict';

const fsp = require('node:fs/promises');
const terminale = require('./terminal');
const Sistema = require('./comandiSistema');

const { PS_INIZIO, psCompila } = Sistema._interni;

// Una variabile d'ambiente di Windows tiene 32.767 caratteri: le posizioni si dividono in pezzi che ci stanno.
const PEZZO_MAX = 30000;
// L'elenco intero si legge col codice: 300 icone coi percorsi interi stanno in poche decine di migliaia di caratteri.
const TETTO_USCITA = 8 * 1024 * 1024;
const TEMPO_MS = 60000;
const TEMPO_STAT_MS = 3000;

// Le icone del desktop di Windows viste dalla Shell (IFolderView2 della finestra del desktop): nomi, posizioni,
// passo della griglia e area dello schermo principale nelle stesse coordinate. C# 5: lo compila il PowerShell 5.1.
const CS_DESKTOP = String.raw`using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
namespace FiloDesktop {
  [StructLayout(LayoutKind.Sequential)] public struct Punto { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rett { public int L; public int T; public int R; public int B; }
  [ComImport, Guid("85CB6900-4D95-11CF-960C-0080C7F4EE85"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellWindows {
    int d1(); int d2(); int d3(); int d4();
    int f1(); int f2(); int f3(); int f4(); int f5(); int f6(); int f7(); int f8();
    [PreserveSig] int FindWindowSW(ref object luogo, ref object radice, int classe, out int finestra, int opzioni, [MarshalAs(UnmanagedType.IDispatch)] out object vista);
  }
  [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFornitore {
    [PreserveSig] int QueryService(ref Guid servizio, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object oggetto);
  }
  [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellBrowser {
    int f1(); int f2(); int f3(); int f4(); int f5(); int f6(); int f7(); int f8(); int f9(); int f10(); int f11(); int f12();
    [PreserveSig] int QueryActiveShellView([MarshalAs(UnmanagedType.IUnknown)] out object vista);
  }
  [ComImport, Guid("000214E3-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellView {
    [PreserveSig] int GetWindow(out IntPtr finestra);
    int f2(); int f3(); int f4(); int f5(); int f6(); int f7(); int f8(); int f9(); int f10();
    [PreserveSig] int SaveViewState();
  }
  [ComImport, Guid("1AF3A467-214F-4298-908E-06B03E0B39F9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFolderView2 {
    int f1(); int f2(); int f3();
    [PreserveSig] int Item(int indice, out IntPtr pidl);
    [PreserveSig] int ItemCount(uint quali, out int quante);
    int f6(); int f7(); int f8();
    [PreserveSig] int GetItemPosition(IntPtr pidl, out Punto dove);
    [PreserveSig] int GetSpacing(ref Punto passo);
    [PreserveSig] int GetDefaultSpacing(out Punto passo);
    int f12(); int f13();
    [PreserveSig] int SelectAndPositionItems(uint quante, [In, MarshalAs(UnmanagedType.LPArray)] IntPtr[] pidl, [In, MarshalAs(UnmanagedType.LPArray)] Punto[] dove, uint come);
    int f15(); int f16(); int f17(); int f18(); int f19(); int f20(); int f21();
    [PreserveSig] int SetCurrentFolderFlags(uint maschera, uint valori);
    [PreserveSig] int GetCurrentFolderFlags(out uint valori);
    int f24(); int f25(); int f26();
    [PreserveSig] int GetItem(int indice, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object oggetto);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    int f1(); int f2();
    [PreserveSig] int GetDisplayName(uint come, out IntPtr nome);
    [PreserveSig] int GetAttributes(uint maschera, out uint attributi);
  }
  class Mancante : Exception { }
  public static class Desktop {
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr contesto);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint azione, uint p, ref Rett r, uint f);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr finestra, ref Punto p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr padre, IntPtr dopo, string classe, string titolo);
    const uint AUTO = 0x1, GRIGLIA = 0x4, NASCOSTE = 0x1000;
    const uint ID = 0x80028000, NOME = 0x0, CARTELLA = 0x20000000, FLUSSO = 0x400000;
    static readonly Guid IID_ITEM = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");

    // Le posizioni delle icone sono in pixel veri: l'area dello schermo va chiesta uguale, o a 125% esce più piccola.
    static void PixelVeri() {
      try {
        if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return;
        if (SetThreadDpiAwarenessContext(new IntPtr(-3)) != IntPtr.Zero) return;
      } catch (EntryPointNotFoundException) { }
      SetProcessDPIAware();
    }

    static IFolderView2 Vista(out IShellView sv, out IntPtr finestra) {
      object sw = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("9BA05972-F6A8-11CF-A442-00A0C90A8F39")));
      object luogo = 0;
      object radice = null;
      int hwnd;
      object disp;
      if (((IShellWindows)sw).FindWindowSW(ref luogo, ref radice, 8, out hwnd, 1, out disp) != 0 || disp == null) throw new Mancante();
      Guid servizio = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837");
      Guid iid = new Guid("000214E2-0000-0000-C000-000000000046");
      object b;
      Marshal.ThrowExceptionForHR(((IFornitore)disp).QueryService(ref servizio, ref iid, out b));
      object v;
      Marshal.ThrowExceptionForHR(((IShellBrowser)b).QueryActiveShellView(out v));
      sv = (IShellView)v;
      IntPtr dv;
      Marshal.ThrowExceptionForHR(sv.GetWindow(out dv));
      IntPtr lv = FindWindowEx(dv, IntPtr.Zero, "SysListView32", null);
      finestra = lv != IntPtr.Zero ? lv : dv;
      return (IFolderView2)v;
    }

    static string Nome(IShellItem si, uint come) {
      IntPtr p;
      if (si.GetDisplayName(come, out p) != 0 || p == IntPtr.Zero) return null;
      try { return Marshal.PtrToStringUni(p); } finally { Marshal.FreeCoTaskMem(p); }
    }

    static string[] K(string k, string v) { return new string[] { k, v }; }

    static void Scrivi(List<string[]> o, IFolderView2 fv, IntPtr finestra) {
      uint flag;
      Marshal.ThrowExceptionForHR(fv.GetCurrentFolderFlags(out flag));
      o.Add(K("auto", (flag & AUTO) != 0 ? "1" : "0"));
      o.Add(K("griglia", (flag & GRIGLIA) != 0 ? "1" : "0"));
      o.Add(K("nascoste", (flag & NASCOSTE) != 0 ? "1" : "0"));
      Punto passo = new Punto();
      if (fv.GetSpacing(ref passo) != 0 || passo.X <= 0 || passo.Y <= 0) fv.GetDefaultSpacing(out passo);
      o.Add(K("passo", passo.X + "," + passo.Y));
      Rett r = new Rett();
      if (SystemParametersInfo(0x30, 0, ref r, 0)) {
        Punto a = new Punto(); a.X = r.L; a.Y = r.T;
        Punto b = new Punto(); b.X = r.R; b.Y = r.B;
        if (ScreenToClient(finestra, ref a) && ScreenToClient(finestra, ref b)) o.Add(K("area", a.X + "," + a.Y + "," + b.X + "," + b.Y));
      }
      int quante;
      Marshal.ThrowExceptionForHR(fv.ItemCount(2, out quante));
      o.Add(K("totale", quante.ToString()));
      Guid iid = IID_ITEM;
      for (int i = 0; i < quante; i++) {
        IntPtr pidl;
        if (fv.Item(i, out pidl) != 0 || pidl == IntPtr.Zero) continue;
        try {
          Punto p;
          object x;
          if (fv.GetItemPosition(pidl, out p) != 0 || fv.GetItem(i, ref iid, out x) != 0 || x == null) continue;
          IShellItem si = (IShellItem)x;
          string id = Nome(si, ID);
          if (string.IsNullOrEmpty(id)) continue;
          uint at;
          if (si.GetAttributes(CARTELLA | FLUSSO, out at) < 0) at = 0;
          o.Add(K("voce", id));
          o.Add(K("nome", Nome(si, NOME) ?? ""));
          o.Add(K("pos", p.X + "," + p.Y));
          o.Add(K("cartella", (at & CARTELLA) != 0 && (at & FLUSSO) == 0 ? "1" : "0"));
        } finally { Marshal.FreeCoTaskMem(pidl); }
      }
    }

    static List<string[]> Guasto(List<string[]> o, Exception e) {
      o.Clear();
      if (e is Mancante) { o.Add(K("errore", "nessun-desktop")); return o; }
      o.Add(K("errore", "eccezione"));
      o.Add(K("dettaglio", e.Message));
      return o;
    }

    public static List<string[]> Leggi() {
      List<string[]> o = new List<string[]>();
      try {
        PixelVeri();
        IShellView sv;
        IntPtr finestra;
        IFolderView2 fv = Vista(out sv, out finestra);
        Scrivi(o, fv, finestra);
      } catch (Exception e) { return Guasto(o, e); }
      return o;
    }

    // Le posizioni arrivano dall'ambiente, una riga «x<TAB>y<TAB>id» per icona; un'icona che non c'è più resta fuori.
    public static List<string[]> Disponi() {
      List<string[]> o = new List<string[]>();
      try {
        PixelVeri();
        Dictionary<string, Punto> voluti = new Dictionary<string, Punto>(StringComparer.Ordinal);
        for (int n = 0; n < 4096; n++) {
          string pezzo = Environment.GetEnvironmentVariable("FILO_SIS_POS_" + n);
          if (pezzo == null) break;
          foreach (string riga in pezzo.Split('\n')) {
            string[] c = riga.Split(new char[] { '\t' }, 3);
            int x, y;
            if (c.Length != 3 || c[2].Length == 0 || !int.TryParse(c[0], out x) || !int.TryParse(c[1], out y)) continue;
            Punto p = new Punto(); p.X = x; p.Y = y;
            voluti[c[2]] = p;
          }
        }
        bool auto = Environment.GetEnvironmentVariable("FILO_SIS_AUTO") == "1";
        IShellView sv;
        IntPtr finestra;
        IFolderView2 fv = Vista(out sv, out finestra);
        uint flag;
        Marshal.ThrowExceptionForHR(fv.GetCurrentFolderFlags(out flag));
        int quante;
        Marshal.ThrowExceptionForHR(fv.ItemCount(2, out quante));
        List<IntPtr> pidl = new List<IntPtr>();
        List<Punto> dove = new List<Punto>();
        Guid iid = IID_ITEM;
        bool riuscito = false;
        try {
          for (int i = 0; i < quante; i++) {
            object x;
            if (fv.GetItem(i, ref iid, out x) != 0 || x == null) continue;
            string id = Nome((IShellItem)x, ID);
            Punto p;
            if (id == null || !voluti.TryGetValue(id, out p)) continue;
            IntPtr q;
            if (fv.Item(i, out q) != 0 || q == IntPtr.Zero) continue;
            pidl.Add(q);
            dove.Add(p);
          }
          // «Disponi automaticamente» rimette tutto in colonna; «Allinea alla griglia» sposta chi trova il posto
          // ancora occupato da un'icona che deve ancora muoversi. Si tolgono durante lo spostamento.
          Marshal.ThrowExceptionForHR(fv.SetCurrentFolderFlags(AUTO | GRIGLIA, 0));
          if (pidl.Count > 0) Marshal.ThrowExceptionForHR(fv.SelectAndPositionItems((uint)pidl.Count, pidl.ToArray(), dove.ToArray(), 0x80));
          riuscito = true;
        } finally {
          foreach (IntPtr q in pidl) Marshal.FreeCoTaskMem(q);
          uint rimetti = riuscito ? (flag & GRIGLIA) | (auto ? AUTO : 0) : flag & (AUTO | GRIGLIA);
          fv.SetCurrentFolderFlags(AUTO | GRIGLIA, rimetti);
        }
        Thread.Sleep(300);
        sv.SaveViewState();
        o.Add(K("spostate", pidl.Count.ToString()));
        Scrivi(o, fv, finestra);
      } catch (Exception e) { return Guasto(o, e); }
      return o;
    }
  }
}
`;

const SCRIPT = {
  win32: {
    'desktop-leggi': PS_INIZIO + psCompila(CS_DESKTOP) + String.raw`foreach ($r in [FiloDesktop.Desktop]::Leggi()) { Dice $r[0] $r[1] }
`,
    'desktop-disponi': PS_INIZIO + psCompila(CS_DESKTOP) + String.raw`foreach ($r in [FiloDesktop.Desktop]::Disponi()) { Dice $r[0] $r[1] }
`,
  },
};

// ── Richiesta → script + ambiente ────────────────────────────────────────────

function ambienteDisponi({ posizioni, auto } = {}) {
  const env = { FILO_SIS_AUTO: auto ? '1' : '0' };
  let pezzo = '';
  let n = 0;
  for (const p of Array.isArray(posizioni) ? posizioni : []) {
    if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6) throw new Error('posizione non valida');
    if (typeof p.id !== 'string' || !p.id || /[\u0000-\u001f\u007f]/.test(p.id)) throw new Error('icona senza un nome valido');
    const riga = `${p.x}\t${p.y}\t${p.id}`;
    if (riga.length > PEZZO_MAX) throw new Error(`nome di un'icona più lungo di ${PEZZO_MAX} caratteri`);
    if (pezzo && pezzo.length + 1 + riga.length > PEZZO_MAX) {
      env[`FILO_SIS_POS_${n}`] = pezzo;
      n += 1;
      pezzo = '';
    }
    pezzo = pezzo ? `${pezzo}\n${riga}` : riga;
  }
  if (pezzo) env[`FILO_SIS_POS_${n}`] = pezzo;
  return env;
}

function costruisci(comando, p, piattaforma = process.platform) {
  const script = SCRIPT[piattaforma] && SCRIPT[piattaforma][comando];
  if (!script) throw new Error(`comando sconosciuto su ${piattaforma}: ${comando}`);
  return { shell: 'powershell', script, env: comando === 'desktop-disponi' ? ambienteDisponi(p) : {} };
}

// ── Uscita → dati ────────────────────────────────────────────────────────────

const intero = (v) => (v != null && /^-?\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : null);
function coppia(v) {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(v || '').trim());
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function interpretaLettura(u) {
  const errore = u.primo('errore');
  if (errore) return { ok: false, errore, dettaglio: u.primo('dettaglio') || '' };
  if (u.troncato) return { ok: false, errore: 'uscita-troncata' };
  const voci = [];
  let cur = null;
  for (const { k, v } of u.voci) {
    if (k === 'voce') {
      cur = { id: v, nome: '', x: null, y: null, cartella: false };
      voci.push(cur);
    } else if (cur && k === 'nome') cur.nome = v;
    else if (cur && k === 'pos') {
      const p = coppia(v);
      if (p) { cur.x = p.x; cur.y = p.y; }
    } else if (cur && k === 'cartella') cur.cartella = v === '1';
  }
  for (const x of voci) if (!x.nome) x.nome = String(x.id).split(/[\\/]/).filter(Boolean).pop() || x.id;
  const a = /^(-?\d+),(-?\d+),(-?\d+),(-?\d+)$/.exec(String(u.primo('area') || '').trim());
  return {
    ok: true,
    voci: voci.filter((x) => x.x != null && x.y != null),
    area: a ? { sinistra: Number(a[1]), alto: Number(a[2]), destra: Number(a[3]), basso: Number(a[4]) } : null,
    passo: coppia(u.primo('passo')),
    auto: u.primo('auto') === '1',
    griglia: u.primo('griglia') === '1',
    nascoste: u.primo('nascoste') === '1',
    totale: intero(u.primo('totale')),
    spostate: intero(u.primo('spostate')),
  };
}

// ── La richiesta, l'ordine e la griglia: logica pura ────────────────────────

const ORDINI = {
  nome: 'nome', alfabetico: 'nome', alfabetica: 'nome', name: 'nome',
  tipo: 'tipo', estensione: 'tipo', type: 'tipo',
  data: 'data', date: 'data', modifica: 'data', recenti: 'data',
  dimensione: 'dimensione', dimensioni: 'dimensione', grandezza: 'dimensione', peso: 'dimensione', size: 'dimensione',
};
const VERSI = {
  righe: 'righe', riga: 'righe', orizzontale: 'righe', rows: 'righe',
  colonne: 'colonne', colonna: 'colonne', verticale: 'colonne', columns: 'colonne',
};

const vero = (v) => v === true || v === 1 || /^(true|1|si|sì|yes)$/i.test(String(v ?? '').trim());
const falso = (v) => v === false || v === 0 || /^(false|0|no)$/i.test(String(v ?? '').trim());

function normalizzaRichiesta(r) {
  const q = r && typeof r === 'object' ? r : {};
  const parola = (v) => String(v ?? '').trim().toLowerCase();
  const ordine = ORDINI[parola(q.ordine) || 'nome'];
  if (!ordine) return { errore: 'ordine non capito: nome, tipo, data o dimensione' };
  const verso = VERSI[parola(q.verso) || 'righe'];
  if (!verso) return { errore: 'verso non capito: righe o colonne' };
  const sino = (v, nome) => {
    if (v == null || v === '') return false;
    if (vero(v)) return true;
    if (falso(v)) return false;
    return { errore: `${nome} non capito: true o false` };
  };
  const alContrario = sino(q.al_contrario ?? q.alContrario, 'al_contrario');
  if (alContrario.errore) return alContrario;
  const cartellePrima = sino(q.cartelle_prima ?? q.cartellePrima, 'cartelle_prima');
  if (cartellePrima.errore) return cartellePrima;
  return { cosa: 'desktop', ordine, verso, alContrario, cartellePrima };
}

const collatore = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
const percorsoDiFile = (id) => /^[a-z]:\\|^\\\\/i.test(String(id || ''));

// L'estensione raggruppa i tipi come li raggruppa Windows: i collegamenti con i collegamenti, i PDF coi PDF.
// Cartelle e icone di sistema (Cestino, Questo PC) non hanno estensione: stanno davanti.
function chiaveTipo(v) {
  if (v.cartella || !percorsoDiFile(v.id)) return '';
  const nome = String(v.id).split('\\').pop();
  const m = /\.([^.]+)$/.exec(nome);
  return m ? m[1].toLowerCase() : '';
}

// Nome e tipo dalla A alla Z, la data dalla più recente, la dimensione dalla più grande; `alContrario` le gira.
// Chi non ha una data o una dimensione (le icone di sistema, le cartelle per la dimensione) va in fondo, per nome.
function ordina(voci, { ordine = 'nome', alContrario = false, cartellePrima = false } = {}) {
  const giro = alContrario ? -1 : 1;
  const perNome = (a, b) => collatore.compare(a.nome, b.nome) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const numero = (valore) => (a, b) => {
    const va = valore(a);
    const vb = valore(b);
    if (va == null || vb == null) return va == null && vb == null ? perNome(a, b) : va == null ? 1 : -1;
    return giro * (vb - va) || perNome(a, b);
  };
  const se = (v) => (Number.isFinite(v) ? v : null);
  const criterio = {
    nome: (a, b) => giro * perNome(a, b),
    tipo: (a, b) => giro * collatore.compare(chiaveTipo(a), chiaveTipo(b)) || perNome(a, b),
    data: numero((v) => se(v.data)),
    dimensione: numero((v) => (v.cartella ? null : se(v.dimensione))),
  }[ordine] || perNome;
  return voci.slice().sort((a, b) => (cartellePrima ? Number(!!b.cartella) - Number(!!a.cartella) : 0) || criterio(a, b));
}

const resto = (v, m) => ((v % m) + m) % m;
function piuFrequente(valori) {
  const conti = new Map();
  let meglio = null;
  for (const v of valori) {
    const c = (conti.get(v) || 0) + 1;
    conti.set(v, c);
    if (meglio == null || c > conti.get(meglio) || (c === conti.get(meglio) && v < meglio)) meglio = v;
  }
  return meglio;
}

// La griglia dello schermo principale. Con «Allinea alla griglia» (o «Disponi automaticamente») le icone stanno già
// sulla griglia di Windows: le nuove posizioni ne prendono l'allineamento, così riaccendendola nessuna salta di posto.
function griglia(letto) {
  const a = letto && letto.area;
  const p = letto && letto.passo;
  if (!a || !p || !(p.x >= 8 && p.y >= 8)) return { errore: 'griglia' };
  if (a.destra - a.sinistra < p.x || a.basso - a.alto < p.y) return { errore: 'griglia' };
  const dentro = (letto.voci || []).filter((v) => v.x >= a.sinistra && v.x < a.destra && v.y >= a.alto && v.y < a.basso);
  const allineate = (letto.griglia || letto.auto) && dentro.length;
  const ox = allineate ? piuFrequente(dentro.map((v) => resto(v.x, p.x))) : resto(a.sinistra, p.x);
  const oy = allineate ? piuFrequente(dentro.map((v) => resto(v.y, p.y))) : resto(a.alto, p.y);
  const x0 = a.sinistra + resto(ox - a.sinistra, p.x);
  const y0 = a.alto + resto(oy - a.alto, p.y);
  const colonne = Math.floor((a.destra - x0) / p.x);
  const righe = Math.floor((a.basso - y0) / p.y);
  if (colonne < 1 || righe < 1) return { errore: 'griglia' };
  return { x0, y0, passoX: p.x, passoY: p.y, colonne, righe };
}

// Dove va ogni icona: in fila da sinistra a destra e poi la riga sotto, o dall'alto in basso e poi la colonna a destra.
function piano(letto, q) {
  const g = griglia(letto);
  if (g.errore) return g;
  const voci = ordina(letto.voci || [], q);
  const posti = g.colonne * g.righe;
  if (voci.length > posti) return { errore: 'non-ci-stanno', totale: voci.length, posti };
  const posizioni = voci.map((v, i) => {
    const col = q.verso === 'colonne' ? Math.floor(i / g.righe) : i % g.colonne;
    const riga = q.verso === 'colonne' ? i % g.righe : Math.floor(i / g.colonne);
    return { id: v.id, x: g.x0 + col * g.passoX, y: g.y0 + riga * g.passoY };
  });
  const n = voci.length;
  const usate = q.verso === 'colonne'
    ? { colonne: Math.ceil(n / g.righe), righe: Math.min(n, g.righe) }
    : { colonne: Math.min(n, g.colonne), righe: Math.ceil(n / g.colonne) };
  return { griglia: g, posizioni, ...usate };
}

// Quante icone non sono finite dove dovevano (oltre mezza casella) e quante non c'erano più a spostarle.
function verifica(posizioni, letto, g) {
  const dove = new Map((letto.voci || []).map((v) => [v.id, v]));
  let fuoriPosto = 0;
  let mancanti = 0;
  for (const p of posizioni) {
    const v = dove.get(p.id);
    if (!v) { mancanti += 1; continue; }
    if (Math.abs(v.x - p.x) * 2 > g.passoX || Math.abs(v.y - p.y) * 2 > g.passoY) fuoriPosto += 1;
  }
  return { fuoriPosto, mancanti };
}

const disposizione = (letto) => ({ auto: !!letto.auto, voci: (letto.voci || []).map((v) => [v.id, v.x, v.y]) });
const stessaDisposizione = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Le frasi ────────────────────────────────────────────────────────────────

const IMPOSTAZIONI_WINDOWS = 'tasto destro sul desktop → Visualizza';
function spiega(errore, { totale = 0, posti = 0 } = {}) {
  const T = {
    'nessun-desktop': {
      frase: 'Windows non ha dato a Filo il desktop: succede se Esplora risorse è fermo, o se il desktop lo disegna un altro programma.',
      dove: 'Esplora risorse si riavvia da Gestione attività: clic destro su «Esplora risorse» → Riavvia.',
    },
    griglia: { frase: 'Windows non ha detto quanto sono distanti le icone del desktop, e senza Filo non sa dove metterle.' },
    'non-ci-stanno': {
      frase: `Sul desktop ci sono ${totale} icone e lo schermo, in griglia, ne tiene ${posti}: in ordine non ci stanno tutte.`,
      dove: `Con le icone più piccole ci stanno (${IMPOSTAZIONI_WINDOWS} → Icone piccole): poi Filo le rimette in ordine.`,
    },
    'non-spostate': { frase: 'Windows non ha spostato le icone: può impedirlo una regola dell\'azienda o un programma che tiene in ordine il desktop.' },
    'tempo-comando': { frase: 'Windows non ha risposto in tempo dal desktop.' },
    mac: {
      frase: 'Su Mac Filo non sa ancora spostare le icone della Scrivania.',
      dove: 'Il Finder le mette in ordine da sé, a colonne partendo da destra: tasto destro sulla Scrivania → Ordina per → Nome.',
    },
    linux: {
      frase: 'Su Linux le icone del desktop le dispone l\'ambiente grafico (GNOME, KDE, XFCE…), e Filo non sa ancora spostarle.',
      dove: 'Di solito si mettono in ordine col tasto destro sul desktop.',
    },
    prove: { frase: 'Durante le prove automatiche Filo non tocca il desktop vero.' },
  };
  const voce = T[errore] || { frase: 'Windows non ha spostato le icone del desktop.' };
  return { errore, frase: voce.frase, ...(voce.dove ? { dove: voce.dove } : {}) };
}

function fallito(errore, extra = {}) {
  return { ok: false, cosa: 'desktop', ...spiega(errore, extra), ...extra };
}

const DETTI = { nome: 'in ordine alfabetico', tipo: 'per tipo', data: 'per data', dimensione: 'per dimensione' };
function comeDetto(come) {
  const c = come || {};
  const verso = c.verso === 'colonne' ? 'a colonne' : 'a righe';
  return `${DETTI[c.ordine] || 'in ordine'}${c.alContrario ? ' al contrario' : ''}, ${verso}${c.cartellePrima ? ', cartelle prima' : ''}`;
}

// L'esito per il modello: numeri e parole di Filo, nessun nome di file.
function esitoPerModello(o) {
  if (!o || !o.ok) {
    if (o && o.errore === 'richiesta') return `Non fatto: ${o.frase}. Correggi i parametri e riprova.`;
    const s = o || spiega('sconosciuto');
    return `Non fatto: ${s.frase}${s.dove ? ` ${s.dove}` : ''} Riporta all'utente queste parole; non riprovare uguale.`;
  }
  if (o.vuoto) return 'Sul desktop non ci sono icone: niente da mettere in ordine.';
  if (o.gia) return `Le ${o.totale} icone del desktop erano già ${comeDetto(o)}: niente spostato.`;
  const parti = [`Icone del desktop ${comeDetto(o)}: ${o.spostate} icone su ${o.righe} ${o.righe === 1 ? 'riga' : 'righe'} e ${o.colonne} ${o.colonne === 1 ? 'colonna' : 'colonne'}, sullo schermo principale.`];
  if (o.autoTolto) parti.push('Era acceso «Disponi automaticamente», che le rimette in colonna: Filo l\'ha spento, dillo all\'utente.');
  if (o.fuoriPosto) parti.push(`${o.fuoriPosto} icone non sono finite al loro posto: dillo all'utente.`);
  if (o.mancanti) parti.push(`${o.mancanti} icone sono sparite dal desktop mentre le spostavo.`);
  if (o.nascoste) parti.push('Le icone del desktop sono nascoste: si vedono rimettendo la spunta su «Mostra icone del desktop» (tasto destro sul desktop → Visualizza). Diglielo.');
  if (o.cambio) parti.push(`Per rimetterle dov'erano: ANNULLA_CAMBIO con id ${o.cambio}.`);
  return parti.join(' ');
}

// ── Eseguire: una mossa alla volta ──────────────────────────────────────────

let computerFinto = null;
let coda = Promise.resolve();
function inFila(fn) {
  const giro = coda.then(fn, fn);
  coda = giro.catch(() => {});
  return giro;
}

async function eseguiScript(comando, p) {
  const { shell, script, env } = costruisci(comando, p, process.platform);
  const r = await terminale.runCommand(script, {
    shell: terminale.resolveShell(shell),
    env: { ...process.env, ...env },
    timeoutMs: TEMPO_MS,
    tettoUscita: TETTO_USCITA,
  });
  const u = Sistema.leggiUscita(r.stdout);
  if (r.timedOut && !u.voci.length) u.voci.push({ k: 'errore', v: 'tempo-comando', righe: [] });
  if (r.truncated) u.troncato = true;
  return u;
}

// Il computer vero, oppure quello delle prove: stessa forma, dati già interpretati.
const COMPUTER = {
  async leggi() { return interpretaLettura(await eseguiScript('desktop-leggi', {})); },
  async disponi(posizioni, { auto = false } = {}) { return interpretaLettura(await eseguiScript('desktop-disponi', { posizioni, auto })); },
};
const computer = () => computerFinto || COMPUTER;

// Data e dimensione le dice il disco: le icone di sistema non ne hanno, e un disco che non risponde non ferma le altre.
async function arricchisci(voci) {
  await Promise.all(voci.map(async (v) => {
    if (Number.isFinite(v.data) && Number.isFinite(v.dimensione)) return;
    if (!percorsoDiFile(v.id) || process.platform !== 'win32') return;
    let timer = null;
    const scade = new Promise((res) => { timer = setTimeout(() => res(null), TEMPO_STAT_MS); });
    try {
      const st = await Promise.race([fsp.stat(v.id), scade]);
      if (st) {
        if (!Number.isFinite(v.data)) v.data = st.mtimeMs;
        if (!Number.isFinite(v.dimensione)) v.dimensione = st.size;
      }
    } catch (_) {
    } finally { clearTimeout(timer); }
  }));
}

const Registro = () => require('./registroCambi');

// Ogni disposizione è un cambio del filo: lo annulla ANNULLA_CAMBIO o il segno «annulla», e l'annullo di un annullo rifà.
function registraCambio(prima, dopo, come) {
  const a = disposizione(prima);
  const b = disposizione(dopo);
  if (stessaDisposizione(a, b)) return null;
  const c = { chiave: 'desktop', prima: a, dopo: b, ...(come ? { come } : {}) };
  try { return Registro().registra({ tipo: 'desktop', cambi: [c] }); } catch (e) {
    console.warn('[Filo] disposizione del desktop non registrata', e && e.message ? e.message : e);
    return null;
  }
}

async function ordinaOra(q) {
  const letto = await computer().leggi();
  if (!letto.ok) return fallito(letto.errore);
  const come = { ordine: q.ordine, verso: q.verso, alContrario: q.alContrario, cartellePrima: q.cartellePrima };
  if (!letto.voci.length) return { ok: true, cosa: 'desktop', ...come, vuoto: true, totale: 0, spostate: 0 };
  if (q.ordine === 'data' || q.ordine === 'dimensione') await arricchisci(letto.voci);
  const p = piano(letto, q);
  if (p.errore) return fallito(p.errore, p.errore === 'non-ci-stanno' ? { totale: p.totale, posti: p.posti } : {});
  const base = { ok: true, cosa: 'desktop', ...come, totale: letto.voci.length, righe: p.righe, colonne: p.colonne, nascoste: letto.nascoste };
  const ora = new Map(letto.voci.map((v) => [v.id, v]));
  if (!letto.auto && p.posizioni.every((x) => ora.get(x.id).x === x.x && ora.get(x.id).y === x.y)) {
    return { ...base, gia: true, spostate: 0 };
  }
  const fatto = await computer().disponi(p.posizioni, { auto: false });
  if (!fatto.ok) return fallito(fatto.errore);
  const { fuoriPosto, mancanti } = verifica(p.posizioni, fatto, p.griglia);
  const evento = registraCambio(letto, fatto, come);
  if (fuoriPosto && fuoriPosto + mancanti >= p.posizioni.length) return { ...fallito('non-spostate'), ...(evento ? { cambio: evento.id } : {}) };
  return {
    ...base,
    spostate: p.posizioni.length - fuoriPosto - mancanti,
    autoTolto: letto.auto && !fatto.auto,
    fuoriPosto,
    mancanti,
    ...(evento ? { cambio: evento.id } : {}),
  };
}

function sulDesktop(fn) {
  return inFila(async () => {
    try {
      // Una prova che si è dimenticata il computer finto non sposta le icone di chi la lancia.
      if (!computerFinto && process.env.NODE_ENV === 'test') return fallito('prove');
      if (!computerFinto && process.platform !== 'win32') return fallito(process.platform === 'darwin' ? 'mac' : 'linux');
      return await fn();
    } catch (e) {
      console.warn('[Filo] icone del desktop non spostate', e && e.message ? e.message : e);
      return fallito('sconosciuto');
    }
  });
}

function ordinaIcone(richiesta) {
  const q = normalizzaRichiesta(richiesta);
  if (q.errore) return Promise.resolve({ ok: false, cosa: 'desktop', errore: 'richiesta', frase: q.errore });
  return sulDesktop(() => ordinaOra(q));
}

// L'annullo di un cambio: le icone che ci sono ancora tornano dove stavano, «Disponi automaticamente» com'era.
// Gira dentro il contesto dell'annullo (registroCambi.js), che segna il cambio nuovo come annullo di quello.
function rimetti(d) {
  const voci = d && Array.isArray(d.voci) ? d.voci.filter((v) => Array.isArray(v) && typeof v[0] === 'string' && Number.isInteger(v[1]) && Number.isInteger(v[2])) : [];
  const auto = !!(d && d.auto);
  return sulDesktop(async () => {
    const letto = await computer().leggi();
    if (!letto.ok) return fallito(letto.errore);
    const ci = new Set(letto.voci.map((v) => v.id));
    const posizioni = voci.filter((v) => ci.has(v[0])).map(([id, x, y]) => ({ id, x, y }));
    const sparite = voci.length - posizioni.length;
    const fatto = await computer().disponi(posizioni, { auto });
    if (!fatto.ok) return fallito(fatto.errore);
    const evento = registraCambio(letto, fatto, null);
    return { ok: true, cosa: 'desktop', rimesse: posizioni.length, sparite, ...(evento ? { cambio: evento.id } : {}) };
  });
}

const _perProve = {
  // Un desktop finto con la forma di COMPUTER: le prove vedono chat, filo e annullo veri sopra icone inventate.
  usaComputer(finto) { computerFinto = finto && typeof finto === 'object' ? finto : null; },
};

module.exports = {
  ordinaIcone, rimetti, esitoPerModello, normalizzaRichiesta, comeDetto, _perProve,
  SCRIPT, CS_DESKTOP, PEZZO_MAX, costruisci, ambienteDisponi, interpretaLettura, ordina, griglia, piano, verifica, spiega,
};
