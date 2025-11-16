/* ==========================================================================
   Melodify — Búsqueda global
   Módulo de búsqueda: barra superior y panel de resultados dinámicos.
   - Deep-link desde URLs (abrir playlist / reproductor con canción).
   - Búsqueda con Enter (redirección a /buscar/).
   - Autocompletado ligero en panel flotante (#search-panel).
   - Like de canciones desde resultados de búsqueda (sin cambiar icono/estilo).
   - Agregar canción a playlist desde el buscador.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('search-input');
    const searchForm  = document.getElementById('search-form');

    const main        = document.getElementById('main-content');
    const initialView = main?.dataset?.initialView || '';
    const params      = new URLSearchParams(window.location.search);
    const viewParam   = params.get('view');
    const playlistIdFromURL = params.get('playlist');
    const songFromURL       = params.get('song');

    // -----------------------------------------------------------------------
    // Deep-link #1: desde /home/?view=playlist&playlist=<id>
    //   - Cambia la vista inicial a "playlist" dentro de la SPA.
    //   - Si viene playlist=<id>, abre directamente sus canciones.
    // -----------------------------------------------------------------------
    if (initialView === 'home' && viewParam === 'playlist') {
        setTimeout(() => {
            const mainEl = document.getElementById('main-content');
            if (!mainEl) return;

            const items = document.querySelectorAll('#menuLateral .menu-item');
            items.forEach(it => it.classList.remove('active'));
            const playlistItem = document.querySelector('#menuLateral .menu-item[data-view="playlist"]');
            if (playlistItem) playlistItem.classList.add('active');

            mainEl.dataset.view = 'playlist';

            try {
                const username = mainEl.dataset.username || '';

                // Inicializa la sección de playlists en la SPA
                if (typeof initPlayList === 'function') {
                    initPlayList(username);
                }
                // Si hay playlist en la URL, cargar su detalle
                if (playlistIdFromURL && typeof verSongs === 'function') {
                    setTimeout(() => verSongs(playlistIdFromURL), 150);
                }
            } catch (err) {
                console.warn('Error al abrir playlist desde la URL:', err);
            }
        }, 0);
    }

    // -----------------------------------------------------------------------
    // Deep-link #2: desde /home/?view=reproductor&song=<url>&title=...&artist=...
    //   - Activa la vista "reproductor" en el menú lateral (SPA).
    //   - Si viene song=<url>, intenta reproducirla vía MDFCore.playExternalSong.
    // -----------------------------------------------------------------------
    if (initialView === 'home' && viewParam === 'reproductor') {
        setTimeout(() => {
            const repItem = document.querySelector('#menuLateral .menu-item[data-view="reproductor"]');
            if (repItem) repItem.click();

            if (!songFromURL) return;

            const titleFromURL  = params.get('title')  || '';
            const artistFromURL = params.get('artist') || '';
            const coverFromURL  = params.get('cover')  || '';

            setTimeout(() => {
                if (window.MDFCore && typeof window.MDFCore.playExternalSong === 'function') {
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

    // -----------------------------------------------------------------------
    // Envío de búsqueda:
    //   - Enter sobre el input.
    //   - Submit del formulario.
    //   -> Redirige a /buscar/?q=...
    // -----------------------------------------------------------------------
    if (searchInput && searchForm) {
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });

        searchForm.addEventListener('submit', function (e) {
            e.preventDefault();
            performSearch();
        });
    }

    /**
     * Lanza la búsqueda "completa" redirigiendo a /buscar/?q=...
     * (página tradicional de resultados).
     */
    function performSearch() {
        const input = document.getElementById('search-input');
        const query = input ? input.value.trim() : '';

        if (query.length > 0) {
            window.location.href = `/buscar/?q=${encodeURIComponent(query)}`;
        } else {
            window.location.href = '/buscar/';
        }
    }

    // -----------------------------------------------------------------------
    // Autocompletado ligero en panel: retraso (debounce) y fetch a /api/buscar
    // -----------------------------------------------------------------------
    let searchTimeout;

    if (searchInput) {
        searchInput.addEventListener('input', function () {
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

    /**
     * Hace una búsqueda rápida vía API para rellenar el panel flotante.
     *
     * @param {string} query - Texto introducido por el usuario.
     */
    function fetchSearchResults(query) {
        fetch(`/api/buscar/?q=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(data => {
                displaySearchPanel(data);
            })
            .catch(error => {
                console.error('Error en búsqueda:', error);
                hideSearchPanel();
            });
    }

    /**
     * Renderiza el panel flotante de resultados (#search-panel).
     *
     * Estructura esperada:
     *  - results.canciones: [{ id, title, artist, audioUrl, coverUrl, is_liked }]
     *  - results.artistas:  [{ username }]
     *  - results.playlists: [{ id, name }]
     *
     * @param {object} results - JSON devuelto por /api/buscar/.
     */
    function displaySearchPanel(results) {
        const panel = document.getElementById('search-panel');
        if (!panel) return;

        let html = '';

        // Likes actuales (para marcar lógica de is_liked, sin cambiar iconos)
        const likesArr = Array.isArray(window._likes) ? window._likes : [];
        const likeIds = new Set(likesArr.map(s => String(s.id || '')));

        // -------------------- Canciones --------------------
        if (results.canciones && results.canciones.length > 0) {
            html += '<div class="search-section"><h4>Canciones</h4>';
            results.canciones.forEach(cancion => {
                const t = String(cancion.title).replace(/'/g, "\\'");
                const a = String(cancion.artist).replace(/'/g, "\\'");
                const u = String(cancion.audioUrl || '').replace(/'/g, "\\'");
                const cover = String(
                    cancion.coverUrl ||
                    cancion.cover ||
                    '/static/inicio_sesion/img_song.png'
                ).replace(/'/g, "\\'");
                const liked = !!cancion.is_liked || likeIds.has(String(cancion.id));

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
                          class="search-btn search-btn-like song-like-btn"
                          data-song-id="${cancion.id}"
                          data-liked="${liked ? '1' : '0'}"
                          onclick="toggleSongLikeFromSearch(event, '${cancion.id}', this)">
                          ♡
                        </button>
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
            html += '</div>';
        }

        // -------------------- Artistas --------------------
        if (results.artistas && results.artistas.length > 0) {
            html += '<div class="search-section"><h4>Artistas</h4>';
            results.artistas.forEach(artista => {
                const u = String(artista.username).replace(/'/g, "\\'");
                html += `
                    <div class="search-item" onclick="viewArtist('${u}')">
                        ${artista.username}
                    </div>
                `;
            });
            html += '</div>';
        }

        // -------------------- Playlists --------------------
        if (results.playlists && results.playlists.length > 0) {
            html += '<div class="search-section"><h4>Playlists</h4>';
            results.playlists.forEach(playlist => {
                html += `
                    <div class="search-item" onclick="viewPlaylist(${playlist.id})">
                        ${playlist.name}
                    </div>
                `;
            });
            html += '</div>';
        }

        if (html === '') {
            html = '<div class="search-no-results">No se encontraron resultados</div>';
        }

        panel.innerHTML = html;
        panel.hidden = false;
    }

    // Cierra el panel si se hace click fuera del contenedor #search
    document.addEventListener('click', function (e) {
        const panel  = document.getElementById('search-panel');
        const search = document.getElementById('search');

        if (panel && search && !search.contains(e.target)) {
            panel.hidden = true;
        }
    });
});

/**
 * Reproduce una canción desde los resultados de búsqueda.
 *
 * 1) Si existe MDFCore.playSong, delega en el reproductor global.
 * 2) Si no, construye una URL hacia /home/?view=reproductor&song=...
 *
 * @param {string} audioUrl - URL del archivo de audio.
 * @param {string} title    - Título de la canción.
 * @param {string} artist   - Artista.
 * @param {string} coverUrl - Portada (opcional).
 */
function playSearchResult(audioUrl, title, artist, coverUrl = '') {
    hideSearchPanel();

    if (window.MDFCore && typeof window.MDFCore.playSong === 'function') {
        window.MDFCore.playSong(audioUrl, title, artist, coverUrl);
        return;
    }

    const main     = document.getElementById('main-content');
    const baseHome = (main && main.dataset && main.dataset.urlHome) || '/home/';

    const url = new URL(baseHome, window.location.origin);
    url.searchParams.set('view', 'reproductor');
    url.searchParams.set('song', audioUrl);
    if (title)  url.searchParams.set('title', title);
    if (artist) url.searchParams.set('artist', artist);
    if (coverUrl) url.searchParams.set('cover', coverUrl);

    window.location.href = url.toString();
}

/**
 * Da / quita like a una canción desde el panel de búsqueda.
 *
 * 🔒 IMPORTANTE: por acuerdo de diseño en HOME/search:
 *   - No se cambia el icono del botón (ni color, ni relleno).
 *   - Solo se actualiza el estado lógico (data-liked) + toast + MDFCore.
 *
 * @param {Event}         evt    - Evento click.
 * @param {number|string} songId - ID de la canción.
 * @param {HTMLElement}   btn    - Botón pulsado (opcional, se recalcula si falta).
 */
function toggleSongLikeFromSearch(evt, songId, btn) {
    if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
    }

    if (!btn && evt && evt.target) {
        btn = evt.target.closest('.search-btn-like, .song-like-btn');
    }

    const id = String(
        songId ||
        (btn && (btn.dataset.songId || btn.getAttribute('data-song-id'))) ||
        ''
    ).trim();

    if (!id) return;

    const csrftoken = getCookie('csrftoken') || '';

    fetch(`/api/like/song/${encodeURIComponent(id)}/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin'
    })
    .then(res => res.json())
    .then(data => {
        const liked = !!data.liked;

        // Sincronizamos estado lógico en TODOS los botones de esa canción,
        // pero sin cambiar icono ni colores.
        const allButtons = document.querySelectorAll(
            `.search-btn-like[data-song-id="${id}"], ` +
            `.song-like-btn[data-song-id="${id}"]`
        );

        allButtons.forEach(b => {
            b.dataset.liked = liked ? '1' : '0';

            // Guardar icono original solo la primera vez
            const originalIcon =
                b.dataset.iconOriginal ||
                (b.textContent || '').trim() ||
                '♡';

            b.dataset.iconOriginal = originalIcon;

            // 🔒 UI: NO cambiamos el icono ni dejamos estilos de "seleccionado"
            b.textContent = originalIcon;
            b.classList.remove('is-liked', 'active');
        });

        // Sincronizar con el reproductor si existe
        if (window.MDFCore && typeof window.MDFCore.syncLikeModelFromClient === 'function') {
            let meta = null;
            const row = btn && btn.closest ? btn.closest('.search-item-song') : null;
            if (row) {
                meta = {
                    id,
                    title:    row.dataset.title     || '',
                    artist:   row.dataset.artist    || row.dataset.author || '',
                    audioUrl: row.dataset.audioUrl  || '',
                    coverUrl: row.dataset.coverUrl  || '',
                    genre:    row.dataset.genre     || ''
                };
            }
            try {
                window.MDFCore.syncLikeModelFromClient(id, liked, meta);
            } catch (err) {
                console.warn('No se pudo sincronizar likes con MDFCore (search):', err);
            }
        }

        showLikeToast(liked ? 'Añadido a tus Me gusta' : 'Quitado de tus Me gusta');
    })
    .catch(err => {
        console.error('Error al dar like a la canción desde search:', err);
    });
}

/**
 * Muestra un toast de "Me gusta" reutilizando el helper global de Home
 * si existe, o creando/actualizando el #like-toast como fallback.
 *
 * @param {string} message - Texto a mostrar en el toast.
 */
function showLikeToast(message) {
    if (window.__melodifyShowLikeToast && typeof window.__melodifyShowLikeToast === 'function') {
        window.__melodifyShowLikeToast(message);
        return;
    }

    var toast = document.getElementById('like-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'like-toast';
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(showLikeToast._t);
    showLikeToast._t = setTimeout(function () {
        toast.classList.remove('show');
    }, 1500);
}

/**
 * Entry-point para "Agregar a playlist" desde el panel de búsqueda.
 *
 *  - Cierra el panel de búsqueda.
 *  - Si existe window.openAddToPlaylistForSong, delega en ese popup.
 *
 * @param {Event}         evt    - Evento click.
 * @param {number|string} songId - ID de la canción.
 */
function openAddToPlaylistFromSearch(evt, songId) {
    if (evt) evt.stopPropagation();

    hideSearchPanel();

    if (typeof window.openAddToPlaylistForSong === 'function') {
        window.openAddToPlaylistForSong(songId);
        return;
    }

    alert('No se encontró la función para agregar a playlist.');
}

/**
 * Navega a la página pública de un artista.
 *
 * @param {string} username - Nombre de usuario del artista.
 */
function viewArtist(username) {
    hideSearchPanel();
    window.location.href = `/artista/${encodeURIComponent(username)}/`;
}

/**
 * Abre HOME en la vista de playlists y selecciona una playlist concreta.
 *
 * Redirige a /home/?view=playlist&playlist=<id>
 *
 * @param {number|string} playlistId - ID de la playlist.
 */
function viewPlaylist(playlistId) {
    hideSearchPanel();

    const main     = document.getElementById('main-content');
    const baseHome = (main && main.dataset && main.dataset.urlHome) || '/home/';

    const url = new URL(baseHome, window.location.origin);
    url.searchParams.set('view', 'playlist');
    url.searchParams.set('playlist', String(playlistId));

    window.location.href = url.toString();
}

/**
 * Oculta el panel flotante de resultados de búsqueda.
 */
function hideSearchPanel() {
    const panel = document.getElementById('search-panel');
    if (panel) {
        panel.hidden = true;
    }
}

/**
 * Obtiene el valor de una cookie por nombre.
 *
 * (Versión local a este módulo, reutilizada para likes en búsqueda).
 *
 * @param {string} name - Nombre de la cookie.
 * @returns {string|null} Valor de la cookie o null si no existe.
 */
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            cookie = cookie.trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}
