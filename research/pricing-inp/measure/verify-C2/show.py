import json, sys, collections
rows = [json.loads(l) for l in open(sys.argv[1])]
g = collections.defaultdict(list)
for d in rows:
    i = d['idle']; b = i['busyMsPerSec']
    bg, fq = d['bg'], d['faq']
    print(d['kind'].ljust(8), d['cond'].ljust(9), 'R', str(b.get('Renderer/CrRendererMain', 0)).rjust(4), 'G', str(b.get('GPU Process/CrGpuMain', 0)).rjust(4),
          'lay/s', i['countsPerSec'].get('Layout', 0), 'rast/s', i['countsPerSec'].get('RasterTask', 0),
          '| bg', bg.get('median'), bg.get('p75'), 'dly', bg.get('medDelay'), 'pres', bg.get('medPres'),
          '| faq', fq.get('median'), fq.get('p75'), 'dly', fq.get('medDelay'), 'pres', fq.get('medPres'), 'n', fq.get('n'))
    g[(d['kind'], d['cond'])].append(d)
print()
for (k, c), ds in sorted(g.items()):
    bgd = sorted(int(x) for d in ds for x in d['bg']['durs'].split(',') if x != '')
    fqd = sorted(int(x) for d in ds for x in d['faq']['durs'].split(',') if x != '')
    q = lambda v, p: v[min(len(v) - 1, int((len(v) - 1) * p + 0.5))] if v else None
    print(k.ljust(8), c.ljust(9), 'runs', len(ds), '| bg n', len(bgd), 'med', q(bgd, .5), 'p75', q(bgd, .75), 'p90', q(bgd, .9), '| faq n', len(fqd), 'med', q(fqd, .5), 'p75', q(fqd, .75), 'p90', q(fqd, .9))
