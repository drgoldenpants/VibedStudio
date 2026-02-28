#!/usr/bin/env python3
"""
Minimal CORS-aware dev server for VibedStudio.
Run: python3 server.py
Then open: http://localhost:8080
"""
import http.server, socketserver, os, sys, json, urllib.request, urllib.error, urllib.parse, tempfile, subprocess, shutil

PORT = 8787
IMAGE_PROXY_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations'

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/video'):
            self.handle_video_proxy()
            return
        return super().do_GET()
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/image':
            self.handle_image_proxy()
            return
        if self.path == '/api/export':
            self.handle_export()
            return

        if self.path != '/api/image':
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Not found'}).encode('utf-8'))
            return
        # Unreachable, but keep for clarity
        return

    def handle_image_proxy(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        req = urllib.request.Request(IMAGE_PROXY_URL, data=body, method='POST')
        content_type = self.headers.get('Content-Type') or 'application/json'
        req.add_header('Content-Type', content_type)
        auth = self.headers.get('Authorization')
        if auth:
            req.add_header('Authorization', auth)
        accept = self.headers.get('Accept')
        if accept:
            req.add_header('Accept', accept)

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
                self.send_response(resp.status)
                ct = resp.headers.get('Content-Type')
                if ct:
                    self.send_header('Content-Type', ct)
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            ct = e.headers.get('Content-Type')
            if ct:
                self.send_header('Content-Type', ct)
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'Bad gateway',
                'message': str(e),
            }).encode('utf-8'))

    def handle_export(self):
        if shutil.which('ffmpeg') is None:
            self.send_response(501)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'ffmpeg_not_found',
                'message': 'ffmpeg is required on the server to export MP4.',
            }).encode('utf-8'))
            return

        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'empty_body'}).encode('utf-8'))
            return

        body = self.rfile.read(length)
        in_fd, in_path = tempfile.mkstemp(suffix='.webm')
        out_fd, out_path = tempfile.mkstemp(suffix='.mp4')
        os.close(in_fd)
        os.close(out_fd)
        try:
            with open(in_path, 'wb') as f:
                f.write(body)

            cmd = [
                'ffmpeg', '-y', '-i', in_path,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                '-c:a', 'aac', '-b:a', '128k',
                out_path
            ]
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
            if proc.returncode != 0 or not os.path.exists(out_path):
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': 'ffmpeg_failed',
                    'message': proc.stderr.decode('utf-8', 'ignore')[-2000:],
                }).encode('utf-8'))
                return

            with open(out_path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except subprocess.TimeoutExpired:
            self.send_response(504)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'ffmpeg_timeout',
                'message': 'ffmpeg timed out while converting the video.',
            }).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'export_failed',
                'message': str(e),
            }).encode('utf-8'))
        finally:
            try:
                os.remove(in_path)
            except Exception:
                pass
            try:
                os.remove(out_path)
            except Exception:
                pass

    def handle_video_proxy(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        url = qs.get('url', [None])[0]
        if not url:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'missing_url'}).encode('utf-8'))
            return
        try:
            target = urllib.parse.urlparse(url)
            if target.scheme not in ('http', 'https'):
                raise ValueError('invalid_url')
        except Exception:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'invalid_url'}).encode('utf-8'))
            return

        req = urllib.request.Request(url, method='GET')
        range_hdr = self.headers.get('Range')
        if range_hdr:
            req.add_header('Range', range_hdr)

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                self.send_response(resp.status)
                ct = resp.headers.get('Content-Type')
                if ct:
                    self.send_header('Content-Type', ct)
                cl = resp.headers.get('Content-Length')
                if cl:
                    self.send_header('Content-Length', cl)
                cr = resp.headers.get('Content-Range')
                if cr:
                    self.send_header('Content-Range', cr)
                ar = resp.headers.get('Accept-Ranges')
                if ar:
                    self.send_header('Accept-Ranges', ar)
                self.end_headers()
                shutil.copyfileobj(resp, self.wfile)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            ct = e.headers.get('Content-Type')
            if ct:
                self.send_header('Content-Type', ct)
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'proxy_failed',
                'message': str(e),
            }).encode('utf-8'))

    def log_message(self, fmt, *args):
        pass  # suppress request noise

os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'\n  VibedStudio dev server running at:')
    print(f'  \033[1;36mhttp://localhost:{PORT}\033[0m\n')
    print(f'  Open that URL in your browser (not file://)\n')
    print(f'  Press Ctrl+C to stop.\n')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')
        sys.exit(0)
