/* Keep browser storage small enough that synchronous localStorage work never
   grows into a visible animation hitch. This runs only when the browser is
   idle and never touches account data such as favourites or ratings. */
(function scheduleStorageMaintenance() {
  'use strict';

  const ARRAY_LIMITS = new Map([
    ['thaalam-on-demand-playback-history-v1', 160]
  ]);
  const OBJECT_LIMITS = new Map([
    ['thaalam-track-duration-cache-v1', 400],
    ['thaalam24x7-song-info-v1', 350],
    ['thaalam-catalog-artist-info-v4', 220],
    ['thaalam-jiosaavn-genre-cache-v12', 16]
  ]);
  const TASTE_KEY = 'thaalam-on-demand-taste-profile-v1';
  const SEARCH_PREFIX = 'thaalam-jiosaavn-search-v1:';
  const SEARCH_LIMIT = 24;
  const parse = (value, fallback) => {
    try { return JSON.parse(value); } catch { return fallback; }
  };

  function trimArrayKey(key, limit) {
    const items = parse(localStorage.getItem(key) || '[]', []);
    if (!Array.isArray(items) || items.length <= limit) return;
    localStorage.setItem(key, JSON.stringify(items.slice(0, limit)));
  }

  function trimObjectKey(key, limit) {
    const records = parse(localStorage.getItem(key) || '{}', {});
    if (!records || typeof records !== 'object' || Array.isArray(records)) return;
    const entries = Object.entries(records);
    if (entries.length <= limit) return;
    entries.sort(([, a], [, b]) => Number(b?.savedAt || b?.updatedAt || 0) - Number(a?.savedAt || a?.updatedAt || 0));
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries.slice(0, limit))));
  }

  function trimTasteProfile() {
    const taste = parse(localStorage.getItem(TASTE_KEY) || '{}', {});
    if (!taste || typeof taste !== 'object') return;
    const completed = Array.isArray(taste.completedTracks) ? taste.completedTracks.slice(0, 180) : [];
    const profile = Array.isArray(taste.profile) ? taste.profile.slice(0, 180) : [];
    if ((taste.completedTracks?.length || 0) <= 180 && (taste.profile?.length || 0) <= 180) return;
    localStorage.setItem(TASTE_KEY, JSON.stringify({ ...taste, completedTracks: completed, profile }));
  }

  function trimSearchCache() {
    const entries = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(SEARCH_PREFIX)) continue;
      const record = parse(localStorage.getItem(key) || '{}', {});
      if (!Number(record?.savedAt) || Date.now() - Number(record.savedAt) > 6 * 60 * 60 * 1000) {
        localStorage.removeItem(key);
      } else {
        entries.push([key, Number(record.savedAt)]);
      }
    }
    entries.sort((a, b) => b[1] - a[1]);
    entries.slice(SEARCH_LIMIT).forEach(([key]) => localStorage.removeItem(key));
  }

  function run() {
    try {
      ARRAY_LIMITS.forEach(trimArrayKey);
      OBJECT_LIMITS.forEach(trimObjectKey);
      trimTasteProfile();
      trimSearchCache();
    } catch { /* Storage is optional; playback remains unaffected. */ }
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    window.setTimeout(run, 1200);
  }
}());
