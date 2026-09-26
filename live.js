/*
 * Betfolio live engine.
 *
 * Tracks every open slip against ESPN's public scoreboard + box score feeds:
 * matches each leg to its game, grades spreads / moneylines / totals / player
 * props from the live score and stats, and writes status, score and progress
 * back into the app store. Runs in the browser (window.BetfolioLive) and in
 * Node for tests (module.exports).
 */
(function (root) {
  "use strict";

  var ESPN = "https://site.api.espn.com/apis/site/v2/sports/";

  var LEAGUES = {
    nfl: [{ path: "football/nfl" }],
    ncaaf: [{ path: "football/college-football", q: "groups=80&limit=400" }],
    nba: [{ path: "basketball/nba" }],
    ncaab: [{ path: "basketball/mens-college-basketball", q: "groups=50&limit=500" }],
    mlb: [{ path: "baseball/mlb" }],
    nhl: [{ path: "hockey/nhl" }],
    soccer: [
      { path: "soccer/eng.1" }, { path: "soccer/esp.1" }, { path: "soccer/ita.1" },
      { path: "soccer/ger.1" }, { path: "soccer/fra.1" }, { path: "soccer/usa.1" },
      { path: "soccer/uefa.champions" }, { path: "soccer/mex.1" }
    ]
  };
  var FALLBACK_ORDER = ["nfl", "ncaaf", "nba", "ncaab", "mlb", "nhl", "soccer"];

  /* ------------------------------------------------------------------ utils */

  function norm(s) {
    return String(s || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9+.\- ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function words(s) { return norm(s).replace(/[+.\-]/g, " ").split(" ").filter(Boolean); }
  function num(v) {
    if (v == null) return null;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? null : n;
  }
  function ymd(d) {
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function fmtLine(n) { return (n > 0 ? "+" : "") + n; }
  function fmtNum(n) { return Math.round(n * 10) / 10; }

  /* --------------------------------------------------------- leg parsing */

  // Player-prop metrics. Order matters: combos before singles.
  var METRICS = [
    { re: /\b(pts\s*\+\s*reb\s*\+\s*ast|points\s*\+\s*rebounds\s*\+\s*assists|pra)\b/, id: "pra", label: "Pts+Reb+Ast", unit: "PRA" },
    { re: /\b(pts\s*\+\s*reb|points\s*\+\s*rebounds)\b/, id: "pr", label: "Pts+Reb", unit: "P+R" },
    { re: /\b(pts\s*\+\s*ast|points\s*\+\s*assists)\b/, id: "pa", label: "Pts+Ast", unit: "P+A" },
    { re: /\b(reb\s*\+\s*ast|rebounds\s*\+\s*assists)\b/, id: "ra", label: "Reb+Ast", unit: "R+A" },
    { re: /\b(stl\s*\+\s*blk|steals\s*\+\s*blocks)\b/, id: "sb", label: "Stl+Blk", unit: "S+B" },
    { re: /\b(rush(ing)?\s*\+\s*rec(eiving)?\s*(yds|yards)|scrimmage yards)\b/, id: "rushRecYds", label: "Rush+Rec Yards", unit: "yds" },
    { re: /\b(hits\s*\+\s*runs\s*\+\s*rbis?|h\s*\+\s*r\s*\+\s*rbi)\b/, id: "hrr", label: "Hits+Runs+RBIs", unit: "H+R+RBI" },
    { re: /\b(anytime (td|touchdown)( scorer)?|to score (a )?(td|touchdown)|td scorer|touchdown scorer)\b/, id: "anyTd", label: "Anytime TD", unit: "TD", yes: true },
    { re: /\b(anytime goal( ?scorer)?|to score (a )?goal|goal ?scorer)\b/, id: "anyGoal", label: "Anytime Goal", unit: "G", yes: true },
    { re: /\b(pass(ing)? (yds|yards))\b/, id: "passYds", label: "Passing Yards", unit: "yds" },
    { re: /\b(pass(ing)? (tds?|touchdowns))\b/, id: "passTd", label: "Passing TDs", unit: "TD" },
    { re: /\b(pass(ing)? completions|completions)\b/, id: "passCmp", label: "Completions", unit: "cmp" },
    { re: /\b(pass(ing)? attempts)\b/, id: "passAtt", label: "Pass Attempts", unit: "att" },
    { re: /\b(interceptions thrown|pass(ing)? interceptions)\b/, id: "passInt", label: "Interceptions", unit: "INT" },
    { re: /\b(rush(ing)? (yds|yards))\b/, id: "rushYds", label: "Rushing Yards", unit: "yds" },
    { re: /\b(rush(ing)? attempts|carries)\b/, id: "rushAtt", label: "Rush Attempts", unit: "att" },
    { re: /\b(rec(eiving)? (yds|yards))\b/, id: "recYds", label: "Receiving Yards", unit: "yds" },
    { re: /\b(receptions|catches)\b/, id: "rec", label: "Receptions", unit: "rec" },
    { re: /\b(three pointers( made)?|3 pointers( made)?|threes( made)?|3pt( made)?|3pm|made threes)\b/, id: "threes", label: "Threes Made", unit: "3PM" },
    { re: /\b(rebounds|rebs?)\b/, id: "reb", label: "Rebounds", unit: "reb" },
    { re: /\b(assists|asts?)\b/, id: "ast", label: "Assists", unit: "ast" },
    { re: /\b(steals|stl)\b/, id: "stl", label: "Steals", unit: "stl" },
    { re: /\b(blocks|blk)\b/, id: "blk", label: "Blocks", unit: "blk" },
    { re: /\b(home runs?|hrs?)\b/, id: "hr", label: "Home Runs", unit: "HR" },
    { re: /\b(rbis?|runs batted in)\b/, id: "rbi", label: "RBIs", unit: "RBI" },
    { re: /\b(hits allowed)\b/, id: "hitsAllowed", label: "Hits Allowed", unit: "H" },
    { re: /\b(earned runs( allowed)?)\b/, id: "er", label: "Earned Runs", unit: "ER" },
    { re: /\b(outs recorded|pitching outs)\b/, id: "outs", label: "Outs Recorded", unit: "outs" },
    { re: /\b(strikeouts|ks|k s)\b/, id: "so", label: "Strikeouts", unit: "K" },
    { re: /\b(runs scored)\b/, id: "runs", label: "Runs", unit: "R" },
    { re: /\b(hits)\b/, id: "hits", label: "Hits", unit: "H" },
    { re: /\b(shots on goal|sog)\b/, id: "sog", label: "Shots on Goal", unit: "SOG" },
    { re: /\b(saves)\b/, id: "saves", label: "Saves", unit: "SV" },
    { re: /\b(goals)\b/, id: "goals", label: "Goals", unit: "G" },
    { re: /\b(points|pts)\b/, id: "pts", label: "Points", unit: "pts" }
  ];

  var UNSUPPORTED = /\b(1st|2nd|first|second) (half|quarter|period|inning|5 innings)|\b(1h|2h|1q|2q|3q|4q|f5)\b|\bdouble double\b|\btriple double\b|\bfirst (td|touchdown|basket|goal)\b|\blast (td|touchdown)\b|\bwinning margin\b|\bexact score\b|\bboth teams to score\b|\bbtts\b|\bmvp\b|\bto win (the )?(championship|title|series|super bowl|world series)\b|\bfutures?\b|\btotal bases\b/;

  function parseLeg(label, extra) {
    var raw = String(label || "").trim();
    var t = norm(raw + " " + (extra || ""));
    var own = norm(raw);
    var spec = { raw: raw };
    if (!own) return { kind: "unknown", raw: raw };
    if (UNSUPPORTED.test(t)) return { kind: "unsupported", raw: raw };

    var metric = null, metricInOwn = false;
    for (var i = 0; i < METRICS.length; i++) if (METRICS[i].re.test(own)) { metric = METRICS[i]; metricInOwn = true; break; }
    if (!metric) for (i = 0; i < METRICS.length; i++) if (METRICS[i].re.test(t)) { metric = METRICS[i]; break; }

    var ou = t.match(/\b(over|under|o|u)\s*(\d+(?:\.\d+)?)\b/);
    var plus = t.match(/(\d+(?:\.\d+)?)\s*\+(?!\s*\d)/);
    var alt = own.match(/\b(alt(ernate)?)\b/);

    // Subject = text before the first number / over-under / metric keyword.
    var cut = own.search(/\s(over|under|o|u)\s*\d|\s[+-]?\d|\s-\s|\s(ml|moneyline|money line|to win|alt|anytime|to score)\b/);
    var subject = (cut > 0 ? own.slice(0, cut) : own).replace(/\b(over|under)\b.*$/, "").trim();
    if (metric) {
      var mcut = subject.search(metric.re);
      if (mcut > 0) subject = subject.slice(0, mcut).trim();
    }
    subject = subject.replace(/\s*-\s*$/, "").replace(/\b(alt(ernate)?)\b/g, "").trim();

    var teamish = metric && !metricInOwn && (metric.id === "pts" || metric.id === "goals" || metric.id === "runs");
    if (ou && (!subject || teamish)) {
      return { kind: "total", raw: raw, subject: subject, dir: /^u/.test(ou[1]) ? "under" : "over", line: parseFloat(ou[2]) };
    }
    if (metric && subject && (metric.yes || ou || plus)) {
      var dir = "over", line;
      if (metric.yes) { line = 0.5; }
      else if (ou) { dir = /^u/.test(ou[1]) ? "under" : "over"; line = parseFloat(ou[2]); }
      else { line = parseFloat(plus[1]) - 0.5; }
      return { kind: "prop", raw: raw, player: subject, display: raw.split(/\s+/).slice(0, subject.split(" ").length).join(" ").replace(/[-\u2013]$/, "").trim(), metric: metric.id, metricLabel: metric.label, unit: metric.unit, dir: dir, line: line, target: dir === "over" ? Math.floor(line) + 1 : line };
    }

    if (/^draw\b|\btie\b|\bdraw$/.test(own)) return { kind: "draw", raw: raw };

    // Totals: "Over 45.5", "Under 220.5", "Bills Over 24.5"
    if (ou && !metric) {
      return { kind: "total", raw: raw, subject: subject.replace(/\b(total|points|runs|goals)\b/g, "").trim(), dir: /^u/.test(ou[1]) ? "under" : "over", line: parseFloat(ou[2]) };
    }
    if (ou && metric && (metric.id === "pts" || metric.id === "goals" || metric.id === "runs")) {
      return { kind: "total", raw: raw, subject: subject, dir: /^u/.test(ou[1]) ? "under" : "over", line: parseFloat(ou[2]) };
    }

    // Spread: first signed number with |n| < 100 (odds are 3+ digits)
    var nums = own.match(/(^|\s)([+-]\d+(?:\.\d+)?|pk|pick(em)?)\b/g) || [];
    for (var k = 0; k < nums.length; k++) {
      var s = nums[k].trim();
      if (/^pk|^pick/.test(s)) return { kind: "spread", raw: raw, team: subject, line: 0 };
      var v = parseFloat(s);
      if (Math.abs(v) < 100 || /\./.test(s)) return { kind: "spread", raw: raw, team: subject, line: v };
    }

    // Moneyline: explicit, or a bare team name with a Moneyline market line nearby
    if (/\b(ml|moneyline|money line|to win)\b/.test(t) || nums.length) return { kind: "ml", raw: raw, team: subject };
    if (subject && subject.split(" ").length <= 4 && !metric) return { kind: "ml", raw: raw, team: subject, guessed: true };
    return { kind: "unknown", raw: raw };
  }

  /* ------------------------------------------------------ slip context */

  var MATCHUP = /^(.{2,60}?)\s+(?:at|@|vs\.?|v\.?)\s+(.{2,60})$/i;

  function cleanA(s) {
    return String(s).replace(/^.*[·•|]\s*/, "")
      .replace(/^(spread|moneyline|money line|total|ml|points o\/u)\s*[-–]\s*/i, "").trim();
  }
  function cleanB(s) { return String(s).replace(/\s*[·•|].*$/, "").trim(); }

  // For each leg find the extra text (market line) and matchup that follow it on the slip.
  function legContexts(legs, sourceText) {
    var lines = String(sourceText || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    var nl = lines.map(norm);
    var matchups = [];
    lines.forEach(function (l, i) {
      var m = l.match(MATCHUP);
      if (m && !/[+-]\d/.test(l) && !/\$/.test(l)) matchups.push({ i: i, a: cleanA(m[1]), b: cleanB(m[2]) });
    });
    var idx = legs.map(function (lg) {
      var n = norm(lg.label);
      for (var i = 0; i < nl.length; i++) if (nl[i] === n) return i;
      for (i = 0; i < nl.length; i++) if (n && nl[i].indexOf(n) >= 0) return i;
      return -1;
    });
    return legs.map(function (lg, j) {
      var at = idx[j], next = -1;
      for (var q = 0; q < idx.length; q++) if (idx[q] > at && (next < 0 || idx[q] < next)) next = idx[q];
      var end = next > 0 ? next : Math.min(lines.length, at + 4);
      var extra = [], mu = null;
      if (at >= 0) {
        for (var i = at + 1; i < end && i <= at + 3; i++) {
          var m = matchups.find(function (x) { return x.i === i; });
          if (m) { mu = mu || m; } else if (!/\$|\b(wager|to pay|payout|to win|bet id|gambl)/i.test(lines[i])) extra.push(lines[i]);
        }
        if (!mu) { var prev = matchups.filter(function (x) { return x.i < at; }).pop(); if (prev && at - prev.i <= 2) mu = prev; }
      }
      if (!mu && matchups.length === 1) mu = matchups[0];
      return { extra: extra.join(" "), matchup: mu ? [mu.a, mu.b] : null };
    });
  }

  /* ------------------------------------------------------- ESPN client */

  function Client(fetchImpl, now) {
    this.fetch = fetchImpl;
    this.now = now || function () { return Date.now(); };
    this.cache = {};
    this.errors = 0;
  }
  Client.prototype.get = function (url, ttl) {
    var c = this.cache[url], t = this.now(), self = this;
    if (c && c.data && t - c.at < ttl) return Promise.resolve(c.data);
    if (c && c.pending) return c.pending;
    var alt = url.replace("//site.api.espn.com/", "//site.web.api.espn.com/");
    var once = function (u) { return self.fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " " + u); return r.json(); }); };
    var p = once(url).catch(function (e) { if (alt === url) throw e; return once(alt); }).then(function (data) {
      self.cache[url] = { at: self.now(), data: data };
      self.errors = 0;
      return data;
    }, function (e) {
      self.errors++;
      if (c && c.data) { self.cache[url] = c; return c.data; }
      delete self.cache[url];
      throw e;
    });
    this.cache[url] = { at: c ? c.at : 0, data: c && c.data, pending: p };
    return p;
  };
  Client.prototype.scoreboard = function (lg, date, live) {
    var q = "dates=" + date + (lg.q ? "&" + lg.q : "");
    return this.get(ESPN + lg.path + "/scoreboard?" + q, live ? 25000 : 10 * 60000);
  };
  Client.prototype.summary = function (lg, eventId, live) {
    return this.get(ESPN + lg.path + "/summary?event=" + eventId, 25000);
  };

  /* ------------------------------------------------------ event helpers */

  function teamsOf(ev) {
    var c = (ev.competitions && ev.competitions[0] && ev.competitions[0].competitors) || [];
    return c.map(function (x) {
      var t = x.team || {};
      return {
        id: t.id, homeAway: x.homeAway, score: num(x.score) || 0, winner: x.winner,
        names: [t.displayName, t.shortDisplayName, (t.location || "") + " " + (t.name || ""), t.location, t.name, t.nickname, t.abbreviation]
          .filter(Boolean).map(norm).filter(function (s, i, a) { return s && a.indexOf(s) === i; }),
        abbr: t.abbreviation || "", display: t.shortDisplayName || t.name || t.displayName || "", full: t.displayName || ""
      };
    });
  }
  function stateOf(ev) {
    var st = (ev.status && ev.status.type) || {};
    return { state: st.state || "pre", completed: !!st.completed, detail: st.shortDetail || st.detail || "", name: st.name || "" };
  }

  // Score how well a text names a team; 0 = no match.
  function teamScore(text, team) {
    var t = " " + norm(text) + " ", best = 0;
    team.names.forEach(function (n, i) {
      if (!n || n.length < 2) return;
      var isAbbr = n === norm(team.abbr);
      if (isAbbr && n.length < 3 && !/^[a-z]{2}$/.test(n)) return;
      if (t.indexOf(" " + n + " ") >= 0) {
        var s = n.length + (i === 0 ? 20 : 0) + (isAbbr ? -2 : 0);
        if (s > best) best = s;
      }
    });
    return best;
  }
  function findTeam(text, ev) {
    var teams = teamsOf(ev), best = null;
    teams.forEach(function (tm) {
      var s = teamScore(text, tm);
      if (s > 0 && (!best || s > best.s)) best = { s: s, team: tm };
    });
    return best;
  }

  /* ------------------------------------------------------ box score */

  function playerTable(summary) {
    var out = [];
    var groups = (summary && summary.boxscore && summary.boxscore.players) || [];
    groups.forEach(function (g) {
      var team = g.team || {};
      (g.statistics || []).forEach(function (cat) {
        var keys = cat.keys || cat.names || [], labels = cat.labels || cat.names || [];
        var cname = norm(cat.name || cat.type || "");
        (cat.athletes || []).forEach(function (a) {
          var ath = a.athlete || {}, name = ath.displayName || ath.fullName || ath.shortName;
          if (!name) return;
          var p = out.find(function (x) { return x.id === ath.id && x.name === name; });
          if (!p) { p = { id: ath.id, name: name, short: ath.shortName || "", team: team.abbreviation || "", teamId: team.id, s: {} }; out.push(p); }
          (a.stats || []).forEach(function (v, i) {
            var k = keys[i], l = labels[i];
            var put = function (key, val) {
              if (!key) return;
              var n = num(val);
              if (n == null) return;
              p.s[cname + "." + key] = n;
              if (p.s[key] == null) p.s[key] = n;
            };
            if (/[-/]/.test(String(v)) && /^\d+\s*[-/]\s*\d+$/.test(String(v).trim())) {
              var parts = String(v).split(/[-/]/), kp = String(k || "").split(/[-/]/), lp = String(l || "").split(/[-/]/);
              put(kp[0], parts[0]); put(kp[1], parts[1]);
              put("L:" + (lp[0] || l), parts[0]);
              put("L:" + l, parts[0]);
            } else {
              put(k, v); put("L:" + l, v);
            }
          });
        });
      });
    });
    return out;
  }

  function pick(s, list) {
    for (var i = 0; i < list.length; i++) if (s[list[i]] != null) return s[list[i]];
    return null;
  }
  function sum(s, lists) {
    var total = 0, any = false;
    lists.forEach(function (l) { var v = pick(s, l); if (v != null) { total += v; any = true; } });
    return any ? total : null;
  }

  function statValue(p, metric, sport) {
    var s = p.s;
    var PTS = ["points", "L:PTS"], REB = ["rebounds", "totalRebounds", "L:REB"], AST = ["assists", "L:AST"];
    switch (metric) {
      case "passYds": return pick(s, ["passing.passingYards", "passing.L:YDS"]);
      case "passTd": return pick(s, ["passing.passingTouchdowns", "passing.L:TD"]);
      case "passCmp": return pick(s, ["passing.completions", "passing.L:C/ATT", "passing.L:C"]);
      case "passAtt": return pick(s, ["passing.passingAttempts"]);
      case "passInt": return pick(s, ["passing.interceptions", "passing.L:INT"]);
      case "rushYds": return pick(s, ["rushing.rushingYards", "rushing.L:YDS"]);
      case "rushAtt": return pick(s, ["rushing.rushingAttempts", "rushing.L:CAR"]);
      case "recYds": return pick(s, ["receiving.receivingYards", "receiving.L:YDS"]);
      case "rec": return pick(s, ["receiving.receptions", "receiving.L:REC"]);
      case "rushRecYds": return sum(s, [["rushing.rushingYards", "rushing.L:YDS"], ["receiving.receivingYards", "receiving.L:YDS"]]);
      case "anyTd": return sum(s, [["rushing.rushingTouchdowns", "rushing.L:TD"], ["receiving.receivingTouchdowns", "receiving.L:TD"]]);
      case "pts":
        if (sport === "nhl") return sum(s, [["goals", "L:G"], ["assists", "L:A"]]);
        return pick(s, PTS);
      case "reb": return pick(s, REB);
      case "ast": return sport === "nhl" ? pick(s, ["assists", "L:A"]) : pick(s, AST);
      case "pra": return sum(s, [PTS, REB, AST]);
      case "pr": return sum(s, [PTS, REB]);
      case "pa": return sum(s, [PTS, AST]);
      case "ra": return sum(s, [REB, AST]);
      case "stl": return pick(s, ["steals", "L:STL"]);
      case "blk": return pick(s, ["blocks", "L:BLK"]);
      case "sb": return sum(s, [["steals", "L:STL"], ["blocks", "L:BLK"]]);
      case "threes": return pick(s, ["threePointFieldGoalsMade", "L:3PT", "L:3PM"]);
      case "hits": return pick(s, ["batting.hits", "batting.L:H"]);
      case "hr": return pick(s, ["batting.homeRuns", "batting.L:HR"]);
      case "rbi": return pick(s, ["batting.RBIs", "batting.rbis", "batting.L:RBI"]);
      case "runs": return pick(s, ["batting.runs", "batting.L:R"]);
      case "hrr": return sum(s, [["batting.hits", "batting.L:H"], ["batting.runs", "batting.L:R"], ["batting.RBIs", "batting.rbis", "batting.L:RBI"]]);
      case "so": return pick(s, ["pitching.strikeouts", "pitching.L:K"]) != null ? pick(s, ["pitching.strikeouts", "pitching.L:K"]) : pick(s, ["batting.strikeouts", "batting.L:K"]);
      case "hitsAllowed": return pick(s, ["pitching.hits", "pitching.L:H"]);
      case "er": return pick(s, ["pitching.earnedRuns", "pitching.L:ER"]);
      case "outs": var ip = pick(s, ["pitching.fullInnings.partInnings", "pitching.L:IP"]); if (ip == null) return null; var whole = Math.floor(ip); return whole * 3 + Math.round((ip - whole) * 10);
      case "goals": case "anyGoal": return pick(s, ["goals", "L:G", "totalGoals"]);
      case "sog": return pick(s, ["shotsTotal", "shots", "L:S", "L:SOG"]);
      case "saves": return pick(s, ["saves", "L:SV"]);
    }
    return null;
  }

  function nameMatch(want, p) {
    var w = norm(want).replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").trim();
    if (!w) return 0;
    var full = norm(p.name).replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").trim();
    if (w === full) return 3;
    var ww = w.split(" "), fw = full.split(" ");
    var last = fw[fw.length - 1];
    if (ww.length >= 2 && ww[ww.length - 1] === last && ww[0][0] === fw[0][0]) return 2;
    if (norm(p.short) && norm(p.short).replace(/\./g, "") === w.replace(/\./g, "")) return 2;
    if (ww.length === 1 && ww[0] === last) return 1;
    return 0;
  }
  function findPlayer(table, name) {
    var best = null;
    table.forEach(function (p) { var s = nameMatch(name, p); if (s && (!best || s > best.s)) best = { s: s, p: p }; });
    return best && best.s >= 2 ? best.p : null;
  }

  /* ------------------------------------------------------------ grading */

  function gradeTeamLeg(spec, ev) {
    var st = stateOf(ev), teams = teamsOf(ev);
    if (teams.length < 2) return null;
    var home = teams.find(function (x) { return x.homeAway === "home"; }) || teams[0];
    var away = teams.find(function (x) { return x.homeAway === "away"; }) || teams[1];
    var scoreLine = (away.abbr || away.display) + " " + away.score + " \u2013 " + (home.abbr || home.display) + " " + home.score;
    if (st.state === "pre") return { status: "pending", detail: st.detail };
    var final = st.state === "post";
    var tail = final ? "Final" : st.detail;
    var status, note;

    if (spec.kind === "total") {
      var total, who = "";
      var subj = spec.subject && findTeam(spec.subject, ev);
      if (subj && subj.team) { total = subj.team.score; who = subj.team.display + " "; }
      else total = home.score + away.score;
      var diff = spec.dir === "over" ? total - spec.line : spec.line - total;
      if (final) status = diff > 0 ? "won" : diff < 0 ? "lost" : "won";
      else if (spec.dir === "over" && total > spec.line) status = "won";
      else if (spec.dir === "under" && total > spec.line) status = "lost";
      else status = diff > 0 ? "live" : "at_risk";
      note = who + "Total " + total + " of " + (spec.dir === "over" ? "o" : "u") + spec.line + (final && diff === 0 ? " \u00b7 Push" : "");
      return { status: status, detail: note + " · " + scoreLine + " · " + tail };
    }

    if (spec.kind === "draw") {
      var tied = home.score === away.score;
      status = final ? (tied ? "won" : "lost") : (tied ? "live" : "at_risk");
      return { status: status, detail: scoreLine + " · " + tail };
    }

    var mine = spec.teamId ? teams.find(function (x) { return x.id === spec.teamId; }) : (findTeam(spec.team, ev) || {}).team;
    if (!mine) return null;
    var opp = mine === home ? away : home;
    var margin = mine.score - opp.score;
    if (spec.kind === "spread") {
      var cover = margin + spec.line;
      if (final) status = cover > 0 ? "won" : cover < 0 ? "lost" : "won";
      else status = cover > 0 ? "live" : "at_risk";
      note = cover === 0 ? "Push" : cover > 0 ? (final ? "Covered by " : "Covering by ") + fmtNum(cover) : (final ? "Missed by " + fmtNum(-cover) : "Needs " + (Math.floor(-cover) + 1) + " more");
    } else {
      if (final) status = margin > 0 ? "won" : "lost";
      else status = margin > 0 ? "live" : "at_risk";
      note = margin > 0 ? "Leading by " + margin : margin < 0 ? "Trailing by " + (-margin) : "Tied";
      if (final) note = margin > 0 ? "Won by " + margin : margin < 0 ? "Lost by " + (-margin) : "Tied";
    }
    return { status: status, detail: note + " · " + scoreLine + " · " + tail };
  }

  function gradeProp(spec, ev, summary, sport) {
    var st = stateOf(ev);
    if (st.state === "pre") return { status: "pending", detail: spec.metricLabel + " · " + st.detail };
    var p = findPlayer(playerTable(summary), spec.player);
    var final = st.state === "post";
    if (!p) return { status: final ? "pending" : "live", detail: (final ? "No stats for " : "Waiting for stats: ") + (spec.display || titleCase(spec.player)) + " · " + (final ? "Final" : st.detail), current: null };
    var v = statValue(p, spec.metric, sport);
    if (v == null) v = 0;
    var status;
    if (spec.dir === "over") status = v > spec.line ? "won" : final ? "lost" : "live";
    else status = v > spec.line ? "lost" : final ? "won" : "live";
    if (status === "live" && spec.dir === "over" && !final) {
      var need = spec.line - v;
      status = need <= Math.max(1, spec.line * 0.35) ? "live" : "at_risk";
    }
    var tgt = spec.dir === "over" ? Math.floor(spec.line) + 1 : spec.line;
    var detail = fmtNum(v) + " / " + (spec.dir === "over" ? tgt : "u" + spec.line) + " " + spec.unit + " · " + (final ? "Final" : st.detail);
    return { status: status, detail: detail, current: v, player: p.name, team: p.team };
  }

  /* ------------------------------------------------------------ engine */

  function Engine(opts) {
    this.client = new Client(opts.fetch, opts.now);
    this.now = opts.now || function () { return Date.now(); };
    this.today = opts.today || function () { return new Date(); };
    this.getBets = opts.getBets;
    this.update = opts.update;
    this.log = opts.log || function () {};
    this.scanCursor = {};
    this.running = false;
    this.lastLive = false;
    this.status = { ok: true, at: 0, message: "" };
  }

  function isOpen(b) { return b && b.status !== "won" && b.status !== "lost"; }

  Engine.prototype.leaguesFor = function (sport) {
    var order = [sport].concat(FALLBACK_ORDER.filter(function (s) { return s !== sport; }));
    return order.filter(function (s) { return LEAGUES[s]; });
  };

  Engine.prototype.windowDates = function () {
    var t = this.today(), out = [];
    for (var d = -1; d <= 6; d++) out.push(ymd(addDays(t, d)));
    return out;
  };

  // Find the event for a team-based leg inside one league's scoreboards.
  Engine.prototype.searchEvents = function (sport, dates, test) {
    var self = this, lgs = LEAGUES[sport] || [];
    var jobs = [];
    lgs.forEach(function (lg) {
      dates.forEach(function (d) {
        jobs.push(self.client.scoreboard(lg, d, d === ymd(self.today())).then(function (sb) {
          return { lg: lg, date: d, events: (sb && sb.events) || [] };
        }, function () { return { lg: lg, date: d, events: [], error: true }; }));
      });
    });
    return Promise.all(jobs).then(function (res) {
      var best = null, errors = 0;
      res.forEach(function (r) {
        if (r.error) errors++;
        r.events.forEach(function (ev) {
          var s = test(ev);
          if (s > 0) {
            var st = stateOf(ev), rank = s + (st.state === "in" ? 1000 : st.state === "pre" ? 500 : 0);
            if (!best || rank > best.rank) best = { rank: rank, ev: ev, lg: r.lg, sport: sport, date: r.date };
          }
        });
      });
      return { best: best, allFailed: errors === res.length && res.length > 0 };
    });
  };

  Engine.prototype.locate = function (bet, leg, spec, ctx) {
    var self = this;
    var sports = this.leaguesFor(bet.sport).slice(0, bet.sport ? 3 : 7);
    var dates = this.windowDates();
    var text = spec.kind === "spread" || spec.kind === "ml" ? spec.team : spec.kind === "total" && spec.subject ? spec.subject : null;
    var mu = ctx.matchup;
    var test = function (ev) {
      var score = 0;
      if (mu) {
        var a = findTeam(mu[0], ev), b = findTeam(mu[1], ev);
        if (a && b && a.team !== b.team) score = a.s + b.s + 50;
      }
      if (text) {
        var f = findTeam(text, ev);
        if (f) score = Math.max(score, f.s + (score ? 30 : 0));
        else if (spec.kind !== "total") score = 0;
      }
      return score;
    };
    if (spec.kind === "prop") {
      if (mu) return this.searchIn(sports, dates, test);
      return Promise.resolve({ best: null, scanProp: true });
    }
    if (!text && !mu) return Promise.resolve({ best: null });
    return this.searchIn(sports, dates, test);
  };

  Engine.prototype.searchIn = function (sports, dates, test) {
    var self = this, i = 0, failed = 0;
    function next() {
      if (i >= sports.length) return Promise.resolve({ best: null, allFailed: failed === sports.length });
      var sp = sports[i++];
      return self.searchEvents(sp, dates, test).then(function (r) {
        if (r.allFailed) failed++;
        return r.best ? r : next();
      });
    }
    return next();
  };

  // Scan in-progress / final games for a player (props without a known matchup).
  Engine.prototype.scanForPlayer = function (bet, spec) {
    var self = this, sport = bet.sport || "nfl", lgs = LEAGUES[sport] || [];
    var dates = [ymd(addDays(this.today(), -1)), ymd(this.today())];
    var jobs = [];
    lgs.forEach(function (lg) { dates.forEach(function (d) { jobs.push(self.client.scoreboard(lg, d, true).then(function (sb) { return { lg: lg, date: d, events: (sb && sb.events) || [] }; }, function () { return { lg: lg, date: d, events: [] }; })); }); });
    return Promise.all(jobs).then(function (res) {
      var cands = [];
      res.forEach(function (r) { r.events.forEach(function (ev) { if (stateOf(ev).state !== "pre") cands.push({ ev: ev, lg: r.lg, date: r.date }); }); });
      cands.sort(function (a, b) { return stateOf(a.ev).state === "in" ? -1 : 1; });
      var key = bet.id + ":" + spec.player, start = self.scanCursor[key] || 0, batch = cands.slice(start, start + 8);
      self.scanCursor[key] = start + 8 >= cands.length ? 0 : start + 8;
      return Promise.all(batch.map(function (c) {
        return self.client.summary(c.lg, c.ev.id, stateOf(c.ev).state === "in").then(function (sum) {
          return findPlayer(playerTable(sum), spec.player) ? { ev: c.ev, lg: c.lg, sport: sport, date: c.date } : null;
        }, function () { return null; });
      })).then(function (hits) { return { best: hits.find(Boolean) || null }; });
    });
  };

  Engine.prototype.refreshEvent = function (ref) {
    var self = this;
    var lg = { path: ref.path, q: ref.q };
    return this.client.scoreboard(lg, ref.date, true).then(function (sb) {
      var ev = ((sb && sb.events) || []).find(function (e) { return String(e.id) === String(ref.eventId); });
      return ev || null;
    });
  };

  function gameFromEvent(ev, sport) {
    var st = stateOf(ev), teams = teamsOf(ev);
    var home = teams.find(function (x) { return x.homeAway === "home"; }) || teams[0] || { display: "", abbr: "", score: 0 };
    var away = teams.find(function (x) { return x.homeAway === "away"; }) || teams[1] || { display: "", abbr: "", score: 0 };
    return {
      id: "espn-" + ev.id, sport: sport,
      status: st.state === "in" ? "live" : st.state === "post" ? "final" : "scheduled",
      home: { name: home.display, abbr: home.abbr, score: home.score },
      away: { name: away.display, abbr: away.abbr, score: away.score },
      period: st.state === "post" ? "Final" : st.detail, clock: "",
      startsAt: ev.date
    };
  }

  function betStatus(legs) {
    if (!legs.length) return "pending";
    if (legs.some(function (l) { return l.status === "lost"; })) return "lost";
    if (legs.every(function (l) { return l.status === "won"; })) return "won";
    if (legs.some(function (l) { return l.status === "at_risk"; })) return "at_risk";
    var started = legs.filter(function (l) { return l.status === "live" || l.status === "won"; });
    if (legs.some(function (l) { return l.status === "live"; })) return started.length ? "winning" : "live";
    return "pending";
  }

  Engine.prototype.processBet = function (bet) {
    var self = this;
    var legs = (bet.legs && bet.legs.length) ? bet.legs.slice() : [{ id: bet.id + "-leg-1", label: bet.eventLabel, status: bet.status === "live" ? "live" : "pending" }];
    var ctxs = legContexts(legs, bet.sourceText);
    var anyLive = false, anyError = false;

    return Promise.all(legs.map(function (leg, i) {
      if (leg.status === "won" || leg.status === "lost") {
        if (leg.live && leg.live.final) return Promise.resolve(leg);
      }
      var spec = leg.live && leg.live.spec ? leg.live.spec : parseLeg(leg.label, ctxs[i].extra);
      if (spec.kind === "unknown" || spec.kind === "unsupported") {
        return Promise.resolve(Object.assign({}, leg, { detail: spec.kind === "unsupported" ? "Not auto-tracked — settle manually" : "Couldn't read this leg — edit it to track", live: { spec: spec } }));
      }
      var ref = leg.live && leg.live.ref;
      var find = function () { return self.locate(bet, leg, spec, ctxs[i]).then(function (r) { return r.scanProp ? self.scanForPlayer(bet, spec) : r; }); };
      var located = ref ? self.refreshEvent(ref).then(function (ev) { return ev ? { best: { ev: ev, lg: { path: ref.path, q: ref.q }, sport: ref.sport, date: ref.date } } : find(); }, find) : find();

      return located.then(function (r) {
        var best = r && r.best;
        if (!best) {
          if (r && r.allFailed) anyError = true;
          return Object.assign({}, leg, {
            detail: r && r.allFailed ? "Live data unavailable — retrying" : spec.kind === "prop" ? "Waiting for " + (spec.display || titleCase(spec.player)) + "'s game to start" : "Game not found yet — checking again soon",
            live: { spec: spec }
          });
        }
        var ev = best.ev, st = stateOf(ev);
        if (st.state === "in") anyLive = true;
        var newRef = { eventId: ev.id, path: best.lg.path, q: best.lg.q, sport: best.sport, date: best.date || (ref && ref.date) || ymd(new Date(ev.date)) };
        var gradeP;
        if (spec.kind === "prop" && /^(pts|goals|runs)$/.test(spec.metric)) {
          var asTeam = findTeam(spec.player, ev);
          if (asTeam && asTeam.s >= 4) spec = { kind: "total", raw: spec.raw, subject: spec.player, dir: spec.dir, line: spec.line };
        }
        if (spec.kind === "prop") {
          gradeP = st.state === "pre" ? Promise.resolve(gradeProp(spec, ev, null, best.sport))
            : self.client.summary(best.lg, ev.id, st.state === "in").then(function (sum) { return gradeProp(spec, ev, sum, best.sport); });
        } else {
          if (spec.kind === "spread" || spec.kind === "ml") {
            var f = findTeam(spec.team, ev);
            if (f) spec = Object.assign({}, spec, { teamId: f.team.id });
          }
          gradeP = Promise.resolve(gradeTeamLeg(spec, ev) || { status: leg.status, detail: "Game found — team unclear" });
        }
        return gradeP.then(function (g) {
          return Object.assign({}, leg, {
            status: g.status, detail: g.detail,
            live: { spec: spec, ref: newRef, final: st.state === "post" && (g.status === "won" || g.status === "lost"), current: g.current, player: g.player, team: g.team },
            game: gameFromEvent(ev, best.sport)
          });
        });
      }, function (e) {
        anyError = true;
        self.log("leg error", e);
        return Object.assign({}, leg, { detail: "Live data unavailable — retrying", live: { spec: spec, ref: ref } });
      });
    })).then(function (newLegs) {
      var patch = {};
      var status = betStatus(newLegs);
      var shown = newLegs.find(function (l) { return l.game && l.game.status === "live"; }) || newLegs.find(function (l) { return l.game && l.status !== "won" && l.status !== "lost"; }) || newLegs.find(function (l) { return l.game; });
      if (shown) patch.game = shown.game;
      if (bet.legs && bet.legs.length) patch.legs = newLegs.map(function (l) { var c = Object.assign({}, l); delete c.game; return c; });
      else patch.legs = undefined;
      var propLeg = newLegs.find(function (l) { return l.live && l.live.spec && l.live.spec.kind === "prop"; });
      if (propLeg && (bet.betType === "player_prop" || bet.playerStat || newLegs.length === 1)) {
        var sp = propLeg.live.spec;
        patch.playerStat = {
          player: propLeg.live.player || sp.display || titleCase(sp.player), teamAbbr: propLeg.live.team || "",
          metric: sp.metricLabel, current: propLeg.live.current != null ? propLeg.live.current : 0,
          target: sp.dir === "over" ? Math.floor(sp.line) + 1 : sp.line, unit: sp.unit
        };
      }
      patch.status = status;
      if (!bet.legs || !bet.legs.length) {
        patch.status = status;
        patch.legs = [Object.assign({}, newLegs[0], { game: undefined })];
      }
      patch.liveCheckedAt = new Date(self.now()).toISOString();
      return { patch: patch, live: anyLive, error: anyError };
    });
  };

  function titleCase(s) { return String(s || "").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }

  function changed(bet, patch) {
    var keys = ["status", "legs", "game", "playerStat"];
    for (var i = 0; i < keys.length; i++) {
      if (JSON.stringify(bet[keys[i]]) !== JSON.stringify(patch[keys[i]])) return true;
    }
    return false;
  }

  Engine.prototype.tick = function () {
    var self = this;
    if (this.running) return Promise.resolve(this.lastLive);
    this.running = true;
    var bets = (this.getBets() || []).filter(isOpen);
    return Promise.all(bets.map(function (b) {
      return self.processBet(b).then(function (r) { return { bet: b, r: r }; }, function (e) { self.log("bet error", e); return null; });
    })).then(function (results) {
      var live = false, err = false;
      results.forEach(function (x) {
        if (!x) return;
        if (x.r.live) live = true;
        if (x.r.error) err = true;
        if (changed(x.bet, x.r.patch)) {
          var p = Object.assign({}, x.r.patch);
          p.updatedAt = new Date(self.now()).toISOString();
          self.update(x.bet.id, p);
        }
      });
      self.lastLive = live;
      var tracked = results.filter(Boolean).length;
      self.status = { ok: !err, at: self.now(), message: err ? "Live data unavailable" : "", tracked: tracked, live: live, fetchedOk: self.client.errors === 0 };
      if (typeof self.onStatus === "function") { try { self.onStatus(self.status); } catch (e) {} }
      self.running = false;
      return live;
    }, function (e) { self.running = false; throw e; });
  };

  var api = { Engine: Engine, parseLeg: parseLeg, legContexts: legContexts, playerTable: playerTable, statValue: statValue, gradeTeamLeg: gradeTeamLeg, gradeProp: gradeProp, betStatus: betStatus, findTeam: findTeam, norm: norm };

  /* ------------------------------------------------------- browser boot */

  function boot() {
    var store = root.__bfStore;
    if (!store || root.__bfLiveStarted) return;
    root.__bfLiveStarted = true;
    var engine = new Engine({
      fetch: function (u) { return root.fetch(u, { cache: "no-store" }); },
      getBets: function () { return store.getState().bets; },
      update: function (id, patch) {
        store.setState(function (s) {
          return { bets: s.bets.map(function (b) { return b.id === id ? Object.assign({}, b, patch) : b; }) };
        });
      },
      log: function () { try { console.warn.apply(console, ["[betfolio live]"].concat([].slice.call(arguments))); } catch (e) {} }
    });
    root.__bfLive = engine;
    var pill = null;
    function paint() {
      var onLive = /#\/app\/live/.test(root.location.hash);
      if (!onLive) { if (pill) pill.style.display = "none"; return; }
      if (!pill) {
        pill = root.document.createElement("div");
        pill.setAttribute("role", "status");
        pill.style.cssText = "position:fixed;top:calc(10px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:60;padding:6px 12px;border-radius:999px;font:500 11px/1.2 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.06em;background:rgba(14,16,20,.8);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);white-space:nowrap;pointer-events:none";
        root.document.body.appendChild(pill);
      }
      var st = engine.status || {};
      var ago = st.at ? Math.max(0, Math.round((Date.now() - st.at) / 1000)) : null;
      var ok = st.at && st.ok;
      pill.style.display = "block";
      pill.style.color = !st.at ? "#8b93a1" : ok ? "#5cf2a6" : "#ffcb5c";
      pill.textContent = !st.at ? "\u25cb LIVE DATA \u00b7 CONNECTING" : ok
        ? "\u25cf LIVE DATA OK \u00b7 " + (st.tracked || 0) + " SLIP" + (st.tracked === 1 ? "" : "S") + " \u00b7 " + (ago < 5 ? "JUST NOW" : ago + "S AGO")
        : "\u25b2 ESPN UNREACHABLE \u00b7 RETRYING";
    }
    engine.onStatus = paint;
    root.addEventListener("hashchange", paint);
    setInterval(paint, 5000);
    var timer = 0;
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms); }
    function run() {
      if (root.document && root.document.hidden) { schedule(60000); return; }
      engine.tick().then(function (live) { schedule(live ? 20000 : 120000); }, function () { schedule(60000); });
    }
    var known = {};
    (store.getState().bets || []).forEach(function (b) { known[b.id] = 1; });
    store.subscribe(function (s) {
      var fresh = false;
      (s.bets || []).forEach(function (b) { if (!known[b.id]) { known[b.id] = 1; fresh = true; } });
      if (fresh) schedule(800);
    });
    if (root.document) root.document.addEventListener("visibilitychange", function () { if (!root.document.hidden) schedule(300); });
    schedule(500);
  }

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.BetfolioLive = api;
    if (root.__bfStore) boot(); else root.addEventListener("bf:store", boot);
  }
})(typeof window !== "undefined" ? window : globalThis);
