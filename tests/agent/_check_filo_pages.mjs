import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  // Test 1: filo://editor (a NATIVE_MENU_PAGE) - does native menu conflict?
  await d.navigate(app, shell, 'filo://editor/editor.html');
  await d.sleep(3000);
  let view = await d.activeView(app, shell);
  if (view) {
    const r1 = await view.evaluate(() => {
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 300, clientY: 300, button: 2,
      });
      document.body.dispatchEvent(evt);
      return new Promise(resolve => {
        setTimeout(() => {
          const menus = document.querySelectorAll('.sn-menu');
          resolve({
            page: 'filo://editor',
            filoReady: document.documentElement.dataset.filoReady,
            menuCount: menus.length,
            menuFound: menus.length > 0,
          });
        }, 500);
      });
    });
    console.log('EDITOR:', JSON.stringify(r1));
  }

  // Test 2: filo://options (another NATIVE_MENU_PAGE)
  await d.navigate(app, shell, 'filo://options/options.html');
  await d.sleep(3000);
  view = await d.activeView(app, shell);
  if (view) {
    const r2 = await view.evaluate(() => {
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 300, clientY: 300, button: 2,
      });
      document.body.dispatchEvent(evt);
      return new Promise(resolve => {
        setTimeout(() => {
          const menus = document.querySelectorAll('.sn-menu');
          resolve({
            page: 'filo://options',
            filoReady: document.documentElement.dataset.filoReady,
            menuCount: menus.length,
            menuFound: menus.length > 0,
          });
        }, 500);
      });
    });
    console.log('OPTIONS:', JSON.stringify(r2));
  }

  // Test 3: filo://newtab (NOT a NATIVE_MENU_PAGE)
  await d.navigate(app, shell, 'filo://newtab/');
  await d.sleep(3000);
  view = await d.activeView(app, shell);
  if (view) {
    const r3 = await view.evaluate(() => {
      const evt = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 300, clientY: 300, button: 2,
      });
      document.body.dispatchEvent(evt);
      return new Promise(resolve => {
        setTimeout(() => {
          const menus = document.querySelectorAll('.sn-menu');
          resolve({
            page: 'filo://newtab',
            filoReady: document.documentElement.dataset.filoReady,
            menuCount: menus.length,
            menuFound: menus.length > 0,
          });
        }, 500);
      });
    });
    console.log('NEWTAB:', JSON.stringify(r3));
  }
} finally {
  await d.closeFilo(app);
}
