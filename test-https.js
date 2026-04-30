const https = require('https');
const fs = require('fs');
const server = https.createServer({
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
}, (req, res) => {
  res.writeHead(200);
  res.end('HTTPS works!');
});
server.listen(8443, () => console.log('Test HTTPS on 8443'));
