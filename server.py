#!/usr/bin/env python3
"""Edusnap JEE Mathematics practice app: standard-library HTTP server + SQLite."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "questions.json"
DB_FILE = Path(os.environ.get("JEE_DB_PATH", ROOT / "data" / "practice.sqlite3")).expanduser()
STATIC_DIR = ROOT / "static"
HOST = os.environ.get("HOST", os.environ.get("JEE_HOST", "127.0.0.1"))
PORT = int(os.environ.get("PORT", os.environ.get("JEE_PORT", "8000")))
COOKIE_NAME = "jee_session"
SESSION_DAYS = 30
GOAL_BONUS_XP = 20
TIMEZONE = ZoneInfo("Asia/Kolkata")
PASSWORD_ITERATIONS = 310_000

ACHIEVEMENTS = {
    "first-question": ("First Step", "Submit your first question.", "✳"),
    "streak-3": ("Three in a Row", "Practice on three consecutive days.", "🔥"),
    "streak-7": ("Week of Focus", "Practice on seven consecutive days.", "◷"),
    "solved-10": ("Ten Solved", "Solve ten different questions correctly.", "✓"),
    "correct-10": ("Accuracy Builder", "Submit ten correct answers.", "◎"),
    "session-5": ("In the Zone", "Complete five questions in one session.", "↗"),
    "paper-1": ("Paper One Complete", "Attempt every question in this paper.", "▤"),
}


def now_local() -> datetime:
    return datetime.now(TIMEZONE)


def iso_now() -> str:
    return now_local().isoformat(timespec="seconds")


def db_connect() -> sqlite3.Connection:
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_FILE, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_db() -> None:
    with db_connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                total_xp INTEGER NOT NULL DEFAULT 0,
                current_streak INTEGER NOT NULL DEFAULT 0,
                longest_streak INTEGER NOT NULL DEFAULT 0,
                last_activity_date TEXT,
                daily_goal INTEGER NOT NULL DEFAULT 5,
                questions_attempted INTEGER NOT NULL DEFAULT 0,
                questions_solved INTEGER NOT NULL DEFAULT 0,
                correct_answers INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS practice_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'quick'
            );
            CREATE TABLE IF NOT EXISTS question_progress (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                question_id TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                solved INTEGER NOT NULL DEFAULT 0,
                rewarded INTEGER NOT NULL DEFAULT 0,
                last_correct INTEGER NOT NULL DEFAULT 0,
                last_answer TEXT,
                last_attempt_at TEXT,
                PRIMARY KEY (user_id, question_id)
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                question_id TEXT NOT NULL,
                session_id TEXT REFERENCES practice_sessions(id) ON DELETE SET NULL,
                attempted_at TEXT NOT NULL,
                answer_json TEXT NOT NULL,
                is_correct INTEGER NOT NULL,
                attempt_number INTEGER NOT NULL,
                time_spent_seconds INTEGER NOT NULL DEFAULT 0,
                hints_used INTEGER NOT NULL DEFAULT 0,
                solution_viewed INTEGER NOT NULL DEFAULT 0,
                xp_earned INTEGER NOT NULL DEFAULT 0,
                goal_bonus_xp INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS attempts_user_date_idx
                ON attempts(user_id, attempted_at DESC);
            CREATE INDEX IF NOT EXISTS attempts_user_question_idx
                ON attempts(user_id, question_id, attempted_at DESC);
            CREATE TABLE IF NOT EXISTS daily_activity (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                activity_date TEXT NOT NULL,
                questions_completed INTEGER NOT NULL DEFAULT 0,
                goal_bonus_awarded INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, activity_date)
            );
            CREATE TABLE IF NOT EXISTS daily_questions (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                activity_date TEXT NOT NULL,
                question_id TEXT NOT NULL,
                PRIMARY KEY (user_id, activity_date, question_id)
            );
            CREATE TABLE IF NOT EXISTS achievements (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                achievement_id TEXT NOT NULL,
                unlocked_at TEXT NOT NULL,
                PRIMARY KEY (user_id, achievement_id)
            );
            """
        )


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return "$".join((
        "pbkdf2_sha256",
        str(PASSWORD_ITERATIONS),
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    ))


