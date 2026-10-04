// Volume, Bluetooth e Wi-Fi del computer, a comando: uno script FISSO per piattaforma, e i parametri solo nell'ambiente.
// Non è una riga di shell libera (non chiede la modalità terminale); il livello di ogni azione sta in actionLevels.js.
// Regole: patterns/il-computer-si-comanda-con-script-fissi.md; prove: tests/unit/comandiSistema.test.mjs.

'use strict';

const terminale = require('./terminal');

const PIATTAFORME = ['win32', 'linux', 'darwin'];
const PASSO_VOLUME = 10;
// Un SSID sta in 32 byte e un nome Bluetooth in 248: oltre non è un nome, e si dice invece di tagliare.
const NOME_MAX = 256;

// ── Le parti comuni degli script ─────────────────────────────────────────────

// Ogni riga di Filo comincia con «FILO:»; quello che un programma stampa di suo arriva con «| » davanti, così un
// nome di rete o di dispositivo non può fingersi una riga di Filo.
const SH_INIZIO = String.raw`dice() { printf 'FILO:%s=%s\n' "$1" "$2"; }
grezzo() { sed 's/^/| /'; }
`;

const PS_INIZIO = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Dice([string]$k, [string]$v) {
  $s = [regex]::Replace($v, '[^ -~]|\\', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  [Console]::Out.WriteLine('FILO:' + $k + '=' + $s)
}
`;

const PS_ATTESA = String.raw`Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1' } | Select-Object -First 1
function Attendi($op, [Type]$tipo) {
  $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op))
  if (-not $t.Wait(10000)) { throw 'Windows non ha risposto' }
  $t.Result
}
`;

const PS_RADIO_TIPI = String.raw`$null = [Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime]
$null = [Windows.Devices.Radios.RadioState,Windows.System.Devices,ContentType=WindowsRuntime]
$null = [Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime]
`;

// Core Audio dell'uscita predefinita (C# 5: lo compila il PowerShell 5.1 di Windows). Lo legge anche statoSistema.js.
const CS_VOLUME = String.raw`using System;
using System.Runtime.InteropServices;
namespace FiloSistema {
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float livello, Guid contesto);
    int j();
    int GetMasterVolumeLevelScalar(out float livello);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool muto, Guid contesto);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muto);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int contesto, int parametri, out IAudioEndpointVolume volume);
  }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int f();
    int GetDefaultAudioEndpoint(int flusso, int ruolo, out IMMDevice uscita);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class EnumeratoreAudio { }
  public static class Volume {
    static IAudioEndpointVolume Uscita() {
      IMMDeviceEnumerator e = new EnumeratoreAudio() as IMMDeviceEnumerator;
      IMMDevice d = null;
      Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
      IAudioEndpointVolume v = null;
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, 0, out v));
      return v;
    }
    public static int Livello() {
      float x = -1;
      Marshal.ThrowExceptionForHR(Uscita().GetMasterVolumeLevelScalar(out x));
      return (int)Math.Round(x * 100);
    }
    public static void Imposta(int livello) {
      Marshal.ThrowExceptionForHR(Uscita().SetMasterVolumeLevelScalar(livello / 100f, Guid.Empty));
    }
    public static bool EMuto() {
      bool m;
      Marshal.ThrowExceptionForHR(Uscita().GetMute(out m));
      return m;
    }
    public static void ImpostaMuto(bool m) {
      Marshal.ThrowExceptionForHR(Uscita().SetMute(m, Guid.Empty));
    }
  }
}
`;

// Collegare e scollegare cuffie e casse: è la stessa richiesta che fa il tasto «Connetti» di Windows, rivolta al
// driver audio Bluetooth del dispositivo (KSPROPSETID_BtAudio). Gli altri dispositivi Windows li collega da sé.
const CS_CUFFIE = String.raw`using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace FiloCuffie {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class EnumeratoreDispositivi { }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flusso, int stati, out IMMDeviceCollection elenco);
    int GetDefaultAudioEndpoint(int flusso, int ruolo, out IMMDevice uscita);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice dispositivo);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    int GetCount(out int quanti);
    int Item(int indice, out IMMDevice dispositivo);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int contesto, IntPtr parametri, [MarshalAs(UnmanagedType.IUnknown)] out object oggetto);
  }
  [Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDeviceTopology {
    int GetConnectorCount(out int quanti);
    int GetConnector(int indice, out IConnector connettore);
  }
  [Guid("9C2C4058-23F5-41DE-877A-DF3AF236A09E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IConnector {
    int GetConnectorType(out int tipo);
    int GetDataFlow(out int flusso);
    int ConnectTo(IntPtr altro);
    int Disconnect();
    int IsConnected(out int collegato);
    int GetConnectedTo(out IntPtr altro);
    int GetConnectorIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetDeviceIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProprietaKs { public Guid Insieme; public int Id; public int Opzioni; }
  [Guid("28F54685-06FD-11D2-B27A-00A0C9223196"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IKsControl {
    int KsProperty(ref ProprietaKs proprieta, int lunghezza, IntPtr dati, int lunghezzaDati, out int letti);
  }
  public static class Cuffie {
    static readonly Guid AudioBluetooth = new Guid("7FA06C40-B8F6-4C7E-8556-E8C33A12E54D");
    // -1: nessuna uscita audio di quel dispositivo; altrimenti quante hanno accettato la richiesta.
    public static int Comanda(string indirizzo, bool collega) {
      IMMDeviceEnumerator e = (IMMDeviceEnumerator)(new EnumeratoreDispositivi());
      IMMDeviceCollection tutti;
      Marshal.ThrowExceptionForHR(e.EnumAudioEndpoints(2, 15, out tutti));
      int n;
      Marshal.ThrowExceptionForHR(tutti.GetCount(out n));
      string cerca = indirizzo.ToLowerInvariant();
      List<string> visti = new List<string>();
      int riusciti = 0;
      for (int i = 0; i < n; i++) {
        try {
          IMMDevice d;
          if (tutti.Item(i, out d) != 0) continue;
          Guid iidTopologia = typeof(IDeviceTopology).GUID;
          object o;
          if (d.Activate(ref iidTopologia, 23, IntPtr.Zero, out o) != 0) continue;
          IConnector c;
          if (((IDeviceTopology)o).GetConnector(0, out c) != 0) continue;
          string filtro;
          if (c.GetDeviceIdConnectedTo(out filtro) != 0 || filtro == null) continue;
          string basso = filtro.ToLowerInvariant();
          if (basso.IndexOf("bth") < 0 || basso.IndexOf(cerca) < 0 || visti.Contains(basso)) continue;
          visti.Add(basso);
          IMMDevice ks;
          if (e.GetDevice(filtro, out ks) != 0) continue;
          Guid iidKs = typeof(IKsControl).GUID;
          object k;
          if (ks.Activate(ref iidKs, 23, IntPtr.Zero, out k) != 0) continue;
          ProprietaKs p = new ProprietaKs();
          p.Insieme = AudioBluetooth;
          p.Id = collega ? 0 : 1;
          p.Opzioni = 1;
          int letti;
          if (((IKsControl)k).KsProperty(ref p, Marshal.SizeOf(typeof(ProprietaKs)), IntPtr.Zero, 0, out letti) == 0) riusciti++;
        } catch { }
      }
      return visti.Count == 0 ? -1 : riusciti;
    }
  }
}
`;

// Le reti Wi-Fi che Windows conosce, e il collegamento a una di queste (wlanapi, senza netsh: il nome non passa da
// nessuna riga di comando).
const CS_WLAN = String.raw`using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
namespace FiloWlan {
  public class EsitoWlan {
    public int Codice;
    public int Interfacce;
    public List<string> Reti = new List<string>();
    public string Attuale;
    public bool Confermato;
  }
  public static class Wlan {
    [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(int versione, IntPtr riservato, out int negoziata, out IntPtr maniglia);
    [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr maniglia, IntPtr riservato);
    [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr maniglia, IntPtr riservato, out IntPtr elenco);
    [DllImport("wlanapi.dll")] static extern int WlanGetProfileList(IntPtr maniglia, ref Guid interfaccia, IntPtr riservato, out IntPtr elenco);
    [DllImport("wlanapi.dll")] static extern int WlanConnect(IntPtr maniglia, ref Guid interfaccia, ref Parametri parametri, IntPtr riservato);
    [DllImport("wlanapi.dll")] static extern int WlanQueryInterface(IntPtr maniglia, ref Guid interfaccia, int codice, IntPtr riservato, out int dimensione, out IntPtr dati, IntPtr tipo);
    [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr memoria);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Parametri {
      public int Modo;
      [MarshalAs(UnmanagedType.LPWStr)] public string Profilo;
      public IntPtr Ssid;
      public IntPtr Bssid;
      public int TipoBss;
      public int Opzioni;
    }

    static IntPtr Sposta(IntPtr p, int quanto) { return new IntPtr(p.ToInt64() + quanto); }

    static List<Guid> Interfacce(IntPtr h, out int codice) {
      List<Guid> ids = new List<Guid>();
      IntPtr elenco;
      codice = WlanEnumInterfaces(h, IntPtr.Zero, out elenco);
      if (codice != 0) return ids;
      int n = Marshal.ReadInt32(elenco, 0);
      for (int i = 0; i < n; i++) {
        byte[] g = new byte[16];
        Marshal.Copy(Sposta(elenco, 8 + i * 532), g, 0, 16);
        ids.Add(new Guid(g));
      }
      WlanFreeMemory(elenco);
      return ids;
    }

    static List<string> Profili(IntPtr h, Guid id, out int codice) {
      List<string> nomi = new List<string>();
      IntPtr elenco;
      codice = WlanGetProfileList(h, ref id, IntPtr.Zero, out elenco);
      if (codice != 0) return nomi;
      int n = Marshal.ReadInt32(elenco, 0);
      for (int i = 0; i < n; i++) nomi.Add(Marshal.PtrToStringUni(Sposta(elenco, 8 + i * 516)));
      WlanFreeMemory(elenco);
      return nomi;
    }

    // Il profilo a cui l'interfaccia è collegata adesso; null se non lo è. Codice 5: Windows non lo dice (posizione).
    static string Attuale(IntPtr h, Guid id, out int codice) {
      int dimensione;
      IntPtr dati;
      codice = WlanQueryInterface(h, ref id, 7, IntPtr.Zero, out dimensione, out dati, IntPtr.Zero);
      if (codice != 0) return null;
      string nome = Marshal.ReadInt32(dati, 0) == 1 ? Marshal.PtrToStringUni(Sposta(dati, 8)) : null;
      WlanFreeMemory(dati);
      return nome;
    }

    public static EsitoWlan Elenco() {
      EsitoWlan e = new EsitoWlan();
      IntPtr h;
      int negoziata;
      e.Codice = WlanOpenHandle(2, IntPtr.Zero, out negoziata, out h);
      if (e.Codice != 0) return e;
      try {
        int c;
        List<Guid> ids = Interfacce(h, out c);
        if (c != 0) { e.Codice = c; return e; }
        e.Interfacce = ids.Count;
        int letti = 0;
        int negati = 0;
        foreach (Guid id in ids) {
          List<string> nomi = Profili(h, id, out c);
          if (c == 0) {
            letti++;
            foreach (string nome in nomi) if (!e.Reti.Contains(nome)) e.Reti.Add(nome);
          } else if (c == 5) negati++;
          int c2;
          string attuale = Attuale(h, id, out c2);
          if (attuale != null) e.Attuale = attuale;
        }
        if (letti == 0 && negati > 0) e.Codice = 5;
      } finally { WlanCloseHandle(h, IntPtr.Zero); }
      return e;
    }

    public static EsitoWlan Collega(string profilo, int attesaMs) {
      EsitoWlan e = new EsitoWlan();
      IntPtr h;
      int negoziata;
      e.Codice = WlanOpenHandle(2, IntPtr.Zero, out negoziata, out h);
      if (e.Codice != 0) return e;
      try {
        int c;
        List<Guid> ids = Interfacce(h, out c);
        if (c != 0) { e.Codice = c; return e; }
        e.Interfacce = ids.Count;
        if (ids.Count == 0) return e;
        Guid scelta = Guid.Empty;
        bool trovata = false;
        int negati = 0;
        foreach (Guid id in ids) {
          List<string> nomi = Profili(h, id, out c);
          if (c == 5) negati++;
          if (c == 0 && nomi.Contains(profilo)) { scelta = id; trovata = true; break; }
        }
        if (!trovata) { e.Codice = negati > 0 ? 5 : 1168; return e; }
        Parametri p = new Parametri();
        p.Modo = 0;
        p.Profilo = profilo;
        p.Ssid = IntPtr.Zero;
        p.Bssid = IntPtr.Zero;
        p.TipoBss = 1;
        p.Opzioni = 0;
        e.Codice = WlanConnect(h, ref scelta, ref p, IntPtr.Zero);
        if (e.Codice != 0) return e;
        DateTime fine = DateTime.Now.AddMilliseconds(attesaMs);
        while (DateTime.Now < fine) {
          Thread.Sleep(500);
          int c2;
          string attuale = Attuale(h, scelta, out c2);
          if (c2 == 5) return e;
          if (attuale == profilo) { e.Attuale = attuale; e.Confermato = true; return e; }
        }
        e.Codice = -1;
      } finally { WlanCloseHandle(h, IntPtr.Zero); }
      return e;
    }
  }
}
`;

const psCompila = (cs) => `try {\nAdd-Type -TypeDefinition @'\n${cs}'@\n} catch { Dice 'errore' 'compilazione'; Dice 'dettaglio' $_.Exception.Message; exit 0 }\n`;

// ── Gli script, uno per comando e per piattaforma ────────────────────────────
// Nessuno contiene un parametro: lo leggono dall'ambiente (FILO_SIS_*), e lo citano sempre fra virgolette.

const SCRIPT = {
  win32: {
    volume: PS_INIZIO + psCompila(CS_VOLUME) + String.raw`try {
  $l = [string]$env:FILO_SIS_LIVELLO
  $p = [string]$env:FILO_SIS_PASSO
  $m = [string]$env:FILO_SIS_MUTO
  if ($l -notmatch '^[0-9]{1,3}$') { $l = '' }
  if ($p -notmatch '^-?[0-9]{1,3}$') { $p = '' }
  $prima = [FiloSistema.Volume]::Livello()
  Dice 'prima' $prima
  $t = $null
  if ($l -ne '') { $t = [int]$l } elseif ($p -ne '') { $t = $prima + [int]$p }
  if ($null -ne $t) {
    if ($t -lt 0) { $t = 0 }
    if ($t -gt 100) { $t = 100 }
    [FiloSistema.Volume]::Imposta($t)
  }
  if ($m -eq '1') { [FiloSistema.Volume]::ImpostaMuto($true) }
  elseif ($m -eq '0') { [FiloSistema.Volume]::ImpostaMuto($false) }
  elseif (($null -ne $t) -and ($t -gt 0) -and (($l -ne '') -or ([int]$p -gt 0))) { [FiloSistema.Volume]::ImpostaMuto($false) }
  Dice 'volume' ([FiloSistema.Volume]::Livello())
  Dice 'muto' ([int][FiloSistema.Volume]::EMuto())
} catch { Dice 'errore' 'nessuna-uscita'; Dice 'dettaglio' $_.Exception.Message }
`,
    radio: PS_INIZIO + String.raw`$quale = 'Bluetooth'
if ($env:FILO_SIS_RADIO -eq 'wifi') { $quale = 'WiFi' }
$voglio = 'Off'
if ($env:FILO_SIS_ACCESO -eq '1') { $voglio = 'On' }
try {
` + PS_ATTESA + PS_RADIO_TIPI + String.raw`} catch { Dice 'errore' 'winrt'; Dice 'dettaglio' $_.Exception.Message; exit 0 }
try {
  $accesso = [string](Attendi ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]))
  if ($accesso -ne 'Allowed') { Dice 'errore' ('accesso-' + $accesso); exit 0 }
  $tutte = Attendi ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  $radio = @($tutte | Where-Object { [string]$_.Kind -eq $quale })
  if ($radio.Count -eq 0) { Dice 'errore' 'nessuna-radio'; exit 0 }
  foreach ($r in $radio) {
    $esito = [string](Attendi ($r.SetStateAsync([Windows.Devices.Radios.RadioState]$voglio)) ([Windows.Devices.Radios.RadioAccessStatus]))
    if ($esito -ne 'Allowed') { Dice 'errore' ('accesso-' + $esito); exit 0 }
  }
  # Una radio ci mette un attimo a cambiare: si rilegge finché è arrivata, o finché un interruttore la tiene ferma.
  $dopo = @()
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Milliseconds 250
    $ora = Attendi ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
    $dopo = @($ora | Where-Object { [string]$_.Kind -eq $quale } | ForEach-Object { [string]$_.State })
    if (@($dopo | Where-Object { $_ -ne $voglio }).Count -eq 0) { break }
    if (@($dopo | Where-Object { $_ -eq 'Disabled' }).Count -gt 0) { break }
  }
  Dice 'stato' ($dopo -join ',')
  Dice 'acceso' ([int](@($dopo | Where-Object { $_ -eq 'On' }).Count -gt 0))
} catch { Dice 'errore' 'eccezione'; Dice 'dettaglio' $_.Exception.Message }
`,
    'bt-elenco': PS_INIZIO + String.raw`try {
` + PS_ATTESA + PS_RADIO_TIPI + String.raw`  $null = [Windows.Devices.Bluetooth.BluetoothDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
  $null = [Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
} catch { Dice 'errore' 'winrt'; Dice 'dettaglio' $_.Exception.Message; exit 0 }
try {
  $tutte = Attendi ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  $bt = @($tutte | Where-Object { [string]$_.Kind -eq 'Bluetooth' })
  if ($bt.Count -eq 0) { Dice 'errore' 'nessuna-radio'; exit 0 }
  Dice 'acceso' ([int](@($bt | Where-Object { [string]$_.State -eq 'On' }).Count -gt 0))
  $visti = @{}
  $classici = Attendi ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true))) ([Windows.Devices.Enumeration.DeviceInformationCollection])
  foreach ($d in @($classici)) {
    try {
      $dev = Attendi ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($d.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice])
      if ($null -eq $dev) { continue }
      $ind = '{0:x12}' -f $dev.BluetoothAddress
      if ($visti.ContainsKey($ind)) { continue }
      $visti[$ind] = 1
      Dice 'dispositivo' $ind
      Dice 'nome' ([string]$d.Name)
      Dice 'collegato' ([int]([string]$dev.ConnectionStatus -eq 'Connected'))
    } catch {}
  }
  $le = Attendi ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true))) ([Windows.Devices.Enumeration.DeviceInformationCollection])
  foreach ($d in @($le)) {
    try {
      $dev = Attendi ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($d.Id)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
      if ($null -eq $dev) { continue }
      $ind = '{0:x12}' -f $dev.BluetoothAddress
      if ($visti.ContainsKey($ind)) { continue }
      $visti[$ind] = 1
      Dice 'dispositivo' $ind
      Dice 'nome' ([string]$d.Name)
      Dice 'collegato' ([int]([string]$dev.ConnectionStatus -eq 'Connected'))
    } catch {}
  }
} catch { Dice 'errore' 'eccezione'; Dice 'dettaglio' $_.Exception.Message }
`,
    'bt-collega': PS_INIZIO + String.raw`$indirizzo = [string]$env:FILO_SIS_INDIRIZZO
