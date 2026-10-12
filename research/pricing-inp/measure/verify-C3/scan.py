import re,sys,glob,os
pats={
 'MO_depless_href': r'new MutationObserver\(function\(\)\{location\.href!==',
 'MO_any': r'new MutationObserver',
 'timeSpent_interval_setState': r'sessionStorage\.setItem\("timeSpent"',
 'hist_patch_w(popstate+__orig)': r'history\.pushState\.__orig',
 'hist_patch_i': r'history\.replaceState=function\(\.\.\.p\)\{u\.apply\(history,p\),i\(window\.location\.href\)\}',
 'Tft_crawl_patch': r'setTimeout\(\w+,200\)\};return history\.pushState=function',
 'crawlDomLinks': r'crawlDomLinks',
 'WidgetAssist': r'WidgetAssist',
 'NetworkInterceptor': r'Network interceptor',
 'ConsoleInterceptor': r'Console interceptor',
}
d=sys.argv[1]
for f in sorted(glob.glob(os.path.join(d,'*.txt'))):
    s=open(f,encoding='utf-8',errors='replace').read()
    row={k:len(re.findall(v,s)) for k,v in pats.items()}
    print(os.path.basename(f)[:14], len(s), ' '.join(f'{k}={v}' for k,v in row.items()))
