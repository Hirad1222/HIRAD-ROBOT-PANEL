import os
import json
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "hirad.db")

def connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    with connect() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS group_settings (
                group_id TEXT PRIMARY KEY,
                settings_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
                    DEFAULT CURRENT_TIMESTAMP
            )
        """)

def get_group_settings(group_id):
    with connect() as db:
        row = db.execute(
            """
            SELECT settings_json
            FROM group_settings
            WHERE group_id = ?
            """,
            (group_id,)
        ).fetchone()

    if not row:
        return {}

    try:
        return json.loads(row["settings_json"])
    except (json.JSONDecodeError, TypeError):
        return {}

def save_group_settings(group_id, settings):
    payload = json.dumps(
        settings,
        ensure_ascii=False,
        separators=(",", ":")
    )

    with connect() as db:
        db.execute("""
            INSERT INTO group_settings (
                group_id,
                settings_json,
                updated_at
            )
            VALUES (?, ?, CURRENT_TIMESTAMP)

            ON CONFLICT(group_id) DO UPDATE SET
                settings_json = excluded.settings_json,
                updated_at = CURRENT_TIMESTAMP
        """, (group_id, payload))

def get_group_count():
    with connect() as db:
        row = db.execute(
            "SELECT COUNT(*) AS total FROM group_settings"
        ).fetchone()

    return row["total"]
