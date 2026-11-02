/* Interfaccia: carica i dati da data/, costruisce il modello e disegna i risultati. */
(function () {
  "use strict";
  const M = window.NBAModel;
  const $ = s => document.querySelector(s);
  let ctx = null, mode = "player", selected = null, suggIdx = -1, suggList = [];

  const pct = p => Math.round(p * 100) + "%";
  const color = p => p >= .65 ? "var(--good)" : p >= .4 ? "var(--mid)" : "var(--bad)";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ord = n => n + "ª";
  const fmtDate = utc => utc ? new Date(utc).toLocaleString("it-IT",
    { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";

  // ------------------------------------------------------------ dati
  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  async function liveInjuries() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const d = await getJSON("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
                              { signal: ctrl.signal, cache: "no-store" });
      const out = [];
      for (const team of d.injuries || []) for (const inj of team.injuries || []) {
        const a = inj.athlete || {};
        let id = a.id;
        if (!id) for (const l of a.links || []) { const m = /\/id\/(\d+)/.exec(l.href || ""); if (m) { id = m[1]; break; } }
        out.push({ id: id ? String(id) : null, name: a.displayName,
                   status: inj.status || (inj.type || {}).description, comment: inj.shortComment || "" });
      }
      return out.length ? out : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  async function loadData() {
    $("#status").textContent = "Caricamento dati…";
    const meta = await getJSON("data/meta.json", { cache: "no-store" });
    const v = encodeURIComponent(meta.updated_at || "");
    const files = await Promise.all(meta.files.map(f => getJSON(`data/${f}?v=${v}`).then(j => [f, j])));
    const logs = {};
    for (const [f, j] of files) {
      const season = f.split("/").pop().slice(0, 7);
      (logs[season] ||= []).push(...M.decodeLogFile(j));
    }
    ctx = new M.Context({ ...meta, logs });
    let injSrc = "aggiornamento dati";
    const live = await liveInjuries();
    if (live) { ctx.setInjuries(live); injSrc = "ESPN in tempo reale"; }
    const upd = meta.updated_at ? new Date(meta.updated_at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "?";
    $("#status").innerHTML = `Stagione ${esc(ctx.season)} · statistiche al ${esc(upd)} · infortuni: ${esc(injSrc)}
      <button id="refresh">Ricarica</button>`;
    $("#refresh").onclick = async () => { await loadData(); run(); };
  }

  function teamOptions() {
    const opts = M.TEAMS.map(t => `<option value="${t.tri}">${esc(t.name)}</option>`).join("");
    $("#team").innerHTML = `<option value="">Scegli una squadra…</option>` + opts;
    $("#opp").innerHTML = `<option value="">Avversario: prossima partita</option>` + opts;
  }

  // ------------------------------------------------------------ logica
  function opponent(tri) {
    const o = $("#opp").value;
    if (o) {
      if (o === tri) throw new Error("Avversario uguale alla squadra.");
      return { opp: o, home: null, utc: null, manual: true };
    }
    const g = ctx.nextGame(tri);
    if (!g) throw new Error(`Nessuna partita in calendario nei prossimi 14 giorni per ${M.TEAM[tri].name}. Scegli un avversario dal menu.`);
    return g;
  }

  function playerResult(pid) {
    const tri = ctx.playerTeam(pid);
    if (!tri) throw new Error("Giocatore non trovato.");
    const game = opponent(tri);
    const res = ctx.project(pid, game.opp, game.home);
    if (!res) throw new Error("Nessuna partita disponibile per questo giocatore.");
    res.game = game;
    res.opp_profile = ctx.opponentProfile(game.opp);
    return res;
  }

  function teamResult(tri, both) {
    const game = opponent(tri);
    const res = { game, team: ctx.projectTeam(tri, game.opp, game.home),
                  opp_profile: ctx.opponentProfile(game.opp), own_profile: ctx.opponentProfile(tri) };
    if (both) res.opponent = ctx.projectTeam(game.opp, tri, game.home == null ? null : !game.home);
    return res;
  }

  // ------------------------------------------------------------ UI
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === b));
    mode = b.dataset.mode;
    $("#playerBox").classList.toggle("hidden", mode !== "player");
    $("#team").classList.toggle("hidden", mode !== "team");
    $("#bothBox").classList.toggle("hidden", mode !== "team");
  });

  $("#pq").addEventListener("input", () => {
    selected = null;
    const q = $("#pq").value.trim();
    if (q.length < 2 || !ctx) return $("#sugg").classList.add("hidden");
    suggList = ctx.searchPlayers(q);
    suggIdx = -1;
    renderSugg();
  });
  function renderSugg() {
    const box = $("#sugg");
    box.innerHTML = suggList.length ? suggList.map((p, i) =>
      `<div data-i="${i}" class="${i === suggIdx ? "hl" : ""}">${esc(p.name)} <small>${esc(p.team)} · ${p.games} gare</small></div>`).join("")
      : `<div><small>Nessun giocatore trovato</small></div>`;
    box.classList.remove("hidden");
    box.querySelectorAll("[data-i]").forEach(d => d.onmousedown = d.ontouchstart = e => { e.preventDefault(); pick(+d.dataset.i); });
  }
  function pick(i) {
    selected = suggList[i];
    $("#pq").value = selected.name;
    $("#sugg").classList.add("hidden");
    $("#pq").blur();
    run();
  }
  $("#pq").addEventListener("keydown", e => {
    if ($("#sugg").classList.contains("hidden")) { if (e.key === "Enter") run(); return; }
    if (e.key === "ArrowDown") { suggIdx = Math.min(suggList.length - 1, suggIdx + 1); renderSugg(); e.preventDefault(); }
    if (e.key === "ArrowUp") { suggIdx = Math.max(0, suggIdx - 1); renderSugg(); e.preventDefault(); }
    if (e.key === "Enter") pick(suggIdx >= 0 ? suggIdx : 0);
    if (e.key === "Escape") $("#sugg").classList.add("hidden");
  });
  $("#pq").addEventListener("blur", () => setTimeout(() => $("#sugg").classList.add("hidden"), 150));
  $("#go").onclick = run;
  $("#team").onchange = run;
  $("#opp").onchange = () => { if (selected || $("#team").value) run(); };

  function run() {
    if (!ctx) return;
    try {
      if (mode === "player") {
        if (!selected) { if (suggList.length) return pick(0); return; }
        $("#out").innerHTML = renderPlayer(playerResult(selected.id));
      } else {
        const t = $("#team").value;
        if (!t) return;
        $("#out").innerHTML = renderTeam(teamResult(t, $("#both").checked));
      }
      bindRows();
    } catch (e) {
      $("#out").innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
  }
  function bindRows() {
    document.querySelectorAll("tr[data-pid]").forEach(tr => tr.onclick = () => {
      selected = { id: +tr.dataset.pid, name: tr.dataset.name };
      document.querySelector('.tab[data-mode="player"]').click();
      $("#pq").value = selected.name;
      window.scrollTo({ top: 0, behavior: "smooth" });
      run();
    });
  }

  // ------------------------------------------------------------ render
  function matchupLine(teamTri, game, oppTri) {
    const where = game.home === false ? "@" : "vs";
    const when = game.manual ? "avversario scelto a mano" : (game.live ? "IN CORSO · " : "") + fmtDate(game.utc);
    return `<div class="vs">${esc(teamTri)} ${where} <b>${esc(oppTri)}</b></div><div class="sub">${esc(when)}</div>`;
  }

  function oppChips(prof) {
    const c = prof.allowed.map(a => {
      const d = Math.round((a.factor - 1) * 100);
      const cls = d > 0 ? "up" : d < 0 ? "dn" : "";
      return `<span class="chip">${esc(a.label)}: <b class="${cls}">${d > 0 ? "+" : ""}${d}%</b> <small>(${ord(a.rank)})</small></span>`;
    });
    const pd = Math.round((prof.pace.rel - 1) * 100);
    c.unshift(`<span class="chip">Ritmo: <b class="${pd > 0 ? "up" : pd < 0 ? "dn" : ""}">${pd > 0 ? "+" : ""}${pd}%</b> <small>(${ord(prof.pace.rank)})</small></span>`);
    return `<h3>Cosa concede ${esc(prof.team.name)} rispetto alla media NBA <small class="nt">(1ª = la più permissiva)</small></h3><div class="opp">${c.join("")}</div>`;
  }

  function statCard(s) {
    const lk = s.likely ? `Molto probabile: <b>almeno ${s.likely.line}</b> (${pct(s.likely.prob)})` : `<span style="color:var(--muted)">Nessuna soglia oltre il 60%</span>`;
    const av = [
      s.season_avg != null ? `Stagione <b>${s.season_avg}</b>` : s.prev_avg != null ? `Anno scorso <b>${s.prev_avg}</b>` : "",
      `L10 <b>${s.l10_avg}</b>`,
      s.h2h_avg != null ? `vs avv. <b>${s.h2h_avg}</b>` : "",
    ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
    const lines = s.lines.map(l => `
      <div class="ln"><span>${l.line}+</span>
        <div class="bar"><i style="width:${pct(l.prob)};background:${color(l.prob)}"></i></div>
        <span style="text-align:right">${pct(l.prob)}</span>
        <span class="hr">${l.l10[0]}/${l.l10[1]}</span></div>`).join("");
    return `<div class="card">
      <div class="top"><span class="name">${esc(s.label)}</span><span class="proj">${s.proj}</span></div>
      <div class="likely">${lk}</div>
      <div class="avgs">${av}</div>
      <div class="ln lnh"><span>soglia</span><span>probabilità</span><span></span><span class="hr">L10</span></div>
      ${lines}</div>`;
  }

  function renderPlayer(d) {
    const w = d.warnings.map(x => `<div class="warn">⚠ ${esc(x)}</div>`).join("");
    const recent = d.recent.map(g => `<tr><td>${esc(g.date.slice(5))}</td><td>${g.home ? "vs" : "@"} ${esc(g.opp)}</td><td>${g.min}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td></tr>`).join("");
    const h2h = d.h2h_games.length ? d.h2h_games.map(g => `<tr><td>${esc(g.date)}</td><td>${g.min}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td></tr>`).join("")
      : `<tr><td colspan="6" style="color:var(--muted)">Nessun precedente nelle ultime stagioni</td></tr>`;
    return `
    <div class="hero">
      <div><h2>${esc(d.player.name)}</h2><div class="sub">${esc(d.player.team.name)}</div>
        ${matchupLine(d.player.team.tri, d.game, d.opponent.tri)}</div>
      <div class="kpis">
        <div class="kpi"><b>${d.minutes}</b><span>minuti attesi</span></div>
        <div class="kpi"><b>${d.games.season}</b><span>gare stagione</span></div>
        <div class="kpi"><b>${d.games.h2h}</b><span>precedenti</span></div>
      </div>
    </div>${w}
    <h3>Proiezioni contro ${esc(d.opponent.name)}</h3>
    <div class="grid">${d.stats.map(statCard).join("")}</div>
    ${oppChips(d.opp_profile)}
    <div class="two">
      <div><h3>Ultime 10 partite</h3><table><tr><th>Data</th><th>Avv.</th><th>Min</th><th>Pt</th><th>Rb</th><th>As</th><th>3P</th></tr>${recent}</table></div>
      <div><h3>Precedenti contro ${esc(d.opponent.tri)}</h3><table><tr><th>Data</th><th>Min</th><th>Pt</th><th>Rb</th><th>As</th><th>3P</th></tr>${h2h}</table></div>
    </div>`;
  }

  const COLS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "PRA"];
  const SHORT = { PTS: "Pt", REB: "Rb", AST: "As", FG3M: "3P", STL: "Rub", BLK: "Stp", PRA: "P+R+A" };

  function teamBlock(t) {
    const leaders = t.leaders.filter(l => l.stat !== "TOV").map(l => `
      <div class="card leader"><div class="name">${esc(l.label)}</div><ol>
        ${l.players.slice(0, 3).map(p => `<li><span>${esc(p.name)} ${p.likely ? `<small>≥${p.likely.line} ${pct(p.likely.prob)}</small>` : ""}</span><span class="v">${p.proj}</span></li>`).join("")}
      </ol></div>`).join("");
    const rows = t.players.map(p => {
      const m = Object.fromEntries(p.stats.map(s => [s.stat, s]));
      const warn = p.injury ? ` <span class="inj" title="${esc(p.injury.status)}">${esc((p.injury.status || "").slice(0, 3))}</span>` : "";
      return `<tr class="click" data-pid="${p.player.id}" data-name="${esc(p.player.name)}"><td>${esc(p.player.name)}${warn}</td><td>${p.minutes}</td>${COLS.map(c => `<td>${m[c].proj}</td>`).join("")}</tr>`;
    }).join("");
    const absent = t.absent.length ? `<div class="warn">Esclusi: ${t.absent.map(a => `${esc(a.name)} <small>(${esc(a.reason)})</small>`).join(", ")}</div>` : "";
    return `
      <h3>Chi è più probabile che faccia cosa · ${esc(t.team.name)} contro ${esc(t.opponent.tri)}</h3>
      <div class="grid">${leaders}</div>
      <h3>Proiezioni per giocatore <small class="nt">(tocca un nome per il dettaglio)</small></h3>
      <div class="scroll"><table><tr><th>Giocatore</th><th>Min</th>${COLS.map(c => `<th>${SHORT[c]}</th>`).join("")}</tr>${rows}</table></div>${absent}`;
  }

  function renderTeam(d) {
    const t = d.team;
    return `
    <div class="hero"><div><h2>${esc(t.team.name)}</h2>${matchupLine(t.team.tri, d.game, t.opponent.tri)}</div></div>
    ${teamBlock(t)}
    ${oppChips(d.opp_profile)}
    ${d.opponent ? `<div class="sep"></div>${teamBlock(d.opponent)}${oppChips(d.own_profile)}` : ""}`;
  }

  // ------------------------------------------------------------ avvio
  teamOptions();
  loadData().catch(e => {
    $("#status").innerHTML = `<span style="color:var(--bad)">Dati non disponibili: ${esc(e.message)}</span>`;
    $("#out").innerHTML = `<div class="err">Non riesco a caricare i dati. Se l'app è appena stata creata, il primo aggiornamento potrebbe essere ancora in corso.</div>`;
  });
})();
