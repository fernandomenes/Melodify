// static/inicio_sesion/searchHandler.js

document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('search-input');
    const searchForm = document.getElementById('search-form');
    const main = document.getElementById('main-content');
    const initialView = main?.dataset?.initialView || '';
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const playlistIdFromURL = params.get('playlist');

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

                if (typeof initPlayList === 'function') {
                    initPlayList(username);       // prepara #content y muestra listas
                }
                if (playlistIdFromURL && typeof verSongs === 'function') {
                    setTimeout(() => verSongs(playlistIdFromURL), 150);
                }
            } catch (err) {
                console.warn('Error al inicializar playlist desde la URL:', err);
            }
        }, 0);
    }
    if (searchInput && searchForm) {
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch();
            }
        });
        
        searchForm.addEventListener('submit', function(e) {
            e.preventDefault();
            performSearch();
        });
    }
    
    function performSearch() {
        const searchInput = document.getElementById('search-input');
        const query = searchInput.value.trim();
        
        if (query.length > 0) {
            window.location.href = `/buscar/?q=${encodeURIComponent(query)}`;
        } else {
            window.location.href = '/buscar/';
        }
    }
    
    let searchTimeout;
    searchInput.addEventListener('input', function() {
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
    
    function displaySearchPanel(results) {
        const panel = document.getElementById('search-panel');
        if (!panel) return;
        
        let html = '';
        
        if (results.canciones && results.canciones.length > 0) {
            html += '<div class="search-section"><h4>Canciones</h4>';
            results.canciones.forEach(cancion => {
                html += `
                    <div class="search-item" onclick="playSearchResult('${cancion.audioUrl}', '${cancion.title}', '${cancion.artist}')">
                        ${cancion.title} - ${cancion.artist}
                    </div>
                `;
            });
            html += '</div>';
        }
        
        if (results.artistas && results.artistas.length > 0) {
            html += '<div class="search-section"><h4>Artistas</h4>';
            results.artistas.forEach(artista => {
                html += `
                    <div class="search-item" onclick="viewArtist('${artista.username}')">
                        ${artista.username}
                    </div>
                `;
            });
            html += '</div>';
        }
        
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
    
    function hideSearchPanel() {
        const panel = document.getElementById('search-panel');
        if (panel) {
            panel.hidden = true;
        }
    }
    
    // Cerrar panel al hacer clic fuera
    document.addEventListener('click', function(e) {
        const panel = document.getElementById('search-panel');
        const search = document.getElementById('search');
        
        if (panel && !search.contains(e.target)) {
            panel.hidden = true;
        }
    });
});

// Funciones globales para los resultados
function playSearchResult(audioUrl, title, artist) {
    if (window.MDFCore && window.MDFCore.playSong) {
        window.MDFCore.playSong(audioUrl, title, artist, '');
    } else {
        console.log('Reproducir:', title, '-', artist);
    }
    hideSearchPanel();
}

function viewArtist(username) {
    window.location.href = `/artista/${encodeURIComponent(username)}/`;
    hideSearchPanel();
}

function viewPlaylist(playlistId) {
    const main = document.getElementById('main-content');
    const baseHome =
        (main && main.dataset && main.dataset.urlHome) ||
        '/home/';

    hideSearchPanel();
    window.location.href =
        `${baseHome}?view=playlist&playlist=${encodeURIComponent(playlistId)}`;
}


function hideSearchPanel() {
    const panel = document.getElementById('search-panel');
    if (panel) {
        panel.hidden = true;
    }
}