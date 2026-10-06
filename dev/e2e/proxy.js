// Dev proxy for the browser test (MAMP is gone): static files from <desertbandit dir> and /api.php forwarded to a PHP dev server.
//   node dev/e2e/proxy.js <desertbandit dir> <php port> <port>
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.argv[2], PHP_PORT = parseInt(process.argv[3], 10), PORT = parseInt(process.argv[4], 10);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api.php') {
    const p = http.request({ host: '127.0.0.1', port: PHP_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(p);
    return;
  }
  let f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(b);
  });
}).listen(PORT, '127.0.0.1', () => console.log('proxy on', PORT));
