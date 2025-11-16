/* ==========================================================================
   Melodify — Playlists del usuario
   UI de gestión de playlists:
   - Crear, renombrar y eliminar playlists propias.
   - Listar playlists y su contenido (canciones).
   - Dar / quitar like a playlists y canciones.
   - Agregar / quitar canciones de una playlist.
   - Integración con MDFCore (reproductor) y toasts globales.
   ========================================================================== */

/* PlayList UI: listas del usuario (crear, editar, borrar, likes). */

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------

let currentViewPlaylist  = "allPlayList"; // "allPlayList" | "allSongsPlayList"
let content              = null;          // Contenedor principal (#content)
let USERNAME             = null;          // Usuario en sesión


// ===========================================================================
// Inicialización
// ===========================================================================

/**
 * Inicializa la sección de Playlists.
 *
 * Se llama desde la SPA (homeScript) pasando el usuario en sesión. Almacena
 * referencias globales mínimas y dispara el render de la lista de playlists.
 *
 * @param {string} username - Nombre de usuario logueado.
 */
function initPlayList(username) {
    USERNAME = username;
    content  = document.getElementById('content');
    showPlaylists();
}

/**
 * Handler del botón "back" en la vista de Playlists.
 *
 * Si el usuario está viendo el detalle de una playlist (allSongsPlayList),
 * regresa al listado principal de playlists.
 */
function clickBackBtnPlaylist() {
    if (currentViewPlaylist === "allSongsPlayList") {
        showPlaylists();
    }
}


// ===========================================================================
// Helpers generales
// ===========================================================================

/**
 * Obtiene el valor de una cookie por nombre.
 *
 * @param {string} name - Nombre de la cookie.
 * @returns {string|null} Valor decodificado o null si no existe.
 */
function getCookie(name) {
    const v = document.cookie.split('; ').find(row => row.startsWith(name + '='));
    return v ? decodeURIComponent(v.split('=')[1]) : null;
}

/**
 * Muestra un toast al agregar o quitar canciones de una playlist.
 *
 * Prioriza los helpers globales:
 *  - __melodifyShowPlaylistToast (Gestión)
 *  - __melodifyShowToast (genérico)
 * y como último fallback reutiliza #like-toast.
 *
 * @param {boolean} added - true si se agregó, false si se quitó.
 * @param {string}  playlistName - Nombre de la playlist (opcional).
 */
function notifyPlaylistSongChange(added, playlistName) {
    const name = (playlistName || '').trim();

    // Gestión (admin): usa el helper global definido en gestion.js
    if (typeof window.__melodifyShowPlaylistToast === 'function') {
        window.__melodifyShowPlaylistToast(added, name);
        return;
    }

    // Home u otras vistas: si hay un toast genérico
    if (typeof window.__melodifyShowToast === 'function') {
        window.__melodifyShowToast(
            added
                ? (name ? `Añadida a la playlist “${name}”` : 'Añadida a una playlist')
                : (name ? `Quitada de la playlist “${name}”` : 'Quitada de la playlist')
        );
        return;
    }

    // Fallback mínimo: usar #like-toast si existe
    const el = document.getElementById('like-toast');
    if (!el) return;

    el.textContent = added
        ? (name ? `Añadida a la playlist “${name}”` : 'Añadida a una playlist')
        : (name ? `Quitada de la playlist “${name}”` : 'Quitada de la playlist');

    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 1400);
}

/**
 * Variante de toast para el caso en el que la canción ya estaba en la playlist.
 *
 * @param {string} playlistName - Nombre de la playlist, opcional.
 */
function notifyPlaylistSongAlready(playlistName) {
    const name = (playlistName || '').trim();
    const msg = name
        ? `La canción ya está en la playlist “${name}”`
        : 'La canción ya está en esa playlist';

    // Si hay toast genérico
    if (typeof window.__melodifyShowToast === 'function') {
        window.__melodifyShowToast(msg);
        return;
    }

    const el = document.getElementById('like-toast');
    if (!el) return;

    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 1400);
}


// ===========================================================================
// API de playlists: crear, editar, eliminar, like
// ===========================================================================

/**
 * Crea una nueva playlist para el usuario actual.
 *
 * POST /playlist/create/
 *
 * @param {string} namePlaylist - Nombre de la nueva playlist.
 */
