// static/reproductor/reproductor.js
/* ==========================================================================
   Módulo: Reproductor central (UI + control de audio)
   --------------------------------------------------------------------------
   Responsabilidades:
   - Gestionar una cola de reproducción derivada del DOM (.song-item / data-audio-url).
   - Controlar reproducción HTMLAudioElement (play/pause/prev/next/seek/volumen).
   - Renderizar y sincronizar la barra fija del reproductor con el layout.
   - Proveer utilidades de render para la vista “Reproductor” (paneles y filtros).
   - Permanecer activo entre vistas SPA sin interrumpir audio por navegación.

   Convenciones de datos (nodos/atributos):
   - Cada elemento clicable de canción debe exponer:
       data-audio-url  (URL absoluta/relativa del audio)
       data-title      (título)   [opcional: si no existe se toma de .song-title]
       data-author     (autor)    [opcional: si no existe se toma de .song-author]
       .song-cover[src] (portada) [opcional]
   - El contenedor principal expone data-view para el enrutamiento SPA.
   - La barra del reproductor se inserta como ._mdf-player-bar al <body>.

   API exportada:
   - DEFAULT_GENRES
   - renderLeftSongs(songs, titleForEmpty)
   - buildRightSidebarHTML({ playlists, genres })
   - attachSidebarHandlers()
   - inicializarReproductor()
   - stopReproductor()
   - rebindReproductor()
   - renderMenuReproductor({ mainContent, contentDiv, ROLE, URL_MI_MUSICA_JSON })
   - wireReproductorPlaylistEvents({ mainContent, ROLE, URL_MI_MUSICA_JSON })
   - stopReproductorIfLoaded()

   Notas:
   - Este módulo no depende de frameworks.
   - Evita logs verbosos; se prioriza comportamiento silencioso de producción.
   ========================================================================== */

let _state = {
  queue: [],               // Cola actual derivada del DOM
  index: -1,               // Índice de la pista activa en la cola
  audio: null,             // Instancia HTMLAudioElement utilizada por el player
  bar: null,               // Nodo raíz de la barra del reproductor
  els: {},                 // Referencias a sub-nodos de la barra
  boundItems: new Set(),   // Ítems (DOM) con listeners de click vinculados
  guardHooked: false,      // Bandera: guardia de vista enganchada
  moView: null,            // MutationObserver para data-view
  moLayout: null,          // MutationObserver para clases de layout (colapso menú)
  moList: null,            // MutationObserver para cambios en la lista de canciones
  exclusiveHooked: false,  // Bandera: hook global para exclusividad de audio
};

const icons = { prev: "⏮", next: "⏭", play: "▶", pause: "⏸" };

const q  = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Normaliza una cadena a slug simple (minúsculas, sin acentos, sin espacios). */
function slugify(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'')
    .trim();
}

/** Garantiza URL absoluta o relativa desde raíz (/). */
function ensureAbs(u) {
  if (!u) return "";
  const s = String(u).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;
  return "/" + s.replace(/^\/+/, "");
}

/** Devuelve href absoluto seguro (o cadena vacía si no es válido). */
function absHref(u) {
  if (!u) return "";
  try { return new URL(u, window.location.origin).href; }
  catch { return ""; }
}

