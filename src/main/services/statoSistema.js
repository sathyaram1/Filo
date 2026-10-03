// Batteria, rete e Bluetooth del computer: un lettore per piattaforma, senza permessi, senza modello, senza console.
// Non comanda niente; un dato che il sistema dà solo con un permesso si omette. I testi stanno in src/shared/sistema.js.
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

function S() {
  if (!globalThis.SN_SISTEMA) require('../../shared/sistema.js');
  return globalThis.SN_SISTEMA;
}

function esegui(file, args, { timeout = COMANDO_MS } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : String(stdout || '')));
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

async function reteLinux(radice, esec) {
  const iface = interfacciaVersoFuori(radice);
  if (!iface) return null;
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

async function leggiLinux(radice = '/', esec = esegui) {
  const [rete, bluetooth] = await Promise.all([reteLinux(radice, esec), bluetoothLinux(radice, esec)]);
  return { batteria: batteriaLinux(radice), rete, bluetooth };
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

async function leggiMac(esec = esegui) {
  const [pm, rotta, bt] = await Promise.all([
    esec('pmset', ['-g', 'batt']),
    esec('route', ['-n', 'get', 'default']),
    esec('defaults', ['read', '/Library/Preferences/com.apple.Bluetooth', 'ControllerPowerState']),
  ]);
  let rete = null;
  const iface = interfacciaDaRoute(rotta);
  if (iface) {
    if (!portePerMac.testo || Date.now() - portePerMac.quando > 60 * 1000) {
      portePerMac = { testo: await esec('networksetup', ['-listallhardwareports']), quando: Date.now() };
    }
    const tipo = tipoDaPortaMac(portaDaNetworksetup(portePerMac.testo, iface));
    const nome = tipo === 'wifi' ? ssidDaIpconfig(await esec('ipconfig', ['getsummary', iface])) : null;
    rete = { tipo, nome };
  }
  return { batteria: batteriaDaPmset(pm), rete, bluetooth: bluetoothDaDefaults(bt) };
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
$ultimo = ''
$btPrima = $null
$nomiPrima = $null
$giri = 0
while ($true) {
  $giri += 1
  try { $null = [System.Diagnostics.Process]::GetProcessById($genitore) } catch { exit }
  $o = [ordered]@{ batteria = $null; rete = $null; bluetooth = $null }
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
    foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      $tipi[([string]$n.Id).Trim('{}').ToLower()] = [string]$n.NetworkInterfaceType
    }
    if ($nlm) {
      $scelta = $null
      foreach ($c in @($nlm.GetNetworkConnections())) {
        if (-not $c.IsConnected) { continue }
        $t = $tipi[([string]$c.GetAdapterId()).Trim('{}').ToLower()]
        $v = @{ tipo = $null; nome = $null; peso = 0 }
        if ($t -eq 'Wireless80211') { $v.tipo = 'wifi' } elseif ($t -like '*Ethernet*') { $v.tipo = 'cavo' }
        if ($v.tipo -eq 'wifi') { try { $v.nome = [string]$c.GetNetwork().GetName() } catch {} }
        $v.peso = ([int][bool]$c.IsConnectedToInternet) * 2 + [int][bool]$v.tipo
        if ((-not $scelta) -or ($v.peso -gt $scelta.peso)) { $scelta = $v }
      }
      if ($scelta) { $o.rete = [ordered]@{ tipo = $scelta.tipo; nome = $scelta.nome } }
    }
  } catch {}
  if ($attendi) {
    $letto = $false
    try {
      $radios = & $attendi ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
      if ($null -ne $radios) {
        $letto = $true
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

function scriptWindows(pid) {
  return SCRIPT_WINDOWS.replace('__GENITORE__', String(Math.trunc(Number(pid)) || 0));
}

function datiDaWindows(riga) {
  let j;
  try { j = JSON.parse(String(riga || '').trim()); } catch (_) { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const rete = j.rete && typeof j.rete === 'object' ? { tipo: j.rete.tipo || null, nome: j.rete.nome || null } : null;
  let bluetooth = j.bluetooth && typeof j.bluetooth === 'object' ? { ...j.bluetooth } : null;
  // Windows PowerShell 5.1 a volte scrive un elenco come {value, Count}: si riprende l'elenco.
  const d = bluetooth && bluetooth.dispositivi;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.value)) bluetooth.dispositivi = d.value;
  return { batteria: j.batteria || null, rete, bluetooth };
}

function lettoreWindows({ avvia = spawn, pid = process.pid, quandoCambia = () => {} } = {}) {
  let figlio = null;
  let ultimo = null;
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
      buffer += pezzo;
      if (buffer.length > 1024 * 1024) buffer = '';
      let a;
      while ((a = buffer.indexOf('\n')) >= 0) {
        const d = datiDaWindows(buffer.slice(0, a));
        buffer = buffer.slice(a + 1);
        if (d) { ultimo = d; guasti = 0; sveglia(); quandoCambia(); }
      }
    });
    // Un'uscita che non abbiamo chiesto è un guasto: dopo tre di fila il lettore si arrende, senza ripartire in loop.
    const finito = () => {
      if (figlio === questo) figlio = null;
      sveglia();
      if (!questo.fermatoDaNoi && !questo.contato) { questo.contato = true; guasti += 1; }
    };
    questo.on('error', finito);
    questo.on('exit', finito);
  }

  function pronto(ms) {
    if (ultimo || !figlio) return Promise.resolve();
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
    sveglia();
  }

  return { assicura, pronto, ferma, ultimo: () => ultimo, attivo: () => !!figlio };
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

// Online lo decide Chromium per tutti e tre i sistemi; come si esce e con che nome lo dice la piattaforma.
function componi(parti, online) {
  const p = parti || {};
  let rete = null;
  if (online === false) rete = { online: false };
  else if (online === true) rete = { online: true, tipo: p.rete ? p.rete.tipo : null, nome: p.rete ? p.rete.nome : null };
  else if (p.rete) rete = { online: true, tipo: p.rete.tipo, nome: p.rete.nome };
  return { batteria: p.batteria || null, rete, bluetooth: p.bluetooth || null };
}

let stato = null;
let firma = null;
let ultimaRichiesta = 0;
let giro = null;
let letturaInCorso = null;
let lettoreProve = null;
let agganciato = false;
let windows = null;

function lettoreDiWindows() {
  if (!windows) windows = lettoreWindows({ quandoCambia: () => { leggiAdesso(); } });
  return windows;
}

async function lettoreDiSistema() {
  if (process.platform === 'win32') {
    const w = lettoreDiWindows();
    w.assicura();
    await w.pronto(ATTESA_PRIMA_LETTURA_MS);
    return componi(w.ultimo(), onlineDaElectron());
  } else if (process.platform === 'darwin') {
    return componi(await leggiMac(), onlineDaElectron());
  } else {
    return componi(await leggiLinux(), onlineDaElectron());
  }
}

function annuncia() {
  try {
    const { MSG } = globalThis.SN_MSG;
    require('./handlers').broadcastToFiloPages({ type: MSG.SISTEMA_AGGIORNATO, stato });
  } catch (_) {}
}

function pubblica(grezzo) {
  const nuovo = S().normalizza(grezzo);
  const f = JSON.stringify(nuovo);
  stato = { ...nuovo, letto: Date.now() };
  if (f !== firma) {
    firma = f;
    annuncia();
  }
  return stato;
}

function leggiAdesso() {
  if (letturaInCorso) return letturaInCorso;
  letturaInCorso = (async () => {
    try {
      pubblica(lettoreProve ? await lettoreProve() : await lettoreDiSistema());
    } catch (_) {}
    letturaInCorso = null;
    return stato;
  })();
  return letturaInCorso;
}

// Staccando il caricatore Windows e macOS lo dicono subito: l'icona cambia senza aspettare il giro.
function correggiCorrente(collegata) {
  if (stato && stato.batteria && !lettoreProve) {
    pubblica({ ...stato, batteria: { ...stato.batteria, collegata, inCarica: collegata && stato.batteria.inCarica } });
  }
  leggiAdesso();
}

function aggancia() {
  if (agganciato) return;
  agganciato = true;
  const e = electron();
  try {
    e.powerMonitor.on('on-ac', () => { if (giro) correggiCorrente(true); });
    e.powerMonitor.on('on-battery', () => { if (giro) correggiCorrente(false); });
    e.powerMonitor.on('resume', () => { if (giro) leggiAdesso(); });
  } catch (_) {}
  try { e.app.on('will-quit', ferma); } catch (_) {}
}

function ferma() {
  if (giro) clearInterval(giro);
  giro = null;
  if (windows) windows.ferma();
}

function richiedi() {
  ultimaRichiesta = Date.now();
  if (giro) return;
  aggancia();
  giro = setInterval(() => {
    if (Date.now() - ultimaRichiesta > VEGLIA_MS) { ferma(); return; }
    leggiAdesso();
  }, GIRO_MS);
  if (giro.unref) giro.unref();
  leggiAdesso();
}

// Per la chat: lo stato di adesso, aspettando la prima lettura se nessuno guardava.
async function statoPerChat() {
  richiedi();
  if (!stato || Date.now() - stato.letto > GIRO_MS * 2) {
    await Promise.race([leggiAdesso(), new Promise((r) => setTimeout(r, ATTESA_PRIMA_LETTURA_MS + 500))]);
  }
  return stato;
}

// Chi deve dire «sei offline» (gli errori della chat) chiede qui: la risposta non aspetta un giro.
function offline() {
  if (lettoreProve) return !!(stato && stato.rete && stato.rete.online === false);
  return onlineDaElectron() === false;
}

// Le prove staccano il caricatore e la rete di un computer finto: il giro, l'annuncio e la home restano quelli veri.
const _perProve = {
  usaLettore(fn) { lettoreProve = typeof fn === 'function' ? fn : null; firma = null; return leggiAdesso(); },
  leggiOra: () => leggiAdesso(),
  attivo: () => !!giro,
  GIRO_MS,
};

const api = {
  richiedi,
  stato: () => stato,
  statoPerChat,
  leggiAdesso,
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
  leggiLinux,
  batteriaDaPmset,
  interfacciaDaRoute,
  portaDaNetworksetup,
  tipoDaPortaMac,
  ssidDaIpconfig,
  bluetoothDaDefaults,
  leggiMac,
  SCRIPT_WINDOWS,
  scriptWindows,
  datiDaWindows,
  lettoreWindows,
};
