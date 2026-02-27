#!/usr/bin/env python3
"""
Minimal CORS-aware dev server for VibedStudio.
Run: python3 server.py
Then open: http://localhost:8080
"""
import http.server, socketserver, os, sys, json, urllib.request, urllib.error

PORT = 8787
IMAGE_PROXY_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations'

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path != '/api/image':
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Not found'}).encode('utf-8'))
            return

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
