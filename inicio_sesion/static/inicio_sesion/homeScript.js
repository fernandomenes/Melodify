// static/inicio_sesion/homeScript.js
// ============================================================================
// Melodify – Home SPA
// - Menú lateral y navegación de vistas (home, playlist, reproductor, perfil)
// - Integración con MDFCore y barra de reproducción global
// - Exploración de canciones/artistas y búsqueda básica
// - Toasts globales para likes
// ============================================================================

const __SPA_DISABLED__ = !!window.__DISABLE_HOME_SCRIPT__;

if (__SPA_DISABLED__) {
  document.addEventListener("DOMContentLoaded", () => {
    const mc = document.getElementById("main-content");
    if (mc) mc.classList.remove("menuLateral-collapsed");
  });
} else {
  document.addEventListener("DOMContentLoaded", async () => {
    let RP;
    try {
      const src =
        window.REPRODUCTOR_SRC || "/static/reproductor/reproductor.js?v=1";
      RP = await import(src);
    } catch {
      RP = {
        stopReproductorIfLoaded: async () => {},
        renderMenuReproductor: async () => {},
        wireReproductorPlaylistEvents: () => {},
      };
    }

    const $ = (s, r = document) => r.querySelector(s);

    const menuLateral = $("#menuLateral");
    const mainContent = $("#main-content");
    const header = $("#header");
    const contentDiv = $("#content");
    const menuToggleBtn = $("#menu-toggle-btn");
    const toggleLogo = $("#toggle-menu");
    const botonBack = $("#back-btn");

    // Toast global para likes en Home
    window.__melodifyShowLikeToast = function (message) {
      let toast = document.getElementById("like-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "like-toast";
        toast.setAttribute("aria-live", "polite");
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(window.__melodifyShowLikeToast._t);
      window.__melodifyShowLikeToast._t = setTimeout(function () {
        toast.classList.remove("show");
      }, 1500);
    };

    // Like en Home (sin cambiar el aspecto del icono)
    window.__melodifyToggleLikeFromHome = function (ev, songId) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {}

      const btn = ev?.currentTarget || ev?.target;
      const id = songId || btn?.dataset?.songId;

      if (!btn || !id) {
        if (
          window.MDFCore &&
          typeof window.MDFCore.toggleLikeFromReproductor === "function"
        ) {
          window.MDFCore.toggleLikeFromReproductor(ev, songId);
        }
        return;
      }

      if (!btn.dataset.iconOriginal) {
        btn.dataset.iconOriginal = (btn.textContent || "").trim() || "♡";
      }

      const prevLiked = btn.dataset.liked === "1";
      const nowLiked = !prevLiked;
      btn.dataset.liked = nowLiked ? "1" : "0";

      if (
        window.MDFCore &&
        typeof window.MDFCore.toggleLikeFromReproductor === "function"
      ) {
        try {
          window.MDFCore.toggleLikeFromReproductor(ev, id);
        } catch (e) {
          console.error("HOME: error en toggleLikeFromReproductor", e);
        }
      }

      // Mantiene el aspecto original del botón en Home
      btn.textContent = btn.dataset.iconOriginal;
      btn.classList.remove("is-liked", "liked", "active");

      if (typeof window.__melodifyShowLikeToast === "function") {
        window.__melodifyShowLikeToast(
          nowLiked ? "Agregado a tus me gusta" : "Quitado de tus me gusta"
        );
      }
    };

    if (!mainContent || !contentDiv) return;

    const searchForm = $("#search-form");
    const searchInput = $("#search-input");
    const searchPanel = $("#search-panel");

    let ROLE_RAW = mainContent.dataset.role || "";
    let ROLE = ROLE_RAW.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

    let USERNAME = (mainContent.dataset.username || "").trim();
    const AVATAR = (mainContent.dataset.avatar || "").trim();
    const DESCRIPTION = (mainContent.dataset.description || "").trim();
    const CREATED_AT = (mainContent.dataset.createdAt || "").trim();

    const URL_MI_MURO = mainContent.dataset.urlMiMuro || "/mi-muro/";
    const URL_MUSICA = mainContent.dataset.urlMusica || "/musica/";
    const URL_GESTION = mainContent.dataset.urlGestion || "/gestion/";
    const URL_HOME = mainContent.dataset.urlHome || "/home/";
    const URL_MI_MUSICA_JSON =
      mainContent.dataset.urlMiMusicaJson || "/mi-musica/json/";
    const URL_ALL_SONGS_JSON =
      mainContent.dataset.urlAllSongsJson || "/api/all-songs/";

    const URL_MURO_PUBLICO_TEMPLATE =
      mainContent.dataset.urlMuroPublicoTemplate ||
      "/artista/ARTISTA_PLACEHOLDER/";

    const URL_MURO_BASE = mainContent.dataset.urlMuroBase || "/muro/";

    const urlParams = new URLSearchParams(location.search);
    const hashView = (location.hash || "").replace(/^#/, "");
    const INITIAL_VIEW = (
      urlParams.get("view") ||
      hashView ||
      mainContent.dataset.initialView ||
      "home"
    ).trim();

    if (!ROLE) {
      const h1 =
        document.querySelector(".page h1")?.textContent?.toLowerCase() || "";
      if (h1.includes("gestion") || h1.includes("gestión")) {
        ROLE = "administrador";
      }
    }

    let currentView = null;
    let historyStack = [];

    // Playlists iniciales inyectadas en Home (#playlists-data-json)
    let playlists = [];
    try {
      const jsonEl = $("#playlists-data-json");
      playlists = JSON.parse(jsonEl?.textContent || "[]");
    } catch {
      // Sin playlists iniciales
    }

    // Bandera para indicar si el usuario tiene playlists personales reales
    const HOME_HAS_PERSONAL_PLAYLISTS =
      Array.isArray(playlists) && playlists.length > 0;

    // Para artistas sin playlists, se expone una playlist virtual "Mi música"
    //if (ROLE === "artista" && !HOME_HAS_PERSONAL_PLAYLISTS) {
      //playlists = [{ id: 1, name: "Mi música", songs: [] }];
   // }

    window._playlists = playlists;
    window.__HOME_HAS_PERSONAL_PLAYLISTS__ = HOME_HAS_PERSONAL_PLAYLISTS;

    function escapeHtml(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function showContent(html) {
      contentDiv.innerHTML = html;
      decorateDangerButtons(contentDiv);
    }

    function pushHistory(html) {
      historyStack.push({ view: currentView, content: html });
    }

    const pickFirst = (...c) =>
      c.find((v) => typeof v === "string" && v.trim().length) || "";

    function normalizeSongHome(song) {
      if (!song) return null;

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

    function dedupByKey(arr, keyFn) {
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

    function collectAllSongsForHome() {
      const basePlaylists =
        Array.isArray(window._playlists) && window._playlists.length
          ? window._playlists
          : playlists;

      const all = [];
      (Array.isArray(basePlaylists) ? basePlaylists : []).forEach((pl) => {
        (Array.isArray(pl.songs) ? pl.songs : []).forEach((raw) => {
          const s = normalizeSongHome(raw);
          if (s) all.push(s);
        });
      });

      return dedupByKey(
        all,
        (s) => (s.id != null ? `id:${s.id}` : "") || s.audioUrl || ""
      );
    }

    function homeIsSongLiked(id) {
      const idStr = String(id ?? "");
      if (!idStr) return false;
      const likes = Array.isArray(window._likes) ? window._likes : [];
      return likes.some((s) => s && s.id != null && String(s.id) === idStr);
    }

    function buildHomeSongRow(song) {
      const idStr = song.id != null ? String(song.id) : "";
      const title = escapeHtml(song.title || "—");
      const author = escapeHtml(song.author || "—");
      const cover = escapeHtml(song.coverUrl || "");
      const audio = escapeHtml(song.audioUrl || "");
      const liked = idStr && homeIsSongLiked(idStr);

      const coverHTML = cover
        ? `<img src="${cover}" alt="${title}" class="song-cover">`
        : `<div class="song-cover song-cover--placeholder"></div>`;

      let likeHTML = "";
      let addHTML = "";

      if (idStr) {
        likeHTML = `
    <button type="button"
            class="song-like-btn"
            data-like-scope="home"
            data-song-id="${idStr}"
            data-liked="${liked ? "1" : "0"}"
            aria-label="${
              liked
                ? "Quitar de tus me gusta"
                : "Agregar a tus me gusta"
            }"
            onclick="window.__melodifyToggleLikeFromHome && window.__melodifyToggleLikeFromHome(event, '${idStr}')">
      ♡
    </button>`;

        addHTML = `
  <button type="button"
          class="song-add-btn"
          data-song-id="${idStr}"
          title="Añadir a playlist"
          onclick="(window.openAddToPlaylistForSong && window.openAddToPlaylistForSong('${idStr}')) || (window.MDFCore && window.MDFCore.openAddToPlaylistDialog && window.MDFCore.openAddToPlaylistDialog(event, '${idStr}'))">
    +
  </button>`;

      }

      return `
        <div class="song-item"
             data-id="${idStr}"
             data-title="${title}"
             data-author="${author}"
             data-audio-url="${audio}"
             data-cover-url="${cover}">
          ${coverHTML}
          <div class="song-info">
            <div class="song-title">
              ${title}
              ${likeHTML}
              ${addHTML}
            </div>
            <div class="song-author">${author}</div>
          </div>
        </div>`;
    }

    function renderHomeSongs(allSongs, expanded) {
      const wrap = document.getElementById("home-songs-wrap");
      if (!wrap) return;

      const subset = expanded ? allSongs : allSongs.slice(0, 5);

      if (!subset.length) {
        wrap.innerHTML =
          '<p style="color:#b3b3b3;font-size:0.95rem;">No hay canciones disponibles todavía.</p>';
        return;
      }
      wrap.innerHTML = subset.map(buildHomeSongRow).join("");
    }

    function extractFeaturedArtistsFromSongs(allSongs, maxCount = 5) {
      const map = new Map();

      for (const s of Array.isArray(allSongs) ? allSongs : []) {
        const name = (s.author || "").trim();
        if (!name) continue;

        const key = name.toLowerCase();
        const existing =
          map.get(key) || {
            name,
            avatar: s.coverUrl || "",
            count: 0,
          };

        existing.count += 1;
        if (!existing.avatar && s.coverUrl) {
          existing.avatar = s.coverUrl;
        }
        map.set(key, existing);
      }

      return Array.from(map.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, maxCount);
    }

    function buildArtistPublicUrl(rawName) {
      const name = (rawName || "").trim();
      if (!name) return "#";
      const encoded = encodeURIComponent(name);
      return (
        URL_MURO_PUBLICO_TEMPLATE.replace("ARTISTA_PLACEHOLDER", encoded) +
        "?no_spa=1"
      );
    }

    function buildArtistCard(artist) {
      const rawName = artist.name || "Artista";
      const name = escapeHtml(rawName);
      const avatar = artist.avatar ? escapeHtml(artist.avatar) : "";
      const initial = name.trim().charAt(0).toUpperCase() || "A";
      const url = buildArtistPublicUrl(rawName);

      const avatarInner = avatar
        ? `<img src="${avatar}" alt="${name}" class="home-artist-avatar-img">`
        : `<div class="home-artist-avatar-initial">${initial}</div>`;

      return `
        <article class="home-artist-card">
          <a class="home-artist-link" href="${url}" data-external="true">
            <div class="home-artist-avatar-wrap">
              ${avatarInner}
            </div>
            <div class="home-artist-name">${name}</div>
          </a>
        </article>`;
    }

    let HOME_SONGS_CACHE = null;

    async function fetchAllSongsForHome() {
      if (Array.isArray(HOME_SONGS_CACHE) && HOME_SONGS_CACHE.length) {
        return HOME_SONGS_CACHE;
      }

      if (URL_ALL_SONGS_JSON) {
        try {
          const res = await fetch(URL_ALL_SONGS_JSON, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { "X-Requested-With": "fetch" },
          });

          if (res.ok) {
            const data = await res.json();

            const raw =
              (Array.isArray(data?.songs) && data.songs) ||
              (Array.isArray(data) ? data : []);

            const songs = raw.map(normalizeSongHome).filter(Boolean);
            const deduped = dedupByKey(
              songs,
              (s) => (s.id != null ? `id:${s.id}` : "") || s.audioUrl || ""
            );

            if (deduped.length) {
              HOME_SONGS_CACHE = deduped;
              return HOME_SONGS_CACHE;
            }
          }
        } catch (e) {
          console.warn("HOME: fallo al pedir URL_ALL_SONGS_JSON", e);
        }
      }

      if (Array.isArray(window._playlists) && window._playlists.length) {
        const fromPlaylists = collectAllSongsForHome();
        if (fromPlaylists.length) {
          HOME_SONGS_CACHE = fromPlaylists;
          return HOME_SONGS_CACHE;
        }
      }

      try {
        const res = await fetch("/playlist/getAllList", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { "X-Requested-With": "fetch" },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const lists = await res.json();
        const songs = [];

        if (Array.isArray(lists)) {
          for (const pl of lists) {
            if (!pl || pl.id == null) continue;

            try {
              const r = await fetch(
                `/playlist/${encodeURIComponent(pl.id)}/songs/`,
                {
                  credentials: "same-origin",
                  cache: "no-store",
                  headers: { "X-Requested-With": "fetch" },
                }
              );
              if (!r.ok) continue;

              const data = await r.json();
              const raw = Array.isArray(data?.songs) ? data.songs : [];

              for (const s of raw) {
                const n = normalizeSongHome(s);
                if (n) songs.push(n);
              }
            } catch (e) {
              console.warn(
                "HOME: error obteniendo canciones de playlist",
                pl.id,
                e
              );
            }
          }
        }

        const deduped = dedupByKey(
          songs,
          (s) => (s.id != null ? `id:${s.id}` : "") || s.audioUrl || ""
        );

        HOME_SONGS_CACHE = deduped;
        return HOME_SONGS_CACHE;
      } catch (e) {
        console.error("HOME: error en fetchAllSongsForHome", e);
      }

      const local = collectAllSongsForHome();
      HOME_SONGS_CACHE = local;
      return HOME_SONGS_CACHE;
    }

    function renderHomeArtists(allSongs, expanded = false) {
      const grid = document.getElementById("home-artists-grid");
      if (!grid) return;

      const artists = extractFeaturedArtistsFromSongs(
        allSongs,
        expanded ? 9999 : 5
      );

      if (!artists.length) {
        grid.innerHTML =
          '<p style="color:#b3b3b3;font-size:0.95rem;">No hay artistas para mostrar todavía.</p>';
        return;
      }
      grid.innerHTML = artists.map(buildArtistCard).join("");
    }

    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    function initSearch() {
      const sf = $("#search-form");
      const si = $("#search-input");
      const pnl = $("#search-panel");

      if (sf && si) {
        sf.addEventListener("submit", (e) => {
          const query = si.value.trim();
          if (!query) {
            e.preventDefault();
            si.focus();
            return;
          }
        });

        if (pnl) {
          const performSearch = debounce(async (query) => {
            if (query.length < 2) {
              pnl.hidden = true;
              return;
            }
            try {
              pnl.hidden = false;
              pnl.innerHTML = `<div style="padding:10px;color:#888;">Presiona Enter para buscar "${escapeHtml(
                query
              )}"</div>`;
            } catch (err) {
              console.error("Error en búsqueda:", err);
              pnl.hidden = true;
            }
          }, 300);

          si.addEventListener("input", (e) =>
            performSearch(e.target.value.trim())
          );

          document.addEventListener("click", (e) => {
            if (!sf.contains(e.target)) pnl.hidden = true;
          });

          si.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
              pnl.hidden = true;
              si.blur();
            }
          });
        }
      }
    }

    function aplicarMensajePlaylistsHome() {
      const hint = document.getElementById("home-playlist-hint");
      if (!hint) return;

      if (!window.__HOME_HAS_PERSONAL_PLAYLISTS__) {
        hint.style.display = "block";
      } else {
        hint.remove();
      }
    }

    async function renderMenuHome() {
      mainContent.dataset.view = "home";

      const ctaMuro =
        ROLE === "artista"
          ? `<a id="muro-fab" class="fab-muro" href="${URL_MI_MURO}?no_spa=1" data-external="true">
             Muro del artista <span class="sub">creador</span>
           </a>`
          : "";

      const ctaGestion =
        ROLE === "administrador"
          ? `<a id="gestion-fab" class="fab-gestion" href="${URL_GESTION}?no_spa=1" data-external="true">
             Gestión <span class="sub">moderador</span>
           </a>`
          : "";

      const html = `
        ${ctaMuro}
        ${ctaGestion}

        <h2>HOME • Bienvenido a Melodify</h2>
        <p>Selecciona una opción del menú para comenzar.</p>

        <section class="home-featured-artists home-all-songs">
          <div class="home-all-songs-head">
            <h3>Explora artistas</h3>
            <button type="button"
                    class="btnVerTodas btnVerArtistas"
                    data-expanded="false">
              Ver todos
            </button>
          </div>
          <div class="home-artists-grid" id="home-artists-grid"></div>
        </section>

        <section class="home-all-songs">
          <div class="home-all-songs-head">
            <h3>Explora canciones</h3>
            <button type="button"
                    class="btnVerTodas btnVerCanciones"
                    data-expanded="false">
              Ver todos
            </button>
          </div>

          <p id="home-playlist-hint"
             class="home-playlist-hint"
             style="display:none;color:#b3b3b3;font-size:0.85rem;margin:4px 0 8px;">
            No tienes playlists personales disponibles. Crea una primero en la sección de playlists.
          </p>

          <div class="songs-wrap" id="home-songs-wrap"></div>
        </section>

      `;

      pushHistory(html);
      showContent(html);

      try {
        const allSongs = await fetchAllSongsForHome();

        renderHomeArtists(allSongs, false);
        renderHomeSongs(allSongs, false);
        aplicarMensajePlaylistsHome();

        const btnArtists = document.querySelector(".btnVerArtistas");
        if (btnArtists) {
          btnArtists.addEventListener("click", () => {
            const expanded = btnArtists.getAttribute("data-expanded") === "true";
            const next = !expanded;
            btnArtists.setAttribute("data-expanded", String(next));
            btnArtists.textContent = next ? "Ver menos" : "Ver todos";
            renderHomeArtists(allSongs, next);
          });
        }

        const btnSongs = document.querySelector(".btnVerCanciones");
        if (btnSongs) {
          btnSongs.addEventListener("click", () => {
            const expanded = btnSongs.getAttribute("data-expanded") === "true";
            const next = !expanded;
            btnSongs.setAttribute("data-expanded", String(next));
            btnSongs.textContent = next ? "Ver menos" : "Ver todos";
            renderHomeSongs(allSongs, next);
          });
        }
      } catch (e) {
        console.error("HOME: error preparando Home:", e);
      }
    }

    function renderMenuPlaylists() {
      mainContent.dataset.view = "playlist";

      const isArtist = ROLE === "artista";
      const P = Array.isArray(window._playlists) ? window._playlists : [];

      let html = "";

      if (isArtist) {
        html +=
          '<ul class="item-list"><li data-playlist-id="1">Mi música</li></ul>';
      } else if (P.length) {
        html +=
          '<ul class="item-list">' +
          P.map(
            (pl) =>
              `<li data-playlist-id="${pl.id}">${escapeHtml(
                pl.name || "—"
              )}</li>`
          ).join("") +
          "</ul>";
      } else {
        html += '<p style="color:#b3b3b3;">No hay playlists.</p>';
      }

      pushHistory(html);
      showContent(html);
    }

    function renderMenuPerfil() {
      mainContent.dataset.view = "perfil";

      const avatarHTML = AVATAR
        ? `<img src="${escapeHtml(AVATAR)}"
                alt="${escapeHtml(
                  USERNAME
                )}"
                style="width:96px;height:96px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px #2b2b2b;">`
        : `<div style="width:96px;height:96px;border-radius:50%;background:#2a2a2a;display:flex;align-items:center;justify-content:center;font-size:36px;">
             ${escapeHtml((USERNAME || "U").charAt(0).toUpperCase())}
           </div>`;

      const roleLabel = ROLE
        ? ROLE.charAt(0).toUpperCase() + ROLE.slice(1)
        : "—";

      const descHTML =
        ROLE === "artista"
          ? `<p style="margin:6px 0 0;color:#bbb;">Descripción: ${escapeHtml(
              DESCRIPTION || "—"
            )}</p>`
          : "";

      const fechaHTML = `<p style="margin:0 0 4px;">Registrado: ${escapeHtml(
        CREATED_AT || "—"
      )}</p>`;

      const html = `
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;">
          <h2 style="margin:0;">Perfil</h2>
        </div>
        <div style="
            display:flex;
            gap:16px;
            align-items:center;
            background:#1e1e1e;
            border:1px solid #2b2b2b;
            border-radius:12px;
            padding:16px;
            max-width:720px;
        ">
          ${avatarHTML}
          <div>
            <p style="margin:0 0 4px;">Nombre: ${escapeHtml(
              USERNAME || "—"
            )}</p>
            <p style="margin:0 0 4px;">Rol: ${escapeHtml(roleLabel)}</p>
            ${fechaHTML}
            ${descHTML}
          </div>
        </div>
      `;

      pushHistory(html);
      showContent(html);
    }

    function aplicarPermisosMenu() {
      const hideAll = (view) => {
        document
          .querySelectorAll(`#menuLateral .menu-item[data-view="${view}"]`)
          .forEach((el) => {
            el.style.setProperty("display", "none", "important");
            el.setAttribute("hidden", "");
            el.classList.add("vis-hidden");
          });
      };

      const showAll = (view) => {
        document
          .querySelectorAll(`#menuLateral .menu-item[data-view="${view}"]`)
          .forEach((el) => {
            el.style.removeProperty("display");
            el.removeAttribute("hidden");
            el.classList.remove("vis-hidden");
          });
      };

      ROLE = (ROLE || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

      ["home", "playlist", "reproductor", "perfil"].forEach(showAll);

      if (ROLE === "administrador") {
        hideAll("mi-muro");
        showAll("gestion");
      } else if (ROLE === "artista") {
        showAll("mi-muro");
        hideAll("gestion");
      } else {
        hideAll("mi-muro");
        hideAll("gestion");
      }
    }

    function clickMenuToggleBtn() {
      menuLateral?.classList.toggle("collapsed");
      mainContent.classList.toggle("menuLateral-collapsed");
      header?.classList.toggle("menuLateral-collapsed");
      document
        .querySelector("._mdf-player-bar")
        ?.classList.toggle("menuLateral-collapsed");
    }

    menuToggleBtn?.addEventListener("click", clickMenuToggleBtn);
    toggleLogo?.addEventListener("click", clickMenuToggleBtn);

    document.addEventListener(
      "click",
      (e) => {
        const a = e.target.closest?.('a[data-external="true"]');
        if (a) return;
      },
      true
    );

    const userTrigger = $("#user-trigger");
    const userMenu = $("#user-menu");

    if (userTrigger && userMenu) {
      userTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        userMenu.classList.toggle("show");
      });

      document.addEventListener("click", () => userMenu.classList.remove("show"));
      userMenu.addEventListener("click", (e) => e.stopPropagation());

      $("#menu-perfil")?.addEventListener("click", (e) => {
        e.preventDefault();
        userMenu.classList.remove("show");
        activarItemMenu("perfil");
        navegarSPA("perfil");
      });
    }

    document
      .querySelectorAll("#menuLateral .menu-item[data-view]")
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          if (item.tagName === "A") {
            e.preventDefault();
            e.stopPropagation();
          }

          document
            .querySelectorAll("#menuLateral .menu-item[data-view]")
            .forEach((el) => el.classList.remove("active"));

          item.classList.add("active");

          const view = item.getAttribute("data-view") || "";
          navegarSPA(view);
        });
      });

    function activarItemMenu(view) {
      document
        .querySelectorAll("#menuLateral .menu-item[data-view]")
        .forEach((el) => {
          el.classList.toggle("active", el.getAttribute("data-view") === view);
        });
    }

    function clickBackBtn() {
      switch (currentView) {
        case "playlist":
          if (typeof window.clickBackBtnPlaylist === "function") {
            window.clickBackBtnPlaylist();
          } else {
            activarItemMenu("home");
            navegarSPA("home");
          }
          break;

        default:
          activarItemMenu("home");
          navegarSPA("home");
          break;
      }
    }

    botonBack?.addEventListener("click", (e) => {
      e.preventDefault();
      clickBackBtn();
    });

    async function navegarSPA(view) {
      currentView = view;
      mainContent.dataset.view = view || "";
      historyStack = [];

      switch (view) {
        case "home": {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(
            new CustomEvent("melodify:bar:shouldShow")
          );
          await renderMenuHome();
          break;
        }

        case "playlist": {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(
            new CustomEvent("melodify:bar:shouldShow")
          );

          if (typeof window.showPlaylists === "function") {
            window.initPlayList?.(USERNAME);
            window.showPlaylists();
          } else {
            renderMenuPlaylists();
          }
          break;
        }

        case "reproductor": {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(
            new CustomEvent("melodify:bar:shouldShow")
          );

          window.__SKIP_MY_MUSIC_REFRESH__ = true;
          await RP.renderMenuReproductor({
            mainContent,
            contentDiv,
            ROLE,
            URL_MI_MUSICA_JSON,
          });
          break;
        }

        case "perfil": {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(
            new CustomEvent("melodify:bar:shouldShow")
          );
          renderMenuPerfil();
          break;
        }

        case "gestion": {
          try {
            window.MDFCore?.getAudio()?.pause();
          } catch {}
          window.__MDF_FORMS_HIDE_BAR__ = true;
          window.location.href = `${URL_GESTION}?no_spa=1`;
          return;
        }

        case "mi-muro":
        case "mi-musica": {
          try {
            window.MDFCore?.getAudio()?.pause();
          } catch {}
          window.__MDF_FORMS_HIDE_BAR__ = true;
          window.location.href = `${URL_MI_MURO}?no_spa=1`;
          return;
        }

        case "musica": {
          try {
            window.MDFCore?.getAudio()?.pause();
          } catch {}
          window.__MDF_FORMS_HIDE_BAR__ = true;
          window.location.href = `${URL_MUSICA}?no_spa=1`;
          return;
        }

        default: {
          await renderMenuHome();
          break;
        }
      }
    }

    function decorateDangerButtons(root = document) {
      const attrMatches = root.querySelectorAll(
        'button[name*="delete" i], button[id*="delete" i], ' +
          'button[data-action="delete"], button[data-danger],' +
          'input[type="submit"][value*="eliminar" i], ' +
          'input[type="submit"][name*="delete" i],' +
          'a[href*="eliminar" i].button, a[role="button"][data-danger]'
      );

      attrMatches.forEach((el) => {
        el.classList.add("btnDanger", "btnPeligro");
      });

      root
        .querySelectorAll(
          "button, input[type=\"submit\"], a[href], [role=\"button\"]"
        )
        .forEach((el) => {
          if (
            el.classList?.contains("btnDanger") ||
            el.classList?.contains("btnPeligro")
          ) {
            return;
          }

          const txt = (el.value || el.textContent || "")
            .trim()
            .toLowerCase();

          const looksDelete = ["eliminar", "borrar", "suprimir", "remove", "delete"].some(
            (w) => txt.includes(w)
          );

          const hrefDelete = (el.getAttribute?.("href") || "")
            .toLowerCase()
            .includes("eliminar");

          if (looksDelete || hrefDelete) {
            el.classList.add("btnDanger", "btnPeligro");
          }
        });
    }

    function aplicarAvatarHeader() {
      const iconEl = $("#user-trigger .user-icon");
      const nameEl = $("#username");

      if (nameEl) {
        nameEl.textContent = USERNAME || "Usuario";
      }

      if (!iconEl) return;

      if (AVATAR) {
        iconEl.innerHTML = `
          <img src="${escapeHtml(AVATAR)}"
               alt="${escapeHtml(USERNAME || "Usuario")}"
               style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
        `;
      } else {
        iconEl.textContent = (USERNAME || "U")
          .trim()
          .charAt(0)
          .toUpperCase();
      }
    }

    async function inicializarApp() {
      if (!USERNAME) USERNAME = "Usuario";

      aplicarAvatarHeader();
      aplicarPermisosMenu();
      setTimeout(aplicarPermisosMenu, 0);

      initSearch();

      try {
        if (window.MDFCore?.getAudio?.()?.src) {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(
            new CustomEvent("melodify:bar:shouldShow")
          );
        }
      } catch {}

      RP.wireReproductorPlaylistEvents({
        mainContent,
        ROLE,
        URL_MI_MUSICA_JSON,
      });

      const first = INITIAL_VIEW || "home";
      activarItemMenu(first);
      mainContent.dataset.view = first;

      if (first === "home") {
        await renderMenuHome();
      } else if (first === "playlist") {
        if (typeof window.showPlaylists === "function") {
          window.initPlayList?.(USERNAME);
          window.showPlaylists();
        } else {
          renderMenuPlaylists();
        }
      } else if (first === "perfil") {
        renderMenuPerfil();
      } else if (first === "reproductor") {
        await RP.renderMenuReproductor({
          mainContent,
          contentDiv,
          ROLE,
          URL_MI_MUSICA_JSON,
        });
      } else {
        await renderMenuHome();
      }

      const main = $("#main-content");
      if (main) {
        const SPA_VIEWS = new Set(["home", "playlist", "reproductor", "perfil"]);
        main.dataset.view = main.dataset.view || first;

        document
          .querySelectorAll("#menuLateral .menu-item[data-view]")
          .forEach((item) => {
            const view = item.getAttribute("data-view");
            if (!SPA_VIEWS.has(view)) return;
            item.addEventListener("click", () => {
              main.dataset.view = view || "home";
            });
          });
      }
    }

    if (menuLateral) {
      const mo = new MutationObserver(() => aplicarPermisosMenu());
      mo.observe(menuLateral, { childList: true, subtree: true });
    }

    await inicializarApp();
  });
}

window.MDFCore = window.MDFCore || {};
if (!window.MDFCore.openAddToPlaylistDialog) {
  window.MDFCore.openAddToPlaylistDialog = function (_ev, songId) {
    if (typeof window.openAddToPlaylistForSong === 'function') {
      window.openAddToPlaylistForSong(songId);
    }
  };
}
