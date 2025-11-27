// static/reproductor/reproductor-discover.js
// ===============================================
// Playlists generadas por el sistema:
//  - Registro de reproducciones (localStorage)
//  - Top 10 personal (congelado diario)
//  - Discover Weekly
//  - Historial de reproducción
//  - Métricas diarias y semanales
// ===============================================

(function () {
  "use strict";

  // ---------------------------- Helpers básicos ----------------------------

  function _pad2(n) {
    return String(n).padStart(2, "0");
  }

  function _slugify(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  function _ensureAbs(u) {
    if (!u) return "";
    const s = String(u).trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;
    return "/" + s.replace(/^\/+/, "");
  }

  function _abs(u) {
    try {
      return u ? new URL(u, window.location.origin).href : "";
    } catch {
      return u || "";
    }
  }

  function _esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------- Usuario / namespace ------------------------

  function _detectUserKey() {
    const main = document.getElementById("main-content");
    const fromData =
      (main &&
        (main.dataset.userId ||
          main.dataset.user ||
          main.dataset.username)) ||
      "";
    const fromMeta =
      (document.querySelector('meta[name="user-id"]') || {}).content ||
      (document.querySelector('meta[name="username"]') || {}).content ||
      "";
    const raw = String(fromData || fromMeta || "anon").trim();
    const base = _slugify(raw) || "anon";
    return base;
  }

  const _USER_KEY = _detectUserKey();
  const _NS = (base) => `mdf.${_USER_KEY}.${base}`;

  // Prefijos en localStorage
  const PLAYS_PREFIX = () => _NS("plays.");
  const ORDER_PREFIX = () => _NS("top10.order.");
  const DISC_PREFIX = () => _NS("discover.");
  const HISTORY_KEY = () => _NS("history");

  function _loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }

  function _saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      // ignore
    }
  }

  // ---------------------------- Fechas / stamps ----------------------------

  function _stampFromDate(d) {
    return (
      d.getFullYear() + _pad2(d.getMonth() + 1) + _pad2(d.getDate())
    );
  }

  function todayStamp() {
    const d = new Date();
    return _stampFromDate(d);
  }

  function yesterdayStamp() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return _stampFromDate(d);
  }

  function _recentStampsInclToday(nDays) {
    const out = [];
    const d = new Date();
    for (let i = 0; i < nDays; i++) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      out.push(_stampFromDate(x));
    }
    return out;
  }

  function _recentStamps(nDays) {
    const out = [];
    const d = new Date();
    for (let i = 1; i <= nDays; i++) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      out.push(_stampFromDate(x));
    }
    return out;
  }

  function _weekKey(d = new Date()) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week =
      1 +
      Math.round(
        ((date - firstThursday) / 86400000 -
          3 +
          ((firstThursday.getUTCDay() + 6) % 7)) /
          7
      );
    const year = date.getUTCFullYear();
    return `${year}-W${String(week).padStart(2, "0")}`;
  }

  // ---------------------------- Storage de plays ---------------------------

  function _loadDailyPlays(stamp) {
    return _loadJSON(PLAYS_PREFIX() + stamp, {});
  }

  function _saveDailyPlays(stamp, obj) {
    _saveJSON(PLAYS_PREFIX() + stamp, obj || {});
  }

  function _sumRecentPlaysByKeyInclToday(nDays) {
    const stamps = _recentStampsInclToday(nDays);
    const agg = {};
    for (const s of stamps) {
      const db = _loadDailyPlays(s);
      for (const k in db) {
        agg[k] = (agg[k] || 0) + (db[k] || 0);
      }
    }
    return agg;
  }

  function _sumRecentPlaysByKey(nDays) {
    const stamps = _recentStamps(nDays);
    const agg = {};
    for (const s of stamps) {
      const db = _loadDailyPlays(s);
      for (const k in db) {
        agg[k] = (agg[k] || 0) + (db[k] || 0);
      }
    }
    return agg;
  }

  // ---------------------------- Claves de canción --------------------------

  function _songKey(song) {
    if (song && song._k) return song._k;
    if (song && song.id != null) return `id:${song.id}`;
    const audio =
      song &&
      (song.audioUrl ||
        song.audio_url ||
        song.audio ||
        (song.file && song.file.url));
    if (audio) {
      try {
        const abs = new URL(audio, window.location.origin).href;
        return `u:${abs}`;
      } catch {
        return `u:${String(audio)}`;
      }
    }
    return "";
  }

  // ---------------------------- Contadores públicos ------------------------

  function getTodayCount(song) {
    const k = _songKey(song);
    if (!k) return 0;
    const db = _loadDailyPlays(todayStamp());
    return Number(db[k] || 0);
  }

  function getWeekCount(song, days, includeToday) {
    const k = _songKey(song);
    if (!k) return 0;
    const stamps = includeToday
      ? _recentStampsInclToday(days)
      : _recentStamps(days);
    let sum = 0;
    for (const s of stamps) {
      const db = _loadDailyPlays(s);
      if (db) sum += db[k] || 0;
    }
    return sum;
  }

  function getWeeklyPlayCount(song, includeToday = true) {
    return getWeekCount(song, 7, includeToday);
  }

  // ---------------------------- Discover cache -----------------------------

  function _discoverKey() {
    return DISC_PREFIX() + _weekKey();
  }

  function _saveDiscover(arr) {
    _saveJSON(_discoverKey(), arr || []);
  }

  function _loadDiscover() {
    return _loadJSON(_discoverKey(), []);
  }

  // ---------------------------- Historial ----------------------------------

  function _saveHistoryEntries(entries) {
    _saveJSON(HISTORY_KEY(), Array.isArray(entries) ? entries : []);
  }

  function _relinkHistorySongWithId(song, keyFromEntry) {
    if (!song) return song;

    const key = keyFromEntry || _songKey(song);
    const songUrl = _abs(
      _ensureAbs(song.audioUrl || song.audio_url || song.audio || "")
    );

    const pls = Array.isArray(window._playlists) ? window._playlists : [];
    for (const pl of pls) {
      const arr = Array.isArray(pl.songs) ? pl.songs : [];
      for (const s of arr) {
        if (!s) continue;
        if (s.id == null) continue;

        const sKey = _songKey(s);
        const sUrl = _abs(
          _ensureAbs(s.audioUrl || s.audio_url || s.audio || "")
        );

        if ((key && sKey === key) || (songUrl && sUrl && songUrl === sUrl)) {
          // Combina metadatos del historial con los de la fuente principal.
          return { ...s, ...song, id: s.id };
        }
      }
    }
    return song;
  }

  function _loadHistoryEntries() {
    const arr = _loadJSON(HISTORY_KEY(), []);
    let entries = Array.isArray(arr) ? arr : [];
    let mutated = false;

    try {
      const pls = Array.isArray(window._playlists) ? window._playlists : [];
      if (pls.length) {
        entries = entries.map((e) => {
          if (!e || !e.song) return e;

          const fixedSong = _relinkHistorySongWithId(
            e.song,
            e.key || _songKey(e.song)
          );
          if (!fixedSong || fixedSong === e.song) return e;

          mutated = true;
          const newKey = _songKey(fixedSong) || e.key;
          return { ...e, song: fixedSong, key: newKey };
        });
      }
    } catch (e) {
      console.warn("No se pudo migrar historial:", e);
    }

    if (mutated) {
      _saveHistoryEntries(entries);
    }
    return entries;
  }

  function _historyRegisterPlay(song) {
    if (!song) return;

    // Se clona la canción para conservar metadatos adicionales.
    let norm = { ...song };

    norm.id = norm.id ?? null;
    norm.title = norm.title || "—";
    norm.author = norm.author || norm.artist_display_name || "—";
    norm.coverUrl =
      norm.coverUrl ||
      norm.cover_url ||
      norm.cover ||
      "/static/inicio_sesion/img_song.png";
    norm.audioUrl = norm.audioUrl || norm.audio_url || norm.audio || "";
    norm.genre = norm.genre || norm.genero || "";

    if (!norm.audioUrl) return;

    // Intenta enlazar con la versión almacenada en window._playlists.
    norm = _relinkHistorySongWithId(norm, null);

    const key = _songKey(norm);
    if (!key) return;

    let entries = _loadHistoryEntries();
    entries = entries.filter((e) => e && e.key !== key);

    const ts = Date.now();
    entries.unshift({ key, ts, song: norm });

    if (entries.length > 200) {
      entries = entries.slice(0, 200);
    }

    _saveHistoryEntries(entries);

    // Actualiza la playlist "pl:history" en memoria y su badge.
    try {
      let pls = Array.isArray(window._playlists)
        ? window._playlists.slice()
        : [];
      const histSongs = entries
        .map((e) =>
          e && e.song ? { ...e.song, _historyTs: e.ts } : null
        )
        .filter(Boolean);

      const idx = pls.findIndex((p) => p.id === "pl:history");
      if (idx >= 0) {
        pls[idx] = { ...pls[idx], songs: histSongs };
      } else {
        pls.splice(1, 0, {
          id: "pl:history",
          name: "Historial",
          songs: histSongs,
        });
      }
      window._playlists = pls;

      const ul = document.getElementById("rep-playlists");
      if (ul) {
        const li = ul.querySelector('li[data-pl="pl:history"]');
        if (li) {
          const badge = li.querySelector(".rep-badge");
          if (badge) badge.textContent = String(histSongs.length);
        }
      }
    } catch {
      // ignore
    }
  }

  function _buildHistoryPlaylist() {
    const entries = _loadHistoryEntries();
    const songs = entries
      .map((e) =>
        e && e.song ? { ...e.song, _historyTs: e.ts } : null
      )
      .filter(Boolean);
    return {
      id: "pl:history",
      name: "Historial",
      songs,
    };
  }

  function injectHistoryIntoPlaylists(basePlaylists) {
    const P = Array.isArray(basePlaylists) ? basePlaylists.slice() : [];
    const histPL = _buildHistoryPlaylist();

    const existing = P.findIndex((p) => p.id === "pl:history");
    if (existing >= 0) P.splice(existing, 1);

    const idxLikes = P.findIndex((p) => p.id === "pl:likes");
    const insertAt = idxLikes >= 0 ? idxLikes + 1 : 1;
    P.splice(insertAt, 0, histPL);
    return P;
  }

  function _fmtHistoryLabel(ts) {
    if (!ts) return "";
    let d;
    if (ts instanceof Date) d = ts;
    else {
      d = new Date(ts);
      if (isNaN(d.getTime())) return "";
    }
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === y.toDateString();
    const hh = _pad2(d.getHours());
    const mm = _pad2(d.getMinutes());
    if (sameDay) return `hoy a las ${hh}:${mm}`;
    if (isYesterday) return `ayer a las ${hh}:${mm}`;
    return `${_pad2(d.getDate())}/${_pad2(
      d.getMonth() + 1
    )}/${d.getFullYear()} ${hh}:${mm}`;
  }

  // ---------------------------- Top 10 congelado ---------------------------

  function _getFrozenOrder(stamp) {
    return _loadJSON(ORDER_PREFIX() + stamp, []);
  }

  function _setFrozenOrder(stamp, arr) {
    _saveJSON(
      ORDER_PREFIX() + stamp,
      Array.isArray(arr) ? arr.slice(0, 10) : []
    );
  }

  function _hasAnyPlays(stamp) {
    const db = _loadDailyPlays(stamp);
    if (!db || typeof db !== "object") return false;
    for (const k in db) if (db[k] > 0) return true;
    return false;
  }

  function _findLastFrozenOrderBefore(today) {
    let best = null;
    let bestStamp = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(ORDER_PREFIX())) {
        const stamp = key.slice(ORDER_PREFIX().length);
        if (/^\d{8}$/.test(stamp) && stamp < today) {
          const arr = _loadJSON(key, []);
          if (Array.isArray(arr) && arr.length) {
            if (!bestStamp || stamp > bestStamp) {
              best = arr;
              bestStamp = stamp;
            }
          }
        }
      }
    }
    return { order: best, stamp: bestStamp };
  }

  function _dedup(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const it of Array.isArray(arr) ? arr : []) {
      const k = keyFn(it);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  }

  function _flattenUniqueSongs(playlists) {
    const all = (Array.isArray(playlists) ? playlists : []).flatMap((pl) =>
      Array.isArray(pl.songs) ? pl.songs : []
    );
    return _dedup(
      all,
      (s) =>
        _songKey(s) ||
        _abs(s.audioUrl) ||
        `${(s.title || "").toLowerCase()}::${(
          s.author || ""
        ).toLowerCase()}`
    );
  }

  function _buildFrozenOrderFromPlays(playlists, stampForScores) {
    const base = _flattenUniqueSongs(playlists);
    const plays = _loadDailyPlays(stampForScores);
    const scored = base
      .map((s) => ({
        key: _songKey(s),
        score: plays[_songKey(s)] || 0,
      }))
      .filter((x) => !!x.key);
    scored.sort((a, b) => b.score - a.score);
    const order = scored.map((x) => x.key).slice(0, 10);
    if (order.length < 10) {
      for (const s of base) {
        const k = _songKey(s);
        if (!k) continue;
        if (!order.includes(k)) order.push(k);
        if (order.length >= 10) break;
      }
    }
    return order.slice(0, 10);
  }

  function ensureDailyRoll(playlists) {
    const today = todayStamp();
    const exists = _getFrozenOrder(today);
    if (Array.isArray(exists) && exists.length) return;

    const yday = yesterdayStamp();
    let order = [];

    if (_hasAnyPlays(yday)) {
      order = _buildFrozenOrderFromPlays(playlists, yday);
    } else {
      const { order: prev } = _findLastFrozenOrderBefore(today);
      if (prev && prev.length) {
        order = prev.slice(0, 10);
      } else {
        order = _buildFrozenOrderFromPlays(playlists, yday);
      }
    }
    _setFrozenOrder(today, order);
  }

  function _countsStampForToday() {
    const y = yesterdayStamp();
    if (_hasAnyPlays(y)) return y;
    const { stamp } = _findLastFrozenOrderBefore(todayStamp());
    return stamp || y;
  }

  // Top 10 basado SOLO en canciones reproducidas en los últimos 7 días
  // (incluyendo hoy). Si no hay reproducciones, queda vacío.
  function buildTop10FromPlaylistsFrozen(playlists) {
    const base = _flattenUniqueSongs(playlists);
    const byKey = new Map(base.map((s) => [_songKey(s), s]));

    // Reproducciones de los últimos 7 días (incluye hoy)
    const recent = _sumRecentPlaysByKeyInclToday(7) || {};
    const scored = [];

    for (const [k, count] of Object.entries(recent)) {
      const plays = Number(count || 0);
      if (!plays) continue;
      const song = byKey.get(k);
      if (!song) continue;
      scored.push({ key: k, song, score: plays });
    }

    // Sin reproducciones recientes → playlist vacía
    if (!scored.length) {
      return { id: "pl:top10", name: "Top 10 personal", songs: [] };
    }

    // Ordenamos por nº de reproducciones (más a menos)
    scored.sort((a, b) => b.score - a.score);

    const songs = scored.slice(0, 10).map((x) => x.song);

    return { id: "pl:top10", name: "Top 10 personal", songs };
  }

  // ---------------------------- Discover Weekly ----------------------------

  function _genreSlug(g) {
    return _slugify(g || "");
  }

  function _countBy(arr, fn) {
    const c = new Map();
    for (const x of arr || []) {
      const k = fn(x);
      if (!k) continue;
      c.set(k, (c.get(k) || 0) + 1);
    }
    return c;
  }

  function _genreWeightsFromLikes(likes) {
    const cnt = _countBy(
      likes || [],
      (s) => _genreSlug(s.genre || s.genero || s.gen || "")
    );
    if (!cnt.size) return new Map();
    let total = 0;
    for (const v of cnt.values()) total += v;
    const w = new Map();
    for (const [g, c] of cnt.entries()) {
      const f = c / total;
      w.set(g, f > 0.4 ? 3 : f > 0.2 ? 2 : 1);
    }
    return w;
  }

  function _capByArtist(songs, maxPerArtist) {
    const seen = new Map();
    const out = [];
    for (const s of songs || []) {
      const a = _slugify(s.author || s.artist_display_name || "");
      const n = seen.get(a) || 0;
      if (n < maxPerArtist) {
        out.push(s);
        seen.set(a, n + 1);
      }
    }
    return out;
  }

  function _roundRobinByGenre(songs) {
    const buckets = new Map();
    for (const s of songs || []) {
      const g =
        _genreSlug(s.genre || s.genero || s.gen || "") || "__other__";
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g).push(s);
    }
    for (const [g, arr] of buckets.entries()) {
      buckets.set(g, arr.slice());
    }
    const out = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [, arr] of buckets.entries()) {
        if (!arr.length) continue;
        out.push(arr.shift());
        progressed = true;
      }
    }
    return out;
  }

  // Discover Weekly: SOLO canciones con reproducciones recientes (7 días).
  function buildDiscoverWeekly({ playlists, likes = [], size = 30 }) {
    const base = _flattenUniqueSongs(playlists);
    const byKey = new Map(base.map((s) => [_songKey(s), s]));

    // Reproducciones de los últimos 7 días (incluyendo hoy)
    const recentPlays = _sumRecentPlaysByKeyInclToday(7) || {};
    const playedKeys = Object.keys(recentPlays).filter(
      (k) => Number(recentPlays[k] || 0) > 0
    );

    // Si no hay ninguna canción reproducida → Discover vacío
    if (!playedKeys.length) {
      return { id: "pl:discover", name: "Discover Weekly", songs: [] };
    }

    // Cache semanal: solo conservamos claves que sigan teniendo reproducciones
    const cachedKeysRaw = _loadDiscover() || [];
    const cachedKeys = cachedKeysRaw.filter((k) =>
      playedKeys.includes(String(k))
    );
    const cachedSongs = cachedKeys
      .map((k) => byKey.get(k))
      .filter(Boolean);

    if (cachedSongs.length >= Math.min(12, size * 0.4)) {
      return {
        id: "pl:discover",
        name: "Discover Weekly",
        songs: cachedSongs.slice(0, size),
      };
    }

    const likeSet = new Set(
      (likes || []).map((s) => _songKey(s)).filter(Boolean)
    );

    const universe = _dedup(
      playedKeys
        .map((k) => byKey.get(k))
        .filter(Boolean),
      (s) => _songKey(s)
    );

    const genreW = _genreWeightsFromLikes(likes || []);

    const scored = (universe || [])
      .map((s) => {
        const k = _songKey(s);
        if (!k) return null;
        const g = _genreSlug(s.genre || s.genero || s.gen || "");
        const plays = Number(recentPlays[k] || 0);
        const playsScore = Math.log(1 + plays) * 1.5;
        const likeBonus = likeSet.has(k) ? 2.0 : 0;
        const genreBonus = genreW.get(g) || (g ? 0.5 : 0);
        const jitter = Math.random() * 0.4;
        const score = playsScore + likeBonus + genreBonus + jitter;
        return { s, score, isLike: likeSet.has(k) };
      })
      .filter(Boolean);

    if (!scored.length) {
      return { id: "pl:discover", name: "Discover Weekly", songs: [] };
    }

    scored.sort((a, b) => b.score - a.score);

    const targetLikes = Math.round(size * 0.4);
    const targetHabits = Math.round(size * 0.4);
    const targetExplore = size - targetLikes - targetHabits;

    const likesBucket = scored.filter((x) => x.isLike).map((x) => x.s);
    const nonLikes = scored.filter((x) => !x.isLike);
    const habitsBucket = nonLikes.slice(0, size * 2).map((x) => x.s);
    const exploreBucket = nonLikes.slice(size * 2).map((x) => x.s);

    let pick = [];
    pick.push(...likesBucket.slice(0, targetLikes));
    pick.push(...habitsBucket.slice(0, targetHabits));
    pick.push(...exploreBucket.slice(0, targetExplore));

    pick = _capByArtist(pick, 2);
    pick = _roundRobinByGenre(pick);

    if (pick.length < size) {
      const already = new Set(pick.map((x) => _songKey(x)));
      const filler = [];
      for (const x of scored.map((z) => z.s)) {
        const k = _songKey(x);
        if (!k || already.has(k)) continue;
        filler.push(x);
        if (already.size + filler.length >= size * 2) break;
      }
      pick = _capByArtist([...pick, ...filler], 2).slice(0, size);
    } else {
      pick = pick.slice(0, size);
    }

    _saveDiscover(pick.map(_songKey));
    return { id: "pl:discover", name: "Discover Weekly", songs: pick };
  }

  // ---------------------------- Métricas Discover / Top10 -------------------

  function _flattenAllSongsFromPlaylists(playlists) {
    return (Array.isArray(playlists) ? playlists : []).flatMap((pl) =>
      Array.isArray(pl.songs) ? pl.songs : []
    );
  }

  function _buildKeyToSongMap(playlists) {
    const all = _flattenAllSongsFromPlaylists(playlists);
    const m = new Map();
    for (const s of all) {
      const k = _songKey(s);
      if (k && !m.has(k)) m.set(k, s);
    }
    return m;
  }

  function _computeWeeklyStats({ playlists, likes = [] }) {
    const recent = _sumRecentPlaysByKeyInclToday(7);
    const byKey = _buildKeyToSongMap(playlists);
    let totalPlays = 0;
    const genreCounts = new Map();
    const artistCounts = new Map();
    for (const [k, plays] of Object.entries(recent)) {
      const s = byKey.get(k);
      if (!s) continue;
      const p = Number(plays || 0);
      if (!p) continue;
      totalPlays += p;
      const g = _genreSlug(s.genre || s.genero || s.gen || "otro");
      genreCounts.set(g, (genreCounts.get(g) || 0) + p);
      const a = _slugify(s.author || s.artist_display_name || "—");
      artistCounts.set(a, (artistCounts.get(a) || 0) + p);
    }
    const topGenre =
      [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0] ||
      ["—", 0];
    const topArtist =
      [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0] ||
      ["—", 0];
    const likeSet = new Set(
      (likes || []).map((s) => _songKey(s)).filter(Boolean)
    );
    return { totalPlays, topGenre, topArtist, likeSet };
  }

  function _renderDiscoverHeader({ playlistDW, stats }) {
    const left = document.querySelector(".rep-left");
    if (!left) return;
    const node = document.createElement("div");
    node.className = "discover-header rep-stats";
    node.setAttribute("data-scope", "week");
    node.style.cssText =
      "background:#0f0f0f;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 12px 0";

    const songs = Array.isArray(playlistDW && playlistDW.songs)
      ? playlistDW.songs
      : [];

    let likedInDW = 0;
    for (const s of songs) {
      if (stats.likeSet.has(_songKey(s))) likedInDW++;
    }

    const gLabel = (g) => {
      const map = {
        pop: "Pop",
        rock: "Rock",
        electronica: "Electrónica",
        salsa: "Salsa",
        indie: "Indie",
        hiphop: "Hip-Hop",
        reggaeton: "Reguetón",
        regional: "Regional",
        balada: "Balada",
        jazz: "Jazz",
        clasica: "Clásica",
        otro: "Otro",
      };
      return map[g] || (g || "—");
    };

    node.innerHTML = `
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <div class="rep-total" style="min-width:180px">
            <strong>Reproducciones (7d):</strong> ${stats.totalPlays}
          </div>
          <div style="min-width:200px">
            <strong>Género top:</strong> ${gLabel(
              stats.topGenre[0]
            )} <small style="opacity:.7">(${stats.topGenre[1] || 0})</small>
          </div>
          <div style="min-width:200px">
            <strong>Artista top:</strong> ${
              stats.topArtist[0] || "—"
            } <small style="opacity:.7">(${stats.topArtist[1] || 0})</small>
          </div>
        </div>
        <div style="min-width:180px">
          <strong>Canciones likeadas:</strong> ${likedInDW}
        </div>
      </div>
    `;
    left.prepend(node);
  }

  function _computeDailyStats({ playlists }) {
    const byKey = _buildKeyToSongMap(playlists);
    let totalPlays = 0;
    const genreCounts = new Map();
    const artistCounts = new Map();

    const today = todayStamp();
    const db = _loadDailyPlays(today) || {};
    for (const [k, plays] of Object.entries(db)) {
      const s = byKey.get(k);
      if (!s) continue;
      const p = Number(plays || 0);
      if (!p) continue;
      totalPlays += p;

      const g = _genreSlug(s.genre || s.genero || s.gen || "otro");
      genreCounts.set(g, (genreCounts.get(g) || 0) + p);

      const a = _slugify(s.author || s.artist_display_name || "—");
      artistCounts.set(a, (artistCounts.get(a) || 0) + p);
    }

    const topGenre =
      [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0] ||
      ["—", 0];
    const topArtist =
      [...artistCounts.entries()].sort((a, b) => b[1] - a[1])[0] ||
      ["—", 0];
    return { totalPlays, topGenre, topArtist };
  }

  function _renderTop10Header({ songs }) {
    const left = document.querySelector(".rep-left");
    if (!left) return;
    const node = document.createElement("div");
    node.className = "top10-header rep-stats";
    node.setAttribute("data-scope", "day");
    node.style.cssText =
      "background:#0f0f0f;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 12px 0";

    const statsDay = _computeDailyStats({
      playlists: window._playlists || [],
    });

    const gLabel = (g) => {
      const map = {
        pop: "Pop",
        rock: "Rock",
        electronica: "Electrónica",
        salsa: "Salsa",
        indie: "Indie",
        hiphop: "Hip-Hop",
        reggaeton: "Reguetón",
        regional: "Regional",
        balada: "Balada",
        jazz: "Jazz",
        clasica: "Clásica",
        otro: "Otro",
      };
      return map[g] || (g || "—");
    };

    node.innerHTML = `
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div class="rep-total" style="min-width:180px">
          <strong>Reproducciones (hoy):</strong> ${statsDay.totalPlays}
        </div>
        <div style="min-width:200px">
          <strong>Género top (hoy):</strong> ${gLabel(
            statsDay.topGenre[0]
          )} <small style="opacity:.7">(${statsDay.topGenre[1] || 0})</small>
        </div>
        <div style="min-width:200px">
          <strong>Artista top (hoy):</strong> ${
            statsDay.topArtist[0] || "—"
          } <small style="opacity:.7">(${statsDay.topArtist[1] || 0})</small>
        </div>
      </div>
    `;
    left.prepend(node);
  }

  // ---------------------------- Registro de plays --------------------------

  function registerPlay(song) {
    const k = _songKey(song);
    if (!k) return;
    const stamp = todayStamp();
    const db = _loadDailyPlays(stamp);
    db[k] = (db[k] || 0) + 1;
    _saveDailyPlays(stamp, db);

    try {
      _historyRegisterPlay(song);
    } catch (e) {
      console.warn("No se pudo registrar en historial:", e);
    }

    try {
      document.dispatchEvent(
        new CustomEvent("melodify:playcount", {
          detail: { key: k },
          bubbles: true,
        })
      );
    } catch {
      // ignore
    }
  }

  // ---------------------------- Vistas (renderizado) -----------------------

  function _clearStatsHeader() {
    const left = document.querySelector(".rep-left");
    if (!left) return;
    const oldH = left.querySelector(".rep-stats");
    if (oldH) oldH.remove();
  }

  function renderTop10View() {
    if (!window.MDFCore || typeof window.MDFCore.renderLeftSongs !== "function")
      return;
    const playlists = Array.isArray(window._playlists)
      ? window._playlists
      : [];
    const plTop = buildTop10FromPlaylistsFrozen(playlists);

    _clearStatsHeader();
    window.MDFCore.renderLeftSongs(plTop.songs, plTop.name, {
      countsMode: "daily",
      showLikeBtn: false,
    });
    _renderTop10Header({ songs: plTop.songs });
  }

  function renderDiscoverView() {
    if (!window.MDFCore || typeof window.MDFCore.renderLeftSongs !== "function")
      return;
    const playlists = Array.isArray(window._playlists)
      ? window._playlists
      : [];
    const likes = Array.isArray(window._likes) ? window._likes : [];
    let d;
    try {
      d = buildDiscoverWeekly({
        playlists,
        likes,
        size: 30,
      });
    } catch (e) {
      console.warn("Discover build failed:", e);
      d = { id: "pl:discover", name: "Discover Weekly", songs: [] };
    }

    _clearStatsHeader();
    window.MDFCore.renderLeftSongs(d.songs, d.name, {
      countsMode: "weekly",
      showLikeBtn: false,
    });
    const stats = _computeWeeklyStats({ playlists, likes });
    _renderDiscoverHeader({ playlistDW: d, stats });
  }

  function renderHistoryView() {
    if (!window.MDFCore || typeof window.MDFCore.renderLeftSongs !== "function")
      return;

    const entries = _loadHistoryEntries();
    const songs = Array.isArray(entries)
      ? entries
          .map((e) => {
            if (!e || !e.song) return null;
            const base = { ...e.song, _historyTs: e.ts };
            const relinked = _relinkHistorySongWithId(
              base,
              e.key || _songKey(e.song)
            );
            return relinked;
          })
          .filter(Boolean)
      : [];

    _clearStatsHeader();
    window.MDFCore.renderLeftSongs(songs, "Historial", {
      countsMode: null,
      showLikeBtn: false,
      showHistoryTime: true,
    });

    // Etiquetas "hoy / ayer / fecha" en filas del historial.
    const rows = document.querySelectorAll(
      ".rep-left .song-item .song-author"
    );

    rows.forEach((row) => {
      const timeNode = row.querySelector(".song-history-time");
      if (!timeNode) return;

      const item = row.closest(".song-item");
      if (!item) return;

      const tsAttr = item.dataset.historyTs;
      if (!tsAttr) return;

      const ts = Number(tsAttr);
      const label = _fmtHistoryLabel(Number.isFinite(ts) ? ts : tsAttr);
      if (label) {
        timeNode.textContent = `• ${label}`;
      }
    });
  }

  function prepareSystemPlaylists(playlists, { likes }) {
    let P = Array.isArray(playlists) ? playlists.slice() : [];

    try {
      ensureDailyRoll(P);
    } catch (e) {
      console.warn("ensureDailyRoll falló:", e);
    }

    const top10 = buildTop10FromPlaylistsFrozen(P);

    P = P.filter(
      (pl) => pl && pl.id !== "pl:top10" && pl.id !== "pl:discover"
    );

    let discover = null;
    try {
      discover = buildDiscoverWeekly({
        playlists: P,
        likes: Array.isArray(likes) ? likes : [],
        size: 30,
      });
    } catch (e) {
      console.warn("Discover Weekly falló:", e);
    }

    let insertAfter = 0;
    for (const id of ["pl:all", "pl:mine", "pl:likes", "pl:history"]) {
      const idx = P.findIndex((p) => p.id === id);
      if (idx >= 0 && idx >= insertAfter) insertAfter = idx + 1;
    }

    P.splice(insertAfter, 0, top10);
    if (discover) {
      P.splice(insertAfter + 1, 0, discover);
    }
    return P;
  }

  function _refreshTop10ViewIfActive() {
    const ul = document.getElementById("rep-playlists");
    if (!ul) return;
    const active = ul.querySelector('li.active[data-pl="pl:top10"]');
    if (!active) return;
    renderTop10View();
  }

  // ---------------------------- Listener de "playcount" --------------------

  document.addEventListener("melodify:playcount", (ev) => {
    const k = ev && ev.detail && ev.detail.key;
    if (!k) return;

    // Actualiza badges de reproducciones por canción.
    if (typeof CSS !== "undefined" && CSS.escape) {
      const nodes = document.querySelectorAll(
        `.rep-badge[data-badge="plays"][data-skey="${CSS.escape(k)}"]`
      );
      nodes.forEach((n) => {
        const scope = n.getAttribute("data-scope");
        if (scope === "day") {
          n.textContent = String(getTodayCount({ _k: k }) || 0);
        } else if (scope === "week") {
          n.textContent = String(
            getWeekCount({ _k: k }, 7, true) || 0
          );
        }
      });
    }

    const header = document.querySelector(".rep-left .rep-stats");

    if (!header) {
      _refreshTop10ViewIfActive();

      const activeDiscover = document.querySelector(
        '#rep-playlists li.active[data-pl="pl:discover"]'
      );
      if (
        activeDiscover &&
        window.MDFDiscover &&
        typeof window.MDFDiscover.renderDiscoverView === "function"
      ) {
        window.MDFDiscover.renderDiscoverView();
      }

      const activeHistory = document.querySelector(
        '#rep-playlists li.active[data-pl="pl:history"]'
      );
      if (
        activeHistory &&
        window.MDFDiscover &&
        typeof window.MDFDiscover.renderHistoryView === "function"
      ) {
        window.MDFDiscover.renderHistoryView();
      }

      return;
    }

    const scope = header.getAttribute("data-scope");
    const totalNode = header.querySelector(".rep-total");

    if (scope === "week") {
      // Header de Discover Weekly
      const stats = _computeWeeklyStats({
        playlists: window._playlists || [],
        likes: window._likes || [],
      });
      if (totalNode) {
        totalNode.innerHTML =
          `<strong>Reproducciones (7d):</strong> ${stats.totalPlays}`;
      }

      const activeDiscover = document.querySelector(
        '#rep-playlists li.active[data-pl="pl:discover"]'
      );
      if (
        activeDiscover &&
        window.MDFDiscover &&
        typeof window.MDFDiscover.renderDiscoverView === "function"
      ) {
        window.MDFDiscover.renderDiscoverView();
      }
    } else if (scope === "day") {
      // Header de Top 10 (hoy)
      const statsDay = _computeDailyStats({
        playlists: window._playlists || [],
      });

      if (totalNode) {
        totalNode.innerHTML =
          `<strong>Reproducciones (hoy):</strong> ${statsDay.totalPlays}`;
      }

      const hdrTop10 = document.querySelector(".rep-left .top10-header");
      if (hdrTop10) {
        const gLabel = (g) => {
          const map = {
            pop: "Pop",
            rock: "Rock",
            electronica: "Electrónica",
            salsa: "Salsa",
            indie: "Indie",
            hiphop: "Hip-Hop",
            reggaeton: "Reguetón",
            regional: "Regional",
            balada: "Balada",
            jazz: "Jazz",
            clasica: "Clásica",
            otro: "Otro",
          };
          return map[g] || (g || "—");
        };
        const blocks = hdrTop10.querySelectorAll("div");
        blocks.forEach((div) => {
          if (div.textContent.includes("Género top")) {
            div.innerHTML = `<strong>Género top (hoy):</strong> ${gLabel(
              statsDay.topGenre[0]
            )} <small style="opacity:.7">(${statsDay.topGenre[1] || 0})</small>`;
          } else if (div.textContent.includes("Artista top")) {
            div.innerHTML = `<strong>Artista top (hoy):</strong> ${
              statsDay.topArtist[0] || "—"
            } <small style="opacity:.7">(${statsDay.topArtist[1] || 0})</small>`;
          }
        });
      }
    }

    _refreshTop10ViewIfActive();

    const activeHistory = document.querySelector(
      '#rep-playlists li.active[data-pl="pl:history"]'
    );
    if (
      activeHistory &&
      window.MDFDiscover &&
      typeof window.MDFDiscover.renderHistoryView === "function"
    ) {
      window.MDFDiscover.renderHistoryView();
    }
  });

  // ---------------------------- API pública --------------------------------

  window.MDFDiscover = {
    registerPlay,
    getTodayCount,
    getWeeklyPlayCount,
    ensureDailyRoll,
    injectHistoryIntoPlaylists,
    prepareSystemPlaylists,
    renderTop10View,
    renderDiscoverView,
    renderHistoryView,
    countsStampForToday: _countsStampForToday,
    loadHistoryEntries: _loadHistoryEntries,
    formatHistoryLabel: _fmtHistoryLabel,
  };
})();