def verify_password(password: str, stored: str) -> bool:
    try:
        method, iterations, salt_text, digest_text = stored.split("$")
        if method != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def xp_level(total_xp: int) -> dict:
    level = 1
    remainder = max(0, total_xp)
    threshold = 100
    while remainder >= threshold:
        remainder -= threshold
        level += 1
        threshold = 100 + (level - 1) * 25
    return {
        "level": level,
        "xpInLevel": remainder,
        "xpToNextLevel": threshold,
        "nextLevel": level + 1,
    }


def load_questions() -> list[dict]:
    with DATA_FILE.open("r", encoding="utf-8") as source:
        return json.load(source)


def public_question(question: dict) -> dict:
    safe = {
        key: value
        for key, value in question.items()
        if key not in {"correctAnswer", "solution", "hints"}
    }
    safe["hintsCount"] = len(question.get("hints", []))
    safe["hasSolution"] = bool(question.get("solution"))
    return safe


def evaluate_answer(question: dict, answer) -> bool:
    expected = question["correctAnswer"]
    question_type = question["questionType"]
    if question_type in {"single_choice", "matching"}:
        return isinstance(answer, str) and answer.strip().upper() == str(expected).upper()
    if question_type == "multiple_choice":
        if not isinstance(answer, list):
            return False
        submitted = sorted({str(value).strip().upper() for value in answer})
        correct = sorted({str(value).strip().upper() for value in expected})
        return submitted == correct
    if question_type == "numerical":
        try:
            actual = float(str(answer).strip())
            target = float(expected)
        except (TypeError, ValueError):
            return False
        return math.isfinite(actual) and abs(actual - target) <= 0.005
    return False


def safe_user(db: sqlite3.Connection, user_id: str) -> dict | None:
    row = db.execute(
        """SELECT id, name, email, created_at, total_xp, current_streak,
                  longest_streak, last_activity_date, daily_goal,
                  questions_attempted, questions_solved, correct_answers
             FROM users WHERE id = ?""",
        (user_id,),
    ).fetchone()
    if not row:
        return None
    user = dict(row)
    if user["last_activity_date"]:
        last_active = date.fromisoformat(user["last_activity_date"])
        if last_active < now_local().date() - timedelta(days=1):
            user["current_streak"] = 0
    user.update(xp_level(user["total_xp"]))
    return user


