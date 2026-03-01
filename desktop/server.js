import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { spawn } from 'child_process';
import net from 'net';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let ffmpegPathPromise = null;
function getFfmpegPath() {
  if (ffmpegPathPromise) return ffmpegPathPromise;
  ffmpegPathPromise = (async () => {
    try {
      const mod = await import('ffmpeg-static');
      return mod.default || mod;
    } catch {
      return null;
    }
  })();
  return ffmpegPathPromise;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

function proxyRequest(req, res, url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    sendJson(res, 400, { error: 'invalid_url' });
    return;
  }
  const client = target.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = client.request(target, { headers }, upstreamRes => {
    res.statusCode = upstreamRes.statusCode || 502;
    const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    passHeaders.forEach(h => {
      if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
    });
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => {
    sendJson(res, 502, { error: 'proxy_failed', message: err.message });
  });
  upstream.end();
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    default: return 'application/octet-stream';
  }
}

function serveStatic(req, res, rootDir, urlPath) {
  let safePath = urlPath;
  try {
    safePath = decodeURIComponent(urlPath);
  } catch {
    sendJson(res, 400, { error: 'bad_path' });
    return;
  }

  const relPath = safePath === '/' ? '/index.html' : safePath;
  const fsPath = path.normalize(path.join(rootDir, relPath));
  if (!fsPath.startsWith(rootDir)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  fs.stat(fsPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', getMimeType(fsPath));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(fsPath);
    stream.on('error', () => {
      res.statusCode = 500;
      res.end('Read Error');
    });
    stream.pipe(res);
  });
}

function checkPort(port) {
  return new Promise(resolve => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

async function findOpenPort(candidates) {
  for (const port of candidates) {
    if (port === 0) return 0;
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkPort(port);
    if (ok) return port;
  }
  return 0;
}

async function startServer() {
  const rootDir = path.join(__dirname, '..');
  let ffmpegPath = await getFfmpegPath();
  if (ffmpegPath && ffmpegPath.includes('app.asar')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
  const server = http.createServer((req, res) => {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    const parsed = new URL(req.url || '/', 'http://localhost');
    if (parsed.pathname === '/api/video') {
      const url = parsed.searchParams.get('url');
      if (!url) return sendJson(res, 400, { error: 'missing_url' });
      proxyRequest(req, res, url);
      return;
    }

    if (parsed.pathname === '/api/thumb') {
      if (!ffmpegPath) {
        return sendJson(res, 501, {
          error: 'ffmpeg_not_found',
          message: 'ffmpeg is required on the server to generate thumbnails.',
        });
      }
      const url = parsed.searchParams.get('url');
      const t = parsed.searchParams.get('t');
      if (!url) return sendJson(res, 400, { error: 'missing_url' });

      const seek = Number.isFinite(Number(t)) ? Math.max(0.05, Number(t)) : 0.1;
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-user_agent', USER_AGENT,
        '-ss', String(seek),
        '-i', url,
        '-frames:v', '1',
        '-f', 'image2',
        '-vcodec', 'png',
        'pipe:1',
      ];
      const ff = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = [];
      let stderr = '';
      ff.stdout.on('data', chunk => chunks.push(chunk));
      ff.stderr.on('data', chunk => { stderr += chunk.toString(); });
      ff.on('close', code => {
        if (code === 0 && chunks.length) {
          const buf = Buffer.concat(chunks);
          res.setHeader('Content-Type', 'image/png');
          res.end(buf);
        } else {
          sendJson(res, 502, { error: 'thumb_failed', message: stderr || 'ffmpeg failed' });
        }
      });
      return;
    }

    serveStatic(req, res, rootDir, parsed.pathname);
  });

  const port = await findOpenPort([8787, 8788, 8789, 0]);
  await new Promise(resolve => server.listen(port, resolve));
  return port;
}

if (process.argv[1] && process.argv[1] === __filename) {
  startServer().then(port => {
    // eslint-disable-next-line no-console
    console.log(`VibedStudio server running at http://localhost:${port}`);
  });
}

export { startServer };
