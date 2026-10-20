#!/usr/bin/env python3
"""Turn results/*.json into the markdown tables used in REPORT.md.

Usage: python3 scripts/analyze.py > results/tables.md   (from spike/p10)
"""
import collections
import json
import os
import statistics

R = os.path.join(os.path.dirname(__file__), '..', 'results')


def load(name):
    p = os.path.join(R, name)
    return json.load(open(p)) if os.path.exists(p) else None


def kib(n):
    return f'{n / 1024:,.0f}'


def sizes():
    d = load('sizes.json')
    # what each build downloads in Chrome (from the verify run)
    first = {
        'js': ['main.dart.js', 'canvaskit/chromium/canvaskit.js', 'canvaskit/chromium/canvaskit.wasm'],
        'wasm': ['main.dart.mjs', 'main.dart.wasm', 'canvaskit/skwasm.js', 'canvaskit/skwasm.wasm'],
    }
    print('### Build output (KiB; gzip -9 / brotli -q 11)\n')
    print('| Item | JS raw | JS gzip | JS br | Wasm raw | Wasm gzip | Wasm br |')
    print('|---|---:|---:|---:|---:|---:|---:|')
    cats = collections.OrderedDict()
    for lab in ('js', 'wasm'):
        for f in d[lab]:
            c = cats.setdefault(f['category'], {}).setdefault(lab, [0, 0, 0])
            c[0] += f['raw']; c[1] += f['gzip']; c[2] += f['br']
    for cat in sorted(cats):
        row = [cat]
        for lab in ('js', 'wasm'):
            v = cats[cat].get(lab)
            row += [kib(x) for x in v] if v else ['-'] * 3
        print('| ' + ' | '.join(row) + ' |')
    for lab_name, pred in (('**Total deployed** (excl. symbols)', lambda f: 'symbols' not in f['category']),):
        row = [lab_name]
        for lab in ('js', 'wasm'):
            fs = [f for f in d[lab] if pred(f)]
            row += [kib(sum(f[k] for f in fs)) for k in ('raw', 'gzip', 'br')]
        print('| ' + ' | '.join(row) + ' |')
    print()
    print('### Critical files actually downloaded by Chrome (KiB)\n')
    print('| Build | File | raw | gzip | br |')
    print('|---|---|---:|---:|---:|')
    for lab in ('js', 'wasm'):
        byp = {f['path']: f for f in d[lab]}
        tot = [0, 0, 0]
        for p in first[lab]:
            f = byp[p]
            tot = [tot[0] + f['raw'], tot[1] + f['gzip'], tot[2] + f['br']]
            print(f"| {lab} | `{p}` | {kib(f['raw'])} | {kib(f['gzip'])} | {kib(f['br'])} |")
        print(f'| {lab} | **app + renderer** | **{kib(tot[0])}** | **{kib(tot[1])}** | **{kib(tot[2])}** |')
    print()


def bench():
    d = load('bench.json')
    if not d:
        return
    print(f"### Loading benchmarks ({d['chrome']}, {d['runs']} runs each; mean / worst, ms)\n")
    groups = collections.OrderedDict()
    for r in d['rows']:
        groups.setdefault((r['profile'], r['cache'], r['build']), []).append(r)
    metrics = [('ttfb', 'TTFB'), ('fcp', 'First paint (FCP)'), ('firstFrame', 'First Flutter frame'),
               ('tti', 'TTI'), ('total', 'Total load'), ('tbt', 'TBT'), ('longest', 'Longest task')]
    print('| Profile | Cache | Build | ' + ' | '.join(m[1] for m in metrics) + ' | Bytes (KiB) | Requests |')
    print('|---|---|---|' + '---:|' * (len(metrics) + 2))
    for (prof, cache, build), rows in groups.items():
        for r in rows:
            r['total'] = max(r['loaded'], r['tti'])
        cells = []
        for k, _ in metrics:
            xs = [r[k] for r in rows if r[k] is not None]
            cells.append(f'{statistics.mean(xs):,.0f} / {max(xs):,.0f}')
        b = statistics.mean(r['bytes'] for r in rows)
        print(f"| {prof} | {cache} | {build} | " + ' | '.join(cells) + f" | {kib(b)} | {rows[0]['requests']} |")
    print()


