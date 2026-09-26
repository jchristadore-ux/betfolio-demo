/* Betfolio slip import helpers: image prep, tesseract.js v7 output, slip parsing. */
(function (root) {
  "use strict";
  // Normalize a screenshot for OCR (width 1100-1800px, grayscale, dark mode inverted,
  // contrast boosted) and keep the untouched luminance for text-brightness checks.
  root.__bfPrep = async function (u) {
    try {
      var img = await new Promise(function (r, j) { var i = new Image(); i.onload = function () { r(i); }; i.onerror = j; i.src = u; });
      var w = img.naturalWidth, h = img.naturalHeight, k = w < 1100 ? 1100 / w : (w > 1800 ? 1800 / w : 1);
      w = Math.round(w * k); h = Math.round(h * k);
      var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      var x = cv.getContext("2d", { willReadFrequently: true });
      x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h), p = d.data, n = 0, dark = 0, q, lum = new Uint8ClampedArray(w * h);
      for (q = 0; q < p.length; q += 4) {
        var l = 0.299 * p[q] + 0.587 * p[q + 1] + 0.114 * p[q + 2];
        lum[q >> 2] = l; p[q] = l;
        if (((q >> 2) & 7) === 0) { n++; if (l < 128) dark++; }
      }
      root.__bfLum = { w: w, h: h, lum: lum };
      var inv = dark / n > 0.5;
      for (q = 0; q < p.length; q += 4) {
        var v = p[q]; if (inv) v = 255 - v;
        v = (v - 128) * 1.3 + 128; v = v < 0 ? 0 : v > 255 ? 255 : v;
        p[q] = p[q + 1] = p[q + 2] = v;
      }
      x.putImageData(d, 0, 0);
      return cv.toDataURL("image/png");
    } catch (e) { root.__bfLum = null; return u; }
  };
  root.__bfWhy = function (e) {
    try {
      var c = e && e.cause !== void 0 ? e.cause : (e && e.name !== "OcrError" ? e : null);
      if (c == null) return "";
      var m = typeof c === "string" ? c : (c.message || String(c));
      return m ? " [" + String(m).slice(0, 160) + "]" : "";
    } catch (x) { return ""; }
  };
  root.__bfLines = function (d) {
    var o = [];
    (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (pa) { (pa.lines || []).forEach(function (l) { o.push(l); }); }); });
    if (o.length) return o;
    return String(d.text || "").split(/\n/).map(function (t) { return { text: t, words: [{ text: t, confidence: d.confidence }] }; });
  };
})(window);