function crearPlaylist(namePlaylist) {
    fetch('/playlist/create/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            user: USERNAME,
            name: namePlaylist
        })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => {
                throw new Error(err.error || `HTTP ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        console.log('Playlist creada:', data);
        showPlaylists();
    })
    .catch(error => {
        console.error('Error al crear playlist:', error);
        alert('No se pudo crear la playlist:\n' + error.message);
    });
}

/**
 * Marca o desmarca like en una playlist.
 *
 * POST /api/like/playlist/<id>/
 *
 * @param {number|string} id - ID de la playlist.
 */
async function likePlaylist(id) {
    console.log('Like en playlist:', id);
    const csrf = getCookie('csrftoken');

    const btn = document.getElementById(`like-playlist-btn-${id}`);
    if (btn) btn.disabled = true;

    try {
        const resp = await fetch(`/api/like/playlist/${id}/`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': csrf,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: null
        });

        let data = null;
        try {
            data = await resp.json();
        } catch (err) {
            console.error('Respuesta no JSON:', err);
        }

        if (resp.ok && data) {
            if (btn) {
                btn.textContent = data.liked ? `Liked (${data.total})` : `Like (${data.total})`;
                btn.classList.toggle('liked', !!data.liked);
            }
        } else if (resp.status === 401 || (data && data.error === 'login_required')) {
            window.location.href = '/login/';
        } else {
            console.warn('Error likePlaylist', resp.status, data);
            alert('No se pudo procesar el like. Revisa la consola para más información.');
        }
    } catch (e) {
        console.error('Error likePlaylist:', e);
        alert('Error de red al intentar dar like.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Actualiza el nombre de una playlist existente.
 *
 * PUT /playlist/<id>/update/
 *
 * @param {number|string} id - ID de la playlist.
 * @param {string} newname - Nuevo nombre.
 */
function editarPlaylist(id, newname) {
    console.log('Editar playlist:', id);
    fetch(`/playlist/${id}/update/`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ name: newname })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => {
                throw new Error(err.error || `Error ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        console.log('Playlist actualizada:', data.message);
        showPlaylists();
    })
    .catch(error => {
        console.error('Error al actualizar:', error);
        alert('Error: ' + error.message);
    });
}

/**
 * Elimina completamente una playlist (no sus canciones del catálogo).
 *
 * DELETE /playlist/<id>/delete/
 *
 * @param {number|string} playlistId - ID de la playlist.
 */