def transport():
    d = load('transport.json')
    if not d:
        return
    print(f"### WebTransport vs WebSocket ({d['chromium']}, {d['runs']} runs; mean / worst, ms)\n")
    g = collections.OrderedDict()
    for r in d['results']:
        g.setdefault((r['condition'], r['transport']), []).append(r)
    print('| Condition | Transport | Connect | First message | RTT p50 | RTT p95 | Datagram RTT p50 (lost) | Small msgs/s (64 B) | Large Mbit/s (16 KiB) |')
    print('|---|---|---:|---:|---:|---:|---:|---:|---:|')
    for (cond, t), rows in g.items():
        mw = lambda f: f'{statistics.mean(f(r) for r in rows):,.1f} / {max(f(r) for r in rows):,.1f}'
        dg = '-'
        if rows[0]['datagramRtt']:
            dg = f"{statistics.mean(r['datagramRtt']['p50'] for r in rows):,.1f} ({sum(r['datagramRtt']['lost'] for r in rows)}/{100 * len(rows)})"
        print(f"| {cond} | {t} | {mw(lambda r: r['connectMs'])} | {mw(lambda r: r['firstMessageMs'])} | "
              f"{mw(lambda r: r['rtt']['p50'])} | {mw(lambda r: r['rtt']['p95'])} | {dg} | "
              f"{statistics.mean(r['throughputSmall']['msgsPerSec'] for r in rows):,.0f} | "
              f"{statistics.mean(r['throughputLarge']['mbitPerSec'] for r in rows):,.1f} |")
    print()
    od = load('transport-outages.json') or d
    print(f"### Temporary network loss (4G profile, 100% packet loss both ways, {od.get('outageRuns', 1)} runs each, fresh browser context per test; mean / worst)\n")
    print('| Client connect timeout | Outage | Transport | Transport noticed? | Detected after | Reconnect took | First msg after network back | Pings sent during outage delivered later | Lost pings |')
    print('|---|---:|---|---|---:|---:|---:|---:|---:|')
    og = collections.OrderedDict()
    for o in od['outages']:
        og.setdefault((o.get('connectTimeoutMs', 3000), o['outageMs'], o['transport']), []).append(o)

    def mw(xs, unit=1000, suf=' s', fmt='{:,.1f}'):
        xs = [x for x in xs if x is not None]
        if not xs:
            return '-'
        return f'{fmt.format(statistics.mean(xs) / unit)} / {fmt.format(max(xs) / unit)}{suf}'

    for (cto, ms, t), os_ in sorted(og.items(), key=lambda kv: (kv[0][0] or 10**9, kv[0][1], kv[0][2])):
        closed = sum(o['connectionClosed'] for o in os_)
        rec = [sum(x['tookMs'] for x in o['reconnects']) for o in os_ if o['reconnects']]
        never = sum(o['firstMessageAfterRestoreMs'] is None for o in os_)
        fm = mw([o['firstMessageAfterRestoreMs'] for o in os_]) + (f' ({never} never)' if never else '')
        sent = sum(o['pingsSentDuringOutage'] for o in os_)
        later = sum(o['thoseDeliveredLater'] for o in os_)
        print(f"| {f'{cto / 1000:.0f} s' if cto else 'none'} | {ms / 1000:.0f} s | {t} | closed in {closed}/{len(os_)} | "
              f"{mw([o['closeDetectedAfterDropMs'] for o in os_])} | {mw(rec)} | {fm} | "
              f"{later}/{sent} | {sum(o['totalLost'] for o in os_)} |")
    print()


sizes()
bench()
transport()
