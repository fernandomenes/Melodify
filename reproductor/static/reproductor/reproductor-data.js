// Reproductor central — Datos y normalización de canciones.

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function ensureAbs(u) {
  if (!u) return "";
  const s = String(u).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;
  return "/" + s.replace(/^\/+/, "");
}

export function absHref(u) {
  try {
    return u ? new URL(u, location.origin).href : "";
  } catch {
    return "";
  }
}

export const pickFirst = (...c) =>
  c.find((v) => typeof v === "string" && v.trim().length) || "";

// Cookie simple para CSRF u otros usos HTTP
function _getCookie(name) {
  const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : "";
}

// Clave estable para una canción
export function _songKey(song) {
  if (song && song._k) return song._k;
  const byId = song?.id != null ? `id:${song.id}` : "";
  const byUrl = song?.audioUrl
    ? `u:${absHref(ensureAbs(song.audioUrl))}`
    : "";
  return byId || byUrl || "";
}

// Registro global de canciones conocidas
export function registerKnownSongs(list) {
  if (!Array.isArray(list) || !list.length) return;

  const prev = Array.isArray(window.__MDF_GLOBAL_SONGS__)
    ? window.__MDF_GLOBAL_SONGS__
    : [];

  const seen = new Set(
    prev.map((s) => {
      const k = _songKey(s);
      if (k) return k;
      const t = (s.title || "").toLowerCase();
      const a = (
        s.author ||
        s.artist_display_name ||
        s.artist ||
        s.singer ||
        ""
      ).toLowerCase();
      return `${s.id ?? ""}::${t}::${a}`;
    })
  );

  for (const s of list) {
    if (!s) continue;
    const k =
      _songKey(s) ||
      `${s.id ?? ""}::${(s.title || "").toLowerCase()}::${(
        s.author ||
        s.artist_display_name ||
        s.artist ||
        s.singer ||
        ""
      ).toLowerCase()}`;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    prev.push(s);
  }

  window.__MDF_GLOBAL_SONGS__ = prev;
}

// Normalización de objetos canción
export function normalizeSong(song) {
  const audio = pickFirst(
    song.audioUrl,
    song.audio_url,
    song.audio,
    song.file,
    song.file_url,
    song.filePath,
    song.file_path,
    song.audioFile,
    song.audio_file,
    song.audioPath,
    song.audio_path,
    song.src,
    song.source,
    song.stream_url,
    song.streamUrl,
    song?.audio?.url,
    song?.file?.url,
    song?.media?.audio,
    song?.media?.url
  );
  if (!audio) return null;

  const cover =
    pickFirst(
      song.coverUrl,
      song.cover_url,
      song.cover,
      song.thumbnail,
      song.thumb,
      song?.cover?.url,
      song?.image?.url,
      song?.media?.cover
    ) || "/static/inicio_sesion/img_song.png";

  const title = pickFirst(song.title, song.name) || "—";
  const author =
    pickFirst(
      song.artist_display_name,
      song.artist,
      song.author,
      song.singer
    ) || "—";
  const genre = pickFirst(song.genre, song.genero, song.gen) || "";

  return {
    id: song.id ?? null,
    title,
    author,
    coverUrl: cover,
    audioUrl: audio,
    genre,
  };
}

// Usuario actual
export function _getUsername() {
  const mc = document.getElementById("main-content");
  return (
    (window.__SESSION_USER__ &&
      (window.__SESSION_USER__.username || window.__SESSION_USER__.user)) ||
    mc?.dataset?.username ||
    document.querySelector('meta[name="username"]')?.content ||
    document.body?.dataset?.username ||
    ""
  );
}

export function _getCurrentUserInfo() {
  const username = (_getUsername() || "").trim();

  const metaId =
    document.querySelector('meta[name="user-id"]')?.content ||
    document.body?.dataset?.userid ||
    "";
  const sessionId =
    (window.__SESSION_USER__ &&
      (window.__SESSION_USER__.id || window.__SESSION_USER__.pk)) ||
    "";

  let rawId = sessionId || metaId || "";
  let userId = String(rawId).trim();

  if (
    !userId ||
    userId === "None" ||
    userId === "null" ||
    userId === "undefined"
  ) {
    userId = "";
  }

  return { username, userId };
}

