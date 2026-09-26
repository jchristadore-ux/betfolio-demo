#!/usr/bin/env python3
"""
Apply Betfolio's post-build patches to a fresh Vite build of index.html.

Every anchor is a regex that captures the minified identifiers, so this keeps
working when the app is rebuilt from source and all names change.

usage: apply_patches.py <index.html in> <index.html out> <theme.css> <build-tag>
"""
import re, sys

src, out, css_path, BUILD = sys.argv[1:5]
s = open(src, encoding="utf-8").read()
report = []


def sub1(name, pattern, repl, flags=0, count=1):
    """Replace exactly `count` matches of pattern (repl may be a function)."""
    global s
    ms = list(re.finditer(pattern, s, flags))
    if len(ms) != count:
        raise SystemExit(f"PATCH FAILED [{name}]: expected {count} match(es), found {len(ms)}")
    s = re.sub(pattern, repl, s, count=0, flags=flags)
    report.append(name)


def lit(name, old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f"PATCH FAILED [{name}]: expected {count}, found {n}: {old[:70]!r}")
    s = s.replace(old, new)
    report.append(name)


def cap(pattern, group=1, flags=0):
    m = re.search(pattern, s, flags)
    if not m:
        raise SystemExit(f"ANCHOR NOT FOUND: {pattern[:80]}")
    return m.group(group)


# ------------------------------------------------------------ identifiers
OCR_ERR = cap(r'class (\w+) extends Error\{constructor\(\w,\w\)\{super\(\w,\w\),this\.name="OcrError"')
STORE = cap(r'(\w+)=\w+\(\)\(\w=>\(\{bets:\[\],demoMode:!0,')
CONN_DEFAULT = cap(r'demoMode:!0,demoLive:!1,overlay:\w+,filters:\w+,connections:(\w+),slipImages')
WORKER_CACHE = cap(r'return (\w+)\|\|\(\w+="warming",\1=')

# ------------------------------------------------------------ head / design
css = open(css_path, encoding="utf-8").read()
css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
css = "\n".join(l for l in css.splitlines() if l.strip())
sub1("stylesheet", r'(<style rel="stylesheet" crossorigin>)(.*?)(</style>)', lambda m: m.group(1) + css + m.group(3), re.S)
lit("theme-color", '<meta name="theme-color" content="#0a0e17" />', '<meta name="theme-color" content="#000000" />')
sub1("description", r'<meta name="description" content="[^"]*" />',
     '<meta name="description" content="Betfolio \u2014 your live betting portfolio. Total exposure and potential reward, updating as games play out." />')
sub1("title", r'<title>[^<]*</title>',
     '<title>Betfolio \u2014 Live Betting Portfolio</title>\n'
     f'    <script src="./slip.js?v={BUILD}"></script>')
lit("live.js", "  </head>", f'    <script defer src="./live.js?v={BUILD}"></script>\n  </head>')

# ------------------------------------------------------------ OCR engine
sub1("ocr worker: self-hosted + PSM 3",
     r'return await (\w+)\.createWorker\("eng"\)',
     lambda m: 'const B=new URL("./ocr/",location.href).href;const W=await ' + m.group(1) +
     '.createWorker("eng",1,{workerPath:B+"worker.min.js",corePath:B,langPath:B,workerBlobURL:!1});'
     'try{await W.setParameters({tessedit_pageseg_mode:"3",preserve_interword_spaces:"1"})}catch{}return W')
sub1("ocr recognize: prep + blocks + page capture",
     r'const (\w)=await (\w)\.recognize\((\w)\.dataUrl\);(\w)=\1==null\?void 0:\1\.data',
     lambda m: f'const {m.group(1)}=await {m.group(2)}.recognize(await window.__bfPrep({m.group(3)}.dataUrl),{{}},{{text:!0,blocks:!0}});'
     f'{m.group(4)}={m.group(1)}==null?void 0:{m.group(1)}.data;'
     f'{m.group(4)}&&!({m.group(4)}.lines&&{m.group(4)}.lines.length)&&({m.group(4)}.lines=window.__bfLines({m.group(4)})),'
     f'{m.group(4)}&&window.__bfAddPage&&window.__bfAddPage({m.group(4)})')
sub1("ocr failure resets worker", r'catch\((\w)\)\{throw new (\w+)\("OCR failed',
     lambda m: f'catch({m.group(1)}){{{WORKER_CACHE}=null;throw new {m.group(2)}("OCR failed')
sub1("ocr unicode minus", r'(\w)=\((\w)\.text\?\?(\w)\.map\((\w)=>\4\.text\)\.join\(" "\)\)\.trim\(\)',
     lambda m: f'{m.group(1)}=({m.group(2)}.text??{m.group(3)}.map({m.group(4)}=>{m.group(4)}.text).join(" ")).replace(/[\\u2212\\u2013\\u2014](?=\\d)/g,"-").trim()')
sub1("parse: reset pages",
     r'(async parse\((\w),(\w)\)\{if\(\2\.length===0\)throw new \w+\("No images provided[^"]*"\);const (\w)=\[\];)',
     lambda m: m.group(1) + 'window.__bfPages=[];')
sub1("parse: structured reader", r'(\.push\(\.\.\.\w\)\}return )(\w+)\((\w)\)\}\}',
     lambda m: f'{m.group(1)}window.__bfFinal({m.group(2)}({m.group(3)}),{m.group(3)})}}}}')
