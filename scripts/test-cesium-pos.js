const { firefox } = require('playwright');
(async () => {
  const browser = await firefox.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  await page.goto('http://localhost:8080');
  
  await page.evaluate(() => document.querySelector('.example-chip').click());
  await page.waitForSelector('#btn-start-practice');
  await page.evaluate(() => document.querySelector('#btn-start-practice').click());
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelector('button[data-pass="3"]').click());
  await page.waitForTimeout(3000);
  
  const cameraDest = await page.evaluate(() => {
    return window.cesiumView && window.cesiumView.viewer && window.cesiumView.viewer.camera.positionCartographic;
  });
  console.log("CAMERA POSITION:", cameraDest);
  
  await browser.close();
})();
