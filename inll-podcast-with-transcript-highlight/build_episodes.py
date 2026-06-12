#!/usr/bin/env python3
"""
build_episodes.py — Poterkëscht podcast data pipeline.

Fetches the podcast RSS feed, extracts inline transcripts (older episodes),
merges manual transcripts from transcripts/*.txt (newer episodes whose
transcripts live behind the INLL Learning Space guest login), and writes
episodes.js for podcast/index.html.

Usage:
    python build_episodes.py              # fetch RSS + rebuild episodes.js
    python build_episodes.py --cache      # reuse rss_cache.xml if present

Manual transcript workflow (for Moodle-locked episodes):
    1. Run this script — it lists episodes with missing transcripts and the
       exact filename to create, e.g.  transcripts/e3k7it7.txt
    2. Open https://learningspace.inll.lu/course/view.php?id=5497
       ("access as guest"), copy the transcript text.
    3. Paste it into transcripts/<id>.txt (plain text, any line breaks).
    4. Re-run  python build_episodes.py  → commit episodes.js + the .txt → push.
"""

import html
import json
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

RSS_URL = "https://anchor.fm/s/f1c8499c/podcast/rss"
HERE = Path(__file__).parent
CACHE = HERE / "rss_cache.xml"
TRANSCRIPTS_DIR = HERE / "transcripts"
OUT = HERE / "episodes.js"

ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"

# Boilerplate lines stripped from the intro text
BOILERPLATE = re.compile(
    r"(Den Transkript fir d[eë]sen? (Episod|Dialog).*?$"
    r"|Dir braucht kee? Kont.*?$"
    r"|Vill Spaa?ss( beim Nolauschteren)?\s*!?.*?$"
    r"|W[eë]llkomm zr[eé]ck an der Poterk[eë]scht\s*!?"
    r"|^-$)",
    re.MULTILINE,
)


def fetch_rss(use_cache: bool) -> str:
    if use_cache and CACHE.exists():
        print(f"Using cached feed: {CACHE.name}")
        return CACHE.read_text(encoding="utf-8")
    req = urllib.request.Request(RSS_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        xml = r.read().decode("utf-8")
    CACHE.write_text(xml, encoding="utf-8")
    print(f"Fetched feed ({len(xml):,} bytes) → cached to {CACHE.name}")
    return xml


def html_to_text(s: str) -> str:
    """Description HTML → plain text, one paragraph per line."""
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"</p>\s*", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = s.replace(" ", " ").replace(" ", " ")
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in s.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def episode_id(link: str, guid: str) -> str:
    """Short stable id: the anchor episode token at the end of the slug
    (…-Aarbecht-A2-e3k7it7 → e3k7it7); falls back to the guid."""
    m = re.search(r"-(e[0-9a-z]+)/?$", link)
    return m.group(1) if m else guid


def split_transcript(text: str):
    """Return (intro, transcript_or_None) from the description text."""
    m = re.search(r"Transkript\s*:?\s*\n", text)
    if m:
        intro, transcript = text[: m.start()], text[m.end():].strip()
        if transcript:
            return intro, transcript
        return intro, None
    return text, None


def clean_intro(text: str) -> str:
    text = BOILERPLATE.sub("", text)
    lines = [ln.strip() for ln in text.split("\n")]
    return "\n".join(ln for ln in lines if ln and ln != "-")


def parse_duration(raw: str | None) -> int | None:
    if not raw:
        return None
    if raw.isdigit():
        return int(raw)
    parts = [int(p) for p in raw.split(":")]
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs


def parse_level(title: str) -> str | None:
    m = re.search(r"\(([ABC][12](?:\s*[-–/]\s*[ABC][12])?)\)", title)
    return re.sub(r"\s*", "", m.group(1)) if m else None


def main():
    use_cache = "--cache" in sys.argv
    xml = fetch_rss(use_cache)
    root = ET.fromstring(xml)
    channel = root.find("channel")

    TRANSCRIPTS_DIR.mkdir(exist_ok=True)
    manual = {p.stem: p for p in TRANSCRIPTS_DIR.glob("*.txt")}

    episodes, missing, used_manual = [], [], []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or "").strip()
        desc = item.findtext("description") or ""
        pub = item.findtext("pubDate") or ""
        enc = item.find("enclosure")
        audio = enc.get("url") if enc is not None else None
        dur = parse_duration(item.findtext(f"{ITUNES}duration"))

        try:
            date = datetime.strptime(pub[:25].strip(), "%a, %d %b %Y %H:%M:%S").strftime("%Y-%m-%d")
        except ValueError:
            date = pub[:10]

        epid = episode_id(link, guid)
        text = html_to_text(desc)
        intro, transcript = split_transcript(text)

        source = "rss" if transcript else None
        if epid in manual:  # manual file wins (lets you fix RSS typos too)
            transcript = manual[epid].read_text(encoding="utf-8").strip()
            source = "manual"
            used_manual.append(epid)
        if not transcript:
            missing.append((epid, title))

        episodes.append({
            "id": epid,
            "title": title,
            "level": parse_level(title),
            "date": date,
            "duration": dur,
            "audio": audio,
            "link": link,
            "intro": clean_intro(intro),
            "transcript": transcript,
            "tsource": source,
        })

    # newest first
    episodes.sort(key=lambda e: e["date"], reverse=True)

    payload = json.dumps(episodes, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// Auto-generated — do not edit. Run build_episodes.py\n"
        f"window.PODCAST_EPISODES = {payload};\n",
        encoding="utf-8",
    )

    n_t = sum(1 for e in episodes if e["transcript"])
    print(f"\nWrote {OUT.name}: {len(episodes)} episodes, "
          f"{n_t} with transcript ({len(used_manual)} manual).")
    unused = set(manual) - set(e["id"] for e in episodes)
    if unused:
        print(f"WARNING: transcripts/ files not matching any episode: {sorted(unused)}")
    if missing:
        print(f"\n{len(missing)} episode(s) missing a transcript — to add one, create:")
        for epid, title in missing:
            print(f"  transcripts/{epid}.txt   ← {title}")
        print("\nTranscripts: https://learningspace.inll.lu/course/view.php?id=5497"
              " (access as guest)")


if __name__ == "__main__":
    main()
