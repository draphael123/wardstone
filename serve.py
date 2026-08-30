#!/usr/bin/env python3
"""Dev server for WARDSTONE.

`python -m http.server` but with `Cache-Control: no-store` on everything.
Without it the browser serves a cached copy of a module you just edited and
you spend an hour debugging code that is no longer running.
"""
import sys
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5835


class NoStoreHandler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map['.js'] = 'text/javascript'
    extensions_map['.mjs'] = 'text/javascript'
    extensions_map['.wasm'] = 'application/wasm'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, fmt, *args):
        if len(args) > 1 and str(args[1]).startswith('2'):
            return
        SimpleHTTPRequestHandler.log_message(self, fmt, *args)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(('127.0.0.1', PORT), NoStoreHandler)
    print('WARDSTONE serving http://localhost:%d  (no-store)' % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
