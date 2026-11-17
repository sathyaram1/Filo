// Batteria, rete, Bluetooth e volume del computer: un lettore per piattaforma, senza permessi, senza modello, senza console.
// Non comanda e non chiede permessi (lo fa comandiSistema.js): patterns/il-computer-si-legge-senza-permessi-e-finche-serve.md.
// Prove: tests/unit/statoSistema.test.mjs (lettori), tests/dashboard-sistema.spec.mjs (home e chat).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const GIRO_MS = 3000;
// Si legge finché qualcuno guarda: una home aperta chiede ogni 30 s, un turno di chat chiede una volta.
const VEGLIA_MS = 90 * 1000;
const COMANDO_MS = 2500;
const ATTESA_PRIMA_LETTURA_MS = 3000;
// L'avviso del caricatore vince sulle letture fatte prima di lui; oltre questo tempo torna a decidere la lettura.
const EVENTO_VALE_MS = 10 * 1000;
// Senza un tasto né un movimento del mouse da tanto, l'utente non è davanti allo schermo (spesso già spento).
const ASSENTE_DOPO_S = 5 * 60;

function S() {
  if (!globalThis.SN_SISTEMA) require('../../shared/sistema.js');
  return globalThis.SN_SISTEMA;
}

// `vuotoSeEsce`: un comando che è partito e ha risposto «non c'è» (uscita diversa da 0) dà '', non null come un guasto.
function esegui(file, args, { timeout = COMANDO_MS, vuotoSeEsce = false } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (!err) resolve(String(stdout || ''));
        else resolve(vuotoSeEsce && typeof err.code === 'number' && !err.killed ? '' : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

const numero = (s) => (s == null || String(s).trim() === '' ? NaN : Number(s));

// ── Linux: sysfs e procfs, più BlueZ dal bus di sistema ─────────────────────

function leggiFile(radice, ...parti) {
  try { return fs.readFileSync(path.join(radice, ...parti), 'utf8').trim(); } catch (_) { return null; }
}
function esiste(radice, ...parti) {
  try { fs.accessSync(path.join(radice, ...parti)); return true; } catch (_) { return false; }
}
function cartella(radice, ...parti) {
  try { return fs.readdirSync(path.join(radice, ...parti)); } catch (_) { return []; }
}

const ALIMENTATORI = new Set(['Mains', 'USB', 'USB_C', 'USB_PD', 'USB_PD_DRP', 'USB_DCP', 'USB_CDP', 'USB_ACA']);

function sintesiBatterie(batterie, corrente) {
  if (!batterie.length) return null;
  const pesate = batterie.every((b) => b.pieno > 0);
  const totale = pesate ? batterie.reduce((s, b) => s + b.pieno, 0) : batterie.length;
  const livello = batterie.reduce((s, b) => s + b.livello * (pesate ? b.pieno : 1), 0) / totale;
  const inCarica = batterie.some((b) => b.stato === 'charging');
  const daStato = batterie.some((b) => ['charging', 'full', 'not charging'].includes(b.stato));
  return { livello: Math.round(livello), inCarica, collegata: inCarica || (corrente !== null ? corrente : daStato) };
}

function batteriaLinux(radice = '/') {
  const base = ['sys', 'class', 'power_supply'];
  const batterie = [];
  let corrente = null;
  for (const nome of cartella(radice, ...base)) {
    const voce = (f) => leggiFile(radice, ...base, nome, f);
    const tipo = voce('type');
    if (tipo === 'Battery') {
      // Mouse, cuffie e tastiere hanno una batteria «Device»: non è quella del computer.
      if (voce('scope') === 'Device' || voce('present') === '0') continue;
      const pieno = numero(voce('energy_full') ?? voce('charge_full'));
      let livello = numero(voce('capacity'));
      if (!Number.isFinite(livello)) {
        const ora = numero(voce('energy_now') ?? voce('charge_now'));
        livello = pieno > 0 && ora >= 0 ? (ora / pieno) * 100 : NaN;
      }
      if (!Number.isFinite(livello)) continue;
      batterie.push({ livello, stato: String(voce('status') || '').toLowerCase(), pieno: pieno > 0 ? pieno : 0 });
    } else if (ALIMENTATORI.has(tipo)) {
      const online = voce('online');
      if (online === '1') corrente = true;
      else if (online === '0' && corrente === null) corrente = false;
    }
  }
  return sintesiBatterie(batterie, corrente);
}

// L'interfaccia della rotta predefinita, IPv4 prima e IPv6 poi.
function interfacciaVersoFuori(radice = '/') {
  let scelta = null;
  const v4 = leggiFile(radice, 'proc', 'net', 'route');
  for (const riga of (v4 || '').split('\n').slice(1)) {
    const c = riga.trim().split(/\s+/);
    if (c.length < 8 || c[1] !== '00000000' || c[7] !== '00000000') continue;
    if (!(parseInt(c[3], 16) & 1)) continue;
    const metrica = Number(c[6]) || 0;
    if (!scelta || metrica < scelta.metrica) scelta = { nome: c[0], metrica };
  }
  if (scelta) return scelta.nome;
  const v6 = leggiFile(radice, 'proc', 'net', 'ipv6_route');
  for (const riga of (v6 || '').split('\n')) {
    const c = riga.trim().split(/\s+/);
    if (c.length < 10 || !/^0{32}$/.test(c[0]) || c[1] !== '00' || c[9] === 'lo') continue;
    if (!(parseInt(c[8], 16) & 1)) continue;
    const metrica = parseInt(c[5], 16) || 0;
    if (!scelta || metrica < scelta.metrica) scelta = { nome: c[9], metrica };
  }
  return scelta ? scelta.nome : null;
}

function tipoInterfacciaLinux(radice, iface) {
  if (!iface || /[/\\]|^\.\.?$/.test(iface)) return null;
  const base = ['sys', 'class', 'net', iface];
  if (esiste(radice, ...base, 'wireless') || esiste(radice, ...base, 'phy80211')) return 'wifi';
  // Un'interfaccia Ethernet con un dispositivo sotto; tun, wireguard, ponti e simili non dicono come si esce.
  if (leggiFile(radice, ...base, 'type') === '1' && esiste(radice, ...base, 'device')) return 'cavo';
  return null;
}

// `iw` scrive come \xNN ogni byte non stampabile del nome (accenti compresi, spazi in testa e in coda, la barra).
function ssidDaIw(testo) {
  const m = /^\s*SSID:\s?(.*)$/m.exec(String(testo || ''));
  if (!m) return null;
  const byte = [];
  const s = m[1].replace(/\r$/, '');
  for (let i = 0; i < s.length; i++) {
    const esc = /^\\x([0-9a-fA-F]{2})/.exec(s.slice(i, i + 4));
    if (esc) { byte.push(parseInt(esc[1], 16)); i += 3; } else byte.push(...Buffer.from(s[i], 'utf8'));
  }
  const nome = Buffer.from(byte).toString('utf8');
  return nome || null;
}

function connessioneDaNmcli(testo) {
  const riga = String(testo || '').split('\n')[0].replace(/\r$/, '');
  const nome = riga.replace(/\\(.)/g, '$1').trim();
  return nome && nome !== '--' ? nome : null;
}

// `uscita: false`: le rotte si leggono e nessuna porta fuori. Chromium conta anche i ponti virtuali (Docker, macchine
// virtuali) e direbbe online: è la piattaforma a sapere che fuori non si va.
async function reteLinux(radice, esec) {
  const iface = interfacciaVersoFuori(radice);
  if (!iface) return leggiFile(radice, 'proc', 'net', 'route') !== null ? { uscita: false } : null;
  const tipo = tipoInterfacciaLinux(radice, iface);
  let nome = null;
  if (tipo === 'wifi') {
    nome = ssidDaIw(await esec('iw', ['dev', iface, 'link']));
    if (!nome) nome = connessioneDaNmcli(await esec('nmcli', ['-g', 'GENERAL.CONNECTION', 'device', 'show', iface]));
  }
  return { tipo, nome };
}

const valoreBus = (v) => (v && typeof v === 'object' && 'data' in v ? v.data : v);

// GetManagedObjects di BlueZ in JSON (`busctl --json=short`): ogni oggetto ha le sue interfacce, ogni
// proprietà è {type, data}. Senza un adattatore la risposta non dice niente sul Bluetooth.
function bluetoothDaBluez(testo) {
  let j;
  try { j = JSON.parse(String(testo || '')); } catch (_) { return null; }
  const oggetti = j && Array.isArray(j.data) ? j.data[0] : j && j.data;
  if (!oggetti || typeof oggetti !== 'object') return null;
  const adattatori = [];
  const dispositivi = [];
  for (const interfacce of Object.values(oggetti)) {
    if (!interfacce || typeof interfacce !== 'object') continue;
    const a = interfacce['org.bluez.Adapter1'];
    if (a) adattatori.push(valoreBus(a.Powered) === true);
    const d = interfacce['org.bluez.Device1'];
    if (d && valoreBus(d.Connected) === true) {
      const nome = valoreBus(d.Alias) || valoreBus(d.Name);
      if (typeof nome === 'string' && nome.trim()) dispositivi.push(nome);
    }
  }
  if (!adattatori.length) return null;
  const acceso = adattatori.some(Boolean);
  return { acceso, dispositivi: acceso ? dispositivi : [] };
}

// Senza BlueZ sul bus resta l'interruttore radio del kernel: acceso o spento, i collegati non li dice.
function bluetoothDaRfkill(radice = '/') {
  const base = ['sys', 'class', 'rfkill'];
  const radio = [];
  for (const nome of cartella(radice, ...base)) {
    if (leggiFile(radice, ...base, nome, 'type') !== 'bluetooth') continue;
    const bloccata = leggiFile(radice, ...base, nome, 'soft') === '1' || leggiFile(radice, ...base, nome, 'hard') === '1';
    radio.push(!bloccata);
  }
  if (!radio.length) return null;
  const acceso = radio.some(Boolean);
  return { acceso, dispositivi: acceso ? null : [] };
}

async function bluetoothLinux(radice, esec) {
  const testo = await esec('busctl', ['--system', '--json=short', 'call', 'org.bluez', '/',
    'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects']);
  return (testo && bluetoothDaBluez(testo)) || bluetoothDaRfkill(radice);
}

// La radio del Wi-Fi dall'interruttore del kernel: senza una radio wlan non si dice niente.
function wifiDaRfkill(radice = '/') {
  const base = ['sys', 'class', 'rfkill'];
  const radio = [];
  for (const nome of cartella(radice, ...base)) {
    if (leggiFile(radice, ...base, nome, 'type') !== 'wlan') continue;
    radio.push(!(leggiFile(radice, ...base, nome, 'soft') === '1' || leggiFile(radice, ...base, nome, 'hard') === '1'));
  }
  return radio.length ? { acceso: radio.some(Boolean) } : null;
}

// «Volume: 0.40 [MUTED]» (wpctl), «Volume: front-left: 26214 /  40% / …» (pactl), «[40%] [on]» (amixer).
function volumeDaWpctl(testo) {
  const m = /Volume:\s*([\d.]+)/.exec(String(testo || ''));
  return m ? { livello: Math.round(Number(m[1]) * 100), muto: /\[MUTED\]/.test(testo) } : null;
}
function volumeDaPactl(volume, muto) {
  const m = /(\d+)%/.exec(String(volume || ''));
  return m ? { livello: Number(m[1]), muto: /:\s*(yes|s[iì])\b/i.test(String(muto || '')) } : null;
}
function volumeDaAmixer(testo) {
  const m = /\[(\d+)%\]/.exec(String(testo || ''));
  return m ? { livello: Number(m[1]), muto: /\[off\]/.test(testo) } : null;
}

async function volumeLinux(esec) {
  const w = volumeDaWpctl(await esec('wpctl', ['get-volume', '@DEFAULT_AUDIO_SINK@']));
  if (w) return w;
  const p = await esec('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
  if (p) return volumeDaPactl(p, await esec('pactl', ['get-sink-mute', '@DEFAULT_SINK@']));
  return volumeDaAmixer(await esec('amixer', ['-M', 'get', 'Master']));
}

async function leggiLinux(radice = '/', esec = esegui) {
  const [rete, bluetooth, volume] = await Promise.all([reteLinux(radice, esec), bluetoothLinux(radice, esec), volumeLinux(esec)]);
  return { batteria: batteriaLinux(radice), rete, bluetooth, volume, wifi: wifiDaRfkill(radice) };
}

// ── Mac: pmset, route, networksetup, ipconfig, defaults ──────────────────────
// Niente system_profiler né CoreBluetooth: su macOS il Bluetooth chiede un permesso, e qui non si chiede.

function batteriaDaPmset(testo) {
  const t = String(testo || '');
  const m = /InternalBattery[^\n]*?\s(\d{1,3})%;\s*([^;\n]*)/.exec(t);
  if (!m) return null;
  const stato = m[2].trim().toLowerCase();
  const inCarica = stato === 'charging' || stato === 'finishing charge';
  const allaCorrente = /'AC Power'/.test(t);
  return {
    livello: Number(m[1]),
    inCarica,
    collegata: inCarica || allaCorrente || stato === 'charged' || /ac attached|not charging/.test(t.toLowerCase()),
  };
}

function interfacciaDaRoute(testo) {
  const m = /^\s*interface:\s*(\S+)/m.exec(String(testo || ''));
  return m ? m[1] : null;
}

function portaDaNetworksetup(testo, iface) {
  const blocchi = String(testo || '').split(/\n\s*\n/);
  for (const b of blocchi) {
    const porta = /Hardware Port:\s*(.+)/.exec(b);
    const disp = /Device:\s*(\S+)/.exec(b);
    if (porta && disp && disp[1] === iface) return porta[1].trim();
  }
  return null;
}

function tipoDaPortaMac(porta) {
  const p = String(porta || '');
  if (/wi-?fi|airport/i.test(p)) return 'wifi';
  if (/ethernet|\blan\b/i.test(p) && !/bridge/i.test(p)) return 'cavo';
  return null;
}

// Da macOS 14.4 l'SSID senza il permesso della posizione esce «<redacted>»: allora si omette.
function ssidDaIpconfig(testo) {
  const m = /^\s*SSID\s*:\s*(.+)$/m.exec(String(testo || ''));
  if (!m) return null;
  const nome = m[1].trim();
  return nome && !/^<redacted>$/i.test(nome) ? nome : null;
}

function bluetoothDaDefaults(testo) {
  const v = String(testo == null ? '' : testo).trim();
  if (v === '1') return { acceso: true, dispositivi: null };
  if (v === '0') return { acceso: false, dispositivi: [] };
  return null;
}

let portePerMac = { testo: null, quando: 0 };

// «40,false»: il volume è «missing value» quando l'uscita non ne ha uno (un monitor HDMI).
function volumeDaOsascript(testo) {
  const m = /^\s*(\d+)\s*,\s*(true|false)\s*$/.exec(String(testo || ''));
  return m ? { livello: Number(m[1]), muto: m[2] === 'true' } : null;
}

function dispositivoWifiMac(testo) {
  const m = /Hardware Port:\s*(?:Wi-Fi|AirPort)\s*\n\s*Device:\s*(\S+)/.exec(String(testo || ''));
  return m ? m[1] : null;
}

function wifiDaNetworksetup(testo) {
  const m = /:\s*(On|Off)\s*$/m.exec(String(testo || ''));
  return m ? { acceso: m[1] === 'On' } : null;
}

async function leggiMac(esec = esegui) {
  if (!portePerMac.testo || Date.now() - portePerMac.quando > 60 * 1000) {
    portePerMac = { testo: await esec('networksetup', ['-listallhardwareports']), quando: Date.now() };
  }
  const dispositivoWifi = dispositivoWifiMac(portePerMac.testo);
  const [pm, rotta, bt, vol, wifi] = await Promise.all([
    esec('pmset', ['-g', 'batt']),
    esec('route', ['-n', 'get', 'default'], { vuotoSeEsce: true }),
    esec('defaults', ['read', '/Library/Preferences/com.apple.Bluetooth', 'ControllerPowerState']),
    esec('osascript', ['-e', 'set s to get volume settings', '-e', 'return ((output volume of s) as string) & "," & ((output muted of s) as string)']),
    dispositivoWifi ? esec('networksetup', ['-getairportpower', dispositivoWifi]) : Promise.resolve(null),
  ]);
  let rete = null;
  const iface = interfacciaDaRoute(rotta);
  if (iface) {
    const tipo = tipoDaPortaMac(portaDaNetworksetup(portePerMac.testo, iface));
    const nome = tipo === 'wifi' ? ssidDaIpconfig(await esec('ipconfig', ['getsummary', iface])) : null;
    rete = { tipo, nome };
  } else if (rotta !== null) {
    // `route` ha risposto e non c'è una rotta predefinita: gli adattatori di Parallels o VMware non portano fuori.
    rete = { uscita: false };
  }
  return { batteria: batteriaDaPmset(pm), rete, bluetooth: bluetoothDaDefaults(bt), volume: volumeDaOsascript(vol), wifi: wifiDaNetworksetup(wifi) };
}

// ── Windows: un PowerShell solo, che resta aperto e scrive una riga quando qualcosa cambia ──
// Ogni lettura con le API del sistema che non chiedono niente: lo stato di alimentazione, le connessioni e i loro
// nomi (non le API del Wi-Fi, che da Windows 11 24H2 vogliono la posizione), le radio. Lo script raccoglie i fatti
// della rete, la scelta la fa reteDaWindows. L'uscita è JSON tutto ASCII: la console non può storpiare un nome.

const SCRIPT_WINDOWS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
try { Remove-TypeData System.Array } catch {}
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
$genitore = __GENITORE__
try { Add-Type -AssemblyName System.Windows.Forms } catch {}
$attendi = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1' } | Select-Object -First 1
  $attendi = { param($op, [Type]$tipo) $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($op)); if ($t.Wait(2000)) { $t.Result } else { $null } }
} catch { $attendi = $null }
try { $null = [Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] } catch {}
try { $null = [Windows.Devices.Bluetooth.BluetoothDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime] } catch {}
try { $null = [Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime] } catch {}
try { $null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] } catch {}
$infoReti = $null
try { $infoReti = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime] } catch {}
$nlm = $null
try { $nlm = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'DCB00C01-570F-4A9B-8D69-199FDBA5723B')) } catch {}
$conVolume = $false
try {
Add-Type -TypeDefinition @'
__VOLUME__'@
$conVolume = $true
} catch {}
function Scrivi($oggetto) {
  $j = ConvertTo-Json -InputObject $oggetto -Compress -Depth 6
  $j = [regex]::Replace($j, '[^ -~]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  [Console]::Out.WriteLine($j); [Console]::Out.Flush()
  return $j
}
__ELENCO_BT__
$global:wlanPronta = $false
function Rispondi([string]$cosa) {
  if ($cosa -eq 'bluetooth') {
    try { $e = ElencoBt } catch { $e = [ordered]@{ errore = 'eccezione' } }
    $null = Scrivi ([ordered]@{ elenco = [ordered]@{ cosa = 'bluetooth'; acceso = $e.acceso; dispositivi = $e.dispositivi; errore = $e.errore } })
  } elseif ($cosa -eq 'wifi') {
    $r = [ordered]@{ cosa = 'wifi' }
    try {
      if (-not $global:wlanPronta) {
        Add-Type -TypeDefinition @'
__WLAN__'@
        $global:wlanPronta = $true
      }
      $w = [FiloWlan.Wlan]::Elenco()
      $r.codice = $w.Codice; $r.interfacce = $w.Interfacce; $r.reti = @($w.Reti); $r.attuale = $w.Attuale
    } catch { if ($global:wlanPronta) { $r.errore = 'eccezione' } else { $r.errore = 'compilazione' } }
    $null = Scrivi ([ordered]@{ elenco = $r })
  }
}
# Le richieste degli elenchi arrivano su stdin, una riga ciascuna; stdin chiuso vuol dire che Filo non c'è più.
$ingresso = $null
$richiesta = $null
try { $ingresso = New-Object System.IO.StreamReader([Console]::OpenStandardInput()); $richiesta = $ingresso.ReadLineAsync() } catch { $richiesta = $null }
$ultimo = ''
$btPrima = $null
$nomiPrima = $null
$giri = 0
while ($true) {
  $giri += 1
  try { $null = [System.Diagnostics.Process]::GetProcessById($genitore) } catch { exit }
  $o = [ordered]@{ batteria = $null; rete = $null; bluetooth = $null; volume = $null; wifi = $null }
  if ($conVolume) {
    try { $o.volume = [ordered]@{ livello = [FiloSistema.Volume]::Livello(); muto = [FiloSistema.Volume]::EMuto() } } catch {}
  }
  try {
    $p = [System.Windows.Forms.SystemInformation]::PowerStatus
    $f = [int]$p.BatteryChargeStatus
    $l = [double]$p.BatteryLifePercent
    if ((($f -band 128) -eq 0) -and ($f -ne 255) -and ($l -ge 0) -and ($l -le 1)) {
      $o.batteria = [ordered]@{ livello = [int][math]::Round($l * 100); inCarica = (($f -band 8) -ne 0); collegata = ([int]$p.PowerLineStatus -eq 1) }
    }
  } catch {}
  $rete = [ordered]@{ schede = $null; profili = $null; principale = $null; connessioni = $null }
  try {
    $schede = New-Object System.Collections.ArrayList
    foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if (([string]$n.OperationalStatus -ne 'Up') -or ([string]$n.NetworkInterfaceType -eq 'Loopback')) { continue }
      $gw = 0
      try { $gw = @($n.GetIPProperties().GatewayAddresses | Where-Object { $_.Address -and -not $_.Address.Equals([System.Net.IPAddress]::Any) -and -not $_.Address.Equals([System.Net.IPAddress]::IPv6Any) }).Count } catch {}
      $null = $schede.Add([ordered]@{ id = ([string]$n.Id).Trim('{}').ToLower(); tipo = [string]$n.NetworkInterfaceType; gateway = ($gw -gt 0) })
    }
    $rete.schede = $schede
  } catch {}
  if ($infoReti) {
    try {
      $profili = New-Object System.Collections.ArrayList
      foreach ($pr in @($infoReti::GetConnectionProfiles())) {
        $ad = $pr.NetworkAdapter
        if ($null -eq $ad) { continue }
        $liv = [int]$pr.GetNetworkConnectivityLevel()
        if ($liv -lt 1) { continue }
        $nomeProfilo = $null
        try { $nomeProfilo = [string]$pr.ProfileName } catch {}
        $null = $profili.Add([ordered]@{ id = ([string]$ad.NetworkAdapterId).Trim('{}').ToLower(); livello = $liv; iana = [int]$ad.IanaInterfaceType; nome = $nomeProfilo })
      }
      $rete.profili = $profili
    } catch {}
    try {
      $ip = $infoReti::GetInternetConnectionProfile()
      if ($ip -and $ip.NetworkAdapter) { $rete.principale = ([string]$ip.NetworkAdapter.NetworkAdapterId).Trim('{}').ToLower() }
    } catch {}
  }
  if ($nlm) {
    try {
      $connessioni = New-Object System.Collections.ArrayList
      foreach ($c in @($nlm.GetNetworkConnections())) {
        if (-not $c.IsConnected) { continue }
        $a = $null
        try { $a = ([string]$c.GetAdapterId()).Trim('{}').ToLower() } catch {}
        $nome = $null
        try { $nome = [string]$c.GetNetwork().GetName() } catch {}
        $null = $connessioni.Add([ordered]@{ id = $a; internet = [bool]$c.IsConnectedToInternet; nome = $nome })
      }
      $rete.connessioni = $connessioni
    } catch {}
  }
  if (($null -ne $rete.profili) -or ($null -ne $rete.connessioni)) { $o.rete = $rete }
  if ($attendi) {
    $letto = $false
    try {
      $radios = & $attendi ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
      if ($null -ne $radios) {
        $letto = $true
        $wf = @($radios | Where-Object { [string]$_.Kind -eq 'WiFi' })
        if (@($wf | Where-Object { [string]$_.State -eq 'On' }).Count -gt 0) { $o.wifi = [ordered]@{ acceso = $true } }
        elseif (@($wf | Where-Object { @('Off', 'Disabled') -contains [string]$_.State }).Count -gt 0) { $o.wifi = [ordered]@{ acceso = $false } }
        $bt = @($radios | Where-Object { [string]$_.Kind -eq 'Bluetooth' })
        if ($bt.Count -gt 0) {
          $acceso = $null
          if (@($bt | Where-Object { [string]$_.State -eq 'On' }).Count -gt 0) { $acceso = $true }
          elseif (@($bt | Where-Object { @('Off', 'Disabled') -contains [string]$_.State }).Count -gt 0) { $acceso = $false }
          $nomi = @()
          if ($acceso -and ($null -ne $nomiPrima) -and (($giri % 3) -ne 0)) {
            $nomi = $nomiPrima
          } elseif ($acceso) {
            try {
              $elenco = New-Object System.Collections.ArrayList
              foreach ($sel in @([Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromConnectionStatus('Connected'), [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromConnectionStatus('Connected'))) {
                $trovati = & $attendi ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
                foreach ($d in @($trovati)) { $nome = [string]$d.Name; if ($nome -and -not $elenco.Contains($nome)) { $null = $elenco.Add($nome) } }
              }
              $nomi = @($elenco)
            } catch { $nomi = $null }
          }
          if ($acceso) { $nomiPrima = $nomi } else { $nomiPrima = $null }
          if ($null -eq $acceso) { $nomi = $null }
          $o.bluetooth = [ordered]@{ acceso = $acceso; dispositivi = $nomi }
        }
      }
    } catch {}
    if ($letto) { $btPrima = $o.bluetooth } else { $o.bluetooth = $btPrima }
  }
  $json = ConvertTo-Json -InputObject $o -Compress -Depth 5
  $json = [regex]::Replace($json, '[^ -~]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  if ($json -ne $ultimo) { [Console]::Out.WriteLine($json); [Console]::Out.Flush(); $ultimo = $json }
  $fine = (Get-Date).AddMilliseconds(2000)
  while ($null -ne $richiesta) {
    $resta = [int](($fine - (Get-Date)).TotalMilliseconds)
    if ($resta -le 0) { break }
    try { if (-not $richiesta.Wait($resta)) { break } } catch { $richiesta = $null; break }
    $riga = $richiesta.Result
    if ($null -eq $riga) { exit }
    Rispondi $riga.Trim()
    $richiesta = $ingresso.ReadLineAsync()
  }
  if ($null -eq $richiesta) { Start-Sleep -Milliseconds 2000 }
}
`;

// Il volume, gli abbinati e le reti si leggono con lo stesso codice degli script di comandiSistema.js: una copia sola.
function scriptWindows(pid) {
  const { CS_VOLUME, PS_ELENCO_BT, CS_WLAN } = require('./comandiSistema')._interni;
  return SCRIPT_WINDOWS.replace('__GENITORE__', String(Math.trunc(Number(pid)) || 0))
    .replace('__VOLUME__', () => CS_VOLUME).replace('__ELENCO_BT__', () => PS_ELENCO_BT).replace('__WLAN__', () => CS_WLAN);
}

// Windows PowerShell 5.1 a volte scrive un elenco come {value, Count}.
function elencoWindows(v) {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object');
  if (v && typeof v === 'object' && Array.isArray(v.value)) return elencoWindows(v.value);
  return null;
}
const RE_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const guidWindows = (v) => {
  const s = typeof v === 'string' ? v.trim().replace(/^\{|\}$/g, '').toLowerCase() : '';
  return RE_GUID.test(s) ? s : null;
};
// IANA 71 è 802.11, 6 è Ethernet: lo stesso numero che .NET chiama Wireless80211 ed Ethernet.
const TIPO_IANA = { 71: 'wifi', 6: 'cavo' };
function tipoSchedaWindows(t) {
  const s = String(t || '');
  if (s === 'Wireless80211') return 'wifi';
  return /ethernet/i.test(s) ? 'cavo' : null;
}

// Vince chi ha Internet, poi chi sa come esce, poi quella che Windows usa. L'adattatore lo legano i profili di Windows
// (Guid vero); il gestore delle reti è la riserva e dà i nomi, ma via PowerShell il suo Guid può mancare (#1114).
function reteDaWindows(r) {
  const schede = new Map();
  for (const s of elencoWindows(r.schede) || []) {
    const id = guidWindows(s.id);
    if (id) schede.set(id, s);
  }
  const profili = elencoWindows(r.profili);
  const connessioni = elencoWindows(r.connessioni);
  if (!profili && !connessioni) return null;
  const esce = (id) => !!(id && schede.get(id) && schede.get(id).gateway === true);
  const tipoDi = (id) => tipoSchedaWindows(id && schede.get(id) && schede.get(id).tipo);
  const daiProfili = [];
  for (const p of profili || []) {
    const id = guidWindows(p.id);
    const livello = Number(p.livello);
    // 1 solo la rete locale, 2 Internet limitata (un portale da accettare), 3 Internet.
    if (!id || !(livello >= 1)) continue;
    if (livello < 2 && !esce(id)) continue;
    daiProfili.push({ id, internet: livello === 3, tipo: TIPO_IANA[Number(p.iana)] || tipoDi(id), nome: p.nome });
  }
  const daiCollegamenti = [];
  for (const c of connessioni || []) {
    const id = guidWindows(c.id);
    const internet = c.internet === true;
    if (!internet && !esce(id)) continue;
    daiCollegamenti.push({ id, internet, tipo: tipoDi(id) });
  }
  const candidati = daiProfili.length ? daiProfili : daiCollegamenti;
  if (!candidati.length) return { uscita: false };
  const principale = guidWindows(r.principale);
  const peso = (c) => (c.internet ? 4 : 0) + (c.tipo ? 2 : 0) + (c.id && c.id === principale ? 1 : 0);
  let scelta = candidati[0];
  for (const c of candidati) if (peso(c) > peso(scelta)) scelta = c;
  return { tipo: scelta.tipo, nome: scelta.tipo === 'wifi' ? nomeDaWindows(scelta, candidati, connessioni || []) : null };
}

// Il nome lo dà il gestore delle reti per adattatore, se dice quale; se no il profilo di Windows legato all'adattatore
// (con una VPN accesa escono su Internet in due, #1114). Senza nessuno dei due è certo solo con un'uscita sola.
function nomeDaWindows(scelta, candidati, connessioni) {
  const nome = (c) => (c && typeof c.nome === 'string' && c.nome.trim() ? c.nome : null);
  const stessa = scelta.id && connessioni.find((c) => guidWindows(c.id) === scelta.id);
  if (stessa && nome(stessa)) return nome(stessa);
  if (nome(scelta)) return nome(scelta);
  const conInternet = connessioni.filter((c) => c.internet === true);
  if (!scelta.internet || conInternet.length !== 1 || candidati.filter((c) => c.internet).length !== 1) return null;
  return nome(conInternet[0]);
}

function datiDaWindows(riga) {
  let j;
  try { j = JSON.parse(String(riga || '').trim()); } catch (_) { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const rete = j.rete && typeof j.rete === 'object' && !Array.isArray(j.rete) ? reteDaWindows(j.rete) : null;
  let bluetooth = j.bluetooth && typeof j.bluetooth === 'object' ? { ...j.bluetooth } : null;
  // Windows PowerShell 5.1 a volte scrive un elenco come {value, Count}: si riprende l'elenco.
  const d = bluetooth && bluetooth.dispositivi;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.value)) bluetooth.dispositivi = d.value;
  return { batteria: j.batteria || null, rete, bluetooth, volume: j.volume || null, wifi: j.wifi || null };
}

// Una riga del lettore che risponde a una richiesta d'elenco (bluetooth, wifi): non è una lettura dello stato.
function elencoDaRiga(riga) {
  let j;
  try { j = JSON.parse(String(riga || '').trim()); } catch (_) { return null; }
  const e = j && typeof j === 'object' && !Array.isArray(j) ? j.elenco : null;
  return e && typeof e === 'object' && (e.cosa === 'bluetooth' || e.cosa === 'wifi') ? e : null;
}

// Il tempo per la risposta a un elenco: col PowerShell già acceso bastano le attese dello script (al più 5 s per le
// radio, 16 per le ricerche, 6 per i nomi), mentre uno che parte su un PC lento ci mette da solo decine di secondi (#2394).
const ELENCO_ACCESO_MS = 40 * 1000;
const ELENCO_A_FREDDO_MS = 60 * 1000;

function lettoreWindows({ avvia = spawn, pid = process.pid, quandoCambia = () => {} } = {}) {
  let figlio = null;
  let ultimo = null;
  let quando = 0;
  // Dopo un sonno l'ultima riga è di prima: resta per chi disegna, ma chi chiede aspetta quella nuova.
  let fresco = false;
  let guasti = 0;
  let attese = [];
  const sveglia = () => { const a = attese; attese = []; for (const r of a) r(); };
  // Le richieste d'elenco in volo, per cosa: due uguali sono una. Un PowerShell vivo che non risponde a stdin non
  // risponderà mai: da lì gli elenchi tornano allo script (`muti`).
  const richieste = new Map();
  let muti = false;
  const consegna = (cosa, valore) => {
    const r = richieste.get(cosa);
    if (!r) return;
    richieste.delete(cosa);
    clearTimeout(r.timer);
    r.risolvi(valore);
  };
  const consegnaTutte = () => { for (const cosa of [...richieste.keys()]) consegna(cosa, null); };

  function assicura() {
    if (figlio || guasti >= 3) return;
    let buffer = '';
    try {
      figlio = avvia('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', scriptWindows(pid)],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (_) {
      figlio = null;
      guasti = 3;
      sveglia();
      return;
    }
    const questo = figlio;
    if (questo.stdin) questo.stdin.on('error', () => {});
    questo.stdout.setEncoding('utf8');
    questo.stdout.on('data', (pezzo) => {
      if (figlio !== questo) return;
      buffer += pezzo;
      if (buffer.length > 1024 * 1024) buffer = '';
      let a;
      while ((a = buffer.indexOf('\n')) >= 0) {
        const riga = buffer.slice(0, a);
        buffer = buffer.slice(a + 1);
        const e = elencoDaRiga(riga);
        if (e) { consegna(e.cosa, e); continue; }
        const d = datiDaWindows(riga);
        if (d) { ultimo = d; quando = Date.now(); fresco = true; guasti = 0; sveglia(); quandoCambia(); }
      }
    });
    // Un'uscita che non abbiamo chiesto è un guasto: dopo tre di fila il lettore si arrende, senza ripartire in loop.
    const finito = () => {
      // Un processo vecchio che esce dopo la ripartenza non sveglia chi aspetta quello nuovo.
      if (figlio === questo) { figlio = null; fresco = false; sveglia(); consegnaTutte(); }
      if (!questo.fermatoDaNoi && !questo.contato) { questo.contato = true; guasti += 1; }
    };
    questo.on('error', finito);
    questo.on('exit', finito);
  }

  function pronto(ms) {
    if (fresco || !figlio) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      attese.push(() => { clearTimeout(t); resolve(); });
    });
  }

  function ferma() {
    if (figlio) {
      figlio.fermatoDaNoi = true;
      try { figlio.kill(); } catch (_) {}
    }
    figlio = null;
    fresco = false;
    sveglia();
    consegnaTutte();
  }

  // L'elenco (bluetooth o wifi) dal PowerShell acceso: l'oggetto della sua risposta; { tempo: true } se non arriva in
  // tempo; null se il lettore non può (spento, arreso, muto) e chi chiede passa allo script.
  function chiedi(cosa, ms) {
    if (!figlio || muti || !figlio.stdin || (cosa !== 'bluetooth' && cosa !== 'wifi')) return Promise.resolve(null);
    const c = richieste.get(cosa);
    if (c) return c.p;
    const acceso = fresco;
    const voce = {};
    voce.p = new Promise((risolvi) => {
      voce.risolvi = risolvi;
      voce.timer = setTimeout(() => {
        if (acceso && figlio) muti = true;
        consegna(cosa, acceso ? null : { tempo: true });
      }, ms != null ? ms : (acceso ? ELENCO_ACCESO_MS : ELENCO_A_FREDDO_MS));
    });
    richieste.set(cosa, voce);
    try { figlio.stdin.write(`${cosa}\n`); } catch (_) { consegna(cosa, null); }
    return voce.p;
  }

  // `ultimo` è solo la riga del processo vivo; `ultimaRiga` resta a chi disegna mentre il lettore riparte.
  // Un lettore che si è arreso non ha più niente di vero da dire: meglio una voce che sparisce che una che mente.
  return {
    assicura, pronto, ferma, chiedi,
    ultimo: () => (fresco ? ultimo : null),
    ultimaRiga: () => (figlio ? ultimo : null),
    inAttesa: () => !!figlio && !fresco,
    attivo: () => !!figlio,
    // Il PowerShell scrive solo quando qualcosa cambia: la riga vale per il momento in cui è arrivata.
    quando: () => quando,
  };
}

// ── Il monitor: chi guarda chiede, il lettore gira finché qualcuno guarda ────

function electron() {
  try { return require('electron'); } catch (_) { return null; }
}

function onlineDaElectron() {
  try {
    const net = electron() && electron().net;
    return net && typeof net.isOnline === 'function' ? net.isOnline() : null;
  } catch (_) {
    return null;
  }
}

// Offline lo dice Chromium, oppure la piattaforma quando nessuna strada porta fuori (`uscita: false`): Chromium conta
// anche gli adattatori virtuali sempre accesi. Come si esce e con che nome lo dice la piattaforma.
function componi(parti, online) {
  const p = parti || {};
  let rete = null;
  if (online === false || (p.rete && p.rete.uscita === false)) rete = { online: false };
  else if (online === true) rete = { online: true, tipo: p.rete ? p.rete.tipo : null, nome: p.rete ? p.rete.nome : null };
  else if (p.rete) rete = { online: true, tipo: p.rete.tipo, nome: p.rete.nome };
  return { batteria: p.batteria || null, rete, bluetooth: p.bluetooth || null, volume: p.volume || null, wifi: p.wifi || null };
}

let stato = null;
let firma = null;
// L'ultima lettura con cui il filo confronta la prossima: le prove che cambiano computer la azzerano.
let ultimoPerFilo = null;
let ultimaRichiesta = 0;
let vegliaMs = VEGLIA_MS;
// Le pagine che seguono il sistema: quando una torna davanti, il lettore riparte senza aspettare il suo richiamo.
const osservatori = new Set();
let giro = null;
let letturaInCorso = null;
let lettoreProve = null;
let agganciato = false;
let windows = null;
let bloccato = false;
let ritorno = null;
// Nei test lo schermo virtuale non riceve input veri e il sistema lo darebbe inattivo dopo cinque minuti.
let inattivita = process.env.FILO_USER_DATA ? () => 'active' : (s) => electron().powerMonitor.getSystemIdleState(s);

function lettoreDiWindows() {
  if (!windows) windows = lettoreWindows({ quandoCambia: () => { leggiAdesso(); } });
  return windows;
}

// `fresco: false` quando il PowerShell che riparte non ha ancora scritto: la home tiene la riga di prima, la chat no.
async function lettoreDiSistema() {
  if (process.platform === 'win32') {
    const w = lettoreDiWindows();
    w.assicura();
    await w.pronto(ATTESA_PRIMA_LETTURA_MS);
    if (w.inAttesa()) return { grezzo: componi(w.ultimaRiga(), onlineDaElectron()), fresco: false, lettoAlle: w.quando() };
    return { grezzo: componi(w.ultimo(), onlineDaElectron()), fresco: true, lettoAlle: w.quando() };
  } else if (process.platform === 'darwin') {
    return { grezzo: componi(await leggiMac(), onlineDaElectron()), fresco: true };
  } else {
    return { grezzo: componi(await leggiLinux(), onlineDaElectron()), fresco: true };
  }
}

function annuncia() {
  try {
    const { MSG } = globalThis.SN_MSG;
    require('./handlers').broadcastToFiloPages({ type: MSG.SISTEMA_AGGIORNATO, stato: statoDaDare() });
  } catch (_) {}
}

// #2394 — le radio lette più di due giri fa (il lettore dormiva, o il PowerShell sta ripartendo) non si danno per
// accese o spente: chi riceve lo stato le trova in `vecchio` e dice «leggo». L'elenco dei dispositivi rinfresca il
// Bluetooth (`radioLetta`), e fra due letture della stessa radio vale la più recente.
const VECCHIO_MS = GIRO_MS * 2;
const RADIO = ['bluetooth', 'wifi'];
const letteRadio = { bluetooth: 0, wifi: 0 };
const lettaAlle = (voce) => Math.max(stato ? stato.letto || 0 : 0, letteRadio[voce] || 0);
const radioVecchie = (adesso = Date.now()) => (stato ? RADIO.filter((v) => adesso - lettaAlle(v) > VECCHIO_MS) : []);
function statoDaDare() {
  const vecchie = radioVecchie();
  return stato && vecchie.length ? { ...stato, vecchio: vecchie } : stato;
}

// `letto` è l'ora della lettura vera: una riga di prima del sonno ridisegnata non la rinfresca.
// Rete caduta o tornata, batteria sotto una soglia, Bluetooth collegato entrano nel filo da qui (#1561): ogni lettura
// passa di qui, chiunque l'abbia chiesta. Senza una lettura prima non c'è niente da confrontare.
function pubblica(grezzo, { fresco = true, radio = null } = {}) {
  const daRileggere = radioVecchie();
  if (radio) letteRadio[radio] = Date.now();
  const tenute = {};
  // Una riga di prima del sonno non smentisce la radio che l'elenco ha appena letto.
  if (!fresco && stato) for (const v of RADIO) if (v !== radio && (letteRadio[v] || 0) > (stato.letto || 0)) tenute[v] = stato[v];
  const nuovo = S().normalizza({ ...grezzo, ...tenute });
  const f = JSON.stringify(nuovo);
  stato = { ...nuovo, letto: fresco ? Date.now() : (stato ? stato.letto : 0) };
  const prima = ultimoPerFilo;
  ultimoPerFilo = nuovo;
  // Uno stato uguale a quello di prima si annuncia lo stesso se chi l'ha ricevuto lo sapeva vecchio.
  const rinfrescate = daRileggere.length > radioVecchie().length;
  const cambiato = f !== firma;
  if (cambiato || rinfrescate) {
    firma = f;
    annuncia();
    if (prima && cambiato) { try { require('./accaduti').sistema(prima, nuovo); } catch (_) {} }
  }
  return stato;
}

// La radio letta da un elenco (comandiSistema.js): vale come una lettura del lettore, per quella radio sola.
function radioLetta(voce, acceso) {
  if (!stato || !RADIO.includes(voce) || typeof acceso !== 'boolean') return;
  const prima = stato[voce];
  const grezzo = { ...stato };
  if (voce === 'wifi') grezzo.wifi = { acceso };
  else grezzo.bluetooth = acceso ? { acceso: true, dispositivi: prima && prima.acceso === true ? prima.dispositivi : null } : { acceso: false, dispositivi: [] };
  pubblica(grezzo, { fresco: false, radio: voce });
}

// Il lettore dorme quando nessuno guarda: la rete che cade, e su Linux la batteria che scende, si vedono senza
// processi; a batteria una lettura ogni tanto, che poi si spegne. Così i cambi che contano arrivano anche a home chiusa.
const GUARDIA_MS = 30 * 1000;
const GUARDIA_BATTERIA_MS = 10 * 60 * 1000;
let guardia = null;
let ultimaGuardia = 0;
function aBatteria() {
  try { return !!electron().powerMonitor.isOnBatteryPower(); } catch (_) { return false; }
}
function sottoSoglia(prima, dopo) {
  const soglie = (globalThis.SN_FILO_ACCADUTI && globalThis.SN_FILO_ACCADUTI.SOGLIE_BATTERIA) || [];
  return soglie.some((x) => prima > x && dopo <= x);
}
async function letturaDiGuardia() {
  ultimaGuardia = Date.now();
  await leggiAdesso();
  if (!giro && windows) windows.ferma();
}
// Chromium che la pensa diversamente dalla piattaforma si rilegge poche volte per ogni suo cambio: con un adattatore
// virtuale acceso (Docker, una macchina virtuale) dice online anche a rete giù, e la differenza non passa.
const RILETTURE_RETE = 3;
function reteDaRileggere(g, online, rete) {
  if (online !== g.visto) { g.visto = online; g.riletture = 0; }
  if (online === null || rete === null || online === rete || g.riletture >= RILETTURE_RETE) return false;
  g.riletture += 1;
  return true;
}
const guardiaRete = { visto: null, riletture: 0 };
function guarda() {
  if (lettoreProve || giro || letturaInCorso || !ultimoPerFilo) return;
  const online = onlineDaElectron();
  const rete = ultimoPerFilo.rete && typeof ultimoPerFilo.rete.online === 'boolean' ? ultimoPerFilo.rete.online : null;
  let leggi = reteDaRileggere(guardiaRete, online, rete);
  const b = ultimoPerFilo.batteria;
  if (!leggi && b && Number.isFinite(b.livello) && process.platform === 'linux') {
    const ora = batteriaLinux();
    if (ora && Number.isFinite(ora.livello) && (ora.collegata !== b.collegata || sottoSoglia(b.livello, ora.livello))) leggi = true;
  } else if (!leggi && b && process.platform !== 'linux' && aBatteria() && Date.now() - ultimaGuardia > GUARDIA_BATTERIA_MS) {
    leggi = true;
  }
  if (leggi) letturaDiGuardia().catch(() => {});
}
function sorveglia() {
  if (guardia) return;
  guardia = setInterval(guarda, GUARDIA_MS);
  if (guardia.unref) guardia.unref();
}

// Una lettura cominciata (o una riga di Windows scritta) prima dell'avviso del caricatore non lo smentisce.
let avvisoCorrente = null;
function dopoAvviso(grezzo, lettoAlle) {
  const a = avvisoCorrente;
  if (!a || !grezzo || !grezzo.batteria || lettoAlle >= a.quando || Date.now() - a.quando > EVENTO_VALE_MS) return grezzo;
  const b = grezzo.batteria;
  return { ...grezzo, batteria: { ...b, collegata: a.collegata, inCarica: a.collegata && b.inCarica === true } };
}

function leggiAdesso() {
  if (letturaInCorso) return letturaInCorso;
  letturaInCorso = (async () => {
    try {
      const inizio = Date.now();
      if (lettoreProve) pubblica(dopoAvviso(await lettoreProve(), inizio));
      else {
        const { grezzo, fresco, lettoAlle = inizio } = await lettoreDiSistema();
        pubblica(dopoAvviso(grezzo, lettoAlle), { fresco });
      }
    } catch (_) {}
    letturaInCorso = null;
    return stato;
  })();
  return letturaInCorso;
}

// Ogni lettura fuori dal richiamo di una home passa dal giro, che ha sempre chi lo spegne (con l'utente assente al
// giro dopo): su Windows nessun PowerShell resta acceso senza padrone.
function leggiUnaVolta() {
  richiedi({ unaVolta: true });
  return leggiAdesso();
}

// Staccando il caricatore Windows e macOS lo dicono subito, e l'avviso non costa niente: vale finché una home è in
// vista, anche con l'utente fermo da minuti e il lettore addormentato; la lettura che segue rinfresca anche il livello.
function correggiCorrente(collegata) {
  avvisoCorrente = { collegata, quando: Date.now() };
  if (!giro && (!osservatoreInVista() || schermoBloccato())) return;
  if (stato && stato.batteria) {
    pubblica({ ...stato, batteria: { ...stato.batteria, collegata, inCarica: collegata && stato.batteria.inCarica } });
  }
  leggiUnaVolta();
}

// Linux non dà l'avviso del caricatore, ma la sua batteria si legge da file, senza processi.
function correnteSenzaProcessi() {
  if (lettoreProve) return null;
  if (process.platform === 'linux') {
    const b = batteriaLinux();
    return b ? b.collegata : null;
  }
  // Windows e macOS: lo dicono i loro avvisi (on-ac, on-battery).
  return null;
}

function statoInattivita() {
  try { return inattivita(ASSENTE_DOPO_S); } catch (_) { return 'unknown'; }
}
const schermoBloccato = () => bloccato || statoInattivita() === 'locked';

// Una regola sola per ogni modo di non esserci: schermo bloccato, oppure nessun tasto né mouse da cinque minuti.
// Un sistema che non sa dirlo (Wayland, per esempio) conta l'utente presente, come prima.
function utenteCe() {
  if (bloccato) return false;
  const s = statoInattivita();
  return s !== 'idle' && s !== 'locked';
}

// Una pagina che segue il sistema è la scheda in vista di una sua finestra.
function osservatoreInVista() {
  try {
    for (const w of electron().BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (!tm || w.isDestroyed()) continue;
      for (const t of tm.tabs || []) {
        const wc = t.view && t.view.webContents;
        if (wc && osservatori.has(wc.id) && tm.inVista(t.id)) return true;
      }
    }
  } catch (_) {}
  return false;
}

// Mentre l'utente non c'è e una home resta in vista, si controlla solo la sua presenza (nessun processo):
// appena torna, il lettore riparte senza aspettare il richiamo della home.
function aspettaRitorno() {
  if (ritorno) return;
  ritorno = setInterval(() => {
    const c = correnteSenzaProcessi();
    if (c !== null && stato && stato.batteria && c !== stato.batteria.collegata) correggiCorrente(c);
    const presente = utenteCe();
    if (presente || !osservatoreInVista()) {
      clearInterval(ritorno);
      ritorno = null;
      if (presente && osservatoreInVista()) richiedi();
    }
  }, GIRO_MS);
  if (ritorno.unref) ritorno.unref();
}

function aggancia() {
  if (agganciato) return;
  agganciato = true;
  const e = electron();
  try {
    e.powerMonitor.on('on-ac', () => correggiCorrente(true));
    e.powerMonitor.on('on-battery', () => correggiCorrente(false));
    e.powerMonitor.on('resume', () => { if (giro) leggiAdesso(); });
    e.powerMonitor.on('lock-screen', () => { bloccato = true; if (giro) { ferma(); aspettaRitorno(); } });
    e.powerMonitor.on('unlock-screen', () => { bloccato = false; if (osservatoreInVista()) richiedi(); });
  } catch (_) {}
  try { e.app.on('will-quit', () => { ferma(); if (guardia) clearInterval(guardia); guardia = null; }); } catch (_) {}
}

function ferma() {
  if (giro) clearInterval(giro);
  giro = null;
  if (ritorno) clearInterval(ritorno);
  ritorno = null;
  if (windows) windows.ferma();
}

// #874 — quello che un comando ha appena cambiato si vede subito; la lettura che segue lo conferma o lo corregge.
function dopoComando(parziale) {
  const p = parziale && typeof parziale === 'object' ? parziale : {};
  if (stato) {
    const nuovo = { ...stato };
    if (p.volume) nuovo.volume = { ...(stato.volume || {}), ...p.volume };
    if (p.wifi && typeof p.wifi.acceso === 'boolean') nuovo.wifi = { acceso: p.wifi.acceso };
    if (p.bluetooth && typeof p.bluetooth.acceso === 'boolean') {
      nuovo.bluetooth = p.bluetooth.acceso ? { acceso: true, dispositivi: stato.bluetooth ? stato.bluetooth.dispositivi : null } : { acceso: false, dispositivi: [] };
    }
    pubblica(nuovo);
  }
  leggiAdesso();
  // Una radio o un collegamento si assestano in qualche secondo: si rilegge ancora, anche con la home dietro.
  setTimeout(() => { leggiAdesso(); }, 2500).unref?.();
}

// Una scheda dietro le altre per Chromium resta «visibile» e continua a chiedere: `davanti: false` risponde
// senza tenere sveglio il lettore, che legge solo finché qualcuno guarda.
// `segue: false` è una home che non mostra niente letto dal computer: riceve lo stato, non sveglia il lettore.
// Con l'utente assente nessuna pagina lo tiene sveglio; `unaVolta` (un turno di chat, un avviso) legge comunque.
// `riscalda`: un riscaldamento a tempo, non un gesto; con l'utente assente non legge, come una pagina che segue (#1302).
function richiedi({ davanti = true, chi = null, segue = true, unaVolta = false, riscalda = false } = {}) {
  if (chi && typeof chi.id === 'number') {
    const id = chi.id;
    if (!segue) osservatori.delete(id);
    else if (!osservatori.has(id)) {
      osservatori.add(id);
      try { chi.once('destroyed', () => osservatori.delete(id)); } catch (_) {}
    }
  }
  if (!davanti || !segue) return;
  aggancia();
  if (riscalda && !utenteCe()) return;
  if (!unaVolta && !utenteCe()) { aspettaRitorno(); return; }
  ultimaRichiesta = Date.now();
  if (giro) return;
  giro = setInterval(() => {
    if (Date.now() - ultimaRichiesta > vegliaMs) { ferma(); return; }
    if (!utenteCe()) { ferma(); aspettaRitorno(); return; }
    leggiAdesso();
  }, GIRO_MS);
  if (giro.unref) giro.unref();
  leggiAdesso();
}

// La finestra porta davanti una scheda: se è una pagina che segue il sistema, il lettore si sveglia subito.
function schedaDavanti(wc) {
  if (wc && osservatori.has(wc.id)) richiedi();
}

const frescoPer = (chiesto) => !!stato && chiesto - stato.letto <= GIRO_MS * 2;

// Per la chat: lo stato di adesso, aspettando la prima lettura se nessuno guardava. Se la lettura nuova non arriva,
// null («il computer non ha risposto»): lo stato di prima della pausa non si dà per letto adesso.
async function statoPerChat() {
  const chiesto = Date.now();
  richiedi({ unaVolta: true });
  if (!frescoPer(chiesto)) {
    await Promise.race([leggiAdesso(), new Promise((r) => setTimeout(r, ATTESA_PRIMA_LETTURA_MS + 500))]);
  }
  return frescoPer(chiesto) ? stato : null;
}

// #2394 — su Windows gli elenchi di comandiSistema.js li legge il PowerShell di questo lettore, già acceso: si tiene
// sveglio come per un turno di chat (il giro lo rispegne). null: il lettore non può, si passa allo script.
async function elencoDalLettore(cosa) {
  if (process.platform !== 'win32' || lettoreProve) return null;
  richiedi({ unaVolta: true });
  const w = lettoreDiWindows();
  w.assicura();
  return w.chiedi(cosa);
}

// Chi deve dire «sei offline» (gli errori della chat) chiede qui: la risposta non aspetta un giro. Col lettore sveglio
// vale anche la piattaforma (nessuna strada fuori); addormentato, il suo stato è vecchio e resta Chromium.
function offline() {
  const letto = !!(stato && stato.rete && stato.rete.online === false);
  if (lettoreProve) return letto;
  return onlineDaElectron() === false || (!!giro && letto);
}

// Le prove staccano il caricatore e la rete di un computer finto: il giro, l'annuncio e la home restano quelli veri.
const _perProve = {
  usaLettore(fn) { lettoreProve = typeof fn === 'function' ? fn : null; firma = null; ultimoPerFilo = null; return leggiAdesso(); },
  leggiOra: () => leggiAdesso(),
  attivo: () => !!giro,
  veglia(ms) { vegliaMs = Number(ms) > 0 ? Number(ms) : VEGLIA_MS; },
  // Lo stato d'inattività che darebbe il sistema ('active' | 'idle' | 'locked'); senza argomento, sempre presente.
  inattivita(v) { inattivita = () => (typeof v === 'string' ? v : 'active'); },
  GIRO_MS,
};

const api = {
  dopoComando,
  richiedi,
  sorveglia,
  schedaDavanti,
  stato: () => stato,
  statoPerChat,
  leggiAdesso,
  leggiUnaVolta,
  offline,
  ferma,
  _perProve,
};
globalThis.SN_SISTEMA_MAIN = api;

module.exports = {
  ...api,
  GIRO_MS,
  VEGLIA_MS,
  RILETTURE_RETE,
  reteDaRileggere,
  componi,
  sintesiBatterie,
  batteriaLinux,
  interfacciaVersoFuori,
  tipoInterfacciaLinux,
  ssidDaIw,
  connessioneDaNmcli,
  bluetoothDaBluez,
  bluetoothDaRfkill,
  wifiDaRfkill,
  volumeDaWpctl,
  volumeDaPactl,
  volumeDaAmixer,
  leggiLinux,
  batteriaDaPmset,
  interfacciaDaRoute,
  portaDaNetworksetup,
  tipoDaPortaMac,
  ssidDaIpconfig,
  bluetoothDaDefaults,
  volumeDaOsascript,
  dispositivoWifiMac,
  wifiDaNetworksetup,
  leggiMac,
  SCRIPT_WINDOWS,
  scriptWindows,
  datiDaWindows,
  reteDaWindows,
  lettoreWindows,
};