function eliminarPlaylist(playlistId) {
    if (!confirm('¿Seguro que deseas eliminar esta playlist?')) {
        return;
    }

    fetch(`/playlist/${playlistId}/delete/`, {
        method: 'DELETE',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        }
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => {
                throw new Error(err.error || `Error ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        console.log('Playlist eliminada:', data.message);
        showPlaylists();
    })
    .catch(error => {
        console.error('Error al eliminar:', error);
        alert('Error: ' + error.message);
    });
}


// ===========================================================================
// Vista principal: listado de playlists
// ===========================================================================

/**
 * Recupera y muestra todas las playlists del usuario.
 *
 * GET /playlist/getAllList
 *
 * Pinta:
 *  - Título "Play List" y botón (+) para nueva playlist.
 *  - Tarjetas con portada, likes y acciones (Editar / Eliminar).
 */
function showPlaylists() {
    currentViewPlaylist = "allPlayList";

    if (!content) {
        content = document.getElementById('content');
    }
    if (!content) {
        console.error('No se encontró #content para playlists');
        return;
    }

    function renderPlaylists(data, messageIfEmpty) {
        content.innerHTML = '';

        const headerContainer = document.createElement('div');
        headerContainer.style.display         = 'flex';
        headerContainer.style.justifyContent  = 'center';
        headerContainer.style.alignItems      = 'center';
        headerContainer.style.gap             = '20px';
        headerContainer.style.margin          = '20px 0 50px 0';

        const title = document.createElement('h2');
        title.textContent    = 'Play List';
        title.style.fontSize = '25px';
        title.style.margin   = '0';

        const btn = document.createElement('button');
        btn.className   = 'btnAddPlaylist';
        btn.textContent = '+';
        btn.addEventListener('click', function () {
            const rect = btn.getBoundingClientRect();
            showAlertNewPlaylist(btn, rect, "new", null);
        });

        headerContainer.appendChild(title);
        headerContainer.appendChild(btn);
        content.appendChild(headerContainer);

        if (!Array.isArray(data) || data.length === 0) {
            const p = document.createElement('p');
            p.textContent = messageIfEmpty ||
                'No tienes playlists personales disponibles. Crea una con el botón (+).';
            p.style.color = '#b3b3b3';
            p.style.marginTop = '8px';
            content.appendChild(p);
            return;
        }

        data.forEach(p => {
            const li = document.createElement('li');
            li.style.display       = 'flex';
            li.style.alignItems    = 'flex-start';
            li.style.marginBottom  = '20px';
            li.style.position      = 'relative';
            li.style.flexDirection = 'column';

            const nameDiv = document.createElement('div');
            nameDiv.innerHTML          = `<strong>${p.name}</strong>`;
            nameDiv.style.marginBottom = '8px';
            li.appendChild(nameDiv);

            const mediaContainer = document.createElement('div');
            mediaContainer.style.display       = 'flex';
            mediaContainer.style.alignItems    = 'flex-start';

            const img = document.createElement('img');
            img.src   = '/static/inicio_sesion/img_playlist.png';
            img.width = 307;
            img.height = 222;
            img.alt   = 'portada';
            img.style.cursor = 'pointer';
            img.addEventListener('click', () => verSongs(p.id, p.name));

            mediaContainer.appendChild(img);

            const buttonsDiv = document.createElement('div');
            buttonsDiv.style.display        = 'flex';
            buttonsDiv.style.flexDirection  = 'column';
            buttonsDiv.style.marginLeft     = '10px';
            buttonsDiv.style.justifyContent = 'flex-start';
            buttonsDiv.style.gap            = '8px';

            const likeBtn = document.createElement('button');
            likeBtn.className   = 'btnRoundPlaylist';
            likeBtn.id          = `like-playlist-btn-${p.id}`;
            likeBtn.textContent = p.liked
                ? `Liked (${p.likes_count || 0})`
                : `Like (${p.likes_count || 0})`;
            likeBtn.addEventListener('click', () => likePlaylist(p.id));

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Editar';
            editBtn.className   = 'btnRoundPlaylist';

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Eliminar';
            deleteBtn.className   = 'btnRoundPlaylist';
            deleteBtn.addEventListener('click', () => eliminarPlaylist(p.id));

            buttonsDiv.appendChild(likeBtn);
            buttonsDiv.appendChild(editBtn);
            buttonsDiv.appendChild(deleteBtn);

            mediaContainer.appendChild(buttonsDiv);
            li.appendChild(mediaContainer);
            content.appendChild(li);

            const rect = editBtn.getBoundingClientRect();
            editBtn.addEventListener('click', () =>
                showAlertNewPlaylist(editBtn, rect, "update", p.id)
            );
        });
    }

    // ----------------- Fetch con manejo de errores robusto -----------------
    fetch('/playlist/getAllList', {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
        .then(async (r) => {
            let data = null;

            try {
                data = await r.json();
            } catch (err) {
                const text = await r.text().catch(() => '');
                console.error('Respuesta no JSON al cargar playlists:', err, text.slice(0, 200));
                renderPlaylists([], 'No se pudieron cargar tus playlists (respuesta no válida del servidor).');
                return;
            }

            if (!r.ok) {
                console.warn('HTTP error al cargar playlists:', r.status, data);
                renderPlaylists([], 'Ocurrió un error al cargar tus playlists. Intenta de nuevo más tarde.');
                return;
            }

            renderPlaylists(data, null);
        })
        .catch(error => {
            console.error('Error al cargar playlists:', error);
            popup.innerHTML =
                '<div style="color:red;">Error al cargar playlists.</div>';
        });
}



// ===========================================================================
// Popup inline para crear/renombrar playlist
// ===========================================================================

/**
 * Muestra un formulario flotante (anclado a un botón) para crear o renombrar
 * una playlist.
 *
 * @param {HTMLElement} btn           - Botón origen (para cálculo de posición).
 * @param {DOMRect}     rectPosition  - BoundingClientRect del botón.
 * @param {"new"|"update"} option     - Modo creación o actualización.
 * @param {number|null} idPlaylist    - ID de la playlist a renombrar (update).
 */
function showAlertNewPlaylist(btn, rectPosition, option, idPlaylist) {
    const formContainer = document.createElement('div');
    formContainer.className = 'playlist-form';
    formContainer.style.left      = rectPosition.right + window.scrollX + 'px';
    formContainer.style.top       = rectPosition.top   + window.scrollY + 'px';
    formContainer.style.transform = 'translateY(-50%)';

    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = 'Nombre de la playlist';

    const buttons = document.createElement('div');
    buttons.className = 'form-buttons';

    const crearBtn = document.createElement('button');
    crearBtn.className   = 'btn-create';
    crearBtn.textContent = 'Crear';

    const cancelarBtn = document.createElement('button');
    cancelarBtn.className   = 'btn-cancel';
    cancelarBtn.textContent = 'Cancelar';

    crearBtn.addEventListener('click', () => {
        const name = input.value.trim();
        if (name) {
            if (option === "new") {
                crearPlaylist(name);
            } else if (option === "update") {
                editarPlaylist(idPlaylist, name);
            }
            document.body.removeChild(formContainer);
        } else {
            input.focus();
        }
    });

    cancelarBtn.addEventListener('click', () => {
        document.body.removeChild(formContainer);
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') crearBtn.click();
    });

    buttons.appendChild(cancelarBtn);
    buttons.appendChild(crearBtn);
    formContainer.appendChild(input);
    formContainer.appendChild(buttons);
    document.body.appendChild(formContainer);
    input.focus();

    const closeOnClickOutside = (e) => {
        if (!formContainer.contains(e.target) && e.target !== btn) {
            document.body.removeChild(formContainer);
            document.removeEventListener('click', closeOnClickOutside);
        }
    };
    setTimeout(() => document.addEventListener('click', closeOnClickOutside), 0);
}


// ===========================================================================
// Detalle de playlist: ver canciones
// ===========================================================================

/**
 * Renderiza el detalle de una playlist (lista de canciones).
 *
 * GET /playlist/<id>/songs/
 *
 * Además:
 *  - Actualiza window.__currentPlaylistContext para evitar duplicados al agregar.
 *  - Normaliza datos para window._playlists (uso en MDFCore).
 *
 * @param {number|string} playlistId   - ID de la playlist.
 * @param {string}        playlistName - Nombre opcional de la playlist.
 */
function verSongs(playlistId, playlistName) {
    currentViewPlaylist = "allSongsPlayList";

    console.log("[Playlist] fetch ->", `/playlist/${playlistId}/songs/`);

    let totalSongs = 0;

    fetch(`/playlist/${playlistId}/songs/`)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            totalSongs = Array.isArray(data?.songs) ? data.songs.length : 0;

            if (!content) {
                console.error("No existe #content");
                return;
            }

            const songs  = Array.isArray(data?.songs) ? data.songs : [];
            const plName = (data && (data.name || data.playlist?.name)) ||
                           playlistName ||
                           `Playlist ${playlistId}`;

            // Guardar contexto actual de playlist (para detectar duplicados al agregar)
            try {
                const idsSet = new Set(
                    (songs || []).map(s => String(s.id))
                );
                window.__currentPlaylistContext = {
                    id: String(playlistId),
                    name: plName,
                    songIds: idsSet
                };
            } catch (e) {
                console.warn('No se pudo actualizar __currentPlaylistContext:', e);
            }

            content.innerHTML = '';

            // Encabezado: nombre de la playlist y botón para agregar canción
            const headerContainer = document.createElement('div');
            headerContainer.style.display        = 'flex';
            headerContainer.style.justifyContent = 'center';
            headerContainer.style.alignItems     = 'center';
            headerContainer.style.gap            = '20px';
            headerContainer.style.margin         = '20px 0 50px 0';

            const title = document.createElement('h2');
            title.textContent    = plName;
            title.style.fontSize = '25px';
            title.style.margin   = '0';

            const btn = document.createElement('button');
            btn.className   = 'btnAddPlaylist';
            btn.textContent = '♫+';
            btn.addEventListener('click', function () {
                // Pasamos también el nombre de la playlist para el toast
                showAlertSongSelector(btn, playlistId, totalSongs, plName);
            });

            headerContainer.appendChild(title);
            headerContainer.appendChild(btn);
            content.appendChild(headerContainer);

            // Sin canciones
            if (!songs.length) {
                const p = document.createElement('p');
                p.textContent = 'No hay canciones en esta playlist.';
                content.appendChild(p);

                const main = document.getElementById('main-content');
                if (main) main.dataset.view = 'playlist';
                try { window.MDFCore?.rebindReproductor?.(); } catch {}
                return;
            }

            // Normalización de campos para el reproductor
            const pickFirst = (...c) =>
                c.find(v => typeof v === 'string' && v.trim().length) || "";

            const normSongs = [];

            const rowsHTML = songs.map(song => {
                const audio = pickFirst(
                    song.audioUrl, song.audio_url, song.audio,
                    song.file, song.file_url, song.filePath, song.file_path,
                    song.audioFile, song.audio_file, song.audioPath, song.audio_path,
                    song.src, song.source, song.stream_url, song.streamUrl,
                    song?.audio?.url, song?.file?.url, song?.media?.audio, song?.media?.url
                );
                if (!audio) return "";

                const cover = pickFirst(
                    song.coverUrl, song.cover_url, song.cover,
                    song.thumbnail, song.thumb,
                    song?.cover?.url, song?.image?.url, song?.media?.cover
                ) || "/static/inicio_sesion/img_song.png";

                const idSong = song.id;
                const title  = pickFirst(song.title, song.name) || "—";
                const author = pickFirst(
                    song.artist_display_name,
                    song.artist,
                    song.author,
                    song.singer
                ) || "—";
                const genre  = pickFirst(song.genre, song.genero, song.gen) || "";

                normSongs.push({
                    id: idSong ?? null,
                    title,
                    author,
                    coverUrl: cover,
                    audioUrl: audio,
                    genre
                });

                const esc = s => String(s ?? '').replace(/"/g, '&quot;');

                return `
                    <li class="song-item"
                        data-playlist-name="${esc(plName)}"
                        data-id="${esc(idSong)}"
                        data-audio-url="${esc(audio)}"
                        data-title="${esc(title)}"
                        data-author="${esc(author)}"
                        ${genre ? `data-genre="${esc(genre)}"` : ""}
                        ${cover ? `data-cover-url="${esc(cover)}"` : ""}>
                      <img class="song-cover" src="${esc(cover)}" alt="${esc(title)}"
                           style="width:56px;height:56px;border-radius:10px;object-fit:cover;">
                      <div class="song-info">
                        <div class="song-title"><strong>${esc(title)}</strong></div>
                        <div class="song-author">
                          <small style="color:#b3b3b3">${esc(author)}</small>
                        </div>
                        <br>
                      ${(() => {
    const liked  = !!song.liked;
    const likesN = song.likes_count ?? song.likes ?? 0;
    const extraClass = liked ? " liked" : "";

    return `<button class="btnRoundPlaylist js-like-btn${extraClass}"
                    id="like-song-btn-${song.id}"
                    onclick="likeSong(event, ${song.id})">
              ${liked ? `Liked (${likesN})` : `Like (${likesN})`}
            </button>`;
})()}

                        <button class="btnRoundPlaylist js-delete-btn"
                                onclick="deleteFromPlaylistSong(
                                  event,
                                  ${song.id},
                                  ${playlistId},
                                  this.closest('.song-item') && this.closest('.song-item').getAttribute('data-playlist-name')
                                )">
                          eliminar
                        </button>
                      </div>
                    </li>`;
            }).filter(Boolean).join("");

            const tempContainer = document.createElement('div');
            tempContainer.innerHTML =
                `<ul style="list-style:none;padding:0;margin:0">${rowsHTML}</ul>`;
            const ulElement = tempContainer.firstElementChild;
            content.appendChild(ulElement);

            const main = document.getElementById('main-content');
            if (main) main.dataset.view = 'playlist';

            // Actualiza cache global de playlists para el reproductor
            try {
                const prev   = Array.isArray(window._playlists) ? window._playlists : [];
                const plId   = `pl:${playlistId}`;
                const others = prev.filter(p =>
                    String(p.id) !== String(plId) &&
                    String(p.id) !== 'my' &&
                    String(p.id) !== '1'
                );
                window._playlists = [{ id: plId, name: plName, songs: normSongs }, ...others];
            } catch (e) {
                console.warn('No se pudo actualizar window._playlists en verSongs:', e);
            }

            // Rebinding del reproductor y solicitud de mostrar barra
            try {
                window.MDFCore?.rebindReproductor?.();
                document.dispatchEvent(
                    new CustomEvent('melodify:bar:shouldShow', { bubbles: true, detail: {} })
                );
            } catch (e) {
                console.warn('No se pudo rebindear el reproductor:', e);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            if (content) {
                content.innerHTML = `<p style="color:red;">Error: ${error.message}</p>`;
            }
        });
}


// ===========================================================================
// Popup para elegir canción y agregarla a la playlist
// ===========================================================================

/**
 * Muestra un popup flotante (junto al botón) con la lista de canciones
 * disponibles para agregar a la playlist actual.
 *
 * GET /playlist/allsongs
 *
 * @param {HTMLElement} btn        - Botón origen.
 * @param {number}      idPlaylist - ID de la playlist.
 * @param {number}      totalSongs - Número actual de canciones en la playlist.
 * @param {string}      playlistName - Nombre de la playlist (para el toast).
 */
function showAlertSongSelector(btn, idPlaylist, totalSongs, playlistName) {
    console.log('idPlaylist para agregar canción:', idPlaylist);

    if (document.getElementById('song-selector-popup')) {
        return;
    }

    const rect = btn.getBoundingClientRect();

    const overlay = document.createElement('div');
    overlay.id = 'song-selector-overlay';
    overlay.style.position        = 'fixed';
    overlay.style.top             = '0';
    overlay.style.left            = '0';
    overlay.style.width           = '100%';
    overlay.style.height          = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.4)';
    overlay.style.zIndex          = '998';

    const popup = document.createElement('div');
    popup.id = 'song-selector-popup';
    popup.style.position        = 'absolute';
    popup.style.left            = rect.right + window.scrollX + 'px';
    popup.style.top             = rect.top   + window.scrollY + 'px';
    popup.style.transform       = 'translateY(-50%)';
    popup.style.backgroundColor = '#1a1a1a';
    popup.style.border          = '1px solid #333';
    popup.style.borderRadius    = '8px';
    popup.style.maxHeight       = '900px';
    popup.style.overflowY       = 'auto';
    popup.style.zIndex          = '999';
    popup.style.minWidth        = '280px';
    popup.style.boxShadow       = '0 4px 16px rgba(0,0,0,0.5)';
    popup.style.fontFamily      = 'sans-serif';

    popup.innerHTML = '<div style="padding:16px; color:#888;">Cargando canciones...</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    fetch('/playlist/allsongs')
        .then(response => response.json())
        .then(songs => {
            if (!Array.isArray(songs) || songs.length === 0) {
                popup.innerHTML =
                    '<div style="padding:16px; color:#888;">No hay canciones disponibles.</div>';
                return;
            }

            let html = '';
            songs.forEach(song => {
                html += `
                    <div class="song-item-selector" data-id="${song.id}"
                         style="padding:10px 16px; cursor:pointer; border-bottom:1px solid #2a2a2a;">
                        <strong>${song.title}</strong><br>
                        <small style="color:#aaa;">${song.artist_display_name}</small>
                    </div>`;
            });
            popup.innerHTML = html;

            popup.querySelectorAll('.song-item-selector').forEach(item => {
                item.addEventListener('click', function () {
                    const idSong = this.dataset.id;
                    addSongToPlaylist(idSong, idPlaylist, totalSongs, playlistName);
                    document.body.removeChild(popup);
                    document.body.removeChild(overlay);
                });
            });
        })
        .catch(error => {
            console.error('Error al cargar canciones:', error);
            popup.innerHTML =
                '<div style="padding:16px; color:red;">Error al cargar canciones.</div>';
        });

    const closePopup = (e) => {
        if (!popup.contains(e.target) && e.target !== btn) {
            document.body.removeChild(popup);
            document.body.removeChild(overlay);
            document.removeEventListener('click', closePopup);
        }
    };
    setTimeout(() => document.addEventListener('click', closePopup), 0);
}


// ===========================================================================
// Agregar canción a playlist (detalle y buscador)
// ===========================================================================

/**
 * Agrega una canción a una playlist (desde el detalle de la playlist).
 *
 * POST /playlist/addsong/
 *
 * Usa window.__currentPlaylistContext para detectar duplicados de forma
 * inmediata antes de preguntar al servidor.
 *
 * @param {number|string} idSong      - ID de la canción.
 * @param {number|string} idPlaylist  - ID de la playlist.
 * @param {number}        totalSong   - Número actual de canciones en la playlist.
 * @param {string}        playlistName - Nombre de la playlist (para el toast).
 */
function addSongToPlaylist(idSong, idPlaylist, totalSong, playlistName) {
    console.log('Agregando canción con ID:', idSong, 'totalSongs:', totalSong);

    const ctx       = window.__currentPlaylistContext;
    const songIdStr = String(idSong);

    // Si estamos en esa playlist y ya contiene la canción → avisar y salir
    if (ctx && String(ctx.id) === String(idPlaylist) && ctx.songIds && ctx.songIds.has(songIdStr)) {
        notifyPlaylistSongAlready(playlistName || ctx.name);
        return;
    }

    const position = totalSong + 1;

    fetch('/playlist/addsong/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
            song_id:     idSong,
            playlist_id: idPlaylist,
            position:    position
        })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => {
                throw new Error(err.error || `Error ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        console.log('Canción agregada en posición:', data.position);

        // Actualizamos el set local por si alguien lo usa antes del siguiente verSongs
        if (ctx && String(ctx.id) === String(idPlaylist) && ctx.songIds) {
            ctx.songIds.add(songIdStr);
        }

        // Toast de "añadida a playlist"
        notifyPlaylistSongChange(true, playlistName || ctx?.name);

        verSongs(idPlaylist);
    })
    .catch(error => {
        console.error('Error al agregar canción:', error);
        alert('No se pudo agregar la canción:\n' + error.message);
    });
}

