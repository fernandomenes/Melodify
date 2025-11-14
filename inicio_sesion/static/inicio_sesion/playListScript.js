/* ==========================================================================
   PlayList UI • Módulo de listas del usuario (crear, editar, borrar, likes)
   - Vista principal de playlists
   - Vista de canciones de una playlist
   - Popups para crear/renombrar playlists y agregar canciones
   - Integración con el reproductor (window.MDFCore, window._playlists)
   ========================================================================== */

// ---------------------------------------------------------------------------
// Estado global simple
// ---------------------------------------------------------------------------
let currentViewPlaylist  = "allPlayList"; // "allPlayList" | "allSongsPlayList"
let content              = null;          // Contenedor principal (#content en home.html)
let USERNAME             = null;          // Usuario en sesión (inyectado desde plantilla)


// ---------------------------------------------------------------------------
// Inicialización
// ---------------------------------------------------------------------------

/**
 * Punto de entrada desde homeScript: inicia la vista de playlists del usuario.
 */
function initPlayList(username) {
    USERNAME = username;
    content  = document.getElementById('content');
    showPlaylists();
}

/**
 * Botón "back" específico de la sección Playlist.
 * Vuelve a la lista de playlists cuando se está viendo las canciones de una.
 */
function clickBackBtnPlaylist() {
    if (currentViewPlaylist === "allSongsPlayList") {
        showPlaylists();
    }
}


// ---------------------------------------------------------------------------
// Helpers generales (CSRF, etc.)
// ---------------------------------------------------------------------------

/**
 * Lee el valor de una cookie por nombre (usado para obtener el csrftoken).
 */
function getCookie(name) {
    const v = document.cookie.split('; ').find(row => row.startsWith(name + '='));
    return v ? decodeURIComponent(v.split('=')[1]) : null;
}


// ---------------------------------------------------------------------------
// CRUD Playlists (crear, editar, eliminar, like)
// ---------------------------------------------------------------------------

/**
 * Crea una nueva playlist para el usuario actual.
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
 * Marca o desmarca "like" sobre una playlist.
 * Actualiza el contador y el estado visual del botón.
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
 * Elimina una playlist completa (tras confirmación).
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


// ---------------------------------------------------------------------------
// Vista principal: listado de playlists
// ---------------------------------------------------------------------------

/**
 * Recupera y muestra todas las playlists del usuario.
 * Incluye botón global para crear nueva playlist.
 */
function showPlaylists() {
    currentViewPlaylist = "allPlayList";

    fetch('/playlist/getAllList')
        .then(r => r.json())
        .then(data => {
            if (!content) return;

            if (!Array.isArray(data) || data.length === 0) {
                content.innerHTML = '<li>No hay playlists.</li>';
                return;
            }

            content.innerHTML = '';

            // Encabezado centrado (título + botón "nueva playlist")
            const headerContainer = document.createElement('div');
            headerContainer.style.display         = 'flex';
            headerContainer.style.justifyContent  = 'center';
            headerContainer.style.alignItems      = 'center';
            headerContainer.style.gap             = '20px';
            headerContainer.style.margin          = '20px 0 50px 0';

            const title = document.createElement('h2');
            title.textContent   = 'Play List';
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

            // Tarjetas de playlist
            data.forEach(p => {
                const li = document.createElement('li');
                li.style.display       = 'flex';
                li.style.alignItems    = 'flex-start';
                li.style.marginBottom  = '20px';
                li.style.position      = 'relative';
                li.style.flexDirection = 'column';

                // Nombre de la playlist
                const nameDiv = document.createElement('div');
                nameDiv.innerHTML       = `<strong>${p.name}</strong>`;
                nameDiv.style.marginBottom = '8px';
                li.appendChild(nameDiv);

                // Contenedor para portada + botones
                const mediaContainer = document.createElement('div');
                mediaContainer.style.display       = 'flex';
                mediaContainer.style.alignItems    = 'flex-start';

                // Portada clicable que abre el detalle de canciones
                const img = document.createElement('img');
                img.src   = '/static/inicio_sesion/img_playlist.png';
                img.width = 307;
                img.height = 222;
                img.alt   = 'portada';
                img.style.cursor = 'pointer';
                img.addEventListener('click', () => verSongs(p.id, p.name));

                mediaContainer.appendChild(img);

                // Columna de botones de acción
                const buttonsDiv = document.createElement('div');
                buttonsDiv.style.display        = 'flex';
                buttonsDiv.style.flexDirection  = 'column';
                buttonsDiv.style.marginLeft     = '10px';
                buttonsDiv.style.justifyContent = 'flex-start';
                buttonsDiv.style.gap            = '8px';

                // Botón like
                const likeBtn = document.createElement('button');
                likeBtn.className = 'btnRoundPlaylist';
                likeBtn.id        = `like-playlist-btn-${p.id}`;
                likeBtn.textContent = p.liked
                    ? `Liked (${p.likes_count || 0})`
                    : `Like (${p.likes_count || 0})`;
                likeBtn.addEventListener('click', () => likePlaylist(p.id));

                // Botón editar
                const editBtn = document.createElement('button');
                editBtn.textContent = 'Editar';
                editBtn.className   = 'btnRoundPlaylist';

                // Botón eliminar
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

                // Popup de renombrar playlist
                const rect = editBtn.getBoundingClientRect();
                editBtn.addEventListener('click', () =>
                    showAlertNewPlaylist(editBtn, rect, "update", p.id)
                );
            });
        })
        .catch(err => console.error('Error al cargar playlists:', err));
}


