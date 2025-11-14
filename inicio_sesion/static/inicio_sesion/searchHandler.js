// static/inicio_sesion/searchHandler.js

document.addEventListener('DOMContentLoaded', function () {
    const searchInput = document.getElementById('search-input');
    const searchForm  = document.getElementById('search-form');

    // Leer estado inicial y parámetros de la URL
    const main        = document.getElementById('main-content');
    const initialView = main?.dataset?.initialView || '';
    const params      = new URLSearchParams(window.location.search);
    const viewParam   = params.get('view');
    const playlistIdFromURL = params.get('playlist');
    const songFromURL       = params.get('song');

    // Si venimos con ?view=playlist&playlist=ID → abrir la vista de playlists y esa lista
    if (initialView === 'home' && viewParam === 'playlist') {
        setTimeout(() => {
            const mainEl = document.getElementById('main-content');
            if (!mainEl) return;

            // Marcar menú Playlist
            const items = document.querySelectorAll('#menuLateral .menu-item');
            items.forEach(it => it.classList.remove('active'));
            const playlistItem = document.querySelector('#menuLateral .menu-item[data-view="playlist"]');
            if (playlistItem) playlistItem.classList.add('active');

            mainEl.dataset.view = 'playlist';

            try {
                const username = mainEl.dataset.username || '';

                if (typeof initPlayList === 'function') {
                    initPlayList(username);
                }
                if (playlistIdFromURL && typeof verSongs === 'function') {
                    // Pequeña espera para que se pinte la UI
                    setTimeout(() => verSongs(playlistIdFromURL), 150);
                }
            } catch (err) {
                console.warn('Error al abrir playlist desde la URL:', err);
            }
        }, 0);
    }

    // Si venimos con ?view=reproductor&song=... → abrir reproductor y reproducir
    if (initialView === 'home' && viewParam === 'reproductor') {
        setTimeout(() => {
            const repItem = document.querySelector('#menuLateral .menu-item[data-view="reproductor"]');
            if (repItem) repItem.click();

            if (!songFromURL) return;

            const titleFromURL  = params.get('title')  || '';
            const artistFromURL = params.get('artist') || '';
            const coverFromURL  = params.get('cover')  || '';

            // Espera para que el reproductor cargue
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

    // Enter y submit en el buscador → navegar a /buscar/?q=...
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

    function performSearch() {
        const input = document.getElementById('search-input');
        const query = input ? input.value.trim() : '';

        if (query.length > 0) {
            window.location.href = `/buscar/?q=${encodeURIComponent(query)}`;
        } else {
            window.location.href = '/buscar/';
        }
    }

    // Búsqueda en tiempo real (panel debajo del input)
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

    // Pintar panel con resultados rápidos
    function displaySearchPanel(results) {
        const panel = document.getElementById('search-panel');
        if (!panel) return;

        let html = '';

        // Canciones
        if (results.canciones && results.canciones.length > 0) {
            html += '<div class="search-section"><h4>Canciones</h4>';
            results.canciones.forEach(cancion => {
                const t = String(cancion.title).replace(/'/g, "\\'");
                const a = String(cancion.artist).replace(/'/g, "\\'");
                const u = String(cancion.audioUrl || '').replace(/'/g, "\\'");
                html += `
                    <div class="search-item"
                         onclick="playSearchResult('${u}', '${t}', '${a}')">
                        ${cancion.title} - ${cancion.artist}
                    </div>
                `;
            });
            html += '</div>';
        }

        // Artistas
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

        // Playlists
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

    // Cerrar panel al hacer clic fuera del área de búsqueda
    document.addEventListener('click', function (e) {
        const panel  = document.getElementById('search-panel');
        const search = document.getElementById('search');

        if (panel && search && !search.contains(e.target)) {
            panel.hidden = true;
        }
    });
});

// Reproducir una canción desde el panel de búsqueda
function playSearchResult(audioUrl, title, artist, coverUrl = '') {
    hideSearchPanel();

    // Si el reproductor ya está cargado en la SPA
    if (window.MDFCore && typeof window.MDFCore.playSong === 'function') {
        window.MDFCore.playSong(audioUrl, title, artist, coverUrl);
        return;
    }

    // Si no está cargado, redirigimos a /home/?view=reproductor&song=...
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

// Ir al perfil de un artista
function viewArtist(username) {
    hideSearchPanel();
    window.location.href = `/artista/${encodeURIComponent(username)}/`;
}

// Ir a una playlist usando la SPA de /home/
function viewPlaylist(playlistId) {
    hideSearchPanel();

    const main     = document.getElementById('main-content');
    const baseHome = (main && main.dataset && main.dataset.urlHome) || '/home/';

    const url = new URL(baseHome, window.location.origin);
    url.searchParams.set('view', 'playlist');
    url.searchParams.set('playlist', String(playlistId));

    window.location.href = url.toString();
}

// Ocultar panel de búsqueda rápido
function hideSearchPanel() {
    const panel = document.getElementById('search-panel');
    if (panel) {
        panel.hidden = true;
    }
}