if ($indirizzo -notmatch '^[0-9a-f]{12}$') { Dice 'errore' 'indirizzo'; exit 0 }
$collega = ($env:FILO_SIS_COLLEGA -eq '1')
` + psCompila(CS_CUFFIE) + String.raw`try {
  $n = [FiloCuffie.Cuffie]::Comanda($indirizzo, $collega)
} catch { Dice 'errore' 'eccezione'; Dice 'dettaglio' $_.Exception.Message; exit 0 }
if ($n -lt 0) { Dice 'errore' 'non-audio'; exit 0 }
if ($n -eq 0) { Dice 'errore' 'rifiutato'; exit 0 }
try {
` + PS_ATTESA + String.raw`  $null = [Windows.Devices.Bluetooth.BluetoothDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
  $numero = [Convert]::ToUInt64($indirizzo, 16)
  $fine = (Get-Date).AddSeconds(12)
  $stato = ''
  while ((Get-Date) -lt $fine) {
    try {
      $dev = Attendi ([Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($numero)) ([Windows.Devices.Bluetooth.BluetoothDevice])
      if ($null -ne $dev) { $stato = [string]$dev.ConnectionStatus }
    } catch {}
    if ($collega -and $stato -eq 'Connected') { break }
    if ((-not $collega) -and $stato -eq 'Disconnected') { break }
    Start-Sleep -Milliseconds 500
  }
  Dice 'collegato' ([int]($stato -eq 'Connected'))
} catch { Dice 'collegato' '' }
`,
    'wifi-elenco': PS_INIZIO + psCompila(CS_WLAN) + String.raw`try {
  $e = [FiloWlan.Wlan]::Elenco()
  Dice 'codice' $e.Codice
  Dice 'interfacce' $e.Interfacce
  foreach ($n in $e.Reti) { Dice 'rete' $n }
  if ($e.Attuale) { Dice 'attuale' $e.Attuale }
} catch { Dice 'errore' 'eccezione'; Dice 'dettaglio' $_.Exception.Message }
`,
    'wifi-collega': PS_INIZIO + psCompila(CS_WLAN) + String.raw`try {
  $e = [FiloWlan.Wlan]::Collega([string]$env:FILO_SIS_RETE, 15000)
  Dice 'codice' $e.Codice
  Dice 'interfacce' $e.Interfacce
  Dice 'confermato' ([int]$e.Confermato)
} catch { Dice 'errore' 'eccezione'; Dice 'dettaglio' $_.Exception.Message }
`,
  },

  linux: {
    volume: SH_INIZIO + String.raw`L="$FILO_SIS_LIVELLO"; P="$FILO_SIS_PASSO"; M="$FILO_SIS_MUTO"
case "$L" in ''|*[!0-9]*) L= ;; esac
case "$P" in ''|-|*[!0-9-]*|?*-*) P= ;; esac
case "$M" in 0|1) ;; *) M= ;; esac
if command -v wpctl >/dev/null 2>&1 && wpctl get-volume @DEFAULT_AUDIO_SINK@ >/dev/null 2>&1; then T_=wpctl
elif command -v pactl >/dev/null 2>&1 && pactl get-sink-volume @DEFAULT_SINK@ >/dev/null 2>&1; then T_=pactl
elif command -v amixer >/dev/null 2>&1 && amixer get Master >/dev/null 2>&1; then T_=amixer
else dice errore manca-audio; exit 0; fi
dice strumento "$T_"
leggi() {
  case "$T_" in
    wpctl) wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null | awk '{ printf "%d", $2 * 100 + 0.5 }' ;;
    pactl) pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null | grep -o '[0-9]*%' | head -n 1 | tr -d '%' ;;
    amixer) amixer -M get Master 2>/dev/null | grep -o '\[[0-9]*%\]' | head -n 1 | tr -d '[]%' ;;
  esac
}
muto() {
  case "$T_" in
    wpctl) if wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null | grep -q MUTED; then echo 1; else echo 0; fi ;;
    pactl) if pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null | grep -qi yes; then echo 1; else echo 0; fi ;;
    amixer) if amixer get Master 2>/dev/null | grep -q '\[off\]'; then echo 1; else echo 0; fi ;;
  esac
}
imposta() {
  case "$T_" in
    wpctl) wpctl set-volume @DEFAULT_AUDIO_SINK@ "$1%" ;;
    pactl) pactl set-sink-volume @DEFAULT_SINK@ "$1%" ;;
    amixer) amixer -q -M set Master "$1%" ;;
  esac
}
silenzia() {
  case "$T_" in
    wpctl) wpctl set-mute @DEFAULT_AUDIO_SINK@ "$1" ;;
    pactl) pactl set-sink-mute @DEFAULT_SINK@ "$1" ;;
    amixer) if [ "$1" = 1 ]; then amixer -q set Master mute; else amixer -q set Master unmute; fi ;;
  esac
}
PRIMA=$(leggi)
case "$PRIMA" in ''|*[!0-9]*) PRIMA= ;; esac
dice prima "$PRIMA"
T=
if [ -n "$L" ]; then T=$L
elif [ -n "$P" ] && [ -n "$PRIMA" ]; then T=$((PRIMA + P)); fi
if [ -n "$T" ]; then
  [ "$T" -lt 0 ] && T=0
  [ "$T" -gt 100 ] && T=100
  imposta "$T" || dice errore comando
