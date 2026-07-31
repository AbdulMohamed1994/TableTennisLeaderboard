#!/usr/bin/env python3
"""Office table tennis leaderboard: single-file backend, stdlib only.

Run: python3 server.py [port]
Then open http://<this-machine-ip>:<port>/ from any device on the office network.
"""
import json
import os
import re
import sqlite3
import sys
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pingpong.db")
INDEX_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
WIN_SCORE = 21
WIN_MARGIN = 2


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_a_id INTEGER NOT NULL REFERENCES players(id),
            player_b_id INTEGER NOT NULL REFERENCES players(id),
            score_a INTEGER NOT NULL,
            score_b INTEGER NOT NULL,
            played_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.commit()
    conn.close()


def iso_week_key(iso_date_str):
    d = date.fromisoformat(iso_date_str)
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


def validate_game(score_a, score_b):
    if not isinstance(score_a, int) or not isinstance(score_b, int):
        return "Scores must be whole numbers."
    if score_a < 0 or score_b < 0:
        return "Scores can't be negative."
    if score_a == score_b:
        return "A match can't end in a tie."
    winner, loser = max(score_a, score_b), min(score_a, score_b)
    if winner < WIN_SCORE:
        return f"Winning score must be at least {WIN_SCORE}."
    if winner - loser < WIN_MARGIN:
        return f"Winner must win by at least {WIN_MARGIN} points."
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "PingPongLeaderboard/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, message, status=400):
        self._send_json({"error": message}, status)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/" or path == "/index.html":
            self._serve_index()
        elif path == "/api/players":
            self._get_players()
        elif path == "/api/matches":
            self._get_matches(qs)
        elif path == "/api/leaderboard":
            self._get_leaderboard(qs)
        elif path == "/api/weeks":
            self._get_weeks()
        else:
            self._send_error_json("Not found", 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/players":
            self._create_player()
        elif path == "/api/matches":
            self._create_match()
        else:
            self._send_error_json("Not found", 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        m = re.match(r"^/api/matches/(\d+)$", parsed.path)
        if m:
            self._delete_match(int(m.group(1)))
        else:
            self._send_error_json("Not found", 404)

    def _serve_index(self):
        try:
            with open(INDEX_PATH, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            self._send_error_json("index.html missing", 500)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _get_players(self):
        conn = get_db()
        rows = conn.execute("SELECT id, name FROM players ORDER BY name COLLATE NOCASE").fetchall()
        conn.close()
        self._send_json([dict(r) for r in rows])

    def _create_player(self):
        data = self._read_json_body()
        if data is None:
            return self._send_error_json("Invalid JSON body")
        name = (data.get("name") or "").strip()
        if not name:
            return self._send_error_json("Player name is required")
        if len(name) > 40:
            return self._send_error_json("Player name is too long")
        conn = get_db()
        try:
            cur = conn.execute("INSERT INTO players (name) VALUES (?)", (name,))
            conn.commit()
            player_id = cur.lastrowid
        except sqlite3.IntegrityError:
            conn.close()
            return self._send_error_json("A player with that name already exists", 409)
        conn.close()
        self._send_json({"id": player_id, "name": name}, 201)

    def _get_matches(self, qs):
        week = (qs.get("week") or [None])[0]
        conn = get_db()
        rows = conn.execute(
            """
            SELECT m.id, m.score_a, m.score_b, m.played_at, m.created_at,
                   pa.id AS player_a_id, pa.name AS player_a_name,
                   pb.id AS player_b_id, pb.name AS player_b_name
            FROM matches m
            JOIN players pa ON pa.id = m.player_a_id
            JOIN players pb ON pb.id = m.player_b_id
            ORDER BY m.played_at DESC, m.id DESC
            """
        ).fetchall()
        conn.close()
        result = []
        for r in rows:
            if week and iso_week_key(r["played_at"]) != week:
                continue
            winner = r["player_a_name"] if r["score_a"] > r["score_b"] else r["player_b_name"]
            result.append(
                {
                    "id": r["id"],
                    "player_a": {"id": r["player_a_id"], "name": r["player_a_name"]},
                    "player_b": {"id": r["player_b_id"], "name": r["player_b_name"]},
                    "score_a": r["score_a"],
                    "score_b": r["score_b"],
                    "played_at": r["played_at"],
                    "week": iso_week_key(r["played_at"]),
                    "winner": winner,
                }
            )
        self._send_json(result)

    def _create_match(self):
        data = self._read_json_body()
        if data is None:
            return self._send_error_json("Invalid JSON body")
        try:
            player_a_id = int(data.get("player_a_id"))
            player_b_id = int(data.get("player_b_id"))
            score_a = int(data.get("score_a"))
            score_b = int(data.get("score_b"))
        except (TypeError, ValueError):
            return self._send_error_json("player_a_id, player_b_id, score_a, score_b are required")

        if player_a_id == player_b_id:
            return self._send_error_json("A player can't play against themselves")

        error = validate_game(score_a, score_b)
        if error:
            return self._send_error_json(error)

        played_at = (data.get("played_at") or "").strip() or date.today().isoformat()
        try:
            date.fromisoformat(played_at)
        except ValueError:
            return self._send_error_json("played_at must be an ISO date (YYYY-MM-DD)")

        conn = get_db()
        players = conn.execute(
            "SELECT id FROM players WHERE id IN (?, ?)", (player_a_id, player_b_id)
        ).fetchall()
        if len(players) != 2:
            conn.close()
            return self._send_error_json("Unknown player id")

        cur = conn.execute(
            """
            INSERT INTO matches (player_a_id, player_b_id, score_a, score_b, played_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (player_a_id, player_b_id, score_a, score_b, played_at, datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        match_id = cur.lastrowid
        conn.close()
        self._send_json({"id": match_id}, 201)

    def _delete_match(self, match_id):
        conn = get_db()
        cur = conn.execute("DELETE FROM matches WHERE id = ?", (match_id,))
        conn.commit()
        conn.close()
        if cur.rowcount == 0:
            return self._send_error_json("Match not found", 404)
        self._send_json({"deleted": match_id})

    def _get_weeks(self):
        conn = get_db()
        rows = conn.execute("SELECT DISTINCT played_at FROM matches").fetchall()
        conn.close()
        weeks = sorted({iso_week_key(r["played_at"]) for r in rows}, reverse=True)
        current = iso_week_key(date.today().isoformat())
        self._send_json({"weeks": weeks, "current_week": current})

    def _get_leaderboard(self, qs):
        week = (qs.get("week") or [None])[0]
        conn = get_db()
        players = conn.execute("SELECT id, name FROM players").fetchall()
        matches = conn.execute(
            "SELECT player_a_id, player_b_id, score_a, score_b, played_at FROM matches"
        ).fetchall()
        conn.close()

        stats = {
            p["id"]: {
                "id": p["id"],
                "name": p["name"],
                "played": 0,
                "wins": 0,
                "losses": 0,
                "points_scored": 0,
                "points_conceded": 0,
            }
            for p in players
        }

        for m in matches:
            if week and iso_week_key(m["played_at"]) != week:
                continue
            a, b = stats.get(m["player_a_id"]), stats.get(m["player_b_id"])
            if not a or not b:
                continue
            a["played"] += 1
            b["played"] += 1
            a["points_scored"] += m["score_a"]
            a["points_conceded"] += m["score_b"]
            b["points_scored"] += m["score_b"]
            b["points_conceded"] += m["score_a"]
            if m["score_a"] > m["score_b"]:
                a["wins"] += 1
                b["losses"] += 1
            else:
                b["wins"] += 1
                a["losses"] += 1

        board = list(stats.values())
        for row in board:
            row["point_diff"] = row["points_scored"] - row["points_conceded"]
            row["win_pct"] = round(100 * row["wins"] / row["played"], 1) if row["played"] else 0.0
            row["avg_points"] = round(row["points_scored"] / row["played"], 1) if row["played"] else 0.0

        board.sort(key=lambda r: (-r["wins"], -r["point_diff"], -r["points_scored"], r["name"].lower()))
        self._send_json(board)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Table tennis leaderboard running: http://localhost:{port}/")
    print("Share the office machine's LAN IP + this port with coworkers so everyone can log matches.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
