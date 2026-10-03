import os
import re
import unicodedata

from flask import Flask, jsonify, request
from ytmusicapi import YTMusic


app = Flask(__name__)
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


def _track_payload(track, seen_ids):
    """Normalise a ytmusicapi track dict into the client track shape.

    Returns None for duplicates or entries without a playable videoId.
    """
    track_id = track.get("videoId")
    if not track_id or track_id in seen_ids:
        return None
    seen_ids.add(track_id)

    # Watch-playlist tracks expose a singular "thumbnail" list, while search
    # results use "thumbnails". Accept either.
    thumbnails = track.get("thumbnails") or track.get("thumbnail") or []
    return {
        "videoId": track_id,
        "title": track.get("title", ""),
        "artist": ", ".join(
            item.get("name", "") for item in track.get("artists") or []
        ),
        "thumbnail": thumbnails[-1].get("url", "") if thumbnails else "",
        "duration": track.get("length", "") or track.get("duration", ""),
    }


def _radio_tracks(video_id, seen_ids, limit):
    tracks = []
    watch_playlist = music.get_watch_playlist(
        videoId=video_id, limit=limit, radio=True
    )
    for track in watch_playlist.get("tracks") or []:
        payload = _track_payload(track, seen_ids)
        if payload:
            tracks.append(payload)
    return tracks


def _search_tracks(query, seen_ids, limit):
    tracks = []
    for track in music.search(query, filter="songs", limit=limit) or []:
        payload = _track_payload(track, seen_ids)
        if payload:
            tracks.append(payload)
    return tracks


def _first_artist(artist):
    """Pick the best single artist token from a credit list.

    The API often returns a long credit string such as
    "Benny-Ignatius, P. Jayachandran, K.S. Chithra & Kaithapram", which is a
    room full of collaborators rather than one searchable performer.
    """
    if not artist:
        return ""
    first = artist.split(",")[0].strip()
    # Trim trailing " feat. ..." / " & ..." style suffixes to the lead credit.
    for separator in (" feat", " ft.", " & ", " and "):
        if separator in first:
            first = first.split(separator)[0].strip()
    return first


@app.get("/api/youtube/related")
def related_youtube_songs():
    """Return tracks similar to a video so on-demand playback can continue.

    Strategies are tried in order and the first non-empty one wins:
      1. radio   - the YouTube Music radio playlist for the video
      2. artist  - a search for the lead artist credit
      3. artist  - a search for the full credit string
      4. title   - a search for the song title alone

    The radio playlist relies on an endpoint that is often unavailable
    without authentication, so the search-based fallbacks keep autoplay
    working instead of dead-ending.
    """
    video_id = request.args.get("videoId", "").strip()[:100]
    title = request.args.get("title", "").strip()[:200]
    artist = request.args.get("artist", "").strip()[:200]

    if not video_id and not artist and not title:
        return jsonify({"error": "A videoId, artist or title is required."}), 400

    try:
        limit = int(request.args.get("limit", 25))
    except ValueError:
        limit = 25
    limit = max(1, min(limit, 50))

    seen_ids = {video_id} if video_id else set()
    lead_artist = _first_artist(artist)

    strategies = []
    if video_id:
        strategies.append(("radio", lambda: _radio_tracks(video_id, seen_ids, limit)))
    if lead_artist and lead_artist != artist:
        strategies.append(("artist", lambda: _search_tracks(lead_artist, seen_ids, limit)))
    if artist:
        strategies.append(("artist", lambda: _search_tracks(artist, seen_ids, limit)))
    if title:
        strategies.append(("title", lambda: _search_tracks(title, seen_ids, limit)))

    tracks = []
    source = None
    errors = []

    for name, run in strategies:
        try:
            found = run()
        except Exception as error:
            app.logger.exception("related-tracks strategy %r failed", name)
            errors.append(f"{name}: {error}")
            continue

        if found:
            tracks = found
            source = name
            break

    app.logger.info(
        "related-tracks for %s -> source=%s count=%d",
        video_id or title or artist,
        source,
        len(tracks),
    )

    if not tracks:
        return jsonify({
            "error": "No related tracks were found.",
            "source": None,
            "errors": errors,
        }), 404

    return jsonify({"tracks": tracks, "source": source, "errors": errors})


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
