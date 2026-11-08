/*
 * Thaalam recommendation engine
 *
 * Pure recommendation logic lives here.
 */
(function initializeThaalamRecommendationEngine() {
  'use strict';

  const normalize = (value) => String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const artistNames = (value) => [...new Set(String(value || '')
    .split(/[,/&]|\b(?:feat(?:uring)?|with|x)\b/i)
    .map((artist) => artist.trim())
    .filter(Boolean))];

  function seed({ deviceId, dayKey, key }) {
    const value = `${deviceId}|${dayKey}|${key}`;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function shuffle(items, value) {
    const shuffled = Array.isArray(items) ? items.slice() : [];
    let state = value >>> 0;
    const random = () => {
      state += 0x6D2B79F5;
      let next = state;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  }

  function diversify(songs) {
    const remaining = Array.isArray(songs) ? [...songs] : [];
    const ordered = [];
    const recentAlbums = [];
    const recentArtists = [];
    while (remaining.length) {
      let index = remaining.findIndex((song) => {
        const album = normalize(song.collectionName);
        const artist = normalize(song.artistName);
        return (!album || !recentAlbums.slice(-5).includes(album)) &&
          (!artist || !recentArtists.slice(-2).includes(artist));
      });
      if (index < 0) index = remaining.findIndex((song) => {
        const album = normalize(song.collectionName);
        return !album || !recentAlbums.slice(-5).includes(album);
      });
      if (index < 0) index = 0;
      const [song] = remaining.splice(index, 1);
      ordered.push(song);
      recentAlbums.push(normalize(song.collectionName));
      recentArtists.push(normalize(song.artistName));
    }
    return ordered;
  }

  function personalize(songs, { history = [], dedupe = (items) => items } = {}) {
    const uniqueSongs = dedupe(songs);
    if (!history.length) return uniqueSongs;
    const artistPlays = new Map();
    history.forEach((song) => artistNames(song.artistName).forEach((artist) => {
      const key = normalize(artist);
      artistPlays.set(key, (artistPlays.get(key) || 0) + 1);
    }));
    const ranked = uniqueSongs.map((song, index) => ({ song, index,
      affinity: artistNames(song.artistName).reduce((total, artist) =>
        total + (artistPlays.get(normalize(artist)) || 0), 0)
    })).sort((first, second) => second.affinity - first.affinity || first.index - second.index);
    const mixed = [];
    const recentArtists = [];
    while (ranked.length) {
      let index = ranked.findIndex(({ song }) => {
        const artists = artistNames(song.artistName).map(normalize);
        return !artists.length || !artists.some((artist) => recentArtists.slice(-2).includes(artist));
      });
      if (index < 0) index = 0;
      const [{ song }] = ranked.splice(index, 1);
      mixed.push(song);
      recentArtists.push(...artistNames(song.artistName).map(normalize));
    }
    return mixed;
  }

  function dailyMixes({ completedTracks = [], labels, genreForSong, dayKey, deviceId, storage, storageKey }) {
    const scores = new Map(Object.keys(labels).map((genre) => [genre, { plays: 0, weight: 0 }]));
    completedTracks.forEach((song, index) => {
      const genre = genreForSong(song);
      const score = scores.get(genre);
      if (!score) return;
      score.plays += 1;
      score.weight += 1 / (1 + index * 0.08);
    });
    const ranked = [...scores]
      .filter(([, score]) => score.plays >= 3)
      .sort((first, second) => second[1].weight - first[1].weight)
      .map(([genre]) => genre);
    if (!ranked.length) return [];

    let planned = [];
    try {
      const saved = JSON.parse(storage.getItem(storageKey) || '{}');
      if (saved?.dayKey === dayKey && saved?.deviceId === deviceId && Array.isArray(saved?.genres)) {
        planned = saved.genres.filter((genre) => Object.prototype.hasOwnProperty.call(labels, genre));
      }
      if (!planned.length) {
        planned = ranked.slice(0, 5);
        storage.setItem(storageKey, JSON.stringify({ dayKey, deviceId, genres: planned }));
      }
    } catch {
      planned = ranked.slice(0, 5);
    }

    const mixes = planned.length > 1 ? [{
      id: 'thaalam', title: 'Thaalam Mix', subtitle: 'Across your favourite sounds', genres: planned
    }] : [];
    planned.forEach((genre, index) => mixes.push({
      id: `genre-${genre}`,
      title: `Thaalam Mix ${index + 1}`,
      subtitle: `${labels[genre]} Mix`,
      genres: [genre]
    }));
    return mixes;
  }

  function discoveryArtists({ mix, taste = [], genreForSong, value }) {
    const scores = new Map();
    taste.forEach((song, index) => {
      if (!mix.genres.includes(genreForSong(song))) return;
      const weight = 1 / (1 + index * 0.06);
      artistNames(song.artistName).forEach((artist) => {
        const key = normalize(artist);
        const current = scores.get(key) || { artist, score: 0 };
        current.score += weight;
        scores.set(key, current);
      });
    });
    return shuffle([...scores.values()].sort((a, b) => b.score - a.score).slice(0, 14), value)
      .slice(0, 6).map(({ artist }) => artist);
  }

  function nextMixSession({ mixId, dayKey, storage, storageKey }) {
    try {
      const saved = JSON.parse(storage.getItem(storageKey) || '{}');
      const sessions = saved?.dayKey === dayKey && saved?.sessions && typeof saved.sessions === 'object'
        ? saved.sessions
        : {};
      const count = Math.max(0, Number(sessions[mixId]) || 0) + 1;
      sessions[mixId] = count;
      storage.setItem(storageKey, JSON.stringify({ dayKey, sessions }));
      return count;
    } catch {
      return Math.floor(Math.random() * 1000000) + 1;
    }
  }

  window.ThaalamRecommendationEngine = Object.freeze({
    seed, shuffle, diversify, personalize, dailyMixes, artistNames,
    discoveryArtists, nextMixSession
  });
}());
