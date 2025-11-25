// Melodify — Búsqueda global: deep-link, búsqueda, autosuggest y playlists (SIN likes).

document.addEventListener("DOMContentLoaded", function () {
  const searchInput = document.getElementById("search-input");
  const searchForm  = document.getElementById("search-form");

  const main        = document.getElementById("main-content");
  const initialView = main?.dataset?.initialView || "";
  const params      = new URLSearchParams(window.location.search);
  const viewParam   = params.get("view");
  const playlistIdFromURL = params.get("playlist");
  const songFromURL       = params.get("song");

  // ---------------------------------------------------------------------------
  // Deep-link /home/?view=playlist&playlist=<id>
  // ---------------------------------------------------------------------------
  if (initialView === "home" && viewParam === "playlist") {
    setTimeout(() => {
      const mainEl = document.getElementById("main-content");
      if (!mainEl) return;

      const items = document.querySelectorAll("#menuLateral .menu-item");
      items.forEach((it) => it.classList.remove("active"));
      const playlistItem = document.querySelector(
        '#menuLateral .menu-item[data-view="playlist"]'
      );
      if (playlistItem) playlistItem.classList.add("active");

      mainEl.dataset.view = "playlist";

      try {
        const username = mainEl.dataset.username || "";
        if (typeof initPlayList === "function") {
          initPlayList(username);
        }
        if (playlistIdFromURL && typeof verSongs === "function") {
          setTimeout(() => verSongs(playlistIdFromURL), 150);
        }
      } catch (err) {
        console.warn("Error al abrir playlist desde la URL:", err);
      }
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // Deep-link /home/?view=reproductor&song=...
  // ---------------------------------------------------------------------------
  if (initialView === "home" && viewParam === "reproductor") {
    setTimeout(() => {
      const repItem = document.querySelector(
        '#menuLateral .menu-item[data-view="reproductor"]'
      );
      if (repItem) repItem.click();

      if (!songFromURL) return;

      const titleFromURL  = params.get("title")  || "";
      const artistFromURL = params.get("artist") || "";
      const coverFromURL  = params.get("cover")  || "";

      setTimeout(() => {
        if (window.MDFCore && typeof window.MDFCore.playExternalSong === "function") {
          window.MDFCore.playExternalSong(
            songFromURL,
            titleFromURL,
            artistFromURL,
            coverFromURL
          );
        }
      }, 500);
    }, 0);
  }

  // ---------------------------------------------------------------------------
  // Submit de búsqueda (header)
  // ---------------------------------------------------------------------------
  if (searchInput && searchForm) {
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        performSearch();
      }
    });

    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      performSearch();
    });
  }

  function performSearch() {
    const input = document.getElementById("search-input");
    const query = input ? input.value.trim() : "";

    if (query.length > 0) {
      window.location.href = `/buscar/?q=${encodeURIComponent(query)}`;
    } else {
      window.location.href = "/buscar/";
    }
  }

  // ---------------------------------------------------------------------------
  // Autocompletado ligero (panel flotante)
  // ---------------------------------------------------------------------------
  let searchTimeout;
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimeout);
      const query = this.value.trim();

      if (query.length >= 2) {
        searchTimeout = setTimeout(() => {
          fetchSearchResults(query);
        }, 300);
      } else {
        hideSearchPanel();
      }
    });
  }

  function fetchSearchResults(query) {
    fetch(`/api/buscar/?q=${encodeURIComponent(query)}`)
      .then((response) => response.json())
      .then((data) => {
        displaySearchPanel(data);
      })
      .catch((error) => {
        console.error("Error en búsqueda:", error);
        hideSearchPanel();
      });
  }

  function displaySearchPanel(results) {
    const panel = document.getElementById("search-panel");
    if (!panel) return;

    let html = "";

    // -----------------------------------------------------------------------
    // Canciones 
    // -----------------------------------------------------------------------
    if (results.canciones && results.canciones.length > 0) {
      html += '<div class="search-section"><h4>Canciones</h4>';
      results.canciones.forEach((cancion) => {
        const t = String(cancion.title).replace(/'/g, "\\'");
        const a = String(cancion.artist).replace(/'/g, "\\'");
        const u = String(cancion.audioUrl || "").replace(/'/g, "\\'");
        const cover = String(
          cancion.coverUrl ||
            cancion.cover ||
            "/static/inicio_sesion/img_song.png"
        ).replace(/'/g, "\\'");

        html += `
          <div class="search-item search-item-song"
               data-song-id="${cancion.id}"
               data-title="${t}"
               data-artist="${a}"
               data-audio-url="${u}"
               data-cover-url="${cover}">
            <div class="search-item-main"
                 onclick="playSearchResult('${u}', '${t}', '${a}', '${cover}')">
              ${cancion.title} - ${cancion.artist}
            </div>
            <div class="search-item-actions">
              <button
                type="button"
                class="search-btn search-btn-add"
                onclick="openAddToPlaylistFromSearch(event, ${cancion.id})">
                +
              </button>
            </div>
          </div>
        `;
      });
      html += "</div>";
    }

    // -----------------------------------------------------------------------
    // Artistas
    // -----------------------------------------------------------------------
    if (results.artistas && results.artistas.length > 0) {
      html += '<div class="search-section"><h4>Artistas</h4>';
      results.artistas.forEach((artista) => {
        const u = String(artista.username).replace(/'/g, "\\'");
        html += `
          <div class="search-item" onclick="viewArtist('${u}')">
            ${artista.username}
          </div>
        `;
      });
      html += "</div>";
    }

    // -----------------------------------------------------------------------
    // Playlists
    // -----------------------------------------------------------------------
    if (results.playlists && results.playlists.length > 0) {
      html += '<div class="search-section"><h4>Playlists</h4>';
      results.playlists.forEach((playlist) => {
        html += `
          <div class="search-item" onclick="viewPlaylist(${playlist.id})">
            ${playlist.name}
          </div>
        `;
      });
      html += "</div>";
    }

    if (html === "") {
      html = '<div class="search-no-results">No se encontraron resultados</div>';
    }

    panel.innerHTML = html;
    panel.hidden = false;
  }

  // Cerrar panel al hacer clic fuera
  document.addEventListener("click", function (e) {
    const panel  = document.getElementById("search-panel");
    const search = document.getElementById("search");
    if (panel && search && !search.contains(e.target)) panel.hidden = true;
  });
});

// ============================================================================
// Acciones desde el panel de búsqueda
// ============================================================================

function playSearchResult(audioUrl, title, artist, coverUrl = "") {
  hideSearchPanel();

  if (window.MDFCore && typeof window.MDFCore.playSong === "function") {
    window.MDFCore.playSong(audioUrl, title, artist, coverUrl);
    return;
  }

  const main     = document.getElementById("main-content");
  const baseHome = (main && main.dataset && main.dataset.urlHome) || "/home/";

  const url = new URL(baseHome, window.location.origin);
  url.searchParams.set("view", "reproductor");
  url.searchParams.set("song", audioUrl);
  if (title)   url.searchParams.set("title", title);
  if (artist)  url.searchParams.set("artist", artist);
  if (coverUrl) url.searchParams.set("cover", coverUrl);

  window.location.href = url.toString();
}

// ============================================================================
// Lazy loader de scripts de playlists (+ botón desde search)
// ============================================================================

const PLAYLISTS_CANDIDATES = [
  window.PLAYLISTS_SRC,
  "/static/inicio_sesion/playListScript.js",
  "/static/inicio_sesion/playlistScript.js",
].filter(Boolean);

let __plLoadPromise = null;

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const abs = new URL(src, location.origin).toString();
    if ([...document.scripts].some((s) => (s.src || "") === abs)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src.includes("?") ? `${src}&ts=${Date.now()}` : `${src}?ts=${Date.now()}`;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.head.appendChild(s);
  });
}

async function ensurePlaylistAPI() {
  if (typeof window.openAddToPlaylistForSong === "function") return true;
  if (!__plLoadPromise) {
    __plLoadPromise = (async () => {
      for (const src of PLAYLISTS_CANDIDATES) {
        try {
          await loadScriptOnce(src);
          if (typeof window.openAddToPlaylistForSong === "function") return true;
        } catch {}
      }
      return false;
    })();
  }
  return __plLoadPromise;
}

async function openAddToPlaylistFromSearch(evt, songId) {
  if (evt) {
    evt.stopPropagation();
    evt.preventDefault();
  }
  hideSearchPanel();

  const ok = await ensurePlaylistAPI();
  if (ok && typeof window.openAddToPlaylistForSong === "function") {
    window.openAddToPlaylistForSong(songId);
    return;
  }
  alert(
    "No se pudo cargar el módulo de playlists. " +
      "Verifica que exista /static/inicio_sesion/playListScript.js"
  );
}

// ============================================================================
// Navegación auxiliar
// ============================================================================

function viewArtist(username) {
  hideSearchPanel();
  window.location.href = `/artista/${encodeURIComponent(username)}/`;
}

function viewPlaylist(playlistId) {
  hideSearchPanel();

  const main     = document.getElementById("main-content");
  const baseHome = (main && main.dataset && main.dataset.urlHome) || "/home/";

  const url = new URL(baseHome, window.location.origin);
  url.searchParams.set("view", "playlist");
  url.searchParams.set("playlist", String(playlistId));

  window.location.href = url.toString();
}

function hideSearchPanel() {
  const panel = document.getElementById("search-panel");
  if (panel) panel.hidden = true;
}