/**
 * Variante para agregar canción a playlist desde el buscador.
 *
 * 1) Obtiene la playlist para conocer tamaño y duplicados.
 * 2) Reusa addSongToPlaylist(...) si todo es válido.
 *
 * @param {number|string} idSong      - ID de la canción.
 * @param {number|string} idPlaylist  - ID de la playlist.
 * @param {string}        playlistName - Nombre de la playlist (para el toast).
 */
function addSongToPlaylistFromSearch(idSong, idPlaylist, playlistName) {
    console.log('Agregar desde buscador. Canción:', idSong, 'Playlist:', idPlaylist);

    fetch(`/playlist/${idPlaylist}/songs/`)
        .then(response => response.json())
        .then(data => {
            const songs      = Array.isArray(data.songs) ? data.songs : [];
            const totalSongs = songs.length;

            // ¿Ya está esta canción en esa playlist?
            const already = songs.some(s => String(s.id) === String(idSong));
            if (already) {
                notifyPlaylistSongAlready(playlistName);
                return;
            }

            addSongToPlaylist(idSong, idPlaylist, totalSongs, playlistName);
        })
        .catch(error => {
            console.error('Error al obtener canciones de la playlist:', error);
            alert('No se pudo agregar la canción a la playlist.');
        });
}


// ===========================================================================
// Selección de playlist (popup) para agregar desde el buscador
// ===========================================================================

