"""Verifica quali fonti dati NBA rispondono dai server di GitHub.
Scrive il risultato in test-report.md."""
import json
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
H = {"User-Agent": UA, "Accept": "application/json", "Referer": "https://www.nba.com/",
     "Origin": "https://www.nba.com"}

rows = []


def get(url, timeout=25):
    t = time.time()
    try:
        req = urllib.request.Request(url, headers=H)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            cors = r.headers.get("Access-Control-Allow-Origin")
            return r.status, json.loads(body), round(time.time() - t, 1), len(body), cors
    except Exception as e:  # noqa: BLE001
        return None, str(e)[:120], round(time.time() - t, 1), 0, None


def check(name, url, test=None):
    status, data, secs, size, cors = get(url)
    ok = status == 200
    note = ""
    if ok and test:
        try:
            note = test(data)
        except Exception as e:  # noqa: BLE001
            ok, note = False, f"formato inatteso: {e}"
    elif not ok:
        note = data
    rows.append((name, "OK" if ok else "NO", secs, f"{size // 1024} KB", cors or "-", note))
    return data if ok else None


def box_note(d):
    g = d["game"]
    p = g["homeTeam"]["players"][0]["statistics"]
    keys = ["points", "reboundsTotal", "assists", "threePointersMade", "steals", "blocks",
            "turnovers", "minutes", "fieldGoalsAttempted", "freeThrowsAttempted", "reboundsOffensive"]
    missing = [k for k in keys if k not in p]
    return f"{g['awayTeam']['teamTricode']}@{g['homeTeam']['teamTricode']} {g.get('gameEt', '')[:10]}" + \
        (f" MANCANO {missing}" if missing else " campi ok")


sched = check("cdn.nba.com calendario", "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json",
              lambda d: f"stagione {d['leagueSchedule']['seasonYear']}, "
                        f"{sum(len(x['games']) for x in d['leagueSchedule']['gameDates'])} partite")

# box score di una partita finita di questa stagione
if sched:
    done = [g["gameId"] for day in sched["leagueSchedule"]["gameDates"] for g in day["games"]
            if g.get("gameStatus") == 3 and g["gameId"].startswith("002")]
    if done:
        check("cdn.nba.com box score (questa stagione)",
              f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{done[-1]}.json", box_note)

for season, gid in [("2025-26", "0022500500"), ("2024-25", "0022400500"), ("2023-24", "0022300500")]:
    check(f"cdn.nba.com box score {season}",
          f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{gid}.json", box_note)

check("stats.nba.com (atteso: bloccato)",
      "https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=1&LeagueID=00&Season=2026-27",
      lambda d: "risponde!")

check("ESPN calendario/risultati", "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      lambda d: f"{len(d.get('events', []))} partite oggi")
inj = check("ESPN infortuni", "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
            lambda d: f"{sum(len(t.get('injuries', [])) for t in d.get('injuries', []))} giocatori in lista")
sb = check("ESPN partite 1 gen 2025",
           "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20250101",
           lambda d: f"{len(d.get('events', []))} partite")
if sb and sb.get("events"):
    eid = sb["events"][0]["id"]
    check("ESPN box score storico",
          f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={eid}",
          lambda d: f"{len(d['boxscore']['players'])} squadre, labels: "
                    f"{','.join(d['boxscore']['players'][0]['statistics'][0]['labels'])}")

lines = ["# Test fonti dati", "", f"Eseguito: {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}", "",
         "| Fonte | Esito | Secondi | Dimensione | CORS | Note |", "|---|---|---|---|---|---|"]
lines += [f"| {' | '.join(str(c) for c in r)} |" for r in rows]
report = "\n".join(lines) + "\n"
print(report)
with open("test-report.md", "w", encoding="utf-8") as f:
    f.write(report)