sub1("parser: payout labels",
     r'/\\b\(to win\|potential payout\|total payout\|payout\|returns\?\|you win\|to return\|total return\)\\b/i',
     r'/\\b(to win|to pay|potential payout|total payout|payout|potential win(?:nings)?|returns?|you win|to return|total return)\\b/i')
sub1("parser: wager labels", r'/\\b\(wager\|stake\|risk\(\?:ed\)\?\|bet amount\|total bet\)\\b/i',
     r'/\\b(wager|stake|risk(?:ed)?|bet amount|total bet|total wager)\\b/i')

# ------------------------------------------------------------ upload rules
sub1("upload: 12 screenshots, 30 MB", r'const (\w+)=5,(\w+)=4\*1024\*1024',
     lambda m: f'const {m.group(1)}=12,{m.group(2)}=30*1024*1024')
sub1("upload: accept by extension", r'(\w+)\.type\.startsWith\("image/"\)&&\1\.size<=(\w+)',
     lambda m: f'({m.group(1)}.type.startsWith("image/")||/\\.(png|jpe?g|webp|heic|heif|gif|bmp)$/i.test({m.group(1)}.name||""))&&{m.group(1)}.size<={m.group(2)}')
lit("upload: cap text", "under 4 MB", "under 30 MB")
lit("upload: cap text 2", "over the 4 MB limit", "over the 30 MB limit")
sub1("upload: HEIC message", r'new Error\("Could not read that image file\."\)',
     f'new {OCR_ERR}("Could not open that image. If it is a HEIC photo, take a regular screenshot (PNG or JPEG) and upload that instead.")')
sub1("upload: show error cause",
     r'(\w)\((\w+) instanceof (\w+)\?\2\.message:"Something went wrong reading that screenshot\. Try again\."\)',
     lambda m: f'{m.group(1)}(({m.group(2)} instanceof {m.group(3)}?{m.group(2)}.message:"Something went wrong reading that screenshot. Try again.")+window.__bfWhy({m.group(2)}))',
     count=2)
sub1("upload: hint", r"Screenshots stay on this device \u2014 they're stored in the app only and never uploaded anywhere\.",
     f"Long parlay? Select every screenshot of the slip at once (up to 12). Screenshots are read on this device and never uploaded. Build {BUILD}.")

# ------------------------------------------------------------ data: no demo, persistence
lit("no demo by default", "demoMode:!0,demoLive:!1", "demoMode:!1,demoLive:!1")
sub1("persist + expose store", r'(resetFilters:\(\)=>\w\(\{filters:\w+\}\)\}\)\);)',
     lambda m: m.group(1) + '(()=>{const K="betfolio:state:v1";try{const r=localStorage.getItem(K);if(r){const j=JSON.parse(r);'
     f'{STORE}.setState({{bets:Array.isArray(j.bets)?j.bets.filter(b=>b&&!String(b.id).startsWith("demo-")):[],demoMode:!1,connections:{CONN_DEFAULT}}}),'
     f'localStorage.setItem(K,JSON.stringify({{bets:{STORE}.getState().bets,demoMode:!1,connections:{CONN_DEFAULT}}}))}}}}catch{{}}'
     f'let t=0;{STORE}.subscribe(st=>{{clearTimeout(t),t=setTimeout(()=>{{try{{localStorage.setItem(K,JSON.stringify({{bets:st.bets,demoMode:st.demoMode,connections:st.connections}}))}}catch{{}}}},300)}}),'
     f'window.__bfStore={STORE};try{{window.dispatchEvent(new Event("bf:store"))}}catch{{}}}})();')
sub1("home: hide demo live toggle", r'(\w+)\.jsx\("button",\{type:"button",className:`sc-btn sc-btn-sm \$\{(\w)\?"sc-btn-primary":"sc-btn-secondary"\}`',
     lambda m: f'{STORE}.getState().demoMode&&' + m.group(0))
lit("home: empty text", "Turn on Demo Live Mode to simulate live action, or check your slips for upcoming games.",
    "Bets show up here once their games go live. Your upcoming slips are in Slips.")
sub1("live: hide demo notice", r'!(\w)&&(\w)\.length===0&&(\w+)\.jsxs\("div",\{className:"sc-notice sc-mb"',
     lambda m: f'{STORE}.getState().demoMode&&' + m.group(0))
sub1("sportsbooks: copy", r' password \u2014 see docs/INTEGRATIONS\.md for the full picture\. Demo mode is available now\."',
     ' password. Use screenshot import to add your slips."')
sub1("review: default no-match game",
     r'const (\w)=(\w)\.eventCandidates\[0\];return \1&&\1\.confidence>=\.7\?\1\.gameId:void 0',
     lambda m: f'const {m.group(1)}={m.group(2)}.eventCandidates[0];return {m.group(1)}?{m.group(1)}.confidence>=.7?{m.group(1)}.gameId:void 0:"none"')
sub1("bet keeps slip text",
     r'source:(\w)\.source,(?=screenshotIds:\[\.\.\.\1\.imageIds\])|source:"screenshot",(?=screenshotIds:\[\.\.\.(\w)\.imageIds\])',
     lambda m: m.group(0) + (f'sourceText:({m.group(1)}.source==="screenshot"?window.__bfCtxText:"")||"",' if m.group(1) else 'sourceText:window.__bfCtxText||"",'))

open(out, "w", encoding="utf-8").write(s)
print(f"{len(report)} patches applied:")
for r in report:
    print("  \u2713", r)