/* Betfolio slip fix-ups: runs after the base parser on the OCR lines. */
window.__bfFix = function (r, lines) {
  try {
    var T = lines.map(function (l) { return String(l.text || "").trim(); }).filter(Boolean);
    var all = T.join("\n"); window.__bfCtxText = all;
    var drop = function (re) { r.issues = (r.issues || []).filter(function (m) { return !re.test(m); }); };
    var money = function (s) { var out = [], re = /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g, m; while ((m = re.exec(s))) out.push(parseFloat(m[1].replace(/,/g, ""))); return out; };

    /* 1. wager / payout laid out as a row of labels over a row of amounts */
    var WAGER = /\b(wager|stake|risk(?:ed)?|bet amount|total wager|total bet|fan\s?cash|bonus bet|free bet|site credit)\b/i;
    var PAY = /\b(to pay|to win|payout|potential payout|total payout|potential win(?:nings)?|returns?|to return)\b/i;
    var LABEL = /\b(wager|stake|risk(?:ed)?|bet amount|total wager|total bet|fan\s?cash|bonus bet|free bet|site credit|to pay|to win|potential payout|total payout|payout|potential win(?:nings)?|returns?|to return)\b/gi;
    for (var i = 0; i < T.length; i++) {
      var labels = T[i].match(LABEL);
      if (!labels || labels.length < 2 || money(T[i]).length) continue;
      var amts = null;
      for (var j = i + 1; j <= i + 2 && j < T.length; j++) { var a = money(T[j]); if (a.length) { amts = a; break; } }
      if (!amts || amts.length !== labels.length) continue;
      labels.forEach(function (lb, k) {
        var f = { value: amts[k], confidence: 0.92, raw: "$" + amts[k].toFixed(2) };
        if (WAGER.test(lb)) r.wager = f; else if (PAY.test(lb)) r.potentialPayout = f;
      });
      break;
    }
    if (r.wager && r.wager.value != null) drop(/^Wager amount not found/);
    if (r.potentialPayout && r.potentialPayout.value != null) drop(/^Potential payout not found/);

    /* 2. legs: drop market descriptors and matchup lines, keep real selections */
    var MARKET = /^(spread|point spread|alt(?:ernate)? spread|moneyline|money line|ml|total|totals|total points|game total|run line|puck line|over\/under|o\/u|player [a-z ]+|[a-z ]+ o\/u|to win|1st half [a-z ]+|1st quarter [a-z ]+)$/i;
    var MATCH = /^(.{3,60}?)\s+(?:at|@|vs\.?)\s+(.{3,60})$/i;
    var HEADER = /^\s*(\d+\s*[- ]?(?:leg|pick|team)s?\s+(?:parlay|sgp|same game parlay)|(?:same[- ]game\s+)?parlay|sgp\+?)\b/i;
    var NOISE = /(1-800|gambler|must be 21|bet id|fanatics sportsbook|draftkings|fanduel|cash out|share|\bid:)/i;
    var SEL = /([A-Za-z][A-Za-z .'&-]{2,}\s[+-]\d+(?:\.\d+)?\s*$)|(\b(over|under)\s+\d+(?:\.\d+)?\b)|([A-Za-z][A-Za-z .'&-]{2,}\s(moneyline|ml)\b)|([A-Za-z][A-Za-z .'&-]{2,}\s[+-]\d{3,4}\s*$)/i;
    var isJunk = function (s) { s = s.trim(); return !s || MARKET.test(s) || (MATCH.test(s) && !/[+-]\d/.test(s)) || HEADER.test(s) || NOISE.test(s) || /^\$/.test(s) || /^[+-]\d+$/.test(s); };
    var legs = (r.legs || []).filter(function (l) { return !isJunk(l.selection); });
    var seen = {}; legs.forEach(function (l) { seen[l.selection.toLowerCase()] = 1; });
    T.forEach(function (t) {
      if (isJunk(t) || !SEL.test(t) || t.length > 90 || seen[t.toLowerCase()]) return;
      var ln = lines.find(function (l) { return String(l.text).trim() === t; });
      legs.push({ selection: t, confidence: Math.min(0.9, (ln && ln.confidence) || 0.8), odds: (t.match(/[+-]\d{3,4}\b/) || [null])[0] });
      seen[t.toLowerCase()] = 1;
    });
    var order = function (s) { var k = T.indexOf(s); return k < 0 ? 1e9 : k; };
    legs.sort(function (a, b) { return order(a.selection) - order(b.selection); });
    var isParlay = r.betType && /parlay/.test(r.betType.value || "");
    if (!isParlay && legs.length > 1) legs = legs.slice(0, 1);
    if (legs.length) {
      r.legs = legs.slice(0, 15);
      drop(/^Leg \d+ \(/); drop(/^Parlay detected but no legs/);
      r.legs.forEach(function (l, k) { if (l.confidence < 0.6) r.issues.push("Leg " + (k + 1) + ' ("' + l.selection.slice(0, 40) + '") could not be confidently identified'); });
    }

    /* 3. event from matchup lines ("Navy Midshipmen at UAB Blazers") */
    var games = T.filter(function (t) { return MATCH.test(t) && !/[+-]\d/.test(t) && !NOISE.test(t); })
      .map(function (t) { var m = t.match(MATCH), a = m[1].replace(/^.*[\u00b7\u2022|]\s*/, "").replace(/^(?:spread|moneyline|money line|total|ml)\s*[-\u2013]\s*/i, "").trim(), b = m[2].replace(/\s*[\u00b7\u2022|].*$/, "").trim(); return a + " @ " + b; });
    if (games.length && (!r.eventLabel || !r.eventLabel.value || isParlay)) {
      var ev = games.length === 1 ? games[0] : games[0] + " + " + (games.length - 1) + " more";
      r.eventLabel = { value: ev, confidence: 0.8, raw: ev };
      drop(/^Event could not be identified/);
    }

    /* 4. college sports: distinctive NCAA nicknames or explicit labels */
    var COLLEGE = /\b(ncaa[fb]?|college (football|basketball)|cfb|cbb|hoosiers|midshipmen|golden bears|wildcats|longhorns|volunteers|buckeyes|wolverines|crimson tide|gators|seminoles|sooners|aggies|razorbacks|gamecocks|commodores|nittany lions|hawkeyes|badgers|cornhuskers|golden gophers|fighting illini|boilermakers|terrapins|scarlet knights|trojans|beavers|utes|sun devils|buffaloes|jayhawks|cyclones|horned frogs|red raiders|mountaineers|bearcats|fighting irish|hokies|tar heels|wolfpack|demon deacons|blue devils|yellow jackets|mustangs|golden hurricane|green wave|mean green|roadrunners|aztecs|rainbow warriors|lobos|wolf pack|black knights|chanticleers|thundering herd|hilltoppers|blue raiders|golden eagles|ragin'? cajuns|warhawks|red wolves|zips|chippewas|redhawks|minutemen|blazers|bulldogs|huskies|cougars|spartans|owls|dukes|monarchs|miners|bobcats)\b/i;
    var PRO_CITY = /\b(portland trail blazers|trail blazers|houston cougars? fc)\b/i;
    if (COLLEGE.test(all) && !PRO_CITY.test(all) && !/\b(NFL|NBA|MLB|NHL)\b/.test(all)) {
      var explicitB = /\b(ncaab|college basketball|cbb)\b/i.test(all), explicitF = /\b(ncaaf|college football|cfb)\b/i.test(all);
      var mo = new Date().getMonth();
      var sp = explicitB ? "ncaab" : explicitF ? "ncaaf" : (mo >= 7 && mo <= 11) ? "ncaaf" : "ncaab";
      r.sport = { value: sp, confidence: 0.8, raw: sp.toUpperCase() };
      drop(/^Sport could not be determined/);
    }

    /* 5. odds: the lone "+595" on the header line beats a leg's line */
    if (!r.odds || !r.odds.value) {
      var h = T.find(function (t) { return HEADER.test(t) && /[+-]\d{3,4}\b/.test(t); });
      if (h) { var o = h.match(/[+-]\d{3,4}\b/)[0]; r.odds = { value: o, confidence: 0.9, raw: o }; drop(/^Odds not found/); }
    }
  } catch (e) { /* never block an import on the fix-up layer */ }
  return r;
};

/* ---------------------------------------------------------------------------
 * Structured slip reader.
 *
 * Works on OCR lines with their positions (tesseract PSM 3) plus how bright each
 * line's text is. A leg is a bold "selection" line (wrapped lines joined),
 * followed by dimmer detail lines: the market ("Receiving Yards") and the
 * matchup ("Minnesota Vikings at Tampa Bay Buccaneers", possibly wrapped).
 * Handles one- and two-column layouts and several screenshots of one slip.
 * ------------------------------------------------------------------------- */
(function (root) {
  "use strict";

  var TEAMS = {
    nfl: "Arizona Cardinals|Atlanta Falcons|Baltimore Ravens|Buffalo Bills|Carolina Panthers|Chicago Bears|Cincinnati Bengals|Cleveland Browns|Dallas Cowboys|Denver Broncos|Detroit Lions|Green Bay Packers|Houston Texans|Indianapolis Colts|Jacksonville Jaguars|Kansas City Chiefs|Las Vegas Raiders|Los Angeles Chargers|Los Angeles Rams|Miami Dolphins|Minnesota Vikings|New England Patriots|New Orleans Saints|New York Giants|New York Jets|Philadelphia Eagles|Pittsburgh Steelers|San Francisco 49ers|Seattle Seahawks|Tampa Bay Buccaneers|Tennessee Titans|Washington Commanders",
    nba: "Atlanta Hawks|Boston Celtics|Brooklyn Nets|Charlotte Hornets|Chicago Bulls|Cleveland Cavaliers|Dallas Mavericks|Denver Nuggets|Detroit Pistons|Golden State Warriors|Houston Rockets|Indiana Pacers|LA Clippers|Los Angeles Clippers|Los Angeles Lakers|Memphis Grizzlies|Miami Heat|Milwaukee Bucks|Minnesota Timberwolves|New Orleans Pelicans|New York Knicks|Oklahoma City Thunder|Orlando Magic|Philadelphia 76ers|Phoenix Suns|Portland Trail Blazers|Sacramento Kings|San Antonio Spurs|Toronto Raptors|Utah Jazz|Washington Wizards",
    mlb: "Arizona Diamondbacks|Atlanta Braves|Baltimore Orioles|Boston Red Sox|Chicago Cubs|Chicago White Sox|Cincinnati Reds|Cleveland Guardians|Colorado Rockies|Detroit Tigers|Houston Astros|Kansas City Royals|Los Angeles Angels|Los Angeles Dodgers|Miami Marlins|Milwaukee Brewers|Minnesota Twins|New York Mets|New York Yankees|Athletics|Oakland Athletics|Philadelphia Phillies|Pittsburgh Pirates|San Diego Padres|San Francisco Giants|Seattle Mariners|St. Louis Cardinals|Tampa Bay Rays|Texas Rangers|Toronto Blue Jays|Washington Nationals",
    nhl: "Anaheim Ducks|Boston Bruins|Buffalo Sabres|Calgary Flames|Carolina Hurricanes|Chicago Blackhawks|Colorado Avalanche|Columbus Blue Jackets|Dallas Stars|Detroit Red Wings|Edmonton Oilers|Florida Panthers|Los Angeles Kings|Minnesota Wild|Montreal Canadiens|Nashville Predators|New Jersey Devils|New York Islanders|New York Rangers|Ottawa Senators|Philadelphia Flyers|Pittsburgh Penguins|San Jose Sharks|Seattle Kraken|St. Louis Blues|Tampa Bay Lightning|Toronto Maple Leafs|Utah Mammoth|Utah Hockey Club|Vancouver Canucks|Vegas Golden Knights|Washington Capitals|Winnipeg Jets"
  };
  var TEAM_LIST = [];
  Object.keys(TEAMS).forEach(function (sp) {
    TEAMS[sp].split("|").forEach(function (full) {
      var parts = full.split(" "), nick = parts.slice(-1)[0];
      if (/^(Sox|Jays|Wings|Knights|Jackets|Leafs|Blazers|Club)$/.test(nick)) nick = parts.slice(-2).join(" ");
      TEAM_LIST.push({ sport: sp, full: full, nick: nick, fullN: nf(full), nickN: nf(nick) });
    });
  });
  var COLLEGE = /\b(ncaa[fb]?|college (football|basketball)|cfb|cbb|hoosiers|midshipmen|golden bears|longhorns|volunteers|buckeyes|wolverines|crimson tide|gators|seminoles|sooners|aggies|razorbacks|gamecocks|commodores|nittany lions|hawkeyes|badgers|cornhuskers|golden gophers|fighting illini|boilermakers|terrapins|scarlet knights|trojans|beavers|utes|sun devils|buffaloes|jayhawks|cyclones|horned frogs|red raiders|mountaineers|bearcats|fighting irish|hokies|tar heels|wolfpack|demon deacons|blue devils|yellow jackets|mustangs|golden hurricane|green wave|mean green|roadrunners|aztecs|rainbow warriors|lobos|wolf pack|black knights|chanticleers|thundering herd|hilltoppers|blue raiders|golden eagles|ragin'? cajuns|warhawks|red wolves|zips|chippewas|redhawks|minutemen|uab|ucf|usc|ucla|lsu|tcu|smu|byu|unlv|utep|utsa)\b/i;

  function nf(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9+.\- ]/g, " ").replace(/\s+/g, " ").trim();
  }

  /* ----------------------------------------------------------- pixels */

  // Contrast of a line's text against its background (0-255).
  function inkContrast(page, bb) {
    var L = page.lum, W = page.w, H = page.h;
    if (!L || !bb) return 0;
    var x0 = Math.max(0, bb.x0 | 0), x1 = Math.min(W - 1, bb.x1 | 0), y0 = Math.max(0, bb.y0 | 0), y1 = Math.min(H - 1, bb.y1 | 0);
    if (x1 <= x0 || y1 <= y0) return 0;
    var hist = new Array(52).fill(0), step = Math.max(1, Math.floor((x1 - x0) * (y1 - y0) / 40000)), x, y, i = 0;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) { if ((i++ % step) === 0) hist[(L[y * W + x] / 5) | 0]++; }
    var mode = 0; for (i = 1; i < hist.length; i++) if (hist[i] > hist[mode]) mode = i;
    var bg = mode * 5 + 2, diffs = [];
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      if ((i++ % step) !== 0) continue;
      var d = Math.abs(L[y * W + x] - bg);
      if (d > 40) diffs.push(d);
    }
    if (diffs.length < 6) return 0;
    diffs.sort(function (a, b) { return b - a; });
    var n = Math.max(3, Math.floor(diffs.length * 0.35)), s = 0;
    for (i = 0; i < n; i++) s += diffs[i];
    return s / n;
  }

  // Split lines into primary (bold / bright) and secondary (dim) by 2-means on contrast.
  function classifyContrast(lines) {
    var v = lines.map(function (l) { return l.contrast; }).filter(function (c) { return c > 0; });
    if (v.length < 3) return false;
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), it;
    for (it = 0; it < 12; it++) {
      var a = [], b = [];
      v.forEach(function (c) { (Math.abs(c - lo) <= Math.abs(c - hi) ? a : b).push(c); });
      if (!a.length || !b.length) return false;
      lo = a.reduce(function (s, c) { return s + c; }, 0) / a.length;
      hi = b.reduce(function (s, c) { return s + c; }, 0) / b.length;
    }
    if (hi - lo < 28) return false;
    var cut = (lo + hi) / 2;
    lines.forEach(function (l) { l.primary = l.contrast >= cut; });
    return true;
  }

  /* ------------------------------------------------------------ pages */

  root.__bfPages = [];
  root.__bfAddPage = function (data) {
    try {
      var page = { w: 0, h: 0, lines: [] }, lum = root.__bfLum;
      if (lum) { page.w = lum.w; page.h = lum.h; page.lum = lum.lum; }
      var bi = 0;
      (data.blocks || []).forEach(function (b) {
        bi++;
        (b.paragraphs || []).forEach(function (p) {
          (p.lines || []).forEach(function (l) {
            var t = String(l.text || "").replace(/[−–—](?=\d)/g, "-").replace(/\s+/g, " ").trim();
            if (!t) return;
            var words = (l.words || []).map(function (w) { return { t: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, conf: w.confidence }; });
            page.lines.push({ text: t, block: bi, x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1, h: l.bbox.y1 - l.bbox.y0, conf: (l.confidence || 50) / 100, words: words });
          });
        });
      });
      if (!page.w) page.lines.forEach(function (l) { page.w = Math.max(page.w, l.x1); page.h = Math.max(page.h, l.y1); });
      page.lines.forEach(function (l) { l.contrast = inkContrast(page, l); });
      page.hasContrast = classifyContrast(page.lines);
      delete page.lum;
      root.__bfPages.push(page);
    } catch (e) { try { console.warn("[betfolio slip] page", e); } catch (x) {} }
  };

  /* ---------------------------------------------------------- vocabulary */

  var BOOKS = /\b(fanatics( sportsbook)?|draftkings( sportsbook)?|fanduel( sportsbook)?|betmgm|caesars( sportsbook)?|espn ?bet|bet365|hard rock( bet)?|betrivers)\b/i;
  var HEADER = /^\s*(\d+\s*[- ]?(leg|pick|team)s?\b.*|(same[- ]game\s+)?parlay\+?\b.*|sgp\+?\b.*|straight\b.*|single\b.*|round robin\b.*)$/i;
  var MONEY_LABEL = /\b(wager|stake|risk(?:ed)?|bet amount|total wager|total bet|fan\s?cash|bonus bet|free bet|site credit|to pay|to win|payout|potential payout|total payout|potential win(?:nings)?|returns?|to return|cash out)\b/i;
  var WAGER_LABEL = /\b(wager|stake|risk(?:ed)?|bet amount|total wager|total bet|fan\s?cash|bonus bet|free bet|site credit)\b/i;
  var PAY_LABEL = /\b(to pay|to win|payout|potential payout|total payout|potential win(?:nings)?|returns?|to return)\b/i;
  var NOISE = /(must be 21|gambling problem|1-800|gambler|bet id|\bid:|cash ?out|share\b|my bets|^open$|^settled$|^live$|^\d{1,2}:\d{2}$|placed|receipt|terms|responsibl|^[\W\d]{0,3}$)/i;
  var MONEY = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2})/g;
  var MARKET_ONLY = /^(spread|point spread|alt(ernate)? spread|moneyline|money line|ml|total|totals|total points|game total|team total|run line|puck line|over\/under|o\/u)$/i;

  function isMatchupStart(t) { return /\s(at|@|vs\.?)\s/i.test(" " + t + " ") || /\s(at|@|vs\.?)$/i.test(t); }
  function moneyIn(t) { var o = [], m; MONEY.lastIndex = 0; while ((m = MONEY.exec(t))) o.push(parseFloat(m[1].replace(/,/g, ""))); return o; }

  /* ------------------------------------------------------------ grouping */

  function columnsOf(lines, W) {
    var xs = lines.map(function (l) { return l.x0; }).sort(function (a, b) { return a - b; });
    var cols = [], tol = Math.max(24, W * 0.05);
    xs.forEach(function (x) { var c = cols.find(function (c) { return Math.abs(c.x - x) <= tol; }); if (c) { c.n++; c.x = (c.x * (c.n - 1) + x) / c.n; } else cols.push({ x: x, n: 1 }); });
    return cols;
  }

  function groupsOf(page) {
    var H0 = page.h || 0;
    var lines = page.lines.filter(function (l) { return l.text.length > 0 && !(H0 && (l.y0 <= 2 || l.y1 >= H0 - 2)); });
    var W = page.w || 1000, cols = columnsOf(lines, W);
    var byCol = {};
    lines.forEach(function (l) {
      var best = 0, bd = 1e9;
      cols.forEach(function (c, i) { var d = Math.abs(c.x - l.x0); if (d < bd) { bd = d; best = i; } });
      (byCol[best] = byCol[best] || []).push(l);
    });
    var hs = lines.map(function (l) { return l.h; }).sort(function (a, b) { return a - b; });
    var mh = hs[Math.floor(hs.length / 2)] || 20;
    var groups = [];
    Object.keys(byCol).forEach(function (k) {
      var col = byCol[k].sort(function (a, b) { return a.y0 - b.y0; });
      var g = null, prev = null;
      col.forEach(function (l) {
        var gap = prev ? l.y0 - prev.y1 : 0;
        var split = !g || gap > mh * 1.35 ||
          (page.hasContrast && l.primary && prev && !prev.primary) ||
          (!page.hasContrast && prev && l.block !== prev.block);
        if (split) { g = { lines: [], x0: l.x0, y0: l.y0, col: +k }; groups.push(g); }
        g.lines.push(l); prev = l;
      });
    });
    // Rows left-to-right, then top-to-bottom, like the slip reads.
    groups.sort(function (a, b) { return Math.abs(a.y0 - b.y0) > mh ? a.y0 - b.y0 : a.x0 - b.x0; });
    var H = page.h || 0;
    groups.forEach(function (g) {
      g.page = page;
      var first = g.lines[0], last = g.lines[g.lines.length - 1];
      g.cutTop = first.y0 < mh * 1.2;
      g.cutBottom = H > 0 && H - last.y1 < mh * 1.2;
    });
    return groups;
  }

  /* ---------------------------------------------------------- leg building */

  function joinWrapped(parts) {
    var out = "";
    parts.forEach(function (p) {
      p = p.trim();
      if (!out) out = p;
      else if (/[-‐]$/.test(out) && /^[a-z]/i.test(p)) out = out + p;
      else out = out + " " + p;
    });
    return out.replace(/\s+/g, " ").trim();
  }

  function cleanMarket(m) {
    return String(m || "").replace(/\s*[·•|].*$/, "")
      .replace(/^(alt(ernate)?|player)\s+/i, "").replace(/\s+/g, " ").trim();
  }

  function cleanMatchup(m) {
    var s = String(m || "").replace(/\s+/g, " ").trim();
    var mm = s.match(/^(.+?)\s+(?:at|@|vs\.?)\s+(.+)$/i);
    if (!mm) return s;
    var a = mm[1].replace(/^.*[·•|]\s*/, "").replace(/^(spread|moneyline|money line|total|ml)\s*[-–]\s*/i, "").trim();
    var b = mm[2].replace(/\s*[·•|].*$/, "").trim();
    return a + " at " + b;
  }

  function needsMarket(sel) {
    var t = sel.trim();
    if (/^(over|under|o|u)\s*\d/i.test(t)) return true;               // "Over 45.5" + "Total Points"
    if (!/\d/.test(t)) return true;                                    // "Derrick Henry" + "Anytime Touchdown Scorer"
    if (/^[^\d]+\s\d+(\.\d+)?\+$/.test(t)) return true;                // "Josh Oliver 10+" + "Receiving Yards"
    if (/^[^\d]+\s(over|under|o|u)\s*\d+(\.\d+)?$/i.test(t)) return true; // "Josh Allen Over 249.5" + "Passing Yards"
    return false;
  }

  function buildLeg(g) {
    var ls = g.lines, sel = [], det = [];
    if (g.page.hasContrast) {
      ls.forEach(function (l) { (l.primary && !det.length ? sel : det).push(l); });
      if (!sel.length) return null;
    } else {
      // No usable brightness signal: first line is the selection; a wrapped name
      // ("Jacory Croskey-" / "Merritt 30+") continues it.
      sel.push(ls[0]);
      var i = 1;
      while (i < ls.length && (/[-‐]$/.test(sel[sel.length - 1].text) || (/^\S+\s\d+(\.\d+)?\+$/.test(ls[i].text) && !/\d/.test(sel[0].text)))) { sel.push(ls[i]); i++; }
      det = ls.slice(i);
    }
    var selection = joinWrapped(sel.map(function (l) { return l.text; }));
    var dt = det.map(function (l) { return l.text; });
    var sp = splitDetails(dt);
    var market = sp.market, matchup = sp.matchup;
    var conf = Math.min.apply(null, sel.map(function (l) { return l.conf; }));
    var complete = !!matchup && !g.cutBottom;
    return { selection: selection, market: cleanMarket(market), matchup: matchup, conf: conf, lines: ls, complete: complete, cut: g.cutTop || g.cutBottom };
  }

  var MARKET_VOCAB = new RegExp("^(?:alt(?:ernate)?\\s+)?(?:player\\s+)?(?:" + [
    "(?:anytime|first|last|1st) (?:touchdown|td|goal|basket)(?: ?scorer)?",
    "(?:passing|rushing|receiving|pass|rush|rec)(?: ?\\+ ?(?:rushing|receiving|rush|rec))? (?:yards|yds|touchdowns|tds|attempts|completions|receptions|longest (?:reception|rush|completion))",
    "(?:pass )?completions", "receptions", "interceptions(?: thrown)?", "sacks", "tackles(?: ?\\+ ?assists)?",
    "points(?: ?\\+ ?rebounds)?(?: ?\\+ ?assists)?", "pts(?: ?\\+ ?reb)?(?: ?\\+ ?ast)?", "rebounds(?: ?\\+ ?assists)?", "assists", "(?:threes|3-pointers|three pointers)(?: made)?", "steals(?: ?\\+ ?blocks)?", "blocks", "double double", "triple double",
    "strikeouts(?: thrown)?", "hits(?: ?\\+ ?runs ?\\+ ?rbis)?", "home runs", "rbis", "runs(?: scored)?", "total bases", "outs recorded", "earned runs(?: allowed)?", "hits allowed",
    "shots on goal", "saves", "goals", "power play points",
    "(?:3-way )?moneyline", "money line", "(?:alt(?:ernate)? )?(?:point )?spread", "run line", "puck line", "(?:game |team )?total(?: points| runs| goals)?", "double chance", "draw no bet", "both teams to score"
  ].join("|") + ")(?:\\s+o\\/u)?\\b", "i");

  // Split a leg's dim detail lines into market ("Receiving Yards") and matchup
  // ("Minnesota Vikings at Tampa Bay Buccaneers"), even when both wrap.
  function splitDetails(dt) {
    var D = joinWrapped(dt), m = D.match(/^(.*?)\s+(at|@|vs\.?)\s+(.+)$/i);
    if (!m) m = D.match(/^(.*?)\s+(at|@|vs\.?)()$/i);   // matchup cut off after "at"
    if (!m) return { market: D, matchup: "" };
    var pre = m[1].trim(), post = m[3].trim(), market = "", away = pre;
    var v = pre.match(MARKET_VOCAB);
    if (v && v[0].length < pre.length) { market = v[0]; away = pre.slice(v[0].length).trim(); }
    else {
      // longest known team name that ends the text before "at"
      var words = pre.split(" "), best = -1;
      for (var i = 0; i < words.length; i++) {
        var tail = nf(words.slice(i).join(" "));
        if (TEAM_LIST.some(function (t) { return t.fullN === tail; })) { best = i; break; }
      }
      if (best < 0) {
        // fall back to line structure: the matchup starts on the line holding (or ending with) "at"
        var k = dt.findIndex(isMatchupStart);
        if (k > 0) {
          var lineAway = dt[k].replace(/\s+(at|@|vs\.?)(\s.*)?$/i, "").trim();
          best = words.length - lineAway.split(" ").length;
          if (best < 0) best = 0;
        } else best = 0;
      }
      market = words.slice(0, best).join(" "); away = words.slice(best).join(" ");
    }
    away = away.split(/\s+[-\u2013\u00b7\u2022|]\s+/).pop().replace(/^[\s\-\u2013\u00b7\u2022|:]+/, "").replace(/^(nfl|nba|mlb|nhl|ncaaf|ncaab|wnba|mls|epl)\s+/i, "").trim();
    post = post.split(/\s+[-\u2013\u00b7\u2022|]\s+/)[0].replace(/\s+(today|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun)\b.*$/i, "").trim();
    market = market.replace(/[\s\-\u2013\u00b7\u2022|:]+$/, "").trim();
    return { market: market, matchup: post ? cleanMatchup(away + " at " + post) : away + " at" };
  }

  function legLabel(leg) {
    var s = leg.selection.replace(/\s+/g, " ").trim(), m = leg.market;
    if (m && (!MARKET_ONLY.test(m) || /^(over|under)\b/i.test(s)) && needsMarket(s) && nf(s).indexOf(nf(m)) < 0) s = s + " " + m;
    if (m && /^(moneyline|money line|ml)$/i.test(m) && !/\d/.test(s)) s = s + " Moneyline";
    return s.replace(/\s+/g, " ").trim();
  }

  function isLegGroup(leg) {
    var s = leg.selection;
    if (!s || s.length < 3) return false;
    if (BOOKS.test(s) && s.replace(BOOKS, "").trim().length < 4) return false;
    if (HEADER.test(s) || NOISE.test(s) || MONEY_LABEL.test(s) || /\$/.test(s)) return false;
    if (/^[+-]?\d[\d,.]*$/.test(s.trim())) return false;
    if (leg.matchup) return true;
    if (leg.market && !NOISE.test(leg.market) && !MONEY_LABEL.test(leg.market) && !/\$/.test(leg.market)) return true;
    return /([+-]\d+(\.\d+)?\s*$)|(\d+(\.\d+)?\+)|\b(over|under)\s+\d|\b(ml|moneyline)\b/i.test(s);
  }

  /* ------------------------------------------------------- money + header */

  function wordsOf(pages) {
    var out = [];
    pages.forEach(function (p, pi) { p.lines.forEach(function (l) { l.words.forEach(function (w) { out.push({ t: w.t, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, page: pi, line: l }); }); }); });
    return out;
  }

  // Pair each dollar amount with the label directly above it or to its left.
  function moneyFields(pages) {
    var res = { wager: null, payout: null };
    pages.forEach(function (p) {
      p.lines.forEach(function (l, li) {
        (l.words || []).forEach(function (w) {
          var am = moneyIn(w.t.replace(/[Ss](?=\d)/, "$"));
          if (!am.length || !/\$/.test(w.t)) return;
          var val = am[0], label = null;
          // same line, words to the left
          var left = l.words.filter(function (x) { return x.x1 <= w.x0 && !/\$/.test(x.t); }).map(function (x) { return x.t; }).join(" ");
          if (MONEY_LABEL.test(left)) label = left;
          if (!label) {
            var best = null;
            p.lines.forEach(function (u) {
              if (u === l || u.y1 > w.y0 + 2 || w.y0 - u.y1 > (l.h || 30) * 3) return;
              (u.words || []).forEach(function (x) {
                var ov = Math.min(x.x1, w.x1) - Math.max(x.x0, w.x0);
                var near = ov > -12 || Math.abs(x.x0 - w.x0) < 30;
                if (!near) return;
                var t = u.words.filter(function (z) { return Math.abs(z.x0 - x.x0) < 1 || (z.x0 > x.x0 && z.x0 - x.x1 < 25 && !/\$/.test(z.t)); }).map(function (z) { return z.t; }).join(" ");
                if (MONEY_LABEL.test(t) && (!best || u.y1 > best.y)) best = { y: u.y1, t: t };
              });
            });
            if (best) label = best.t;
          }
          if (!label) return;
          if (WAGER_LABEL.test(label) && res.wager == null) res.wager = val;
          else if (PAY_LABEL.test(label) && res.payout == null) res.payout = val;
        });
      });
    });
    return res;
  }

  function headerInfo(pages) {
    var info = { legCount: null, odds: null, sgp: false, book: null, bookConf: 0 };
    pages.forEach(function (p) {
      p.lines.forEach(function (l) {
        var t = l.text, m;
        if (!info.book && (m = t.match(/fanatics|draftkings|draft kings|fanduel/i))) info.book = /fanatics/i.test(m[0]) ? "fanatics" : /fanduel/i.test(m[0]) ? "fanduel" : "draftkings";
        if ((m = t.match(/\b(\d{1,2})\s*[- ]?\s*(leg|pick|team)s?\b/i)) && info.legCount == null) info.legCount = parseInt(m[1], 10);
        if (/same[- ]game parlay|\bsgp\b/i.test(t)) info.sgp = true;
        if (HEADER.test(t) || /parlay|leg/i.test(t)) {
          var o = t.match(/(^|\s)([+-]\d{3,}(?:,\d{3})*)(?!\.\d)\b/);
          if (o && !info.odds) info.odds = o[2].replace(/,/g, "");
        }
      });
    });
    if (!info.odds) pages.forEach(function (p) {
      p.lines.forEach(function (l) { if (!info.odds && /^[+-]\d{3,}(?:,\d{3})*$/.test(l.text.trim())) info.odds = l.text.trim().replace(/,/g, ""); });
    });
    return info;
  }

  /* ------------------------------------------------------------- sports */

  function teamIn(text) {
    var t = " " + nf(text) + " ", best = null;
    TEAM_LIST.forEach(function (tm) {
      var s = 0;
      if (t.indexOf(" " + tm.fullN + " ") >= 0) s = 10 + tm.fullN.length;
      else if (t.indexOf(" " + tm.nickN + " ") >= 0) s = 2 + tm.nickN.length;
      if (s && (!best || s > best.s)) best = { s: s, team: tm };
    });
    return best;
  }

  function sportOfLeg(leg) {
    var text = leg.matchup || leg.selection;
    if (leg.matchup) {
      var sides = leg.matchup.split(/\s+(?:at|@|vs\.?)\s+/i), votes = {};
      sides.forEach(function (sd) { var tm = teamIn(sd); if (tm && tm.s >= 10) votes[tm.team.sport] = (votes[tm.team.sport] || 0) + 2; else if (tm) votes[tm.team.sport] = (votes[tm.team.sport] || 0) + 1; });
      var best = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0];
      if (best && votes[best] >= 2) return best;
      if (COLLEGE.test(text) || sides.length === 2) return collegeSport(text, leg.market);
    }
    var tm2 = teamIn(leg.selection);
    if (tm2 && tm2.s >= 10) return tm2.team.sport;
    if (COLLEGE.test(text)) return collegeSport(text, leg.market);
    var m = nf(leg.market + " " + leg.selection);
    if (/passing|rushing|receiving|touchdown|receptions/.test(m)) return "nfl";
    if (/rebounds|assists|threes|3-pointers/.test(m)) return "nba";
    if (/home run|rbi|strikeouts|hits allowed|total bases/.test(m)) return "mlb";
    if (/shots on goal|saves/.test(m)) return "nhl";
    return null;
  }
  function collegeSport(text, market) {
    var m = nf(text + " " + (market || ""));
    if (/ncaab|college basketball|cbb|rebounds|assists|threes/.test(m)) return "ncaab";
    if (/ncaaf|college football|cfb|passing|rushing|receiving|touchdown/.test(m)) return "ncaaf";
    var mo = new Date().getMonth();
    return mo >= 7 && mo <= 11 ? "ncaaf" : mo === 0 ? "ncaaf" : "ncaab";
  }

  /* --------------------------------------------------------------- main */

  root.__bfStruct = function (pages) {
    pages = pages || root.__bfPages || [];
    if (!pages.length) return null;
    // Collect legs from every screenshot. Overlapping screenshots repeat legs, and a
    // leg can be cut at a screenshot edge: keep the most complete copy of each.
    var legs = [];
    var selKey = function (l) { return nf(l.selection).replace(/[^a-z0-9+.]/g, ""); };
    pages.forEach(function (p) {
      groupsOf(p).forEach(function (g) {
        var leg = buildLeg(g);
        if (!leg || !isLegGroup(leg)) return;
        if (leg.conf < 0.45 && !leg.matchup) return;
        if (g.cutTop && !leg.complete && legs.length && !/\d|over|under/i.test(leg.selection) && !leg.market) return;
        leg.label = legLabel(leg);
        var k = selKey(leg), mk = nf(leg.market).split(" ")[0] || "";
        var dup = legs.findIndex(function (o) {
          if (selKey(o) !== k) return false;
          var om = nf(o.market).split(" ")[0] || "";
          return !o.complete || !leg.complete || om === mk || !om || !mk;
        });
        if (dup >= 0) {
          var o = legs[dup];
          var score = function (l) { return (l.complete ? 4 : 0) + (l.matchup ? 2 : 0) + (l.market ? 1 : 0) + l.matchup.length / 1000; };
          if (score(leg) > score(o)) legs[dup] = leg;
          return;
        }
        legs.push(leg);
      });
    });
    legs.forEach(function (l) { if (!l.complete) l.conf = Math.min(l.conf, 0.55); });
    if (!legs.length) return null;
    var head = headerInfo(pages), money = moneyFields(pages);
    var games = [];
    legs.forEach(function (l) { if (l.matchup) { var k = nf(l.matchup); if (games.indexOf(k) < 0) games.push(k); } });
    var votes = {};
    legs.forEach(function (l) { l.sport = sportOfLeg(l); if (l.sport) votes[l.sport] = (votes[l.sport] || 0) + 1; });
    var sport = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0] || null;
    var betType;
    if (legs.length === 1) {
      var sp = nf(legs[0].label);
      betType = /\d+\+|\bover\b|\bunder\b|yards|points|rebounds|assists|touchdown|strikeouts|shots|hits|scorer/.test(sp) && !/^(over|under)\b/.test(sp) && !MARKET_ONLY.test(legs[0].market || "x") && !/total/.test(nf(legs[0].market)) ? "player_prop" : "straight";
    } else betType = games.length <= 1 && (head.sgp || games.length === 1) ? "same_game_parlay" : "parlay";
    var eventLabel = games.length === 1 ? legs.find(function (l) { return l.matchup; }).matchup.replace(/\s+at\s+/i, " @ ")
      : legs.length > 1 ? legs.length + "-leg parlay" + (games.length ? " · " + games.length + " games" : "")
      : legs[0].label;
    var issues = [];
    if (head.legCount && head.legCount < legs.length) issues.push("Found " + legs.length + " legs but the slip says " + head.legCount + " \u2014 remove any extra leg below");
    if (head.legCount && head.legCount > legs.length) issues.push("Found " + legs.length + " of " + head.legCount + " legs — add the rest of the slip's screenshots (up to 5) in one upload, or add the missing legs below");
    var text = [];
    pages.forEach(function (p) { p.lines.forEach(function (l) { if (!legs.some(function (lg) { return lg.lines.indexOf(l) >= 0; })) text.push(l.text); }); });
    legs.forEach(function (l) { text.push(l.label); if (l.market) text.push(l.market); if (l.matchup) text.push(l.matchup); });
    return {
      legs: legs, book: head.book, odds: head.odds, legCount: head.legCount, wager: money.wager, payout: money.payout,
      sport: sport, betType: betType, eventLabel: eventLabel, games: games.length, issues: issues, sourceText: text.join("\n")
    };
  };

  // Overlay the structured read onto the base parser's result.
  root.__bfFinal = function (base, lines) {
    var r = base;
    try { r = root.__bfFix(base, lines); } catch (e) {}
    var st = null;
    try { st = root.__bfStruct(); } catch (e) { try { console.warn("[betfolio slip] struct", e); } catch (x) {} }
    root.__bfLastStruct = st;
    if (!st || !st.legs.length) return r;
    var drop = function (re) { r.issues = (r.issues || []).filter(function (m) { return !re.test(m); }); };
    r.legs = st.legs.map(function (l) { return { selection: l.label, confidence: Math.max(0.6, Math.min(0.95, l.conf || 0.8)), odds: null }; });
    drop(/^Leg \d+ \(|^Parlay detected but no legs/);
    r.legs.forEach(function (l, k) { if (l.confidence < 0.6) r.issues.push("Leg " + (k + 1) + ' ("' + l.selection.slice(0, 40) + '") could not be confidently identified'); });
    if (st.book) r.sportsbook = { value: st.book, confidence: 0.95 };
    if (st.sport) { r.sport = { value: st.sport, confidence: 0.85, raw: st.sport.toUpperCase() }; drop(/^Sport could not/); }
    r.betType = { value: st.betType, confidence: 0.9, raw: st.betType };
    drop(/^Bet type could not/);
    r.eventLabel = { value: st.eventLabel, confidence: 0.85, raw: st.eventLabel };
    drop(/^Event could not/);
    if (st.odds) { r.odds = { value: st.odds, confidence: 0.9, raw: st.odds }; drop(/^Odds not found/); }
    if (st.wager != null) { r.wager = { value: st.wager, confidence: 0.92, raw: "$" + st.wager.toFixed(2) }; drop(/^Wager amount not found/); }
    if (st.payout != null) { r.potentialPayout = { value: st.payout, confidence: 0.92, raw: "$" + st.payout.toFixed(2) }; drop(/^Potential payout not found/); }
    if (st.legs.length > 1) r.playerStat = null;
    drop(/^Event date not found/);
    st.issues.forEach(function (m) { r.issues.push(m); });
    root.__bfCtxText = st.sourceText;
    return r;
  };
})(window);
