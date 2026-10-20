#!/usr/bin/env python3
"""Size breakdown of a `flutter build web` output: raw, gzip -9 and brotli -q11.

Usage: sizes.py <label> <build/web dir> [<label> <dir> ...] > sizes.json
"""
import gzip, json, os, subprocess, sys


def category(rel):
    name = os.path.basename(rel)
    if name.endswith('.symbols'):
        return 'debug symbols (not downloaded)'
    if name.startswith('main.dart.'):
        return 'app code (' + name.split('.', 2)[2] + ')'
    if rel.startswith('canvaskit/'):
        return 'renderer: ' + (name.rsplit('.', 1)[0] if '/' not in rel[10:] else rel.split('/')[1] + '/')
    if name.endswith(('.otf', '.ttf', '.woff2')):
        return 'fonts'
    if rel.startswith('assets/'):
        return 'other assets'
    if rel.startswith('icons/') or name in ('favicon.png', 'manifest.json'):
        return 'icons/manifest'
    return 'bootstrap (index.html, flutter*.js, version.json)'


def brotli_size(path):
    return len(subprocess.run(['brotli', '-c', '-q', '11', path],
                              check=True, capture_output=True).stdout)


def measure(root):
    files = []
    for dirpath, _, names in os.walk(root):
        for n in names:
            if n.endswith(('.gz', '.br')) or n == 'SOURCE_TREE':
                continue  # precompressed copies / provenance written by deploy.sh
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, root)
            data = open(p, 'rb').read()
            files.append({'path': rel, 'category': category(rel), 'raw': len(data),
                          'gzip': len(gzip.compress(data, 9)), 'br': brotli_size(p)})
    return sorted(files, key=lambda f: f['path'])


out = {}
args = sys.argv[1:]
for label, root in zip(args[::2], args[1::2]):
    out[label] = measure(root)
json.dump(out, sys.stdout, indent=1)
