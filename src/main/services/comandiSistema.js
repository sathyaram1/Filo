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
namespace FiloSistema {
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
namespace FiloSistema {
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
  Start-Sleep -Milliseconds 300
  $dopo = @($radio | ForEach-Object { [string]$_.State })
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
  $n = [FiloSistema.Cuffie]::Comanda($indirizzo, $collega)
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
  $e = [FiloSistema.Wlan]::Elenco()
  Dice 'codice' $e.Codice
  Dice 'interfacce' $e.Interfacce
  foreach ($n in $e.Reti) { Dice 'rete' $n }
  if ($e.Attuale) { Dice 'attuale' $e.Attuale }
} catch { Dice 'errore' 'eccezione'; Dice 'dettaglio' $_.Exception.Message }
`,
    'wifi-collega': PS_INIZIO + psCompila(CS_WLAN) + String.raw`try {
  $e = [FiloSistema.Wlan]::Collega([string]$env:FILO_SIS_RETE, 15000)
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
elif [ -n "$T" ] && [ "$T" -gt 0 ] && { [ -n "$L" ] || [ "\${P#-}" = "$P" ]; }; then silenzia 0; fi
dice volume "$(leggi)"
dice muto "$(muto)"
`.replace('\\${P#-}', '${P#-}'),
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
  INFO=$(timeout 5 bluetoothctl info "$ind" 2>/dev/null)
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
  "$B" --power "$A" 2>&1 | grezzo
  dice uscita "$?"
  dice acceso "$("$B" --power 2>/dev/null)"
fi
`,
    'bt-elenco': SH_INIZIO + String.raw`B=
for c in "$(command -v blueutil 2>/dev/null)" /opt/homebrew/bin/blueutil /usr/local/bin/blueutil; do
  if [ -n "$c" ] && [ -x "$c" ]; then B=$c; break; fi
done
[ -n "$B" ] || { dice errore manca-blueutil; exit 0; }
dice acceso "$("$B" --power 2>/dev/null)"
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
if [ "$FILO_SIS_COLLEGA" = 1 ]; then "$B" --connect "$I" 2>&1 | grezzo; else "$B" --disconnect "$I" 2>&1 | grezzo; fi
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
networksetup -setairportnetwork "$D" "$FILO_SIS_RETE" 2>&1 | grezzo
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

// Le righe «FILO:chiave=valore» in ordine; le righe «| …» (quello che il programma ha stampato) nel blocco aperto.
function leggiUscita(testo) {
  const voci = [];
  const blocchi = {};
  const grezze = [];
  let blocco = null;
  for (const riga of String(testo || '').split(/\r?\n/)) {
    const m = /^FILO:([a-z][a-z0-9-]*)=(.*)$/.exec(riga);
    if (m) {
      const valore = decodifica(m[2]);
      voci.push([m[1], valore]);
      if (m[1] === 'blocco') { blocco = valore; blocchi[blocco] = blocchi[blocco] || []; }
      continue;
    }
    if (riga.startsWith('| ')) {
      grezze.push(riga.slice(2));
      if (blocco) blocchi[blocco].push(riga.slice(2));
    }
  }
  const primo = (k) => { const v = voci.find(([c]) => c === k); return v ? v[1] : null; };
  return { voci, blocchi, grezze, primo };
}

const intero = (v) => (v != null && /^-?\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : null);
const bit = (v) => (String(v).trim() === '1' ? true : String(v).trim() === '0' ? false : null);

function dispositiviDaVoci(voci) {
  const out = [];
  let cur = null;
  for (const [k, v] of voci) {
    if (k === 'dispositivo') { cur = { indirizzo: v, nome: '', collegato: null }; out.push(cur); } else if (cur && k === 'nome') cur.nome = v;
    else if (cur && k === 'collegato') cur.collegato = bit(v);
  }
  return out;
}

// bluetoothctl info: «Alias:» è il nome che l'utente vede (rinominato o no); «Name:» il ripiego.
function dispositiviLinux(u) {
  const out = [];
  let cur = null;
  const righe = [];
  for (const [k, v] of u.voci) if (k === 'dispositivo') righe.push({ ind: v });
  // Le righe grezze seguono il loro «dispositivo»: le si riattacca in ordine.
  const testo = u.grezze;
  let i = -1;
  for (const r of testo) {
    if (/^\s*Name:/.test(r) && i + 1 < righe.length && (!righe[i + 1].visto)) { /* fallthrough below */ }
  }
  void testo; void i;
  return out.concat(righe.length ? [] : []), out;
}

module.exports = {
  PIATTAFORME, PASSO_VOLUME, NOME_MAX, SCRIPT, AMBIENTE,
  costruisci, parametri, nomeValido, leggiUscita, decodifica, dispositiviDaVoci,
  _interni: { CS_VOLUME, CS_CUFFIE, CS_WLAN, PS_INIZIO, PS_ATTESA, PS_RADIO_TIPI, SH_INIZIO, intero, bit, dispositiviLinux },
};
