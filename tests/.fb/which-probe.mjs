import { spawn } from 'node:child_process';

function timeit(file, args, label) {
  return new Promise((res) => {
    const t = Date.now();
    const p = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
    p.on('error', () => { console.log(label, '-> ERROR', Date.now() - t, 'ms'); res(); });
    p.on('exit', (c) => { console.log(label, '->', c === 0 ? 'EXISTS' : 'NOT', '(' + c + ')', Date.now() - t, 'ms'); res(); });
  });
}

// Current impl
const gcFull = (name) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
  'if (Get-Command -Name $args[0] -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }', name];
// Restricted (no Application, autoload off)
const gcR = (name) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
  "$PSModuleAutoLoadingPreference='None'; if (Get-Command -Name $args[0] -CommandType Alias,Function,Cmdlet,ExternalScript -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }", name];

const names = ['firebase', 'npm', 'node', 'git', 'ls', 'cd', 'Get-ChildItem', 'gci', 'fakefakefake'];

for (const n of names) await timeit('where.exe', [n], 'where ' + n);
console.log('---');
for (const n of names) await timeit('powershell.exe', gcR(n), 'restrictedGC ' + n);
console.log('--- full GC (current, slow) sample ---');
await timeit('powershell.exe', gcFull('firebase'), 'fullGC firebase');
await timeit('powershell.exe', gcFull('ls'), 'fullGC ls');
