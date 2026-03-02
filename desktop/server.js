import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { spawn } from 'child_process';
import net from 'net';
import os from 'os';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_PATH = path.join(os.homedir(), 'Library', 'Logs', 'VibedStudio.log');

function log(message) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
  }
}

const FFMPEG_RELEASE = 'b6.1.1';
const FFMPEG_BINARIES_URL = process.env.FFMPEG_BINARIES_URL
  || 'https://github.com/eugeneware/ffmpeg-static/releases/download';
let ffmpegPathPromise = null;

function getFfmpegCacheDir() {
  return path.join(os.homedir(), '.vibedstudio', 'ffmpeg');
}

function getFfmpegBinaryPath() {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(getFfmpegCacheDir(), `ffmpeg${ext}`);
}

function getFfmpegDownloadUrl() {
  const platform = process.platform;
  const arch = process.arch;
  return `${FFMPEG_BINARIES_URL}/${FFMPEG_RELEASE}/ffmpeg-${platform}-${arch}.gz`;
}

async function downloadFfmpegBinary() {
  const destPath = getFfmpegBinaryPath();
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.download`;
  const url = getFfmpegDownloadUrl();

  await new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (!res || res.statusCode !== 200) {
        res?.resume();
        reject(new Error(`Failed to download ffmpeg (${res?.statusCode || 'no response'})`));
        return;
      }
      pipeline(res, createGunzip(), fs.createWriteStream(tmpPath))
        .then(resolve)
        .catch(reject);
    });
    req.on('error', reject);
  });

  await fs.promises.rename(tmpPath, destPath);
  if (process.platform !== 'win32') {
    await fs.promises.chmod(destPath, 0o755);
  }
  return destPath;
}

async function ensureFfmpeg({ allowDownload }) {
  if (ffmpegPathPromise) return ffmpegPathPromise;
  ffmpegPathPromise = (async () => {
    const binPath = getFfmpegBinaryPath();
    try {
      await fs.promises.access(binPath, fs.constants.X_OK);
      return binPath;
    } catch {
      if (!allowDownload) return null;
      return await downloadFfmpegBinary();
    }
  })();
  return ffmpegPathPromise;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const ARK_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sanitizeProjectName(name) {
  const base = String(name || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safe = base || `vibedstudio-${Date.now()}`;
  return safe.endsWith('.svs') ? safe : `${safe}.svs`;
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

function proxyArk(req, res, parsed) {
  const tail = parsed.pathname.replace(/^\/api\/ark/, '');
  const targetUrl = new URL(ARK_BASE_URL + (tail.startsWith('/') ? tail : `/${tail}`));
  parsed.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': req.headers.accept || 'application/json',
    'Accept-Encoding': 'identity',
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;

  const upstream = https.request(targetUrl, { method: req.method, headers }, upstreamRes => {
    res.statusCode = upstreamRes.statusCode || 502;
    const passHeaders = ['content-type'];
    passHeaders.forEach(h => {
      if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
    });
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => {
    sendJson(res, 502, { error: 'proxy_failed', message: err.message });
  });
  if (req.method === 'GET' || req.method === 'HEAD') {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
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

async function handleExportRequest(req, res) {
  const ffmpegPath = await ensureFfmpeg({ allowDownload: true });
  if (!ffmpegPath) {
    return sendJson(res, 501, {
      error: 'ffmpeg_not_found',
      message: 'ffmpeg is required on the server to export MP4.',
    });
  }

  const tmpDir = path.join(getFfmpegCacheDir(), 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const stamp = Date.now();
  const inputPath = path.join(tmpDir, `export-${stamp}.webm`);
  const outputPath = path.join(tmpDir, `export-${stamp}.mp4`);

  const writeStream = fs.createWriteStream(inputPath);
  req.pipe(writeStream);
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    req.on('error', reject);
  });

  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', 'faststart',
      outputPath,
    ];
    const ff = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', chunk => { stderr += chunk.toString(); });
    ff.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || 'ffmpeg failed'));
    });
    ff.on('error', reject);
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'video/mp4');
  const stream = fs.createReadStream(outputPath);
  stream.on('close', async () => {
    await fs.promises.unlink(inputPath).catch(() => {});
    await fs.promises.unlink(outputPath).catch(() => {});
  });
  stream.pipe(res);
}

async function handleProjectSave(req, res, rootDir) {
  try {
    const body = await readBody(req);
    const payload = JSON.parse(body.toString('utf-8'));
    const project = payload?.project ?? payload;
    if (!project || typeof project !== 'object') {
      sendJson(res, 400, { error: 'missing_project' });
      return;
    }
    const name = sanitizeProjectName(payload?.name);
    const dir = path.join(rootDir, 'projects');
    await fs.promises.mkdir(dir, { recursive: true });
    const data = Buffer.from(JSON.stringify(project));
    const packed = zlib.gzipSync(data);
    await fs.promises.writeFile(path.join(dir, name), packed);
    sendJson(res, 200, { ok: true, name });
  } catch (err) {
    sendJson(res, 500, { error: 'save_failed', message: err?.message || String(err) });
  }
}

async function handleProjectList(req, res, rootDir) {
  try {
    const dir = path.join(rootDir, 'projects');
    await fs.promises.mkdir(dir, { recursive: true });
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const projects = await Promise.all(entries
      .filter(ent => ent.isFile() && ent.name.endsWith('.svs'))
      .map(async ent => {
        const stat = await fs.promises.stat(path.join(dir, ent.name));
        return { name: ent.name, size: stat.size, mtime: stat.mtimeMs };
      }));
    projects.sort((a, b) => b.mtime - a.mtime);
    sendJson(res, 200, { projects });
  } catch (err) {
    sendJson(res, 500, { error: 'list_failed', message: err?.message || String(err) });
  }
}

async function handleProjectLoad(req, res, rootDir, parsed) {
  try {
    const name = sanitizeProjectName(parsed.searchParams.get('name') || '');
    const dir = path.join(rootDir, 'projects');
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const packed = await fs.promises.readFile(filePath);
    const data = zlib.gunzipSync(packed);
    const project = JSON.parse(data.toString('utf-8'));
    sendJson(res, 200, project);
  } catch (err) {
    sendJson(res, 500, { error: 'load_failed', message: err?.message || String(err) });
  }
}

async function startServer() {
  const rootDir = path.join(__dirname, '..');
  log(`Server starting, rootDir=${rootDir}`);
  const server = http.createServer((req, res) => {
    const method = req.method || 'GET';
    const parsed = new URL(req.url || '/', 'http://localhost');

    if (parsed.pathname.startsWith('/api/ark/')) {
      if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }
      proxyArk(req, res, parsed);
      return;
    }

    if (parsed.pathname === '/api/export') {
      if (method !== 'POST') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }
      handleExportRequest(req, res).catch(err => {
        sendJson(res, 502, { error: 'ffmpeg_failed', message: err.message });
      });
      return;
    }

    if (parsed.pathname === '/api/project/save') {
      if (method !== 'POST') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }
      handleProjectSave(req, res, rootDir);
      return;
    }

    if (parsed.pathname === '/api/project/list') {
      if (method !== 'GET') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }
      handleProjectList(req, res, rootDir);
      return;
    }

    if (parsed.pathname === '/api/project/load') {
      if (method !== 'GET') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }
      handleProjectLoad(req, res, rootDir, parsed);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    if (parsed.pathname === '/api/video') {
      const url = parsed.searchParams.get('url');
      if (!url) return sendJson(res, 400, { error: 'missing_url' });
      proxyRequest(req, res, url);
      return;
    }

    if (parsed.pathname === '/api/thumb') {
      ensureFfmpeg({ allowDownload: false }).then(ffmpegPath => {
        if (!ffmpegPath) {
          sendJson(res, 501, {
            error: 'ffmpeg_not_found',
            message: 'ffmpeg is required on the server to generate thumbnails.',
          });
          return;
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
      }).catch(err => {
        sendJson(res, 502, { error: 'thumb_failed', message: err.message });
      });
      return;
    }

    serveStatic(req, res, rootDir, parsed.pathname);
  });
  server.on('error', err => {
    log(`Server error: ${err?.stack || err}`);
  });

  const port = await findOpenPort([8787, 8788, 8789, 0]);
  await new Promise(resolve => server.listen(port, resolve));
  log(`Server listening on ${port}`);
  return port;
}

if (process.argv[1] && process.argv[1] === __filename) {
  startServer().then(port => {
    // eslint-disable-next-line no-console
    console.log(`VibedStudio server running at http://localhost:${port}`);
  });
}

export { startServer };