fi
if [ -n "$M" ]; then silenzia "$M" || dice errore comando
elif [ -n "$T" ] && [ "$T" -gt 0 ] && { [ -n "$L" ] || [ "$P" -gt 0 ]; }; then silenzia 0; fi
dice volume "$(leggi)"
dice muto "$(muto)"
`,
    radio: SH_INIZIO + String.raw`A="$FILO_SIS_ACCESO"
case "$A" in 0|1) ;; *) dice errore parametro; exit 0 ;; esac
hard() {
  for r in /sys/class/rfkill/rfkill*; do
    [ -r "$r/type" ] || continue
    [ "$(cat "$r/type" 2>/dev/null)" = "$1" ] || continue
    [ "$(cat "$r/hard" 2>/dev/null)" = 1 ] && { echo 1; return; }
  done
  echo 0
}
if [ "$FILO_SIS_RADIO" = wifi ]; then
  command -v nmcli >/dev/null 2>&1 || { dice errore manca-nmcli; exit 0; }
  nmcli -t -f TYPE device 2>/dev/null | grep -qx wifi || { dice errore nessuna-radio; exit 0; }
  dice bloccata "$(hard wlan)"
  if [ "$A" = 1 ]; then nmcli radio wifi on 2>&1 | grezzo; else nmcli radio wifi off 2>&1 | grezzo; fi
  sleep 1
  if [ "$(nmcli radio wifi 2>/dev/null)" = enabled ]; then dice acceso 1; else dice acceso 0; fi
else
  dice bloccata "$(hard bluetooth)"
  if [ "$A" = 1 ] && command -v rfkill >/dev/null 2>&1; then rfkill unblock bluetooth 2>&1 | grezzo; fi
  if command -v bluetoothctl >/dev/null 2>&1; then
    if [ "$A" = 1 ]; then timeout 10 bluetoothctl power on 2>&1 | grezzo; else timeout 10 bluetoothctl power off 2>&1 | grezzo; fi
    if timeout 5 bluetoothctl show 2>/dev/null | grep -q 'Powered: yes'; then dice acceso 1
    elif timeout 5 bluetoothctl show 2>/dev/null | grep -q 'Powered:'; then dice acceso 0
    else dice errore nessuna-radio; fi
  elif command -v rfkill >/dev/null 2>&1; then
    if [ "$A" = 0 ]; then rfkill block bluetooth 2>&1 | grezzo; fi
    if rfkill list bluetooth 2>/dev/null | grep -q 'Soft blocked: yes'; then dice acceso 0
    elif rfkill list bluetooth 2>/dev/null | grep -q 'Soft blocked: no'; then dice acceso 1
    else dice errore nessuna-radio; fi
  else dice errore manca-bluetoothctl; fi
fi
`,
    'bt-elenco': SH_INIZIO + String.raw`command -v bluetoothctl >/dev/null 2>&1 || { dice errore manca-bluetoothctl; exit 0; }
if timeout 5 bluetoothctl show 2>/dev/null | grep -q 'Powered: yes'; then dice acceso 1
elif timeout 5 bluetoothctl show 2>/dev/null | grep -q 'Powered:'; then dice acceso 0
else dice errore nessuna-radio; exit 0; fi
timeout 8 bluetoothctl devices 2>/dev/null | while read -r tipo ind resto; do
  [ "$tipo" = Device ] || continue
  case "$ind" in [0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]:[0-9A-Fa-f][0-9A-Fa-f]) ;; *) continue ;; esac
  INFO=$(timeout 5 bluetoothctl info "$ind" 2>/dev/null </dev/null)
  printf '%s\n' "$INFO" | grep -q 'Paired: yes' || continue
  dice dispositivo "$ind"
  printf '%s\n' "$INFO" | grep -E '^[[:space:]]*(Alias|Name|Connected):' | grezzo
