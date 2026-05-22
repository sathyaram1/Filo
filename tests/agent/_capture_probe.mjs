// Throwaway: verifica che la cattura OS-level della finestra Filo mostri
// la UI composita reale (shell + WebContentsView).
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const OUT = join(__dirname, '.out');
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

function captureRect(x, y, w, h, outPath) {
  const ps = `
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
$bmp = New-Object System.Drawing.Bitmap(${w}, ${h})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${x}, ${y}, 0, 0, (New-Object System.Drawing.Size(${w}, ${h})))
$bmp.Save('${outPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'pipe' });
}

const userData = mkdtempSync(join(tmpdir(), 'filo-cap-'));
const app = await electron.launch({ args: ['.'], cwd: ROOT, env: { ...process.env, FILO_USER_DATA: userData } });
const shell = await app.firstWindow();
await shell.waitForLoadState('domcontentloaded');
await new Promise((r) => setTimeout(r, 1500));

// porta in primo piano e prendi i bounds del contenuto in coordinate schermo
const bounds = await app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.show(); win.moveTop(); win.focus();
  const b = win.getContentBounds();
  return b;
});
console.log('content bounds:', JSON.stringify(bounds));
await new Promise((r) => setTimeout(r, 600));

// 1) cattura nativa con la dashboard
captureRect(bounds.x, bounds.y, bounds.width, bounds.height, join(OUT, 'native-dashboard.png'));

// 2) apri editor, poi apri il menu app → dovrebbe mostrare l'area bianca
await shell.evaluate(() => window.filoShell.tabs.open('filo://editor/editor.html'));
await new Promise((r) => setTimeout(r, 1500));
await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.moveTop(); w.focus(); });
await new Promise((r) => setTimeout(r, 400));
captureRect(bounds.x, bounds.y, bounds.width, bounds.height, join(OUT, 'native-editor.png'));

// apri il menu app
await shell.click('#nav-apps');
await new Promise((r) => setTimeout(r, 600));
captureRect(bounds.x, bounds.y, bounds.width, bounds.height, join(OUT, 'native-appsmenu.png'));

console.log('saved to', OUT);
await app.close();