// ---------------------------------------------------------------------------
// Popup inline para crear/renombrar playlist (junto al botón origen)
// ---------------------------------------------------------------------------

/**
 * Muestra un pequeño formulario flotante al lado de un botón para
 * crear una nueva playlist o renombrar una existente.
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


// ---------------------------------------------------------------------------
// Vista de canciones dentro de una playlist
// ---------------------------------------------------------------------------

/**
 * Carga y muestra las canciones de una playlist concreta.
 * playlistName es opcional; si no se pasa, se intenta obtener del backend.
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

            content.innerHTML = '';

            // Encabezado: nombre de la playlist + botón "agregar canción"
            const headerContainer = document.createElement('div');
            headerContainer.style.display        = 'flex';
            headerContainer.style.justifyContent = 'center';
            headerContainer.style.alignItems     = 'center';
            headerContainer.style.gap            = '20px';
            headerContainer.style.margin         = '20px 0 50px 0';

            const title = document.createElement('h2');
            title.textContent   = plName;
            title.style.fontSize = '25px';
            title.style.margin   = '0';

            const btn = document.createElement('button');
            btn.className   = 'btnAddPlaylist';
            btn.textContent = '♫+';
            btn.addEventListener('click', function () {
                showAlertSongSelector(btn, playlistId, totalSongs);
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
                            const liked  = song.liked ? true : false;
                            const likesN = song.likes_count || 0;
                            return `<button class="btnRoundPlaylist js-like-btn"
                                            id="like-song-btn-${song.id}"
                                            onclick="likeSong(event, ${song.id})">
                                      ${liked ? `Liked (${likesN})` : `Like (${likesN})`}
                                    </button>`;
                        })()}
                        <button class="btnRoundPlaylist js-delete-btn"
                                onclick="deleteFromPlaylistSong(event, ${song.id}, ${playlistId})">
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

            // Actualizar cache global de playlists para el reproductor
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


// ---------------------------------------------------------------------------
// Popup selector de canciones para agregar a una playlist
// ---------------------------------------------------------------------------

/**
 * Muestra un popup junto al botón para elegir una canción
 * y agregarla a la playlist indicada.
 */
function showAlertSongSelector(btn, idPlaylist, totalSongs) {
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
                    addSongToPlaylist(idSong, idPlaylist, totalSongs);
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


// ---------------------------------------------------------------------------
// Alta de canciones a playlist (desde vista y desde buscador)
// ---------------------------------------------------------------------------

/**
 * Agrega una canción a la playlist en la posición indicada
 * y recarga el detalle de la playlist.
 */
function addSongToPlaylist(idSong, idPlaylist, totalSong) {
    console.log('Agregando canción con ID:', idSong, 'totalSongs:', totalSong);

    const position = totalSong + 1;

    fetch('/playlist/addsong/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
            song_id:    idSong,
            playlist_id: idPlaylist,
            position:   position
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
        verSongs(idPlaylist);
    })
    .catch(error => {
        console.error('Error al agregar canción:', error);
        alert('No se pudo agregar la canción:\n' + error.message);
    });
}

/**
 * Versión usada por el buscador:
 * primero consulta cuántas canciones tiene la playlist y luego llama a addSongToPlaylist.
 */
function addSongToPlaylistFromSearch(idSong, idPlaylist) {
    console.log('Agregar desde buscador. Canción:', idSong, 'Playlist:', idPlaylist);

    fetch(`/playlist/${idPlaylist}/songs/`)
        .then(response => response.json())
        .then(data => {
            const totalSongs = Array.isArray(data.songs) ? data.songs.length : 0;
            addSongToPlaylist(idSong, idPlaylist, totalSongs);
        })
        .catch(error => {
            console.error('Error al obtener canciones de la playlist:', error);
            alert('No se pudo agregar la canción a la playlist.');
        });
}


// ---------------------------------------------------------------------------
// Selector de playlist (popup) para agregar canción desde el buscador
// ---------------------------------------------------------------------------

/**
 * Popup modal centrado que permite elegir una playlist
 * cuando se llama desde el buscador.
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
                         style="padding:8px 10px;border-radius:6px;
                                border:1px solid #2a2a2a;margin-bottom:6px;
                                cursor:pointer;">
                        ${p.name}
                    </div>`;
            });
            popup.innerHTML = html;

            popup.querySelectorAll('.playlist-item-selector').forEach(item => {
                item.addEventListener('click', function () {
                    const idPlaylist = this.dataset.id;
                    addSongToPlaylistFromSearch(idSong, idPlaylist);
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


// ---------------------------------------------------------------------------
// Likes de canciones dentro de la playlist
// ---------------------------------------------------------------------------

/**
 * Marca o desmarca "like" en una canción dentro de la playlist.
 * Sincroniza también el modelo de likes del reproductor (MDFCore).
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


// ---------------------------------------------------------------------------
// Eliminación de canción desde la playlist
// ---------------------------------------------------------------------------

/**
 * Quita una canción de la playlist actual (sin borrarla del catálogo).
 */
function deleteFromPlaylistSong(ev, idSong, playlistId) {
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
        verSongs(playlistId);
    })
    .catch(error => {
        console.error('Error al eliminar:', error);
        alert('Error: ' + error.message);
    });
}