done
`,
    'bt-collega': SH_INIZIO + String.raw`I="$FILO_SIS_INDIRIZZO"
case "$I" in [0-9A-F][0-9A-F]:[0-9A-F][0-9A-F]:[0-9A-F][0-9A-F]:[0-9A-F][0-9A-F]:[0-9A-F][0-9A-F]:[0-9A-F][0-9A-F]) ;; *) dice errore indirizzo; exit 0 ;; esac
command -v bluetoothctl >/dev/null 2>&1 || { dice errore manca-bluetoothctl; exit 0; }
if [ "$FILO_SIS_COLLEGA" = 1 ]; then timeout 25 bluetoothctl connect "$I" 2>&1 | grezzo; else timeout 15 bluetoothctl disconnect "$I" 2>&1 | grezzo; fi
if timeout 5 bluetoothctl info "$I" 2>/dev/null | grep -q 'Connected: yes'; then dice collegato 1; else dice collegato 0; fi
`,
    'wifi-elenco': SH_INIZIO + String.raw`command -v nmcli >/dev/null 2>&1 || { dice errore manca-nmcli; exit 0; }
nmcli -t -f TYPE device 2>/dev/null | grep -qx wifi || { dice errore nessuna-radio; exit 0; }
if [ "$(nmcli radio wifi 2>/dev/null)" = enabled ]; then dice acceso 1; else dice acceso 0; fi
dice blocco reti
nmcli -t -f TYPE,UUID,ACTIVE,NAME connection show 2>&1 | grezzo
`,
    'wifi-collega': SH_INIZIO + String.raw`U="$FILO_SIS_UUID"
case "$U" in *[!0-9a-fA-F-]*|'') dice errore parametro; exit 0 ;; esac
command -v nmcli >/dev/null 2>&1 || { dice errore manca-nmcli; exit 0; }
nmcli --wait 25 connection up uuid "$U" 2>&1 | grezzo
dice uscita "$(nmcli -t -f UUID connection show --active 2>/dev/null | grep -qix "$U" && echo 0 || echo 1)"
`,
  },

  darwin: {
    volume: SH_INIZIO + String.raw`osascript <<'FINE_APPLESCRIPT'
on numero(t)
  try
    return t as integer
  on error
    return missing value
  end try
end numero
set L to my numero(system attribute "FILO_SIS_LIVELLO")
set P to my numero(system attribute "FILO_SIS_PASSO")
set M to system attribute "FILO_SIS_MUTO"
set s to get volume settings
set prima to output volume of s
if prima is missing value then return "FILO:errore=nessuna-uscita"
set T to missing value
if L is not missing value then
  set T to L
else if P is not missing value then
  set T to prima + P
end if
if T is not missing value then
  if T < 0 then set T to 0
  if T > 100 then set T to 100
  set volume output volume T
end if
if M is "1" then
  set volume output muted true
else if M is "0" then
  set volume output muted false
else if T is not missing value then
  if T > 0 and (L is not missing value or P > 0) then set volume output muted false
end if
set s to get volume settings
set m to 0
if output muted of s then set m to 1
return "FILO:prima=" & prima & linefeed & "FILO:volume=" & (output volume of s) & linefeed & "FILO:muto=" & m
FINE_APPLESCRIPT
`,
    radio: SH_INIZIO + String.raw`A="$FILO_SIS_ACCESO"
case "$A" in 0|1) ;; *) dice errore parametro; exit 0 ;; esac
if [ "$FILO_SIS_RADIO" = wifi ]; then
  D=$(networksetup -listallhardwareports 2>/dev/null | awk '/^Hardware Port: (Wi-Fi|AirPort)$/ { getline; print $2; exit }')
  [ -n "$D" ] || { dice errore nessuna-radio; exit 0; }
  if [ "$A" = 1 ]; then networksetup -setairportpower "$D" on 2>&1 | grezzo; else networksetup -setairportpower "$D" off 2>&1 | grezzo; fi
  if networksetup -getairportpower "$D" 2>/dev/null | grep -q ': On$'; then dice acceso 1; else dice acceso 0; fi
else
  B=
  for c in "$(command -v blueutil 2>/dev/null)" /opt/homebrew/bin/blueutil /usr/local/bin/blueutil; do
    if [ -n "$c" ] && [ -x "$c" ]; then B=$c; break; fi
  done
  [ -n "$B" ] || { dice errore manca-blueutil; exit 0; }
  OUT=$("$B" --power "$A" 2>&1); RC=$?
  printf '%s\n' "$OUT" | grezzo
  dice uscita "$RC"
  dice acceso "$("$B" --power 2>/dev/null)"
fi
`,
    'bt-elenco': SH_INIZIO + String.raw`B=
for c in "$(command -v blueutil 2>/dev/null)" /opt/homebrew/bin/blueutil /usr/local/bin/blueutil; do
  if [ -n "$c" ] && [ -x "$c" ]; then B=$c; break; fi
done
[ -n "$B" ] || { dice errore manca-blueutil; exit 0; }
OUT=$("$B" --power 2>&1); RC=$?
dice uscita "$RC"
dice acceso "$OUT"
dice blocco dispositivi
"$B" --paired --format json 2>/dev/null | grezzo
`,
    'bt-collega': SH_INIZIO + String.raw`I="$FILO_SIS_INDIRIZZO"
case "$I" in [0-9a-f][0-9a-f]-[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f]-[0-9a-f][0-9a-f]) ;; *) dice errore indirizzo; exit 0 ;; esac
B=
for c in "$(command -v blueutil 2>/dev/null)" /opt/homebrew/bin/blueutil /usr/local/bin/blueutil; do
  if [ -n "$c" ] && [ -x "$c" ]; then B=$c; break; fi
done
[ -n "$B" ] || { dice errore manca-blueutil; exit 0; }
if [ "$FILO_SIS_COLLEGA" = 1 ]; then OUT=$("$B" --connect "$I" 2>&1); RC=$?; else OUT=$("$B" --disconnect "$I" 2>&1); RC=$?; fi
printf '%s\n' "$OUT" | grezzo
dice uscita "$RC"
dice collegato "$("$B" --is-connected "$I" 2>/dev/null)"
`,
    'wifi-elenco': SH_INIZIO + String.raw`D=$(networksetup -listallhardwareports 2>/dev/null | awk '/^Hardware Port: (Wi-Fi|AirPort)$/ { getline; print $2; exit }')
[ -n "$D" ] || { dice errore nessuna-radio; exit 0; }
if networksetup -getairportpower "$D" 2>/dev/null | grep -q ': On$'; then dice acceso 1; else dice acceso 0; fi
dice blocco reti
networksetup -listpreferredwirelessnetworks "$D" 2>&1 | grezzo
`,
    'wifi-collega': SH_INIZIO + String.raw`D=$(networksetup -listallhardwareports 2>/dev/null | awk '/^Hardware Port: (Wi-Fi|AirPort)$/ { getline; print $2; exit }')
