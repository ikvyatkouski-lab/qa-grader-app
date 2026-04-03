const http  = require('http');
const https = require('https');

const FRONT_BASE = 'https://motion7434.api.frontapp.com';
const PORT = 3000;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Accept');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const target = new URL(FRONT_BASE + req.url);

  const options = {
    hostname: target.hostname,
    path: target.pathname + target.search,
    method: 'GET',
    headers: {
      'Authorization': req.headers['authorization'] || '',
      'Accept': 'application/json'
    }
  };

  const proxy = https.request(options, proxyRes => {
    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    proxyRes.pipe(res);
  });

  proxy.on('error', err => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
  proxy.end();

}).listen(PORT, () => {
  console.log(`Front proxy running → http://localhost:${PORT}`);
  console.log(`Forwarding to       → ${FRONT_BASE}`);
});