// Dueño de playlist
export function _extractPlaylistOwner(pl) {
  if (!pl || typeof pl !== "object") {
    return { ownerName: "", ownerId: "" };
  }

  const rawUser = pl.user || pl.usuario || null;
  let nameFromUserObj = "";
  let idFromUserObj = "";

  if (rawUser && typeof rawUser === "object") {
    nameFromUserObj =
      rawUser.username ||
      rawUser.user ||
      rawUser.name ||
      rawUser.nombre ||
      rawUser.email ||
      "";
    idFromUserObj =
      rawUser.id ??
      rawUser.pk ??
      rawUser.user_id ??
      rawUser.id_user ??
      "";
  } else if (
    rawUser != null &&
    (typeof rawUser === "number" || /^[0-9]+$/.test(String(rawUser)))
  ) {
    idFromUserObj = String(rawUser);
  }

  const ownerName =
    pl.owner_username ||
    pl.username ||
    (typeof pl.user === "string" ? pl.user : "") ||
    pl.owner ||
    pl.user_name ||
    pl.usuario ||
    nameFromUserObj ||
    "";

  const ownerId =
    pl.idUser ??
    pl.user_id ??
    pl.owner_id ??
    pl.id_user ??
    pl.userid ??
    pl.id_usuario ??
    idFromUserObj ??
    "";

  return {
    ownerName: String(ownerName || ""),
    ownerId: ownerId != null ? String(ownerId) : "",
  };
}

// Fetch de playlists y canciones

export async function fetchAllSongsFromBackend() {
  try {
    if (Array.isArray(window.__MDF_ALL_SONGS__)) {
      return window.__MDF_ALL_SONGS__;
    }

    const url =
      window.__MDF_URL_ALL_SONGS__ ||
      document.body?.dataset?.urlAllSongsJson ||
      "";

    if (!url) {
      console.warn(
        "No se configuró URL_ALL_SONGS_JSON (data-url-all-songs-json)."
      );
      return [];
    }

    const res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "fetch" },
    });

    if (!res.ok) {
      console.warn("fetchAllSongsFromBackend() HTTP", res.status);
      return [];
    }

    const data = await res.json();

    const raw =
      (Array.isArray(data?.songs) && data.songs) ||
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data) && data) ||
      [];

    const songs = raw.map(normalizeSong).filter(Boolean);

    registerKnownSongs(songs);

    window.__MDF_ALL_SONGS__ = songs;
    return songs;
  } catch (e) {
    console.warn("fetchAllSongsFromBackend() falló:", e);
    return [];
  }
}

export async function fetchFollowedArtistsPlaylists() {
  try {
    const res = await fetch("/api/followed-artists/playlists/", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "fetch" },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const raw = Array.isArray(data.playlists) ? data.playlists : [];
    return raw.map((pl) => ({
      ...pl,
      songs: Array.isArray(pl.songs)
        ? pl.songs.map((s) => normalizeSong(s)).filter(Boolean)
        : [],
    }));
  } catch {
    return [];
  }
}

export async function fetchMyMusic(URL_MI_MUSICA_JSON) {
  try {
    if (!URL_MI_MUSICA_JSON) return [];
    const res = await fetch(URL_MI_MUSICA_JSON, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "fetch" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw =
      (Array.isArray(data?.songs) && data.songs) ||
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.playlist?.songs) && data.playlist.songs) ||
      [];
    const songs = raw.map(normalizeSong).filter(Boolean);

    registerKnownSongs(songs);

    return songs;
  } catch (e) {
    console.warn("fetchMyMusic() falló:", e);
    return [];
  }
}

export async function fetchMyLikes(URL_MIS_LIKES_JSON) {
  try {
    if (!URL_MIS_LIKES_JSON) return [];
    const res = await fetch(URL_MIS_LIKES_JSON, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return [];

    const data = await res.json();

    const raw =
      (Array.isArray(data?.songs) && data.songs) ||
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.playlist?.songs) && data.playlist.songs) ||
      [];

    const songs = raw.map(normalizeSong).filter(Boolean);

    registerKnownSongs(songs);

    return songs;
  } catch (e) {
    console.warn("fetchMyLikes() falló:", e);
    return [];
  }
}