[ -n "$D" ] || { dice errore nessuna-radio; exit 0; }
dice blocco esito
networksetup -setairportnetwork "$D" "$FILO_SIS_RETE" 2>&1 | grezzo
dice blocco attuale
networksetup -getairportnetwork "$D" 2>&1 | grezzo
`,
  },
};

// ── Richiesta → script + ambiente ────────────────────────────────────────────

const AMBIENTE = {
  volume: ['LIVELLO', 'PASSO', 'MUTO'],
  radio: ['RADIO', 'ACCESO'],
  'bt-elenco': [],
  'bt-collega': ['INDIRIZZO', 'COLLEGA'],
  'wifi-elenco': [],
  'wifi-collega': ['RETE', 'UUID'],
};

const INDIRIZZO = {
  win32: /^[0-9a-f]{12}$/,
  linux: /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/,
  darwin: /^[0-9a-f]{2}(-[0-9a-f]{2}){5}$/,
};

// Un nome che arriva al sistema: niente caratteri di controllo (un a capo non sta in nessun nome di rete) e un tetto.
function nomeValido(v) {
  if (typeof v !== 'string' || !v.length) return 'vuoto';
  if (/[\u0000-\u001f\u007f]/.test(v)) return 'caratteri di controllo';
  if (Array.from(v).length > NOME_MAX) return `più lungo di ${NOME_MAX} caratteri`;
  return null;
}

// I parametri si controllano qui e di nuovo nello script: un valore che non passa non arriva al sistema.
function parametri(comando, p, piattaforma) {
  const q = p || {};
  const fuori = {};
  if (comando === 'volume') {
    if (q.livello != null) {
      const n = Number(q.livello);
      if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('livello del volume fuori da 0-100');
      fuori.LIVELLO = String(n);
    }
    if (q.passo != null) {
      const n = Number(q.passo);
      if (!Number.isInteger(n) || n < -100 || n > 100 || n === 0) throw new Error('passo del volume non valido');
      fuori.PASSO = String(n);
    }
    if (q.muto != null) {
      if (typeof q.muto !== 'boolean') throw new Error('muto dev\'essere sì o no');
      fuori.MUTO = q.muto ? '1' : '0';
    }
    if (!Object.keys(fuori).length) throw new Error('niente da cambiare nel volume');
  } else if (comando === 'radio') {
    if (q.radio !== 'bluetooth' && q.radio !== 'wifi') throw new Error('radio sconosciuta');
    if (typeof q.acceso !== 'boolean') throw new Error('acceso dev\'essere sì o no');
    fuori.RADIO = q.radio;
    fuori.ACCESO = q.acceso ? '1' : '0';
  } else if (comando === 'bt-collega') {
    const ind = String(q.indirizzo || '');
    if (!INDIRIZZO[piattaforma].test(ind)) throw new Error('indirizzo Bluetooth non valido');
    if (typeof q.collega !== 'boolean') throw new Error('collega dev\'essere sì o no');
    fuori.INDIRIZZO = ind;
    fuori.COLLEGA = q.collega ? '1' : '0';
  } else if (comando === 'wifi-collega') {
    if (piattaforma === 'linux') {
      const u = String(q.uuid || '');
      if (!/^[0-9a-fA-F-]{8,64}$/.test(u)) throw new Error('rete senza identificativo');
      fuori.UUID = u;
    } else {
      const errore = nomeValido(q.rete);
      if (errore) throw new Error(`nome di rete ${errore}`);
      fuori.RETE = q.rete;
    }
  }
  const ammessi = AMBIENTE[comando];
  for (const k of Object.keys(fuori)) if (!ammessi.includes(k)) throw new Error(`parametro ${k} non previsto`);
  return fuori;
}

// `shell` è quella da chiedere: quale gira davvero lo decide resolveShell (fuori da Windows, la shell di sistema).
function costruisci(comando, p, piattaforma = process.platform) {
  if (!PIATTAFORME.includes(piattaforma)) throw new Error(`piattaforma non prevista: ${piattaforma}`);
  const script = SCRIPT[piattaforma][comando];
  if (!script) throw new Error(`comando sconosciuto: ${comando}`);
  const env = {};
  for (const [k, v] of Object.entries(parametri(comando, p, piattaforma))) env[`FILO_SIS_${k}`] = v;
  return { shell: piattaforma === 'win32' ? 'powershell' : 'sh', script, env };
}


// ── Uscita → dati ────────────────────────────────────────────────────────────

const decodifica = (v) => String(v).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

// Le righe «FILO:chiave=valore» in ordine; ognuna si porta dietro le righe «| …» stampate dal programma dopo di lei.
function leggiUscita(testo) {
  const voci = [];
  const grezze = [];
  let ultima = null;
  for (const riga of String(testo || '').split(/\r?\n/)) {
    const m = /^FILO:([a-z][a-z0-9-]*)=(.*)$/.exec(riga);
    if (m) {
      ultima = { k: m[1], v: decodifica(m[2]), righe: [] };
      voci.push(ultima);
    } else if (riga.startsWith('| ')) {
      grezze.push(riga.slice(2));
      if (ultima) ultima.righe.push(riga.slice(2));
    }
  }
  const primo = (k) => { const x = voci.find((v) => v.k === k); return x ? x.v : null; };
  const blocco = (nome) => { const x = voci.find((v) => v.k === 'blocco' && v.v === nome); return x ? x.righe : []; };
  return { voci, grezze, primo, blocco };
}

const intero = (v) => (v != null && /^-?\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : null);
const bit = (v) => (v == null ? null : String(v).trim() === '1' ? true : String(v).trim() === '0' ? false : null);

function interpretaVolume(u) {
  const errore = u.primo('errore');
  const volume = intero(u.primo('volume'));
  if (volume == null) return { ok: false, errore: errore || 'sconosciuto' };
  return { ok: true, volume: Math.max(0, Math.min(150, volume)), muto: bit(u.primo('muto')) === true, prima: intero(u.primo('prima')) };
}

function interpretaRadio(u, piattaforma, radio, voluto) {
  const errore = u.primo('errore');
  if (errore) return { ok: false, errore };
  const acceso = bit(u.primo('acceso'));
  const testo = u.grezze.join('\n');
  if (piattaforma === 'linux' && /not authorized|non autorizzat/i.test(testo)) return { ok: false, errore: 'polkit' };
  if (piattaforma === 'darwin' && radio === 'wifi' && /root|administrator|amministrator/i.test(testo)) return { ok: false, errore: 'admin-wifi' };
  if (acceso === null) {
    if (piattaforma === 'darwin' && radio === 'bluetooth') return { ok: false, errore: 'permesso-bluetooth' };
    return { ok: false, errore: 'sconosciuto' };
  }
  if (acceso !== voluto) {
    const bloccata = bit(u.primo('bloccata')) === true || /disabled/i.test(String(u.primo('stato') || '')) || /blocked/i.test(testo);
    if (voluto && bloccata) return { ok: false, errore: 'bloccata' };
    if (piattaforma === 'darwin' && radio === 'bluetooth') return { ok: false, errore: 'permesso-bluetooth' };
    return { ok: false, errore: 'non-cambiato' };
  }
  return { ok: true, acceso };
}

// bluetoothctl info: «Alias:» è il nome che l'utente vede (rinominato o no); «Name:» il ripiego.
function dispositiviDaVoci(u, piattaforma) {
  const out = [];
  let cur = null;
  for (const { k, v, righe } of u.voci) {
    if (k === 'dispositivo') {
      cur = { indirizzo: v, nome: '', collegato: null };
      out.push(cur);
      if (piattaforma === 'linux') {
        const campo = (nome) => { const r = righe.find((x) => new RegExp(`^\\s*${nome}:`).test(x)); return r ? r.replace(/^\s*\w+:\s?/, '') : ''; };
        cur.nome = campo('Alias') || campo('Name') || v;
        cur.collegato = /yes/.test(campo('Connected')) ? true : (campo('Connected') ? false : null);
      }
    } else if (cur && k === 'nome') cur.nome = v;
    else if (cur && k === 'collegato') cur.collegato = bit(v);
  }
  return out;
}

// blueutil 2.7 e seguenti scrivono JSON; le versioni prima una riga per dispositivo, col nome fra virgolette.
function dispositiviMac(righe) {
  let j;
  try { j = JSON.parse(righe.join('\n')); } catch (_) { j = null; }
  if (!Array.isArray(j)) {
    const testo = righe.filter((r) => /^address:/.test(r));
    if (!testo.length) return righe.join('').trim() ? null : [];
    return testo.map((r) => {
      const ind = /^address:\s*([0-9a-fA-F:-]{17})/.exec(r);
      const nome = /name:\s*"(.*)"/.exec(r);
      return ind ? { indirizzo: ind[1].toLowerCase().replace(/:/g, '-'), nome: nome ? nome[1] : ind[1], collegato: !/not connected/.test(r) && /connected/.test(r) } : null;
    }).filter(Boolean);
  }
  return j.filter((d) => d && typeof d.address === 'string').map((d) => ({
    indirizzo: d.address.toLowerCase().replace(/:/g, '-'),
    nome: typeof d.name === 'string' && d.name ? d.name : d.address,
    collegato: typeof d.connected === 'boolean' ? d.connected : null,
  }));
}

function interpretaBtElenco(u, piattaforma) {
  const errore = u.primo('errore');
  if (errore) return { ok: false, errore };
  let dispositivi;
  if (piattaforma === 'darwin') {
    if (intero(u.primo('uscita')) > 0) return { ok: false, errore: 'permesso-bluetooth' };
    dispositivi = dispositiviMac(u.blocco('dispositivi'));
    if (!dispositivi) return { ok: false, errore: 'sconosciuto' };
  } else dispositivi = dispositiviDaVoci(u, piattaforma);
  const valide = dispositivi.filter((d) => d.indirizzo && INDIRIZZO[piattaforma].test(normalizzaIndirizzo(d.indirizzo, piattaforma)));
  for (const d of valide) d.indirizzo = normalizzaIndirizzo(d.indirizzo, piattaforma);
  return { ok: true, acceso: bit(u.primo('acceso')), dispositivi: valide };
}

function normalizzaIndirizzo(ind, piattaforma) {
  const s = String(ind || '').trim();
  if (piattaforma === 'linux') return s.toUpperCase();
  if (piattaforma === 'darwin') return s.toLowerCase().replace(/:/g, '-');
  return s.toLowerCase();
}

function interpretaBtCollega(u, piattaforma, collega) {
  const errore = u.primo('errore');
  if (errore) return { ok: false, errore };
  const collegato = bit(u.primo('collegato'));
  if (piattaforma === 'darwin' && intero(u.primo('uscita')) > 128) return { ok: false, errore: 'permesso-bluetooth' };
  if (collegato === null) return piattaforma === 'win32' ? { ok: true, collegato: null } : { ok: false, errore: 'sconosciuto' };
  if (collegato !== collega) return { ok: false, errore: collega ? 'bt-non-collegato' : 'bt-non-scollegato' };
  return { ok: true, collegato };
}

// nmcli -t: i campi sono separati da «:», e «:» e «\» dentro un valore arrivano come «\:» e «\\».
function campiNmcli(riga, quanti) {
  const campi = [];
  let cur = '';
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (c === '\\' && i + 1 < riga.length) { cur += riga[++i]; continue; }
    if (c === ':' && campi.length < quanti - 1) { campi.push(cur); cur = ''; continue; }
    cur += c;
  }
  campi.push(cur);
  return campi;
}

function interpretaWifiElenco(u, piattaforma) {
  const errore = u.primo('errore');
  if (errore) return { ok: false, errore };
  if (piattaforma === 'win32') {
    const codice = intero(u.primo('codice'));
    if (codice) return { ok: false, errore: erroreWlan(codice) };
    if (intero(u.primo('interfacce')) === 0) return { ok: false, errore: 'nessuna-radio' };
    const attuale = u.primo('attuale');
    const reti = u.voci.filter((v) => v.k === 'rete' && v.v).map((v) => ({ nome: v.v, attiva: v.v === attuale }));
    return { ok: true, acceso: null, reti, attuale: attuale || null };
  }
  const righe = u.blocco('reti');
  let reti = [];
  if (piattaforma === 'linux') {
    if (righe.some((r) => /not authorized|non autorizzat/i.test(r))) return { ok: false, errore: 'polkit' };
    for (const r of righe) {
      const [tipo, uuid, attiva, nome] = campiNmcli(r, 4);
      if (tipo !== '802-11-wireless' || !nome) continue;
      reti.push({ nome, id: uuid, attiva: attiva === 'yes' });
    }
  } else {
    reti = righe.filter((r) => /^\s/.test(r) && r.trim()).map((r) => ({ nome: r.replace(/^\t/, '').replace(/^\s+/, ''), attiva: false }));
  }
  const attiva = reti.find((r) => r.attiva);
  return { ok: true, acceso: bit(u.primo('acceso')), reti, attuale: attiva ? attiva.nome : null };
}

// I codici di wlanapi che l'utente può fare qualcosa per togliere.
function erroreWlan(codice) {
  if (codice === 5) return 'posizione';
  if (codice === 1062) return 'servizio-wlan';
  if (codice === 1168 || codice === 87) return 'non-trovata';
  // La radio spenta Windows la dice in due modi: lo stato della radio, o «interfaccia non pronta».
  if (codice === -2144067582 || codice === 5023) return 'radio-spenta';
  if (codice === -1) return 'tempo';
  return 'sconosciuto';
}

function interpretaWifiCollega(u, piattaforma, nome) {
  const errore = u.primo('errore');
  if (errore) return { ok: false, errore };
  if (piattaforma === 'win32') {
    const codice = intero(u.primo('codice'));
    if (codice) return { ok: false, errore: erroreWlan(codice) };
    if (intero(u.primo('interfacce')) === 0) return { ok: false, errore: 'nessuna-radio' };
    return { ok: true, confermato: bit(u.primo('confermato')) === true };
  }
  const testo = u.grezze.join('\n');
  if (piattaforma === 'linux') {
    if (/not authorized|non autorizzat/i.test(testo)) return { ok: false, errore: 'polkit' };
    if (intero(u.primo('uscita')) === 0) return { ok: true, confermato: true };
    if (/wi-?fi is disabled|radio.*disabled|wireless is disabled/i.test(testo)) return { ok: false, errore: 'radio-spenta' };
    return { ok: false, errore: 'non-collegato' };
  }
  const esito = u.blocco('esito').join('\n');
  if (/could not find|failed|error|unable/i.test(esito)) {
    if (/power|off/i.test(esito)) return { ok: false, errore: 'radio-spenta' };
    return { ok: false, errore: /could not find/i.test(esito) ? 'non-collegato' : 'non-collegato' };
  }
  const attuale = u.blocco('attuale').join('\n');
  const m = /:\s(.+)$/m.exec(attuale);
  return { ok: true, confermato: !!(m && m[1].trim() === nome) };
}

// ── Cosa dire quando non riesce: una frase, e dove si concede quello che manca ──

const IMPOSTAZIONI = {
  'win-radio': 'ms-settings:privacy-radios',
  'win-aereo': 'ms-settings:network-airplanemode',
  'win-posizione': 'ms-settings:privacy-location',
  'win-bluetooth': 'ms-settings:bluetooth',
  'mac-bluetooth': 'x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth',
  'mac-wifi': 'x-apple.systempreferences:com.apple.wifi-settings-extension',
};

function spiega(errore, { cosa, piattaforma = process.platform, nome = '' } = {}) {
  const radio = cosa === 'wifi' ? 'il Wi-Fi' : 'il Bluetooth';
  const Radio = cosa === 'wifi' ? 'Il Wi-Fi' : 'Il Bluetooth';
  const chi = nome ? `«${nome}»` : 'il dispositivo';
  const T = {
    'accesso-DeniedByUser': {
      frase: 'Windows non lascia a Filo accendere e spegnere le radio.',
      dove: 'Si concede in Impostazioni → Privacy e sicurezza → Radio, con «Consenti alle app di controllare le radio del dispositivo».',
      apri: 'win-radio',
    },
    'accesso-Unspecified': {
      frase: 'Windows non ha detto se Filo può accendere e spegnere le radio.',
      dove: 'Si controlla in Impostazioni → Privacy e sicurezza → Radio, con «Consenti alle app di controllare le radio del dispositivo».',
      apri: 'win-radio',
    },
    'accesso-DeniedBySystem': {
      frase: `Windows adesso non permette di cambiare ${radio}: può essere la modalità aereo o una regola dell'azienda.`,
      dove: 'Si controlla in Impostazioni → Rete e Internet → Modalità aereo.',
      apri: 'win-aereo',
    },
    bloccata: {
      frase: `${Radio} è spento da un interruttore, da un tasto del computer o dalla modalità aereo: si riaccende da lì.`,
      apri: piattaforma === 'win32' ? 'win-aereo' : undefined,
    },
    'nessuna-radio': {
      frase: cosa === 'wifi'
        ? 'Il sistema non vede un Wi-Fi su questo computer.'
        : 'Il sistema non vede un Bluetooth su questo computer (può anche essere fermo il servizio Bluetooth).',
    },
    'non-cambiato': { frase: `${Radio} non ha cambiato stato: il sistema non ha detto perché.` },
    polkit: {
      frase: 'Linux non dà a questo utente il permesso di cambiare la rete.',
      dove: 'Lo concede chi amministra il computer, nelle regole di polkit per NetworkManager; intanto il Wi-Fi si cambia dal menu di rete del desktop.',
    },
    'manca-nmcli': {
      frase: 'Su questo Linux la rete non la gestisce NetworkManager, e Filo comanda il Wi-Fi con nmcli.',
      dove: 'nmcli arriva col pacchetto di NetworkManager della distribuzione (network-manager o NetworkManager).',
    },
    'manca-bluetoothctl': {
      frase: 'Su questo Linux manca bluetoothctl, il comando di BlueZ con cui Filo comanda il Bluetooth.',
      dove: 'Arriva col pacchetto bluez (su alcune distribuzioni bluez-utils).',
    },
    'manca-audio': {
      frase: 'Su questo Linux Filo non trova un modo di cambiare il volume.',
      dove: 'Serve uno fra wpctl, pactl e amixer: arrivano con PipeWire, PulseAudio o alsa-utils.',
    },
    'nessuna-uscita': { frase: 'Il computer non ha un\'uscita audio di cui cambiare il volume, o il sistema non la dice.' },
    'manca-blueutil': {
      frase: 'Su Mac il Bluetooth si comanda con un piccolo programma che qui non c\'è: blueutil.',
      dove: 'Si installa con Homebrew, scrivendo nel Terminale: brew install blueutil.',
    },
    'permesso-bluetooth': {
      frase: 'macOS non permette a Filo di usare il Bluetooth.',
      dove: 'Si concede in Impostazioni di Sistema → Privacy e sicurezza → Bluetooth, accendendo Filo.',
      apri: 'mac-bluetooth',
    },
    'admin-wifi': {
      frase: 'macOS chiede un amministratore per accendere o spegnere il Wi-Fi.',
      dove: 'Si toglie in Impostazioni di Sistema → Wi-Fi → Avanzate: «Richiedi l\'autorizzazione dell\'amministratore per attivare o disattivare il Wi-Fi».',
      apri: 'mac-wifi',
    },
    posizione: {
      frase: 'Da Windows 11, per leggere le reti Wi-Fi conosciute e collegarsi Filo deve poter usare la posizione.',
      dove: 'Si concede in Impostazioni → Privacy e sicurezza → Posizione: «Servizi di localizzazione» e «Consenti alle app desktop di accedere alla posizione».',
      apri: 'win-posizione',
    },
    'servizio-wlan': {
      frase: 'È fermo il servizio di Windows che gestisce il Wi-Fi (Configurazione automatica WLAN).',
      dove: 'Riparte riavviando il computer, o da services.msc.',
    },
    'non-trovata': { frase: `${nome ? `La rete «${nome}»` : 'Quella rete'} non è fra quelle che il computer conosce: la prima volta ci si collega dalle impostazioni del sistema, con la password.` },
    'radio-spenta': { frase: 'Il Wi-Fi è spento.' },
    tempo: { frase: `Il computer non è riuscito a collegarsi a ${nome ? `«${nome}»` : 'quella rete'}: può essere fuori portata, o la password è cambiata.` },
    'non-collegato': { frase: `Il computer non è riuscito a collegarsi a ${nome ? `«${nome}»` : 'quella rete'}: può essere fuori portata, o la password è cambiata.` },
    'non-audio': {
      frase: 'Su Windows Filo collega da qui cuffie, casse e auricolari. Gli altri dispositivi Windows li collega da sé quando li accendi.',
      dove: 'Altrimenti si collegano da Impostazioni → Bluetooth e dispositivi.',
      apri: 'win-bluetooth',
    },
    rifiutato: { frase: `${chi[0].toUpperCase()}${chi.slice(1)} non ha accettato il collegamento: dev'essere acceso e vicino.` },
    'bt-non-collegato': { frase: `${chi[0].toUpperCase()}${chi.slice(1)} non si è collegato: dev'essere acceso, vicino e non già collegato a un altro telefono o computer.` },
    'bt-non-scollegato': { frase: `${chi[0].toUpperCase()}${chi.slice(1)} risulta ancora collegato.` },
    'nessun-dispositivo': { frase: nome ? `Fra i dispositivi abbinati non ce n'è uno che si chiami «${nome}».` : 'Non ci sono dispositivi Bluetooth abbinati.' },
    'nessuna-rete': { frase: nome ? `Fra le reti conosciute non ce n'è una che si chiami «${nome}».` : 'Il computer non conosce nessuna rete Wi-Fi.' },
    ambiguo: { frase: `Più di un nome somiglia a «${nome}»: quale?` },
    occupato: { frase: 'Il sistema sta ancora eseguendo il comando di prima.' },
    'non-supportato': { frase: 'Su questo sistema Filo non sa ancora comandarlo.' },
    prove: { frase: 'Durante le prove automatiche Filo non comanda il computer vero.' },
  };
  const voce = T[errore] || { frase: 'Il sistema non ha eseguito il comando.' };
  const fuori = { errore, frase: voce.frase };
  if (voce.dove) fuori.dove = voce.dove;
  if (voce.apri && IMPOSTAZIONI[voce.apri]) fuori.apri = voce.apri;
  return fuori;
}

