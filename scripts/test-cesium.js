const { firefox } = require('playwright');
(async () => {
  const browser = await firefox.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  await page.goto('http://localhost:8080');
  
  await page.evaluate(() => {
    document.querySelector('.example-chip').click();
  });
  
  await page.waitForSelector('#btn-start-practice');
  await page.evaluate(() => {
    document.querySelector('#btn-start-practice').click();
  });
  
  await page.waitForTimeout(1000);
  
  await page.evaluate(() => {
    document.querySelector('button[data-pass="3"]').click();
  });
  
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'cesium-firefox.png' });
  await browser.close();
})();