export async function fetchAllPlaylistsWithSongs() {
  try {
    const info = _getCurrentUserInfo();
    const uname = (info.username || "").trim();
    const uid = (info.userId || "").trim();

    const norm = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

    const curNameNorm = norm(uname);

    const res = await fetch("/playlist/getAllList", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const lists =
      (Array.isArray(data) && data) ||
      (Array.isArray(data?.playlists) && data.playlists) ||
      (Array.isArray(data?.results) && data.results) ||
      [];

    if (!lists.length) return [];

    const byId = async (pl) => {
      const pidRaw =
        pl.id ?? pl.pk ?? pl.id_playlist ?? pl.playlist_id ?? null;

      if (pidRaw == null) {
        console.warn("Playlist sin id conocido en getAllList:", pl);
        return null;
      }

      const pid = String(pidRaw);

      const inferred = _extractPlaylistOwner(pl) || {};
      const ownerName = inferred.ownerName || "";
      const ownerId = inferred.ownerId || "";

      const ownerNorm = norm(ownerName);

      const isOwnedByName =
        curNameNorm && ownerNorm ? curNameNorm === ownerNorm : false;
      const isOwnedById =
        uid && ownerId ? String(uid) === String(ownerId) : false;

      const isMine = isOwnedByName || isOwnedById;

      const isPrivate =
        pl.isprivate === true || pl.is_private === true;

      const baseMeta = {
        id: `pl:${pid}`,
        name: pl.name || pl.nombre || `Playlist ${pid}`,

        owner: ownerName,
        user: ownerName,
        username: ownerName,
        owner_username: ownerName,

        idUser: ownerId,
        user_id: ownerId,
        owner_id: ownerId,
        id_user: ownerId,
        userid: ownerId,

        isprivate: isPrivate,
        is_private: isPrivate,

        isMine: isMine,
      };

      const r = await fetch(`/playlist/${encodeURIComponent(pid)}/songs/`, {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!r.ok) {
        return {
          ...baseMeta,
          songs: [],
        };
      }

      const dataSongs = await r.json();
      const rawSongs =
        (Array.isArray(dataSongs?.songs) && dataSongs.songs) ||
        (Array.isArray(dataSongs?.results) && dataSongs.results) ||
        (Array.isArray(dataSongs?.playlist?.songs) &&
          dataSongs.playlist.songs) ||
        [];
      const normSongs = rawSongs.map(normalizeSong).filter(Boolean);

      registerKnownSongs(normSongs);

      return {
        ...baseMeta,
        songs: normSongs,
      };
    };

    const detailed = await Promise.all(lists.map(byId));
    return detailed.filter(Boolean);
  } catch (e) {
    console.warn("fetchAllPlaylistsWithSongs() falló:", e);
    return [];
  }
}

// Colaboradores de playlist

export async function fetchPlaylistCollaborators(playlistId) {
  try {
    const resp = await fetch(
      `/playlist/${encodeURIComponent(playlistId)}/collaborators/`,
      {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-Requested-With": "fetch" },
      }
    );
    if (!resp.ok) {
      let extra = null;
      try {
        extra = await resp.json();
      } catch {
        /* ignore */
      }
      console.warn("No se pudo obtener colaboradores", resp.status, extra);
      return [];
    }
    const data = await resp.json().catch(() => ({}));
    return Array.isArray(data.collaborators) ? data.collaborators : [];
  } catch (e) {
    console.error("fetchPlaylistCollaborators error", e);
    return [];
  }
}

export async function addPlaylistCollaborator(
  playlistId,
  username,
  role = "viewer"
) {
  const csrf = _getCookie("csrftoken") || "";
  try {
    const resp = await fetch(
      `/playlist/${encodeURIComponent(playlistId)}/collaborators/add/`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "fetch",
          ...(csrf ? { "X-CSRFToken": csrf } : {}),
        },
        body: JSON.stringify({ username, role }),
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, ...data };
    }
    return data;
  } catch (e) {
    console.error("addPlaylistCollaborator error", e);
    return { ok: false, error: "network" };
  }
}

export async function removePlaylistCollaborator(playlistId, userId) {
  const csrf = _getCookie("csrftoken") || "";
  try {
    const resp = await fetch(
      `/playlist/${encodeURIComponent(
        playlistId
      )}/collaborators/remove/${encodeURIComponent(userId)}/`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "X-Requested-With": "fetch",
          ...(csrf ? { "X-CSRFToken": csrf } : {}),
        },
      }
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, ...data };
    }
    return data;
  } catch (e) {
    console.error("removePlaylistCollaborator error", e);
    return { ok: false, error: "network" };
  }
}

// Modelo base de playlists
export function buildPlaylistsModel({
  allPlaylists,
  mySongs,
  myLikes,
  isArtist = false,
}) {
  const abs = (u) => {
    try {
      return u ? new URL(u, location.origin).href : "";
    } catch {
      return u || "";
    }
  };
  const dedup = (arr, keyFn) => {
    const seen = new Set();
    const out = [];
    for (const it of Array.isArray(arr) ? arr : []) {
      const k = keyFn(it);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    return out;
  };
  const keyer = (s) =>
    _songKey(s) ||
    abs(s.audioUrl) ||
    `${(s.title || "").toLowerCase()}::${(s.author || "").toLowerCase()}`;

  const flattenAll = (Array.isArray(allPlaylists) ? allPlaylists : []).flatMap(
    (pl) => (Array.isArray(pl.songs) ? pl.songs : [])
  );
  const allUnique = dedup(flattenAll, keyer);
  const allPlaylist = {
    id: "pl:all",
    name: "Todas tus canciones",
    songs: allUnique,
  };

  const mineUnique = dedup(mySongs || [], keyer);
  const likesUnique = dedup(myLikes || [], keyer);

  const out = [
    allPlaylist,
    ...(Array.isArray(allPlaylists) ? allPlaylists : []),
  ];

  if (isArtist && mineUnique.length) {
    out.splice(1, 0, {
      id: "pl:mine",
      name: "Mi música",
      songs: mineUnique,
    });
  }

  const after = out.findIndex((p) => p.id === "pl:mine");
  const insertAt = after >= 0 ? after + 1 : 1;
  out.splice(insertAt, 0, {
    id: "pl:likes",
    name: "Music that i love",
    songs: likesUnique,
  });

  return out;
}