// ── I nomi come li dice l'utente: maiuscole, accenti, spazi e qualche errore di battitura non contano ──

function piega(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function distanza(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prima = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const riga = [i];
    for (let j = 1; j <= n; j++) {
      riga[j] = Math.min(prima[j] + 1, riga[j - 1] + 1, prima[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prima = riga;
  }
  return prima[n];
}

// Le parole che si dicono intorno al nome («le cuffie Sony», «la rete di casa»): nel nome non ci sono quasi mai.
const CONTORNO = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una', 'di', 'del', 'dello', 'della',
  'dei', 'degli', 'delle', 'd', 'a', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'da', 'dal', 'dalla', 'in', 'nel',
  'nella', 'dell', 'all', 'dall', 'nell', 'sull', 'con', 'col', 'su', 'sul', 'sulla', 'per', 'mio', 'mia', 'miei', 'mie',
  'rete', 'wifi', 'wi', 'fi']);

// { scelto } se un nome solo corrisponde; { candidati } se più d'uno; {} se nessuno.
function scegliNome(chiesto, nomi) {
  const elenco = [...new Set((nomi || []).filter((n) => typeof n === 'string' && n))];
  const esatto = elenco.filter((n) => n === chiesto);
  if (esatto.length === 1) return { scelto: esatto[0] };
  const c = piega(chiesto);
  if (!c) return {};
  const parole = c.split(' ');
  const essenziali = parole.filter((w) => !CONTORNO.has(w));
  const nucleo = essenziali.length ? essenziali.join(' ') : c;
  const uguali = elenco.filter((n) => piega(n) === c || piega(n) === nucleo);
  if (uguali.length === 1) return { scelto: uguali[0] };
  if (uguali.length > 1) return { candidati: uguali };
  const cercate = nucleo.split(' ');
  // Ogni parola detta sta nel nome, oppure il nome intero sta fra le parole dette.
  const dentro = elenco.filter((n) => {
    const p = piega(n);
    const pw = p.split(' ');
    return p.includes(c) || cercate.every((w) => pw.some((x) => x.startsWith(w)))
      || (pw.some((w) => !CONTORNO.has(w)) && pw.every((w) => parole.includes(w)));
  });
  if (dentro.length === 1) return { scelto: dentro[0] };
  if (dentro.length > 1) return { candidati: dentro };
  const tolleranza = nucleo.length <= 4 ? 1 : 2;
  const vicini = elenco.map((n) => ({ n, d: Math.min(distanza(piega(n), c), distanza(piega(n), nucleo)) })).filter((x) => x.d <= tolleranza);
  if (!vicini.length) return {};
  const migliore = Math.min(...vicini.map((x) => x.d));
  const primi = vicini.filter((x) => x.d === migliore).map((x) => x.n);
  return primi.length === 1 ? { scelto: primi[0] } : { candidati: primi };
}

// ── Eseguire: uno alla volta, dalla via del terminale ───────────────────────

const TEMPI_MS = {
  volume: 30000, radio: 30000, 'bt-elenco': 40000, 'bt-collega': 60000, 'wifi-elenco': 30000, 'wifi-collega': 60000,
};

let computerFinto = null;
let coda = Promise.resolve();
let comandiFiniti = 0;

function inFila(fn) {
  const giro = coda.then(fn, fn).finally(() => { comandiFiniti += 1; });
  coda = giro.catch(() => {});
  return giro;
}

// Leggere un elenco non cambia niente: non fa la fila dei comandi (un riquadro aperto non fa aspettare il gesto dopo),
// e due letture uguali in volo sono una, finché nel frattempo non è finito un comando che può averlo cambiato.
const lettureInVolo = new Map();
function inLettura(cosa, fn) {
  const c = lettureInVolo.get(cosa);
  if (c && c.giro === comandiFiniti) return c.p;
  const voce = { giro: comandiFiniti, p: null };
  voce.p = Promise.resolve().then(fn).finally(() => { if (lettureInVolo.get(cosa) === voce) lettureInVolo.delete(cosa); });
  lettureInVolo.set(cosa, voce);
  return voce.p;
}

async function eseguiScript(comando, p) {
  const piattaforma = process.platform;
  const { shell, script, env } = costruisci(comando, p, piattaforma);
  // Fuori da Windows i messaggi dei programmi si leggono in inglese; i nomi restano in UTF-8.
  const lingua = piattaforma === 'linux' ? { LC_ALL: 'C.UTF-8' } : {};
  const r = await terminale.runCommand(script, {
    shell: terminale.resolveShell(shell),
    env: { ...process.env, ...lingua, ...env },
    timeoutMs: TEMPI_MS[comando],
  });
  const u = leggiUscita(r.stdout);
  if (r.timedOut && !u.voci.length) u.voci.push({ k: 'errore', v: 'tempo-comando', righe: [] });
  if (r.truncated) u.troncato = true;
  return u;
}

// Il computer vero, oppure quello delle prove: stessa forma, dati già interpretati.
const COMPUTER = {
  async volume(p) { return interpretaVolume(await eseguiScript('volume', p)); },
  async radio(p) { return interpretaRadio(await eseguiScript('radio', p), process.platform, p.radio, p.acceso); },
  async btElenco() { return interpretaBtElenco(await eseguiScript('bt-elenco', {}), process.platform); },
  async btCollega(p) { return interpretaBtCollega(await eseguiScript('bt-collega', p), process.platform, p.collega); },
  async wifiElenco() { return interpretaWifiElenco(await eseguiScript('wifi-elenco', {}), process.platform); },
  async wifiCollega(p) { return interpretaWifiCollega(await eseguiScript('wifi-collega', p), process.platform, p.rete); },
};
const computer = () => computerFinto || COMPUTER;

const sistemaMain = () => globalThis.SN_SISTEMA_MAIN || null;

// Quello che il comando ha appena cambiato si vede subito nella home, senza aspettare il giro del lettore.
function annunciaCambio(parziale) {
  const M = sistemaMain();
  try { if (M && typeof M.dopoComando === 'function') M.dopoComando(parziale); } catch (_) {}
}

function fallito(errore, contesto) {
  return { ok: false, cosa: contesto.cosa, ...spiega(errore, contesto) };
}

const vero = (v) => v === true || v === 1 || /^(true|1|si|sì|yes|on|acceso|accendi)$/i.test(String(v ?? '').trim());
const falso = (v) => v === false || v === 0 || /^(false|0|no|off|spento|spegni)$/i.test(String(v ?? '').trim());
const booleano = (v) => (vero(v) ? true : falso(v) ? false : null);

// Una richiesta (dalla chat o da un tasto) nella forma unica che i due cammini condividono.
function normalizzaRichiesta(r) {
  const q = r && typeof r === 'object' ? r : {};
  const cosa = String(q.cosa || '').toLowerCase();
  const testo = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  if (cosa === 'volume') {
    const out = { cosa };
    const livello = q.livello ?? q.percentuale ?? q.valore;
    if (livello != null && livello !== '') {
      const n = Number(String(livello).replace('%', '').trim());
      if (!Number.isFinite(n)) return { errore: 'livello del volume non capito: un numero da 0 a 100' };
      out.livello = Math.round(Math.max(0, Math.min(100, n)));
      out.limitato = n < 0 || n > 100;
    }
    const verso = testo(q.verso ?? q.direzione).toLowerCase();
    if (verso) {
      if (!['su', 'giu', 'giù', 'alza', 'abbassa'].includes(verso)) return { errore: 'verso del volume non capito: su o giu' };
      out.passo = /^(su|alza)$/.test(verso) ? PASSO_VOLUME : -PASSO_VOLUME;
    }
    if (q.passo != null && out.passo == null) {
      const n = Number(q.passo);
      if (Number.isInteger(n) && n !== 0 && Math.abs(n) <= 100) out.passo = n;
    }
    if (q.muto != null && q.muto !== '') {
      const b = booleano(q.muto);
      if (b === null) return { errore: 'muto non capito: true o false' };
      out.muto = b;
    }
    if (out.livello == null && out.passo == null && out.muto == null) return { errore: 'niente da cambiare: passa livello, verso o muto' };
    if (out.livello != null) delete out.passo;
    return out;
  }
  if (cosa === 'bluetooth' || cosa === 'wifi') {
    const out = { cosa };
    if (vero(q.elenca)) { out.elenca = true; return out; }
    const nome = testo(cosa === 'wifi' ? (q.rete ?? q.nome ?? q.ssid) : (q.dispositivo ?? q.nome));
    if (nome) {
      const errore = nomeValido(nome);
      if (errore) return { errore: `nome ${errore}` };
      out.nome = nome;
      if (cosa === 'bluetooth') {
        // «Spegni le cuffie» arriva come acceso:false col nome: vuol dire scollegarle, non collegarle.
        const c = q.collega == null || q.collega === '' ? booleano(q.acceso) !== false : booleano(q.collega);
        if (c === null) return { errore: 'collega non capito: true o false' };
        out.collega = c;
      }
      return out;
    }
    if (q.acceso != null && q.acceso !== '') {
      const b = booleano(q.acceso);
      if (b === null) return { errore: 'acceso non capito: true o false' };
      out.acceso = b;
      return out;
    }
    return { errore: cosa === 'wifi' ? 'niente da fare: passa acceso, rete o elenca' : 'niente da fare: passa acceso, dispositivo o elenca' };
  }
  return { errore: 'comando del sistema sconosciuto' };
}

async function volume(q) {
  const r = await computer().volume({ livello: q.livello, passo: q.passo, muto: q.muto });
  if (!r.ok) return fallito(r.errore, q);
  annunciaCambio({ volume: { livello: r.volume, muto: r.muto } });
  return { ok: true, cosa: 'volume', volume: r.volume, muto: r.muto, prima: r.prima, limitato: !!q.limitato };
}

async function radio(q) {
  const r = await computer().radio({ radio: q.cosa, acceso: q.acceso });
  if (!r.ok) return fallito(r.errore, q);
  annunciaCambio(q.cosa === 'wifi' ? { wifi: { acceso: r.acceso } } : { bluetooth: { acceso: r.acceso } });
  return { ok: true, cosa: q.cosa, acceso: r.acceso };
}

async function bluetooth(q) {
  if (q.acceso != null) return radio(q);
  const elenco = await computer().btElenco();
  if (!elenco.ok) return fallito(elenco.errore, q);
  if (q.elenca) return { ok: true, cosa: 'bluetooth', elenco: elenco.dispositivi, acceso: elenco.acceso };
  const nomi = elenco.dispositivi.map((d) => d.nome);
  const s = scegliNome(q.nome, nomi);
  if (!s.scelto) {
    const f = fallito(s.candidati ? 'ambiguo' : 'nessun-dispositivo', { ...q, nome: q.nome });
    return { ...f, candidati: s.candidati || nomi };
  }
  const d = elenco.dispositivi.find((x) => x.nome === s.scelto);
  if (d.collegato === q.collega) return { ok: true, cosa: 'bluetooth', dispositivo: d.nome, collegato: q.collega, gia: true };
  // Per collegare serve il Bluetooth acceso: chi chiede le cuffie lo vuole acceso, e lo si accende prima.
  let acceso = false;
  if (q.collega && elenco.acceso === false) {
    const on = await computer().radio({ radio: 'bluetooth', acceso: true });
    if (!on.ok) return fallito(on.errore, { ...q, cosa: 'bluetooth' });
    annunciaCambio({ bluetooth: { acceso: true } });
    acceso = true;
  }
  const r = await computer().btCollega({ indirizzo: d.indirizzo, collega: q.collega });
  if (!r.ok) return { ...fallito(r.errore, { ...q, nome: d.nome }), dispositivo: d.nome, accesoPrima: acceso };
  annunciaCambio({ bluetooth: {} });
  return { ok: true, cosa: 'bluetooth', dispositivo: d.nome, collegato: r.collegato, accesoPrima: acceso };
}

async function wifi(q) {
  if (q.acceso != null) return radio(q);
  const elenco = await computer().wifiElenco();
  if (!elenco.ok) return fallito(elenco.errore, q);
  if (q.elenca) return { ok: true, cosa: 'wifi', elenco: elenco.reti, acceso: elenco.acceso, attuale: elenco.attuale };
  const nomi = elenco.reti.map((x) => x.nome);
  const s = scegliNome(q.nome, nomi);
  if (!s.scelto) {
    const f = fallito(s.candidati ? 'ambiguo' : 'nessuna-rete', q);
    return { ...f, candidati: s.candidati || nomi };
  }
  const rete = elenco.reti.find((x) => x.nome === s.scelto);
  if (rete.attiva) return { ok: true, cosa: 'wifi', rete: rete.nome, confermato: true, gia: true };
  let acceso = false;
  // Windows non dice la radio nell'elenco delle reti: la sa il lettore della home.
  const letta = sistemaMain() && typeof sistemaMain().stato === 'function' ? sistemaMain().stato() : null;
  const radioSpenta = elenco.acceso === false || (elenco.acceso == null && !!letta && !!letta.wifi && letta.wifi.acceso === false);
  if (radioSpenta) {
    const on = await computer().radio({ radio: 'wifi', acceso: true });
    if (!on.ok) return fallito(on.errore, q);
    annunciaCambio({ wifi: { acceso: true } });
    acceso = true;
  }
  let r = await computer().wifiCollega({ rete: rete.nome, uuid: rete.id });
  // Windows dice «radio spenta» solo provando: si accende e si riprova una volta.
  if (!r.ok && r.errore === 'radio-spenta' && !acceso) {
    const on = await computer().radio({ radio: 'wifi', acceso: true });
    if (!on.ok) return fallito(on.errore, q);
    annunciaCambio({ wifi: { acceso: true } });
    acceso = true;
    r = await computer().wifiCollega({ rete: rete.nome, uuid: rete.id });
  }
  if (!r.ok) return { ...fallito(r.errore, { ...q, nome: rete.nome }), rete: rete.nome, accesoPrima: acceso };
  annunciaCambio({ wifi: { acceso: true } });
  return { ok: true, cosa: 'wifi', rete: rete.nome, confermato: r.confermato, accesoPrima: acceso };
}

// La porta unica dei due cammini (chat e tasti): stessa richiesta, stesso risultato.
function comanda(richiesta) {
  const q = normalizzaRichiesta(richiesta);
  if (q.errore) return Promise.resolve({ ok: false, cosa: String((richiesta && richiesta.cosa) || ''), errore: 'richiesta', frase: q.errore });
  const esegui = async () => {
    try {
      // Una prova che si è dimenticata il computer finto non cambia il volume o la rete di chi la lancia.
      if (!computerFinto && process.env.NODE_ENV === 'test') return fallito('prove', q);
      if (!computerFinto && !PIATTAFORME.includes(process.platform)) return fallito('non-supportato', q);
      if (q.cosa === 'volume') return await volume(q);
      if (q.cosa === 'bluetooth') return await bluetooth(q);
      return await wifi(q);
    } catch (e) {
      console.warn('[Filo] comando del sistema non riuscito', q.cosa, e && e.message ? e.message : e);
      return fallito('sconosciuto', q);
    }
  };
  return q.elenca ? inLettura(q.cosa, esegui) : inFila(esegui);
}

// Il nome vero di una rete o di un dispositivo detto a parole, letto prima di chiedere conferma: { nome, gia } se ce
// n'è uno solo (`gia`: è già come lo si chiede), { esito } (l'errore con l'elenco) se nessuno o più d'uno, {} se
// l'elenco non si legge.
async function risolviNome(richiesta) {
  const q = normalizzaRichiesta(richiesta);
  if (q.errore || !q.nome || (q.cosa !== 'wifi' && q.cosa !== 'bluetooth')) return {};
  const r = await comanda({ cosa: q.cosa, elenca: true });
  if (!r.ok || !Array.isArray(r.elenco)) return {};
  const nomi = r.elenco.map((x) => x.nome);
  const s = scegliNome(q.nome, nomi);
  if (s.scelto) {
    const x = r.elenco.find((v) => v.nome === s.scelto) || {};
    const gia = q.cosa === 'wifi' ? x.attiva === true : typeof x.collegato === 'boolean' && x.collegato === q.collega;
    return { nome: s.scelto, gia };
  }
  const errore = s.candidati ? 'ambiguo' : q.cosa === 'wifi' ? 'nessuna-rete' : 'nessun-dispositivo';
  return { esito: { ...fallito(errore, q), candidati: s.candidati || nomi } };
}

function uriImpostazioni(chiave) {
  return Object.prototype.hasOwnProperty.call(IMPOSTAZIONI, chiave) ? IMPOSTAZIONI[chiave] : null;
}

const _perProve = {
  // Un computer finto con la forma di COMPUTER: le prove vedono chat, tasti e home veri sopra un sistema inventato.
  usaComputer(finto) { computerFinto = finto && typeof finto === 'object' ? finto : null; },
};

const api = { comanda, normalizzaRichiesta, risolviNome, uriImpostazioni, _perProve };
globalThis.SN_COMANDI_SISTEMA = api;

module.exports = {
  ...api,
  PIATTAFORME, PASSO_VOLUME, NOME_MAX, SCRIPT, AMBIENTE, IMPOSTAZIONI, INDIRIZZO,
  costruisci, parametri, nomeValido, leggiUscita, decodifica, spiega, scegliNome, piega,
  interpretaVolume, interpretaRadio, interpretaBtElenco, interpretaBtCollega, interpretaWifiElenco, interpretaWifiCollega,
  campiNmcli, erroreWlan,
  _interni: { CS_VOLUME, CS_CUFFIE, CS_WLAN, PS_INIZIO, PS_ATTESA, PS_RADIO_TIPI, SH_INIZIO },
};