def dashboard_data(db: sqlite3.Connection, user_id: str, questions: list[dict]) -> dict:
    user = safe_user(db, user_id)
    today = now_local().date().isoformat()
    activity = db.execute(
        """SELECT questions_completed, goal_bonus_awarded
             FROM daily_activity WHERE user_id = ? AND activity_date = ?""",
        (user_id, today),
    ).fetchone()
    attempted_unique = db.execute(
        "SELECT COUNT(*) FROM question_progress WHERE user_id = ? AND attempts > 0",
        (user_id,),
    ).fetchone()[0]
    accuracy = (
        round(100 * user["correct_answers"] / user["questions_attempted"])
        if user["questions_attempted"]
        else 0
    )
    progress_rows = db.execute(
        "SELECT question_id, attempts, solved FROM question_progress WHERE user_id = ?",
        (user_id,),
    ).fetchall()
    progress = {row["question_id"]: dict(row) for row in progress_rows}
    chapter_buckets: dict[str, dict] = {}
    topic_buckets: dict[tuple[str, str], dict] = {}
    concept_buckets: dict[str, dict] = {}
    for question in questions:
        chapter = question["chapter"]
        if chapter not in chapter_buckets:
            chapter_buckets[chapter] = {
                "name": chapter, "chapter": chapter, "total": 0, "attempted": 0,
                "solved": 0, "attempts": 0, "correct": 0,
            }
        question_topics = question.get("topics") or [question["topic"]]
        for topic in question_topics:
            topic_key = (chapter, topic)
            if topic_key not in topic_buckets:
                topic_buckets[topic_key] = {
                    "name": topic, "chapter": chapter, "total": 0, "attempted": 0,
                    "solved": 0, "attempts": 0, "correct": 0,
                }
        for tag in question.get("conceptTags", []):
            if tag not in concept_buckets:
                concept_buckets[tag] = {
                    "name": tag, "total": 0, "attempted": 0,
                    "solved": 0, "attempts": 0, "correct": 0,
                }
        current = progress.get(question["id"])
        buckets = [chapter_buckets[chapter]]
        buckets.extend(topic_buckets[(chapter, topic)] for topic in question_topics)
        buckets.extend(concept_buckets[tag] for tag in question.get("conceptTags", []))
        for bucket in buckets:
            bucket["total"] += 1
            if current:
                bucket["attempts"] += current["attempts"]
                bucket["attempted"] += int(current["attempts"] > 0)
                bucket["solved"] += current["solved"]
    q_by_id = {q["id"]: q for q in questions}
    for attempt in db.execute(
        "SELECT question_id, is_correct FROM attempts WHERE user_id = ?",
        (user_id,),
    ).fetchall():
        question = q_by_id.get(attempt["question_id"])
        if question:
            chapter_buckets[question["chapter"]]["correct"] += attempt["is_correct"]
            for topic in question.get("topics") or [question["topic"]]:
                topic_buckets[(question["chapter"], topic)]["correct"] += attempt["is_correct"]
            for tag in question.get("conceptTags", []):
                concept_buckets[tag]["correct"] += attempt["is_correct"]

    def finish_bucket(item: dict) -> dict:
        return {
            **item,
            "progress": round(100 * item["solved"] / item["total"]) if item["total"] else 0,
            "accuracy": round(100 * item["correct"] / item["attempts"]) if item["attempts"] else None,
        }

    chapters = [finish_bucket(item) for item in chapter_buckets.values()]
    topics = [finish_bucket(item) for item in topic_buckets.values()]
    concepts = [finish_bucket(item) for item in concept_buckets.values()]
    weak_areas = sorted(
        [item for item in concepts if item["attempts"] and item["accuracy"] is not None],
        key=lambda item: (item["accuracy"], -item["attempts"]),
    )[:2]
    recent_rows = db.execute(
        """SELECT question_id, attempted_at, is_correct, xp_earned, goal_bonus_xp,
                  attempt_number, time_spent_seconds
             FROM attempts WHERE user_id = ?
             ORDER BY attempted_at DESC, rowid DESC LIMIT 6""",
        (user_id,),
    ).fetchall()
    recent = []
    for row in recent_rows:
        question = q_by_id.get(row["question_id"], {})
        recent.append({
            **dict(row),
            "questionNumber": question.get("questionNumber"),
            "chapter": question.get("chapter", ""),
            "topic": question.get("topic", ""),
            "title": question.get("shortTitle", ""),
        })
    unlocked = db.execute(
        "SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC",
        (user_id,),
    ).fetchall()
    achievement_list = [
        {
            "id": row["achievement_id"],
            "name": ACHIEVEMENTS[row["achievement_id"]][0],
            "description": ACHIEVEMENTS[row["achievement_id"]][1],
            "icon": ACHIEVEMENTS[row["achievement_id"]][2],
            "unlockedAt": row["unlocked_at"],
        }
        for row in unlocked if row["achievement_id"] in ACHIEVEMENTS
    ]
    return {
        "profile": user,
        "accuracy": accuracy,
        "uniqueAttempted": attempted_unique,
        "questionCount": len(questions),
        "todayCompleted": activity["questions_completed"] if activity else 0,
        "goalBonusAwarded": bool(activity["goal_bonus_awarded"]) if activity else False,
        "chapters": chapters,
        "topics": topics,
        "concepts": concepts,
        "weakAreas": weak_areas,
        "recentActivity": recent,
        "achievements": achievement_list,
    }


def unlock_achievement(db: sqlite3.Connection, user_id: str, achievement_id: str) -> bool:
    cursor = db.execute(
        """INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at)
           VALUES (?, ?, ?)""",
        (user_id, achievement_id, iso_now()),
    )
    return cursor.rowcount > 0


