const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const getPort = require('get-port');
const ffmpegPath = (() => {
  try { return require('ffmpeg-static'); } catch { return null; }
})();

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function extractParams(req) {
  const raw = (req.originalUrl || req.url || '').split('?')[1] || '';
  let url = null;
  let t = null;
  if (!raw) return { url, t };
  raw.split('&').forEach(part => {
    if (part.startsWith('url=')) url = decodeURIComponent(part.slice(4));
    if (part.startsWith('t=')) t = decodeURIComponent(part.slice(2));
  });
  return { url, t };
}

function proxyRequest(req, res, url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    res.status(400).json({ error: 'invalid_url' });
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
    res.status(upstreamRes.statusCode || 502);
    const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    passHeaders.forEach(h => {
      if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
    });
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => {
    res.status(502).json({ error: 'proxy_failed', message: err.message });
  });
  upstream.end();
}

async function startServer() {
  const app = express();
  const rootDir = path.join(__dirname, '..');
  app.use(express.static(rootDir));

  app.get('/api/video', (req, res) => {
    const { url } = extractParams(req);
    if (!url) return res.status(400).json({ error: 'missing_url' });
    proxyRequest(req, res, url);
  });

  app.get('/api/thumb', (req, res) => {
    if (!ffmpegPath) {
      return res.status(501).json({
        error: 'ffmpeg_not_found',
        message: 'ffmpeg is required on the server to generate thumbnails.',
      });
    }
    const { url, t } = extractParams(req);
    if (!url) return res.status(400).json({ error: 'missing_url' });

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
        res.status(502).json({ error: 'thumb_failed', message: stderr || 'ffmpeg failed' });
      }
    });
  });

  const port = await getPort({ port: [8787, 8788, 8789, 0] });
  await new Promise(resolve => app.listen(port, resolve));
  return port;
}

if (require.main === module) {
  startServer().then(port => {
    // eslint-disable-next-line no-console
    console.log(`VibedStudio server running at http://localhost:${port}`);
  });
}

module.exports = { startServer };