/**
 * Muestra un popup modal con la lista de playlists del usuario para elegir
 * a cuál agregar una canción (flujo desde el buscador / Home).
 *
 * @param {number|string} idSong - ID de la canción a agregar.
 */
function openAddToPlaylistForSong(idSong /* metaOpcional */) {
    if (document.getElementById('playlist-selector-popup')) {
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'playlist-selector-overlay';
    overlay.style.position        = 'fixed';
    overlay.style.top             = '0';
    overlay.style.left            = '0';
    overlay.style.width           = '100%';
    overlay.style.height          = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.4)';
    overlay.style.zIndex          = '998';

    const popup = document.createElement('div');
    popup.id = 'playlist-selector-popup';
    popup.style.position        = 'fixed';
    popup.style.top             = '50%';
    popup.style.left            = '50%';
    popup.style.transform       = 'translate(-50%, -50%)';
    popup.style.backgroundColor = '#1a1a1a';
    popup.style.border          = '1px solid #333';
    popup.style.borderRadius    = '10px';
    popup.style.minWidth        = '260px';
    popup.style.maxWidth        = '320px';
    popup.style.maxHeight       = '70vh';
    popup.style.overflowY       = 'auto';
    popup.style.padding         = '16px';
    popup.style.boxShadow       = '0 4px 16px rgba(0,0,0,0.5)';
    popup.style.zIndex          = '999';
    popup.style.fontFamily      = 'sans-serif';

    popup.innerHTML = `
        <div style="margin-bottom:10px;"><strong>Agregar a playlist</strong></div>
        <div style="color:#888;">Cargando playlists…</div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    function cerrar() {
        if (popup.parentNode) popup.parentNode.removeChild(popup);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('click', clickOutside);
    }

    function clickOutside(e) {
        if (!popup.contains(e.target)) {
            cerrar();
        }
    }
    setTimeout(() => document.addEventListener('click', clickOutside), 0);
    overlay.addEventListener('click', cerrar);

    fetch('/playlist/getAllList')
        .then(response => response.json())
        .then(data => {
            if (!Array.isArray(data) || !data.length) {
                popup.innerHTML =
                    '<div style="color:#888;">No tienes playlists creadas.</div>';
                return;
            }

            let html = `
                <div style="margin-bottom:10px;"><strong>Agregar a playlist</strong></div>
                <div style="font-size:12px;color:#aaa;margin-bottom:8px;">
                    Elige una playlist:
                </div>
            `;
            data.forEach(p => {
                html += `
                    <div class="playlist-item-selector"
                         data-id="${p.id}"
                         data-name="${(p.name || '').replace(/"/g, '&quot;')}"
                         style="padding:8px 10px;border-radius:6px;
                                border:1px solid #2a2a2a;margin-bottom:6px;
                                cursor:pointer;">
                        ${p.name}
                    </div>`;
            });
            popup.innerHTML = html;

            popup.querySelectorAll('.playlist-item-selector').forEach(item => {
                item.addEventListener('click', function () {
                    const idPlaylist   = this.dataset.id;
                    const playlistName = this.dataset.name || this.textContent.trim();
                    addSongToPlaylistFromSearch(idSong, idPlaylist, playlistName);
                    cerrar();
                });
            });
        })
        .catch(error => {
            console.error('Error al cargar playlists:', error);
            popup.innerHTML =
                '<div style="color:red;">Error al cargar playlists.</div>';
        });

}


// ===========================================================================
// Likes de canciones dentro de la playlist
// ===========================================================================

/**
 * Marca o desmarca like en una canción dentro de una playlist y sincroniza
 * el modelo de likes en MDFCore (si está disponible).
 *
 * POST /api/like/song/<idSong>/
 *
 * @param {Event}         ev     - Evento click del botón.
 * @param {number|string} idSong - ID de la canción.
 */
async function likeSong(ev, idSong) {
    if (ev) {
        ev.stopPropagation();
        ev.preventDefault();
    }

    console.log('Like song:', idSong);
    const csrf = getCookie('csrftoken');

    const btn = document.getElementById(`like-song-btn-${idSong}`);
    if (btn) btn.disabled = true;

    try {
        const resp = await fetch(`/api/like/song/${idSong}/`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': csrf,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: null
        });

        let data = null;
        try {
            data = await resp.json();
        } catch (err) {
            console.error("Respuesta no JSON:", err);
        }

        if (resp.ok && data) {
            const liked = !!data.liked;

            if (btn) {
                btn.textContent = liked
                    ? `Liked (${data.total})`
                    : `Like (${data.total})`;
                btn.classList.toggle("liked", liked);
            }

            // Sincroniza modelo de likes en MDFCore (si existe)
            if (window.MDFCore && typeof window.MDFCore.syncLikeModelFromClient === 'function') {
                let meta = null;
                const row = btn ? btn.closest('.song-item') : null;
                if (row) {
                    meta = {
                        title:    row.getAttribute('data-title')      || '',
                        artist:   row.getAttribute('data-author')     || '',
                        audioUrl: row.getAttribute('data-audio-url')  || '',
                        coverUrl: row.querySelector('.song-cover')?.getAttribute('src') || '',
                        genre:    row.getAttribute('data-genre')      || ''
                    };
                }
                window.MDFCore.syncLikeModelFromClient(idSong, liked, meta);
            }
        } else if (resp.status === 401 || (data && data.error === "login_required")) {
            window.location.href = "/login/";
        } else {
            console.warn("Error likeSong", resp.status, data);
            alert("No se pudo procesar el like.");
        }
    } catch (e) {
        console.error("Error likeSong:", e);
        alert("Error de conexión al procesar el like.");
    } finally {
        if (btn) btn.disabled = false;
    }
}


// ===========================================================================
// Quitar canción de playlist (sin borrar del catálogo)
// ===========================================================================

/**
 * Quita una canción de la playlist sin eliminarla del catálogo global.
 *
 * DELETE /playlist/removeSong/
 *
 * @param {Event}         ev          - Evento click.
 * @param {number|string} idSong      - ID de la canción.
 * @param {number|string} playlistId  - ID de la playlist.
 * @param {string}        playlistName - Nombre de la playlist (para el toast).
 */
function deleteFromPlaylistSong(ev, idSong, playlistId, playlistName) {
    if (ev) {
        ev.stopPropagation();
        ev.preventDefault();
    }

    console.log('delete', idSong);
    if (!confirm('¿Quitar esta canción de la playlist?')) {
        return;
    }

    fetch('/playlist/removeSong/', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
            playlist_id: playlistId,
            song_id:     idSong
        })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => {
                throw new Error(err.error || `Error ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        console.log('Canción eliminada de playlist:', data.message);

        // Toast de "quitada de la playlist"
        notifyPlaylistSongChange(false, playlistName);

        verSongs(playlistId);
    })
    .catch(error => {
        console.error('Error al eliminar:', error);
        alert('Error: ' + error.message);
    });
}
