# Post-build patches

`index.html` is a Vite build. Betfolio's redesign, screenshot import, saved
bets and live tracking are applied on top of that build. They live in
`slip.js`, `live.js`, `ocr/` and the patches below.

After rebuilding `index.html` from source, re-apply them before deploying:

```sh
python3 tools/apply_patches.py index.html index.html tools/theme.css <build-tag>
```

The script finds its anchors by pattern, not by minified names, so it survives
rebuilds. If an anchor is missing, it stops and names the patch that failed.
It never writes a half-patched file.
