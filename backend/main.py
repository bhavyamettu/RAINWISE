"""RAINWISE backend: FastAPI + SQLite.

Run:  uvicorn main:app --host 0.0.0.0 --port 8000
"""
import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
DB_PATH = os.environ.get("RAINWISE_DB", str(BASE / "rainwise.db"))
API_KEY = os.environ.get("RAINWISE_API_KEY", "change-me")  # ESP32 must send the same key
LIVE_WINDOW_MIN = 10  # a reading newer than this counts as "hardware connected"

DEFAULT_SETTINGS = {"tank_height_cm": 150.0, "tank_capacity_l": 1000.0, "sensor_offset_cm": 20.0}
DEFAULT_TASKS = [
    ("Clean the water tank", "Empty, scrub and rinse the tank.", 180),
    ("Inspect the filter", "Remove leaves and dirt; rinse or replace if blocked.", 30),
    ("Clean the gutters", "Clear leaves and debris so water flows freely.", 30),
    ("Check the first-flush device", "Empty the first-flush chamber so it is ready for the next rain.", 14),
]

app = FastAPI(title="RAINWISE API")


# ---------- database ----------
@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS readings(
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
            rain_percent REAL NOT NULL, distance_cm REAL NOT NULL)""")
        c.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value REAL NOT NULL)")
        c.execute("""CREATE TABLE IF NOT EXISTS tasks(
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
            tip TEXT NOT NULL, interval_days INTEGER NOT NULL, last_done TEXT)""")
        for k, v in DEFAULT_SETTINGS.items():
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)", (k, v))
        for name, tip, days in DEFAULT_TASKS:
            c.execute("INSERT OR IGNORE INTO tasks(name, tip, interval_days) VALUES(?, ?, ?)", (name, tip, days))


init_db()


def now_utc():
    return datetime.now(timezone.utc)


def get_settings():
    with db() as c:
        return {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM settings")}


# ---------- calculations ----------
def rain_label(p):
    if p < 5:
        return "No rain"
    if p < 35:
        return "Light rain"
    if p < 70:
        return "Moderate rain"
    return "Heavy rain"


def tank_status(pct):
    if pct < 10:
        return "Empty"
    if pct < 30:
        return "Low"
    if pct < 85:
        return "Good"
    if pct < 95:
        return "Nearly full"
    return "Full"


def build_reading(ts, rain_percent, distance_cm, s):
    """Turn raw sensor values into numbers people understand."""
    depth = s["tank_height_cm"] - (distance_cm - s["sensor_offset_cm"])
    depth = max(0.0, min(s["tank_height_cm"], depth))
    pct = depth / s["tank_height_cm"] * 100
    return {
        "ts": ts,
        "rain_percent": round(rain_percent, 1),
        "rain_label": rain_label(rain_percent),
        "level_percent": round(pct, 1),
        "stored_liters": round(pct / 100 * s["tank_capacity_l"]),
        "status": tank_status(pct),
    }


def demo_history(s, n=24):
    """Clearly-labelled sample data. Never stored in the database."""
    out, end = [], now_utc()
    for i in range(n):
        t = end - timedelta(hours=n - 1 - i)
        rain = max(0.0, 70 * math.sin(i / 3.0 - 1.0)) if 6 <= i <= 14 else 0.0
        pct = min(95.0, 30 + i * 2.2 + (rain / 10))
        dist = s["sensor_offset_cm"] + s["tank_height_cm"] * (1 - pct / 100)
        out.append(build_reading(t.isoformat(timespec="seconds"), rain, dist, s))
    return out


def get_dashboard():
    s = get_settings()
    with db() as c:
        rows = c.execute("SELECT * FROM readings ORDER BY id DESC LIMIT 30").fetchall()[::-1]
    history = [build_reading(r["ts"], r["rain_percent"], r["distance_cm"], s) for r in rows]
    last_seen = rows[-1]["ts"] if rows else None
    live = bool(rows) and now_utc() - datetime.fromisoformat(last_seen) < timedelta(minutes=LIVE_WINDOW_MIN)
    if not live:
        history = demo_history(s)
    return {"mode": "live" if live else "demo", "last_seen": last_seen,
            "latest": history[-1], "history": history, "settings": s}


def make_recommendations(r):
    lvl, rain, items = r["level_percent"], r["rain_percent"], []

    def add(kind, title, text):
        items.append({"kind": kind, "title": title, "text": text})

    if lvl >= 90:
        add("warn", "Check the overflow pipe", "The tank is almost full. Make sure the overflow pipe is clear and sends extra water to a safe place.")
        if rain >= 5:
            add("warn", "Rain is still falling", "Use or divert water now, such as for gardening or a recharge pit, so the tank does not overflow.")
    elif lvl < 10:
        add("warn", "Tank is almost empty", "Use water only for essential needs until the next rain.")
    elif lvl < 30:
        add("info", "Save water", "Water is low. Use it for plants, cleaning and washing first.")
    else:
        add("good", "Water level is healthy", "No action needed. Keep the tank lid closed.")
    if rain >= 35 and lvl < 90:
        add("good", "Good time to collect", "Heavy rain is a good chance to fill the tank. Check that gutters and the filter are not blocked.")
    elif 5 <= rain < 35:
        add("info", "Light rain", "Rain is falling. The tank is filling slowly.")
    if rain < 5 and 30 <= lvl < 60:
        add("info", "Plan ahead", "No rain now. Use stored water carefully until the next rain.")
    return items


def task_state(row):
    if not row["last_done"]:
        status, days_left, last = "not_recorded", None, None
    else:
        last = datetime.fromisoformat(row["last_done"])
        days_left = row["interval_days"] - (now_utc() - last).days
        status = "overdue" if days_left < 0 else "due_soon" if days_left <= 7 else "ok"
    return {"id": row["id"], "name": row["name"], "tip": row["tip"],
            "interval_days": row["interval_days"], "last_done": row["last_done"],
            "days_left": days_left, "status": status}


# ---------- request models ----------
class ReadingIn(BaseModel):
    rain_percent: float = Field(ge=0, le=100, description="0 = dry, 100 = very wet")
    distance_cm: float = Field(gt=0, le=600, description="Distance from sensor to water")


class SettingsIn(BaseModel):
    tank_height_cm: float = Field(gt=10, le=1000)
    tank_capacity_l: float = Field(gt=10, le=1_000_000)
    sensor_offset_cm: float = Field(ge=0, le=200)


class CalcIn(BaseModel):
    roof_area_m2: float = Field(gt=0, le=100_000)
    rainfall_mm: float = Field(ge=0, le=5000)
    efficiency: float = Field(default=0.8, ge=0.5, le=1.0)


def check_key(x_api_key: Optional[str] = Header(default=None)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key.")


# ---------- routes ----------
@app.post("/api/readings", dependencies=[Depends(check_key)])
def add_reading(r: ReadingIn):
    with db() as c:
        c.execute("INSERT INTO readings(ts, rain_percent, distance_cm) VALUES(?,?,?)",
                  (now_utc().isoformat(timespec="seconds"), r.rain_percent, r.distance_cm))
        # keep the database small: keep the newest 5000 readings
        c.execute("DELETE FROM readings WHERE id <= (SELECT MAX(id) FROM readings) - 5000")
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard():
    return get_dashboard()


@app.get("/api/recommendations")
def recommendations():
    d = get_dashboard()
    return {"mode": d["mode"], "items": make_recommendations(d["latest"])}


@app.put("/api/settings")
def update_settings(s: SettingsIn):
    with db() as c:
        for k, v in s.model_dump().items():
            c.execute("UPDATE settings SET value=? WHERE key=?", (v, k))
    return get_settings()


@app.post("/api/calculate")
def calculate(c: CalcIn):
    liters = c.roof_area_m2 * c.rainfall_mm * c.efficiency  # 1 mm on 1 m2 = 1 litre
    return {"liters": round(liters), "buckets_20l": round(liters / 20)}


@app.get("/api/maintenance")
def maintenance():
    with db() as c:
        return [task_state(r) for r in c.execute("SELECT * FROM tasks ORDER BY id")]


@app.post("/api/maintenance/{task_id}/done")
def mark_done(task_id: int):
    with db() as c:
        cur = c.execute("UPDATE tasks SET last_done=? WHERE id=?",
                        (now_utc().isoformat(timespec="seconds"), task_id))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found.")
        return task_state(c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())


app.mount("/", StaticFiles(directory=BASE.parent / "frontend", html=True), name="frontend")
