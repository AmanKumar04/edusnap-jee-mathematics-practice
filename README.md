# Edusnap — JEE Mathematics practice

**Learn in a Snap.** Edusnap is a JEE Mathematics practice app seeded with the 16 questions in **JEE Advanced 2026, Paper 1**.

## Run it

Requires Python 3.10 or newer. The application uses only the Python standard library and SQLite.

~~~sh
python3 server.py
~~~

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Create an account to save your attempts and progress. The SQLite database is created automatically at data/practice.sqlite3.

To use a different local port, set JEE_PORT, for example:

~~~sh
JEE_PORT=8080 python3 server.py
~~~

## What is included

- Email and password accounts with salted PBKDF2 password hashes and HTTP-only session cookies
- Public paper preview, searchable question bank, and filters generated from question metadata
- Dynamic single-choice, multiple-choice, numerical and matching-list answer interfaces
- Server-side answer evaluation, progressive hints and post-submission solutions
- Persistent attempt history, question status, chapter/topic/concept analytics, XP, levels, daily goals, streaks and achievements
- Quick practice sessions with five questions

Questions and their metadata, hints, answer keys and explanations are kept in data/questions.json; the UI reads them through the API. Student accounts and activity are stored separately in SQLite.

The source PDF provides the question paper but no answer key. The answer keys and worked explanations in the seed data were derived from the printed questions.

## Data and privacy

Account passwords are never stored in plaintext. Each signed-in API request is scoped to the account identified by its session cookie. SQLite stores password hashes, account profiles, attempts and progression records. No student progress is stored only in browser local storage.

## Project layout

~~~text
server.py             Local HTTP API and SQLite persistence
data/questions.json   Structured question bank
static/index.html     App entry point
static/styles.css     Responsive interface
static/app.js         Client-side views and practice flow
~~~
