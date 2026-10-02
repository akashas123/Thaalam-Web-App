import os
import re
import unicodedata
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory
from ytmusicapi import YTMusic


APP_ROOT = Path(__file__).resolve().parent
STATIC_FILES = {
    "album-placeholder.svg",
    "audio-recovery.js",
    "icon-192.png",
    "icon-512.png",
    "index.html",
    "logo.png",
    "lyrics.js",
    "manifest.json",
    "marquee.js",
    "media-metadata.js",
    "player-controls.js",
    "script.js",
    "style.css",
    "sw.js",
    "youtube-player.js",
}

app = Flask(__name__, static_folder=None)
music = YTMusic()


def normalize(value):
    decomposed = unicodedata.normalize("NFKD", value or "")
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]", "", without_marks.lower())


@app.get("/api/youtube/search")
def search_youtube_song():
    title = request.args.get("title", "").strip()[:200]
    artist = request.args.get("artist", "").strip()[:200]
    if not title:
        return jsonify({"error": "A song title is required."}), 400

    query = " ".join(part for part in (title, artist) if part)
    try:
        results = music.search(query, filter="songs", limit=10)
    except Exception:
        app.logger.exception("YouTube Music search failed")
        return jsonify({"error": "YouTube Music search is unavailable."}), 502

    tracks = [result for result in results if result.get("videoId")]
    if not tracks:
        return jsonify({"error": "No playable YouTube result was found."}), 404

    normalized_title = normalize(title)
    normalized_artist = normalize(artist)

    def score(track):
        track_title = normalize(track.get("title", ""))
        track_artists = normalize(" ".join(
            item.get("name", "") for item in track.get("artists", [])
        ))
        return (
            bool(normalized_artist and normalized_artist in track_artists),
            track_title == normalized_title,
        )

    ranked_tracks = sorted(tracks, key=score, reverse=True)
    candidate_ids = list(dict.fromkeys(track["videoId"] for track in ranked_tracks))
    match = ranked_tracks[0]
    thumbnails = match.get("thumbnails", [])
    return jsonify({
        "videoId": match["videoId"],
        "alternatives": candidate_ids[1:8],
        "title": match.get("title", title),
        "artist": ", ".join(item.get("name", "") for item in match.get("artists", [])),
        "thumbnail": thumbnails[-1].get("url", "") if thumbnails else "",
        "duration": match.get("duration", ""),
    })


@app.get("/")
def index():
    return send_from_directory(APP_ROOT, "index.html")


@app.get("/<path:filename>")
def static_files(filename):
    if filename not in STATIC_FILES:
        abort(404)
    return send_from_directory(APP_ROOT, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))