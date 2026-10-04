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
// Ogni lettura con le API del sistema che non chiedono niente: lo stato di alimentazione, la rete secondo
// il gestore delle reti (non le API del Wi-Fi, che da Windows 11 24H2 vogliono la posizione), le radio.
// L'uscita è JSON tutto ASCII: la codifica della console non può storpiare un nome.

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
$nlm = $null
try { $nlm = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'DCB00C01-570F-4A9B-8D69-199FDBA5723B')) } catch {}
$conVolume = $false
try {
Add-Type -TypeDefinition @'
__VOLUME__'@
$conVolume = $true
} catch {}
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
  try {
    $tipi = @{}
    $uscite = @{}
    foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      $id = ([string]$n.Id).Trim('{}').ToLower()
      $tipi[$id] = [string]$n.NetworkInterfaceType
      $gw = 0
      try { $gw = @($n.GetIPProperties().GatewayAddresses | Where-Object { $_.Address -and -not $_.Address.Equals([System.Net.IPAddress]::Any) -and -not $_.Address.Equals([System.Net.IPAddress]::IPv6Any) }).Count } catch {}
      $uscite[$id] = $gw -gt 0
    }
    if ($nlm) {
      $scelta = $null
      foreach ($c in @($nlm.GetNetworkConnections())) {
        if (-not $c.IsConnected) { continue }
        $a = ([string]$c.GetAdapterId()).Trim('{}').ToLower()
        if ((-not $c.IsConnectedToInternet) -and (-not $uscite[$a])) { continue }
        $t = $tipi[$a]
        $v = @{ tipo = $null; nome = $null; peso = 0 }
        if ($t -eq 'Wireless80211') { $v.tipo = 'wifi' } elseif ($t -like '*Ethernet*') { $v.tipo = 'cavo' }
        if ($v.tipo -eq 'wifi') { try { $v.nome = [string]$c.GetNetwork().GetName() } catch {} }
        $v.peso = ([int][bool]$c.IsConnectedToInternet) * 2 + [int][bool]$v.tipo
        if ((-not $scelta) -or ($v.peso -gt $scelta.peso)) { $scelta = $v }
      }
      if ($scelta) { $o.rete = [ordered]@{ tipo = $scelta.tipo; nome = $scelta.nome } } else { $o.rete = [ordered]@{ uscita = $false } }
    }
  } catch {}
  if ($attendi) {
    $letto = $false
    try {
      $radios = & $attendi ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
      if ($null -ne $radios) {
        $letto = $true
        $wf = @($radios | Where-Object { [string]$_.Kind -eq 'WiFi' })
        if ($wf.Count -gt 0) { $o.wifi = [ordered]@{ acceso = (@($wf | Where-Object { [string]$_.State -eq 'On' }).Count -gt 0) } }
        $bt = @($radios | Where-Object { [string]$_.Kind -eq 'Bluetooth' })
        if ($bt.Count -gt 0) {
          $acceso = @($bt | Where-Object { [string]$_.State -eq 'On' }).Count -gt 0
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
          $o.bluetooth = [ordered]@{ acceso = $acceso; dispositivi = $nomi }
        }
      }
    } catch {}
    if ($letto) { $btPrima = $o.bluetooth } else { $o.bluetooth = $btPrima }
  }
  $json = ConvertTo-Json -InputObject $o -Compress -Depth 5
  $json = [regex]::Replace($json, '[^ -~]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  if ($json -ne $ultimo) { [Console]::Out.WriteLine($json); [Console]::Out.Flush(); $ultimo = $json }
  Start-Sleep -Milliseconds 2000
}
`;

// Il volume si legge con lo stesso C# con cui comandiSistema.js lo cambia: una copia sola.
function scriptWindows(pid) {
  const volume = require('./comandiSistema')._interni.CS_VOLUME;
  return SCRIPT_WINDOWS.replace('__GENITORE__', String(Math.trunc(Number(pid)) || 0)).replace('__VOLUME__', () => volume);
}

function datiDaWindows(riga) {
  let j;
  try { j = JSON.parse(String(riga || '').trim()); } catch (_) { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  let rete = j.rete && typeof j.rete === 'object' ? { tipo: j.rete.tipo || null, nome: j.rete.nome || null } : null;
  if (rete && j.rete.uscita === false) rete = { uscita: false };
  let bluetooth = j.bluetooth && typeof j.bluetooth === 'object' ? { ...j.bluetooth } : null;
  // Windows PowerShell 5.1 a volte scrive un elenco come {value, Count}: si riprende l'elenco.
  const d = bluetooth && bluetooth.dispositivi;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.value)) bluetooth.dispositivi = d.value;
  return { batteria: j.batteria || null, rete, bluetooth, volume: j.volume || null, wifi: j.wifi || null };
}

function lettoreWindows({ avvia = spawn, pid = process.pid, quandoCambia = () => {} } = {}) {
  let figlio = null;
  let ultimo = null;
  let quando = 0;
  // Dopo un sonno l'ultima riga è di prima: resta per chi disegna, ma chi chiede aspetta quella nuova.
  let fresco = false;
  let guasti = 0;
  let attese = [];
  const sveglia = () => { const a = attese; attese = []; for (const r of a) r(); };

  function assicura() {
    if (figlio || guasti >= 3) return;
    let buffer = '';
    try {
      figlio = avvia('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', scriptWindows(pid)],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
      figlio = null;
      guasti = 3;
      sveglia();
      return;
    }
    const questo = figlio;
    questo.stdout.setEncoding('utf8');
    questo.stdout.on('data', (pezzo) => {
      if (figlio !== questo) return;
      buffer += pezzo;
      if (buffer.length > 1024 * 1024) buffer = '';
      let a;
      while ((a = buffer.indexOf('\n')) >= 0) {
        const d = datiDaWindows(buffer.slice(0, a));
        buffer = buffer.slice(a + 1);
        if (d) { ultimo = d; quando = Date.now(); fresco = true; guasti = 0; sveglia(); quandoCambia(); }
      }
    });
    // Un'uscita che non abbiamo chiesto è un guasto: dopo tre di fila il lettore si arrende, senza ripartire in loop.
    const finito = () => {
      // Un processo vecchio che esce dopo la ripartenza non sveglia chi aspetta quello nuovo.
      if (figlio === questo) { figlio = null; fresco = false; sveglia(); }
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
  }

  // `ultimo` è solo la riga del processo vivo; `ultimaRiga` resta a chi disegna mentre il lettore riparte.
  // Un lettore che si è arreso non ha più niente di vero da dire: meglio una voce che sparisce che una che mente.
  return {
    assicura, pronto, ferma,
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
    require('./handlers').broadcastToFiloPages({ type: MSG.SISTEMA_AGGIORNATO, stato });
  } catch (_) {}
}

// `letto` è l'ora della lettura vera: una riga di prima del sonno ridisegnata non la rinfresca.
function pubblica(grezzo, { fresco = true } = {}) {
  const nuovo = S().normalizza(grezzo);
  const f = JSON.stringify(nuovo);
  stato = { ...nuovo, letto: fresco ? Date.now() : (stato ? stato.letto : 0) };
  if (f !== firma) {
    firma = f;
    annuncia();
  }
  return stato;
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
  try { e.app.on('will-quit', ferma); } catch (_) {}
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
function richiedi({ davanti = true, chi = null, segue = true, unaVolta = false } = {}) {
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

// Chi deve dire «sei offline» (gli errori della chat) chiede qui: la risposta non aspetta un giro. Col lettore sveglio
// vale anche la piattaforma (nessuna strada fuori); addormentato, il suo stato è vecchio e resta Chromium.
function offline() {
  const letto = !!(stato && stato.rete && stato.rete.online === false);
  if (lettoreProve) return letto;
  return onlineDaElectron() === false || (!!giro && letto);
}

// Le prove staccano il caricatore e la rete di un computer finto: il giro, l'annuncio e la home restano quelli veri.
const _perProve = {
  usaLettore(fn) { lettoreProve = typeof fn === 'function' ? fn : null; firma = null; return leggiAdesso(); },
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
  lettoreWindows,
};