class Handler(BaseHTTPRequestHandler):
    server_version = "JEEPractice/1.0"

    def log_message(self, format, *args):
        print("%s - %s" % (self.log_date_time_string(), format % args))

    def send_json(self, payload, status=200, extra_headers=None):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if extra_headers:
            for name, value in extra_headers:
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request length.")
        if length > 64_000:
            raise ValueError("Request is too large.")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Request must contain valid JSON.")
        if not isinstance(result, dict):
            raise ValueError("Request body must be an object.")
        return result

    def get_session_cookie(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            morsel = cookie.get(COOKIE_NAME)
            return morsel.value if morsel else None
        except Exception:
            return None

    def current_user_id(self, db):
        token = self.get_session_cookie()
        if not token:
            return None
        row = db.execute(
            "SELECT user_id, expires_at FROM auth_sessions WHERE id = ?",
            (token_hash(token),),
        ).fetchone()
        if not row:
            return None
        if row["expires_at"] <= iso_now():
            db.execute("DELETE FROM auth_sessions WHERE id = ?", (token_hash(token),))
            return None
        return row["user_id"]

    def require_user(self, db):
        user_id = self.current_user_id(db)
        if not user_id:
            self.send_json({"error": "Please sign in to continue."}, 401)
            return None
        return user_id

    def check_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlparse(origin)
        return parsed.netloc.lower() == self.headers.get("Host", "").lower()

    def issue_session(self, db, user_id):
        token = secrets.token_urlsafe(32)
        expires = now_local() + timedelta(days=SESSION_DAYS)
        db.execute(
            "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), user_id, expires.isoformat(timespec="seconds")),
        )
        secure = "; Secure" if os.environ.get("JEE_HTTPS", "").lower() == "1" else ""
        return (
            "Set-Cookie",
            "{}={}; Path=/; Max-Age={}; HttpOnly; SameSite=Strict{}".format(
                COOKIE_NAME, token, SESSION_DAYS * 24 * 60 * 60, secure
            ),
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            questions = load_questions()
            with db_connect() as db:
                if path == "/api/session":
                    user_id = self.current_user_id(db)
                    if not user_id:
                        self.send_json({"user": None})
                    else:
                        self.send_json({
                            "user": safe_user(db, user_id),
                            "dashboard": dashboard_data(db, user_id, questions),
                        })
                    return
                if path == "/api/questions":
                    user_id = self.current_user_id(db)
                    status_map = {}
                    if user_id:
                        status_map = {
                            row["question_id"]: "correct" if row["solved"] else "incorrect"
                            for row in db.execute(
                                """SELECT question_id, solved FROM question_progress
                                   WHERE user_id = ? AND attempts > 0""",
                                (user_id,),
                            ).fetchall()
                        }
                    result = []
                    for question in questions:
                        item = public_question(question)
                        item["status"] = status_map.get(question["id"], "unsolved")
                        result.append(item)
                    self.send_json({"questions": result})
                    return
                hint_match = re.fullmatch(r"/api/question/([^/]+)/hint", path)
                if hint_match:
                    question = next((q for q in questions if q["id"] == hint_match.group(1)), None)
                    if not question:
                        self.send_json({"error": "Question not found."}, 404)
                        return
                    query = parse_qs(parsed.query)
                    try:
                        index = int(query.get("index", ["0"])[0])
                    except ValueError:
                        index = -1
                    hints = question.get("hints", [])
                    if index < 0 or index >= len(hints):
                        self.send_json({"error": "No hint at that step."}, 404)
                        return
                    self.send_json({"index": index, "hint": hints[index]})
                    return
                solution_match = re.fullmatch(r"/api/question/([^/]+)/solution", path)
                if solution_match:
                    user_id = self.require_user(db)
                    if not user_id:
                        return
                    question_id = solution_match.group(1)
                    attempted = db.execute(
                        "SELECT 1 FROM attempts WHERE user_id = ? AND question_id = ? LIMIT 1",
                        (user_id, question_id),
                    ).fetchone()
                    question = next((q for q in questions if q["id"] == question_id), None)
                    if not question:
                        self.send_json({"error": "Question not found."}, 404)
                    elif not attempted:
                        self.send_json({"error": "Submit an answer before viewing the solution."}, 403)
                    else:
                        db.execute(
                            """UPDATE attempts SET solution_viewed = 1
                               WHERE id = (
                                 SELECT id FROM attempts
                                 WHERE user_id = ? AND question_id = ?
                                 ORDER BY attempted_at DESC, rowid DESC LIMIT 1
                               )""",
                            (user_id, question_id),
                        )
                        self.send_json({"solution": question.get("solution", [])})
                    return
                if path == "/api/dashboard":
                    user_id = self.require_user(db)
                    if user_id:
                        self.send_json(dashboard_data(db, user_id, questions))
                    return
                if path == "/api/history":
                    user_id = self.require_user(db)
                    if not user_id:
                        return
                    q_by_id = {q["id"]: q for q in questions}
                    rows = db.execute(
                        """SELECT id, question_id, session_id, attempted_at, answer_json,
                                  is_correct, attempt_number, time_spent_seconds,
                                  hints_used, solution_viewed, xp_earned, goal_bonus_xp
                           FROM attempts WHERE user_id = ?
                           ORDER BY attempted_at DESC, rowid DESC LIMIT 200""",
                        (user_id,),
                    ).fetchall()
                    entries = []
                    for row in rows:
                        item = dict(row)
                        item["answer"] = json.loads(item.pop("answer_json"))
                        question = q_by_id.get(item["question_id"], {})
                        item["questionNumber"] = question.get("questionNumber")
                        item["chapter"] = question.get("chapter", "")
                        item["topic"] = question.get("topic", "")
                        item["shortTitle"] = question.get("shortTitle", "")
                        entries.append(item)
                    self.send_json({"history": entries})
                    return
            self.send_json({"error": "Not found."}, 404)
            return

        if path in {"/", "/index.html"}:
            path = "/index.html"
        candidate = (STATIC_DIR / path.lstrip("/")).resolve()
        if not candidate.is_relative_to(STATIC_DIR.resolve()) or not candidate.is_file():
            self.send_json({"error": "Not found."}, 404)
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(candidate.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.check_origin():
            self.send_json({"error": "Cross-origin requests are not allowed."}, 403)
            return
        try:
            payload = self.read_json()
        except ValueError as error:
            self.send_json({"error": str(error)}, 400)
            return
        path = urlparse(self.path).path
        questions = load_questions()
        q_by_id = {q["id"]: q for q in questions}
        with db_connect() as db:
            if path == "/api/register":
                name = str(payload.get("name", "")).strip()
                email = str(payload.get("email", "")).strip().lower()
                password = payload.get("password", "")
                if not 1 <= len(name) <= 80:
                    self.send_json({"error": "Enter a name between 1 and 80 characters."}, 400)
                    return
                if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
                    self.send_json({"error": "Enter a valid email address."}, 400)
                    return
                if not isinstance(password, str) or len(password) < 8 or len(password) > 200:
                    self.send_json({"error": "Use a password with at least 8 characters."}, 400)
                    return
                user_id = str(uuid.uuid4())
                try:
                    db.execute(
                        """INSERT INTO users (id, name, email, password_hash, created_at)
                           VALUES (?, ?, ?, ?, ?)""",
                        (user_id, name, email, password_hash(password), iso_now()),
                    )
                except sqlite3.IntegrityError:
                    self.send_json({"error": "An account with that email already exists."}, 409)
                    return
                cookie = self.issue_session(db, user_id)
                self.send_json({"user": safe_user(db, user_id)}, 201, [cookie])
                return
            if path == "/api/login":
                email = str(payload.get("email", "")).strip().lower()
                password = payload.get("password", "")
                row = db.execute(
                    "SELECT id, password_hash FROM users WHERE email = ?",
                    (email,),
                ).fetchone()
                if not row or not isinstance(password, str) or not verify_password(password, row["password_hash"]):
                    self.send_json({"error": "Email or password is incorrect."}, 401)
                    return
                cookie = self.issue_session(db, row["id"])
                self.send_json({"user": safe_user(db, row["id"])}, 200, [cookie])
                return
            if path == "/api/logout":
                token = self.get_session_cookie()
                if token:
                    db.execute("DELETE FROM auth_sessions WHERE id = ?", (token_hash(token),))
                self.send_json({"ok": True}, 200, [(
                    "Set-Cookie",
                    "{}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict".format(COOKIE_NAME),
                )])
                return
            if path == "/api/sessions":
                user_id = self.require_user(db)
                if not user_id:
                    return
                session_id = str(uuid.uuid4())
                db.execute(
                    "INSERT INTO practice_sessions (id, user_id, started_at, kind) VALUES (?, ?, ?, 'quick')",
                    (session_id, user_id, iso_now()),
                )
                rng = secrets.SystemRandom()
                medium = [q for q in questions if q["difficulty"] == "medium"]
                hard = [q for q in questions if q["difficulty"] == "hard"]
                selected = rng.sample(medium, min(2, len(medium)))
                selected.extend(rng.sample(hard, min(5 - len(selected), len(hard))))
                remaining = [q for q in questions if q not in selected]
                if len(selected) < 5:
                    selected.extend(rng.sample(remaining, min(5 - len(selected), len(remaining))))
                rng.shuffle(selected)
                self.send_json({
                    "sessionId": session_id,
                    "questionIds": [question["id"] for question in selected],
                }, 201)
                return
            if path == "/api/goal":
                user_id = self.require_user(db)
                if not user_id:
                    return
                try:
                    goal = int(payload.get("dailyGoal"))
                except (TypeError, ValueError):
                    self.send_json({"error": "Daily goal must be a whole number."}, 400)
                    return
                if goal < 1 or goal > 30:
                    self.send_json({"error": "Choose a daily goal from 1 to 30."}, 400)
                    return
                db.execute("UPDATE users SET daily_goal = ? WHERE id = ?", (goal, user_id))
                self.send_json(dashboard_data(db, user_id, questions))
                return
            if path == "/api/attempt":
                # Serialize attempts so two rapid submissions cannot both claim
                # the one-time XP reward for the same question.
                db.execute("BEGIN IMMEDIATE")
                user_id = self.require_user(db)
                if not user_id:
                    return
                question_id = str(payload.get("questionId", ""))
                question = q_by_id.get(question_id)
                if not question:
                    self.send_json({"error": "Question not found."}, 404)
                    return
                answer = payload.get("answer")
                if answer is None:
                    self.send_json({"error": "Enter or select an answer before submitting."}, 400)
                    return
                if question["questionType"] == "numerical" and (
                    not isinstance(answer, str) or len(answer) > 80
                ):
                    self.send_json({"error": "Enter a numerical value."}, 400)
                    return
                correct = evaluate_answer(question, answer)
                previous = db.execute(
                    """SELECT attempts, solved, rewarded FROM question_progress
                       WHERE user_id = ? AND question_id = ?""",
                    (user_id, question_id),
                ).fetchone()
                attempt_number = (previous["attempts"] if previous else 0) + 1
                new_solve = correct and not (previous and previous["solved"])
                first_reward = correct and not (previous and previous["rewarded"])
                xp_earned = question["xp"] if first_reward else 0
                try:
                    time_spent = max(0, min(86_400, int(payload.get("timeSpentSeconds", 0))))
                    hints_used = max(0, min(10, int(payload.get("hintsUsed", 0))))
                except (TypeError, ValueError):
                    self.send_json({"error": "Attempt metadata is invalid."}, 400)
                    return
                solution_viewed = 1 if payload.get("solutionViewed") else 0
                session_id = str(payload.get("sessionId") or "").strip() or None
                if session_id:
                    owned = db.execute(
                        "SELECT 1 FROM practice_sessions WHERE id = ? AND user_id = ?",
                        (session_id, user_id),
                    ).fetchone()
                    if not owned:
                        self.send_json({"error": "Practice session not found."}, 400)
                        return
                today_text = now_local().date().isoformat()
                today = date.fromisoformat(today_text)
                current = db.execute(
                    "SELECT current_streak, longest_streak, last_activity_date FROM users WHERE id = ?",
                    (user_id,),
                ).fetchone()
                if current["last_activity_date"] != today_text:
                    yesterday = (today - timedelta(days=1)).isoformat()
                    streak = current["current_streak"] + 1 if current["last_activity_date"] == yesterday else 1
                    longest = max(current["longest_streak"], streak)
                    db.execute(
                        "UPDATE users SET current_streak = ?, longest_streak = ?, last_activity_date = ? WHERE id = ?",
                        (streak, longest, today_text, user_id),
                    )
                db.execute(
                    """INSERT INTO question_progress
                       (user_id, question_id, attempts, solved, rewarded, last_correct,
                        last_answer, last_attempt_at)
                       VALUES (?, ?, 1, ?, ?, ?, ?, ?)
                       ON CONFLICT(user_id, question_id) DO UPDATE SET
                         attempts = attempts + 1,
                         solved = MAX(solved, excluded.solved),
                         rewarded = MAX(rewarded, excluded.rewarded),
                         last_correct = excluded.last_correct,
                         last_answer = excluded.last_answer,
                         last_attempt_at = excluded.last_attempt_at""",
                    (
                        user_id, question_id, int(correct), int(new_solve), int(correct),
                        json.dumps(answer, ensure_ascii=False), iso_now(),
                    ),
                )
                attempt_id = str(uuid.uuid4())
                db.execute(
                    """INSERT INTO attempts
                       (id, user_id, question_id, session_id, attempted_at, answer_json,
                        is_correct, attempt_number, time_spent_seconds, hints_used,
                        solution_viewed, xp_earned)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        attempt_id, user_id, question_id, session_id, iso_now(),
                        json.dumps(answer, ensure_ascii=False), int(correct),
                        attempt_number, time_spent, hints_used, solution_viewed, xp_earned,
                    ),
                )
                db.execute(
                    """INSERT OR IGNORE INTO daily_questions (user_id, activity_date, question_id)
                       VALUES (?, ?, ?)""",
                    (user_id, today_text, question_id),
                )
                daily_unique = db.execute(
                    """SELECT COUNT(*) FROM daily_questions
                       WHERE user_id = ? AND activity_date = ?""",
                    (user_id, today_text),
                ).fetchone()[0]
                db.execute(
                    """INSERT INTO daily_activity (user_id, activity_date, questions_completed)
                       VALUES (?, ?, ?)
                       ON CONFLICT(user_id,activity_date) DO UPDATE SET
                         questions_completed = excluded.questions_completed""",
                    (user_id, today_text, daily_unique),
                )
                daily = db.execute(
                    """SELECT questions_completed, goal_bonus_awarded FROM daily_activity
                       WHERE user_id = ? AND activity_date = ?""",
                    (user_id, today_text),
                ).fetchone()
                goal = db.execute(
                    "SELECT daily_goal FROM users WHERE id = ?", (user_id,)
                ).fetchone()["daily_goal"]
                goal_bonus = 0
                if daily["questions_completed"] >= goal and not daily["goal_bonus_awarded"]:
                    goal_bonus = GOAL_BONUS_XP
                    db.execute(
                        """UPDATE daily_activity SET goal_bonus_awarded = 1
                           WHERE user_id = ? AND activity_date = ?""",
                        (user_id, today_text),
                    )
                    db.execute(
                        "UPDATE attempts SET goal_bonus_xp = ? WHERE id = ?",
                        (goal_bonus, attempt_id),
                    )
                db.execute(
                    """UPDATE users SET total_xp = total_xp + ?,
                         questions_attempted = questions_attempted + 1,
                         questions_solved = questions_solved + ?,
                         correct_answers = correct_answers + ?
                       WHERE id = ?""",
                    (xp_earned + goal_bonus, int(new_solve), int(correct), user_id),
                )
                unlocked_now = []

                def unlock(achievement_id):
                    if unlock_achievement(db, user_id, achievement_id):
                        title, description, icon = ACHIEVEMENTS[achievement_id]
                        unlocked_now.append({
                            "id": achievement_id, "name": title,
                            "description": description, "icon": icon,
                        })

                profile = safe_user(db, user_id)
                if profile["questions_attempted"] >= 1:
                    unlock("first-question")
                if profile["longest_streak"] >= 3:
                    unlock("streak-3")
                if profile["longest_streak"] >= 7:
                    unlock("streak-7")
                if profile["questions_solved"] >= 10:
                    unlock("solved-10")
                if profile["correct_answers"] >= 10:
                    unlock("correct-10")
                if session_id:
                    session_count = db.execute(
                        """SELECT COUNT(DISTINCT question_id) FROM attempts
                           WHERE user_id = ? AND session_id = ?""",
                        (user_id, session_id),
                    ).fetchone()[0]
                    if session_count >= 5:
                        unlock("session-5")
                attempted_count = db.execute(
                    "SELECT COUNT(*) FROM question_progress WHERE user_id = ? AND attempts > 0",
                    (user_id,),
                ).fetchone()[0]
                if attempted_count >= len(questions):
                    unlock("paper-1")
                updated = dashboard_data(db, user_id, questions)
                self.send_json({
                    "correct": correct,
                    "answer": answer,
                    "attemptNumber": attempt_number,
                    "newSolve": bool(new_solve),
                    "xpEarned": xp_earned,
                    "goalBonusXp": goal_bonus,
                    "goalCompleted": bool(goal_bonus),
                    "correctAnswer": question["correctAnswer"],
                    "unlockedAchievements": unlocked_now,
                    "dashboard": updated,
                }, 201)
                return
        self.send_json({"error": "Not found."}, 404)


def main():
    init_db()
    load_questions()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Edusnap is available at http://{}:{}/".format(HOST, PORT))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