/** Formatea segundos a mm:ss. */
function fmtTime(t) {
  if (!Number.isFinite(t)) return "0:00";
  t = Math.max(0, Math.floor(t));
  const m = Math.floor(t / 60), s = String(t % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/** Escapa HTML en línea. */
function _esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ========================================================================== */
/* Vistas habilitadas para mantener el reproductor activo                     */
/* ========================================================================== */

const PLAYABLE_VIEWS = new Set([
  "reproductor", "playlist", "musica", "genero", "generos", "home",
]);

/** Obtiene la vista SPA actual desde #main-content. */
function getCurrentView() {
  const main = document.getElementById("main-content");
  return (main?.dataset.view || main?.dataset.initialView || "").trim();
}

/** Indica si la vista actual admite control de player visible/activo. */
function isPlayableView() { return PLAYABLE_VIEWS.has(getCurrentView()); }

/* ========================================================================== */
/* Barra del reproductor                                                       */
/* ========================================================================== */

/** Sincroniza offset de la barra con el estado del menú lateral. */
function syncBarWithSidebar() {
  const main = document.getElementById("main-content");
  if (!_state.bar || !main) return;
  const collapsed = main.classList.contains("menuLateral-collapsed");
  _state.bar.classList.toggle("menuLateral-collapsed", collapsed);
}

/** Crea (si no existe) y configura la barra del reproductor. */
function ensureBar() {
  let bar = q("._mdf-player-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "_mdf-player-bar";
    bar.innerHTML = `
      <div class="_mdf-now">
        <img class="_mdf-cover" alt="" style="visibility:hidden">
        <div class="_mdf-meta">
          <div class="_mdf-player-title"></div>
          <div class="_mdf-player-artist"></div>
        </div>
      </div>
      <div class="_mdf-ctrls">
        <button class="_mdf-btn _mdf-prev"  title="Anterior">${icons.prev}</button>
        <button class="_mdf-btn _mdf-btn--primary _mdf-play" title="Reproducir/Pausar">${icons.play}</button>
        <button class="_mdf-btn _mdf-next"  title="Siguiente">${icons.next}</button>
      </div>
      <div class="_mdf-right">
        <span class="_mdf-time">0:00 / 0:00</span>
        <input class="_mdf-player-seek" type="range" min="0" max="100" value="0" step="1">
        <input class="_mdf-vol" type="range" min="0" max="1" step=".01" value="1">
      </div>`;
    document.body.appendChild(bar);
  }

  _state.bar = bar;
  _state.els = {
    cover: q("._mdf-cover", bar),
    title: q("._mdf-player-title", bar),
    artist: q("._mdf-player-artist", bar),
    prev: q("._mdf-prev", bar),
    next: q("._mdf-next", bar),
    play: q("._mdf-play", bar),
    time: q("._mdf-time", bar),
    seek: q("._mdf-player-seek", bar),
    vol: q("._mdf-vol", bar),
  };

  syncBarWithSidebar();

  // Observa cambios de layout (colapso/expandir menú)
  const main = document.getElementById("main-content");
  if (main && !_state.moLayout) {
    _state.moLayout = new MutationObserver(syncBarWithSidebar);
    _state.moLayout.observe(main, { attributes: true, attributeFilter: ["class"] });
  }

  // Exclusividad: si otro <audio> embebido reproduce, este player pausa
  if (!_state.exclusiveHooked) {
    document.addEventListener("play", (ev) => {
      const t = ev.target;
      if (t && t.tagName === "AUDIO") {
        try { if (_state.audio && !_state.audio.paused) _state.audio.pause(); } catch {}
      }
    }, true);
    _state.exclusiveHooked = true;
  }

  // Inicializa HTMLAudioElement y suscripción a eventos
  if (!_state.audio) {
    _state.audio = new Audio();
    _state.audio.preload = "metadata";

    _state.audio.addEventListener("timeupdate", () => {
      const a = _state.audio;
      const dur = Number.isFinite(a.duration) ? a.duration : 0;
      const cur = Number.isFinite(a.currentTime) ? a.currentTime : 0;
      _state.els.time.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
      _state.els.seek.value = dur ? String(Math.round((cur / dur) * 100)) : "0";
    });
    _state.audio.addEventListener("ended", next);
    _state.audio.addEventListener("play", updatePlayIcon);
    _state.audio.addEventListener("pause", updatePlayIcon);

    // Pausa audios embebidos del documento si el player central reproduce
    _state.audio.addEventListener("play", () => {
      document.querySelectorAll("audio").forEach((a) => { try { a.pause(); } catch {} });
    });

    _state.audio.addEventListener("loadedmetadata", () => {
      const a = _state.audio;
      const dur = Number.isFinite(a.duration) ? a.duration : 0;
      _state.els.time.textContent = `${fmtTime(0)} / ${fmtTime(dur)}`;
      _state.els.seek.value = "0";
    });

    _state.audio.volume = 1;
  }

  // Controles
  _state.els.play.onclick = toggle;
  _state.els.prev.onclick = prev;
  _state.els.next.onclick = next;

  // Seek y volumen
  _state.els.seek.oninput = (e) => {
    const a = _state.audio;
    if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
    const pct = Number(e.target.value || 0) / 100;
    a.currentTime = Math.max(0, Math.min(a.duration * pct, a.duration - 0.25));
  };
  _state.els.vol.oninput = (e) => {
    const v = Math.max(0, Math.min(1, Number(e.target.value)));
    _state.audio.volume = Number.isFinite(v) ? v : 1;
  };
}

/** Muestra la barra. */
function showBar() { if (_state.bar) _state.bar.classList.add("is-visible"); }
/** Oculta la barra. */
function hideBar() { if (_state.bar) _state.bar.classList.remove("is-visible"); }
/** Pausa el audio. */
function stopAudio() { if (_state.audio) _state.audio.pause(); }

/** Rellena metadatos visuales del player (título, artista, portada). */
function setMeta(song) {
  _state.els.title.textContent = song.title || "—";
  _state.els.artist.textContent = song.author || song.artist_display_name || "—";
  const u = ensureAbs(song.coverUrl || song.cover_url || song.cover || "");
  if (u) {
    _state.els.cover.style.visibility = "visible";
    _state.els.cover.src = u;
    _state.els.cover.onerror = () => { _state.els.cover.style.visibility = "hidden"; };
  } else {
    _state.els.cover.removeAttribute("src");
    _state.els.cover.style.visibility = "hidden";
  }
}

/** Actualiza el ícono de play/pause según el estado del audio. */
function updatePlayIcon() {
  if (!_state.els.play) return;
  const playing = _state.audio && !_state.audio.paused;
  _state.els.play.textContent = playing ? icons.pause : icons.play;
}

/** Elimina resalte de fila activa. */
function clearRowHighlight() {
  qa(".song-item.is-playing").forEach((el) => el.classList.remove("is-playing"));
}

/** Resalta fila correspondiente al índice actual. */
function highlightCurrent() {
  clearRowHighlight();
  const node = q(`.song-item[data-_idx="${_state.index}"]`);
  if (node) node.classList.add("is-playing");
}

/**
 * Carga una pista por índice en la cola y reproduce opcionalmente.
 * @param {number} idx - Índice de la pista en _state.queue.
 * @param {boolean} autoplay - Si true, reproduce tras cargar.
 */
function load(idx, autoplay = true) {
  idx = Number(idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= _state.queue.length) return;
  _state.index = idx;

  const s = _state.queue[idx];
  const url = ensureAbs(s.audioUrl || s.audio_url || s.audio || "");
  if (!url) return;

  setMeta(s);
  _state.audio.src = url;
  _state.audio.currentTime = 0;
  highlightCurrent();

  if (autoplay) _state.audio.play().catch(() => {});
  updatePlayIcon();
  showBar();
}

/** Alterna reproducción. */
function toggle() {
  if (!_state.audio || !_state.audio.src) return;
  if (_state.audio.paused) _state.audio.play().catch(() => {});
  else _state.audio.pause();
}

/** Reproduce pista anterior (con wrap). */
function prev() {
  if (_state.queue.length === 0) return;
  const i = _state.index > 0 ? _state.index - 1 : _state.queue.length - 1;
  load(i, true);
}

/** Reproduce pista siguiente (con wrap). */
function next() {
  if (_state.queue.length === 0) return;
  const i = (_state.index + 1) % _state.queue.length;
  load(i, true);
}

/**
 * Reconstruye la cola de reproducción a partir del DOM.
 * - Soporta nodos con clase .song-item y/o atributo data-audio-url.
 * - Mantiene índice si la pista actual sigue presente.
 */
function collectQueueFromDOM() {
  const items = qa(".song-item, [data-audio-url]");
  const curHref = absHref(_state.audio?.src || "");

  const nextQueue = [];
  let k = 0;
  items.forEach((el) => {
    const title   = el.dataset.title  || el.querySelector(".song-title")?.textContent || "—";
    const author  = el.dataset.author || el.querySelector(".song-author")?.textContent || "—";
    const coverUrl = ensureAbs(el.dataset.coverUrl || el.querySelector(".song-cover")?.getAttribute("src") || "");
    const audioUrl = ensureAbs(el.dataset.audioUrl || "");
    if (audioUrl) {
      nextQueue.push({ title, author, coverUrl, audioUrl });
      el.dataset._idx = String(k++);
      if (!el.classList.contains("song-item")) el.classList.add("song-item");
    } else {
      el.removeAttribute("data-_idx");
    }
  });

  _state.queue = nextQueue;
  const want = curHref
    ? _state.queue.findIndex((s) => absHref(ensureAbs(s.audioUrl)) === curHref)
    : -1;
  _state.index = want;
}

/**
 * Vincula/Desvincula clicks sobre .song-item para controlar reproducción.
 * @param {boolean} enable - true para vincular, false para quitar.
 */
function bindClicks(enable) {
  _state.boundItems.forEach((el) => (el.onclick = null));
  _state.boundItems.clear();

  if (!enable) return;

  qa(".song-item").forEach((el) => {
    el.onclick = () => {
      const idx = Number(el.dataset._idx ?? -1);
      if (idx < 0) return;

      const wants = _state.queue[idx];
      const nextH = absHref(ensureAbs(wants?.audioUrl || ""));
      const curH  = absHref(_state.audio?.src || "");

      if (idx === _state.index && nextH && curH && nextH === curH) {
        toggle();
      } else {
        load(idx, true);
      }
    };
    _state.boundItems.add(el);
  });
}

/** Observa cambios en el contenedor de listas para rearmar la cola. */
function observeListChanges() {
  const host = document.getElementById("content") || document.body;
  if (_state.moList) {
    _state.moList.disconnect();
    _state.moList = null;
  }
  _state.moList = new MutationObserver((mutations) => {
    let touched = false;
    for (const m of mutations) {
      if (
        m.type === "childList" ||
        (m.type === "attributes" && m.target instanceof HTMLElement && m.target.hasAttribute("data-audio-url"))
      ) { touched = true; break; }
    }
    if (touched) {
      collectQueueFromDOM();
      bindClicks(isPlayableView());
      if (_state.audio?.src) showBar();
    }
  });
  _state.moList.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-audio-url"] });
}

/**
 * Guardia de vista SPA:
 * - En vistas reproducibles, reengancha cola y controles sin pausar audio.
 * - En otras vistas, mantiene la barra si existe src; oculta si no hay.
 */
function hookViewGuard() {
  if (_state.guardHooked) return;
  _state.guardHooked = true;

  const main = document.getElementById("main-content");
  if (!main) return;

  const apply = () => {
    const playable = isPlayableView();
    if (playable) {
      collectQueueFromDOM();
      bindClicks(true);
      if (_state.audio?.src) showBar();
      observeListChanges();
    } else {
      bindClicks(false);
      if (!_state.audio?.src) {
        hideBar();
        clearRowHighlight();
      }
      observeListChanges();
    }
  };

  apply();
  if (_state.moView) _state.moView.disconnect();
  _state.moView = new MutationObserver(apply);
  _state.moView.observe(main, { attributes: true, attributeFilter: ["data-view"] });
}

/* ========================================================================== */
/* API de render y utilidades para la vista Reproductor                       */
/* ========================================================================== */

/** Catálogo por defecto de géneros. */
export const DEFAULT_GENRES = [
  { value:'pop',         label:'Pop' },
  { value:'rock',        label:'Rock' },
  { value:'electronica', label:'Electrónica' },
  { value:'salsa',       label:'Salsa' },
  { value:'indie',       label:'Indie' },
  { value:'hiphop',      label:'Hip-Hop' },
  { value:'reggaeton',   label:'Reggaetón' },
  { value:'regional',    label:'Regional Mexicano' },
  { value:'balada',      label:'Balada' },
  { value:'jazz',        label:'Jazz' },
  { value:'clasica',     label:'Clásica' },
  { value:'otro',        label:'Otro' },
];

/** Genera el HTML de una fila de canción para el panel izquierdo. */
function _playlistSongRow(song) {
  const isString = (typeof song === 'string');
  const title  = isString ? song : (song?.title || '—');
  const author = isString ? '—'   : (song?.author || song?.artist_display_name || song?.artist || '—');
  const cover  = isString ? null  : ensureAbs(song?.coverUrl || song?.cover_url || song?.cover || '');
  const audio  = isString ? ''    : ensureAbs(song?.audioUrl || song?.audio_url || song?.audio || '');

  const coverHTML = cover
    ? `<img src="${_esc(cover)}" alt="${_esc(title)}" class="song-cover">`
    : `<div class="song-cover song-cover--placeholder"></div>`;

  return `
    <div class="song-item"
         data-audio-url="${_esc(audio)}"
         data-title="${_esc(title)}"
         data-author="${_esc(author)}">
      ${coverHTML}
      <div class="song-info">
        <div class="song-title">${_esc(title)}</div>
        <div class="song-author">${_esc(author)}</div>
      </div>
    </div>
  `;
}

/**
 * Renderiza el panel izquierdo con una lista de canciones.
 * @param {Array<Object|string>} songs - Arreglo de canciones o títulos.
 * @param {string} titleForEmpty - Etiqueta a mostrar cuando no hay elementos.
 */
export function renderLeftSongs(songs, titleForEmpty = 'Mi música') {
  const left = q('.rep-left');
  if (!left) return;
  if (!songs || !songs.length) {
    left.innerHTML = `
      <div class="rep-empty">
        <div><h3 style="margin:0">${_esc(titleForEmpty)}</h3><p>No hay canciones.</p></div>
      </div>`;
  } else {
    left.innerHTML = `<div class="songs-wrap">${songs.map(_playlistSongRow).join('')}</div>`;
  }
  try { inicializarReproductor(); } catch {}
}

/**
 * Construye el HTML del panel derecho (playlists + chips de géneros).
 * @param {Object} params
 * @param {Array}  params.playlists - Colección de playlists [{id, name, songs}].
 * @param {Array}  params.genres    - Catálogo de géneros {value,label}.
 * @returns {string} HTML concatenado de ambos paneles.
 */
export function buildRightSidebarHTML({ playlists, genres = DEFAULT_GENRES }) {
  const P  = Array.isArray(playlists) ? playlists : [];
  const pl = P[0] || { id: 1, name: 'Mi música', songs: [] };
  const songs = Array.isArray(pl.songs) ? pl.songs : [];
  const playlistsHTML = `
    <div class="rep-panel">
      <div class="rep-head"><h3 style="margin:0">Playlists</h3></div>
      <ul id="rep-playlists" class="rep-list" style="list-style:none;margin:0;padding:0">
        <li data-pl="${_esc(pl.id)}" style="display:flex;align-items:center;gap:10px;background:#181818;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer">
          <span style="flex:1">${_esc(pl.name || 'Mi música')}</span>
          <span class="rep-badge">${songs.length}</span>
        </li>
      </ul>
    </div>`;

  const chipsHTML = genres.map(g => `<span class="rep-chip" data-genre="${_esc(g.value)}">${_esc(g.label)}</span>`).join('');

  const genresHTML = `
    <div class="rep-panel">
      <div class="rep-head"><h3 style="margin:0">Géneros</h3></div>
      <div id="rep-genres">${chipsHTML}</div>
    </div>`;

  return playlistsHTML + '\n' + genresHTML;
}

/** Registra manejadores del panel derecho (exclusividad playlists ↔ géneros). */
export function attachSidebarHandlers() {
  const clearGenres = () => {
    const wrap = document.getElementById('rep-genres');
    if (!wrap) return;
    wrap.querySelectorAll('.rep-chip.active,[aria-selected="true"],[aria-pressed="true"]')
      .forEach(x => {
        x.classList.remove('active');
        x.removeAttribute('aria-selected');
        x.removeAttribute('aria-pressed');
      });
  };
  const clearPlaylists = () => {
    const ul = document.getElementById('rep-playlists');
    if (!ul) return;
    ul.querySelectorAll('li.active').forEach(x => x.classList.remove('active'));
  };

  // Playlists
  const ul = document.getElementById('rep-playlists');
  if (ul) {
    ul.querySelectorAll('li[data-pl]').forEach(li => {
      li.addEventListener('click', () => {
        clearGenres(); clearPlaylists(); li.classList.add('active');
        const id = li.dataset.pl;
        const pl = (window._playlists || []).find(p => String(p.id) === String(id)) || { name:'—', songs:[] };
        const songs = Array.isArray(pl.songs) ? pl.songs : [];
        renderLeftSongs(songs, pl.name || 'Playlist');
      });
    });
    const first = ul.querySelector('li[data-pl]');
    if (first) { first.classList.add('active'); clearGenres(); }
  }

  // Géneros
  const chipsWrap = document.getElementById('rep-genres');
  if (chipsWrap) {
    const all = Array.from(chipsWrap.querySelectorAll('.rep-chip'));
    all.forEach(ch => {
      ch.addEventListener('click', () => {
        clearPlaylists();
        all.forEach(x => { x.classList.remove('active'); x.removeAttribute('aria-selected'); x.removeAttribute('aria-pressed'); });
        ch.classList.add('active'); ch.setAttribute('aria-selected','true');

        const g = slugify(ch.dataset.genre || '');
        const allSongs = (window._playlists || []).flatMap(p => Array.isArray(p.songs) ? p.songs : []);
        const filtered = allSongs.filter(s => {
          const sg = slugify(s.genre || s.genero || s.gen || '');
          if (!g || g === 'otro') return true;
          return sg && sg === g;
        });
        renderLeftSongs(filtered, ch.textContent || 'Género');
      });
    });
  }
}

/* ========================================================================== */
/* API núcleo (audio / cola / hooks)                                          */
/* ========================================================================== */

/** Inicializa barra, guardia de vista y bindings según la vista actual. */
export function inicializarReproductor() {
  ensureBar();
  hookViewGuard();

  if (isPlayableView()) {
    collectQueueFromDOM();
    bindClicks(true);
    if (_state.audio?.src) showBar();
    observeListChanges();
  } else {
    bindClicks(false);
    if (!_state.audio?.src) hideBar();
    observeListChanges();
  }
}

/** Detiene y oculta el reproductor (sin destruir estado de sesión). */
export function stopReproductor() {
  bindClicks(false);
  stopAudio();
  hideBar();
  clearRowHighlight();
  if (_state.moList) {
    _state.moList.disconnect();
    _state.moList = null;
  }
}

/** Reengancha click handlers tras re-render de listas. */
export function rebindReproductor() {
  ensureBar();
  collectQueueFromDOM();
  bindClicks(isPlayableView());
  if (_state.audio?.src) showBar();
}

/* ========================================================================== */
/* Integración SPA                                                             */
/* ========================================================================== */

/**
 * Refresca “Mi música” para artistas, usando el endpoint JSON existente.
 * No altera otros roles.
 */
async function _refreshMyMusic(ROLE, URL_MI_MUSICA_JSON) {
  if (String(ROLE).toLowerCase() !== 'artista') return;
  try {
    const res = await fetch(URL_MI_MUSICA_JSON, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.ok) return;

    const songs = Array.isArray(data.songs) ? data.songs : [];
    window._playlists = [{ id: 1, name: 'Mi música', songs }];
  } catch { /* silencioso */ }
}

/**
 * Renderiza la vista “Reproductor” (layout rep-grid con panel derecho).
 * @param {Object} params
 * @param {HTMLElement} params.mainContent   - Contenedor principal (#main-content).
 * @param {HTMLElement} params.contentDiv    - Contenedor interno (#content).
 * @param {string} params.ROLE               - Rol actual (artista/…).
 * @param {string} params.URL_MI_MUSICA_JSON - Endpoint JSON para “Mi música”.
 */
export async function renderMenuReproductor({ mainContent, contentDiv, ROLE, URL_MI_MUSICA_JSON }) {
  // Asegura ?view=reproductor en la URL sin abandonar /home/
  const u = new URL(location.href);
  u.searchParams.set('view', 'reproductor');
  history.replaceState(null, '', u.toString());
  mainContent.dataset.view = 'reproductor';

  // Carga/actualiza “Mi música” si aplica
  await _refreshMyMusic(ROLE, URL_MI_MUSICA_JSON);

  const P  = Array.isArray(window._playlists) ? window._playlists : [];
  const pl = P[0] || { id: 1, name: 'Mi música', songs: [] };
  const songs = Array.isArray(pl.songs) ? pl.songs : [];

  const rightHTML = buildRightSidebarHTML({ playlists: P, genres: DEFAULT_GENRES || [] }) || '';
  const html = `
    <div class="rep-grid">
      <div class="rep-left"></div>
      <div class="rep-right">${rightHTML}</div>
    </div>`;
  contentDiv.innerHTML = html;

  // Inicializa/engancha y pinta
  inicializarReproductor();
  renderLeftSongs(songs, pl.name || 'Mi música');
  attachSidebarHandlers();
}

/**
 * Observa eventos externos de cambio de playlist (delete/undo) y refresca.
 * Se limita a la vista actual para evitar re-render innecesario.
 */
export function wireReproductorPlaylistEvents({ mainContent, ROLE, URL_MI_MUSICA_JSON }) {
  window.addEventListener('melodify:playlistChanged', async () => {
    if ((mainContent?.dataset.view || '') === 'reproductor') {
      try {
        await renderMenuReproductor({
          mainContent,
          contentDiv: document.getElementById('content'),
          ROLE,
          URL_MI_MUSICA_JSON
        });
      } catch {}
    } else {
      await _refreshMyMusic(ROLE, URL_MI_MUSICA_JSON);
    }
  });
}

/** Detiene el reproductor si ya estaba cargado. */
export async function stopReproductorIfLoaded() {
  try { stopReproductor(); } catch {}
}
