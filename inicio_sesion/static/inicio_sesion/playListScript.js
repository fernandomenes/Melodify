/* ==========================================================================
   Melodify — Playlists de usuario
   Gestión de playlists personales: creación, edición, eliminación y likes.
   Integración con el reproductor (MDFCore) y toasts globales.
   ========================================================================== */

/* PlayList UI: listas del usuario. */

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------

let currentViewPlaylist  = "allPlayList"; // "allPlayList" | "allSongsPlayList"
let content              = null;          // Contenedor principal (#content)
let USERNAME             = null;          // Usuario en sesión

// Caché de nombres de playlist (id -> nombre)
const PL_NAME = new Map();

// Cabeceras comunes para peticiones fetch
const H_FETCH = {
  'X-Requested-With': 'fetch',
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Obtiene el usuario de sesión desde distintas fuentes
function getSessionUsername() {
  return (
    (window.__SESSION_USER__ && (window.__SESSION_USER__.username || window.__SESSION_USER__.user)) ||
    document.getElementById('main-content')?.dataset?.username ||
    document.querySelector('meta[name="username"]')?.getAttribute('content') ||
    window.__USER__ ||
    document.body?.getAttribute('data-username') ||
    ''
  );
}

function getCookie(name) {
  const v = document.cookie.split('; ').find(row => row.startsWith(name + '='));
  return v ? decodeURIComponent(v.split('=')[1]) : null;
}

function notifyPlaylistSongChange(added, playlistName) {
  const name = (playlistName || '').trim();

  if (typeof window.__melodifyShowPlaylistToast === 'function') {
    window.__melodifyShowPlaylistToast(added, name);
    return;
  }
  if (typeof window.__melodifyShowToast === 'function') {
    window.__melodifyShowToast(
      added
        ? (name ? `Añadida a la playlist “${name}”` : 'Añadida a una playlist')
        : (name ? `Quitada de la playlist “${name}”` : 'Quitada de la playlist')
    );
    return;
  }

  const el = document.getElementById('like-toast');
  if (!el) return;
  el.textContent = added
    ? (name ? `Añadida a la playlist “${name}”` : 'Añadida a una playlist')
    : (name ? `Quitada de la playlist “${name}”` : 'Quitada de la playlist');
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

function notifyPlaylistSongAlready(playlistName) {
  const name = (playlistName || '').trim();
  const msg = name
    ? `La canción ya está en la playlist “${name}”`
    : 'La canción ya está en esa playlist';

  if (typeof window.__melodifyShowToast === 'function') {
    window.__melodifyShowToast(msg);
    return;
  }
  const el = document.getElementById('like-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

// ===========================================================================
// Inicialización
// ===========================================================================

function initPlayList(username) {
  USERNAME = username || getSessionUsername();
  content  = document.getElementById('content');
  showPlaylists();
}

function clickBackBtnPlaylist() {
  if (currentViewPlaylist === "allSongsPlayList") {
    showPlaylists();
  }
}

// ===========================================================================
// API de playlists: crear, editar, eliminar, like
// ===========================================================================

function crearPlaylist(namePlaylist) {
  const csrf = getCookie('csrftoken');
  fetch('/playlist/create/', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? {'X-CSRFToken': csrf} : {})
    },
    body: JSON.stringify({ user: USERNAME, name: namePlaylist })
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || `HTTP ${r.status}`); }))
  .then(data => {
    if (data && data.id) {
      PL_NAME.set(String(data.id), data.name || namePlaylist);
    }
    showPlaylists();
  })
  .catch(err => {
    console.error('Error al crear playlist:', err);
    alert('No se pudo crear la playlist:\n' + err.message);
  });
}

async function likePlaylist(id) {
  const csrf = getCookie('csrftoken');
  const btn = document.getElementById(`like-playlist-btn-${id}`);
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch(`/api/like/playlist/${id}/`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-CSRFToken': csrf || '',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    let data = null;
    try { data = await resp.json(); } catch {}
    if (resp.ok && data) {
      if (btn) {
        btn.textContent = data.liked ? `Liked (${data.total})` : `Like (${data.total})`;
        btn.classList.toggle('liked', !!data.liked);
      }
    } else if (resp.status === 401 || (data && data.error === 'login_required')) {
      window.location.href = '/login/';
    } else {
      throw new Error((data && data.error) || `HTTP ${resp.status}`);
    }
  } catch (e) {
    console.error('Error likePlaylist:', e);
    alert('No se pudo procesar el like.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function editarPlaylist(id, newname) {
  const csrf = getCookie('csrftoken');
  fetch(`/playlist/${id}/update/`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? {'X-CSRFToken': csrf} : {})
    },
    body: JSON.stringify({ name: newname })
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || `HTTP ${r.status}`); }))
  .then(_ => {
    PL_NAME.set(String(id), newname);
    showPlaylists();
  })
  .catch(error => {
    console.error('Error al actualizar:', error);
    alert('Error: ' + error.message);
  });
}

function eliminarPlaylist(playlistId) {
  if (!confirm('¿Seguro que deseas eliminar esta playlist?')) return;

  const csrf = getCookie('csrftoken');
  fetch(`/playlist/${playlistId}/delete/`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? {'X-CSRFToken': csrf} : {})
    }
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || `HTTP ${r.status}`); }))
  .then(_ => {
    PL_NAME.delete(String(playlistId));
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

function showPlaylists() {
  currentViewPlaylist = "allPlayList";

  if (!content) content = document.getElementById('content');
  if (!content) { console.error('No se encontró #content para playlists'); return; }

  function renderPlaylists(data, messageIfEmpty) {
    content.innerHTML = '';

    const headerContainer = document.createElement('div');
    headerContainer.style.display        = 'flex';
    headerContainer.style.justifyContent = 'center';
    headerContainer.style.alignItems     = 'center';
    headerContainer.style.gap            = '20px';
    headerContainer.style.margin         = '20px 0 50px 0';

    const title = document.createElement('h2');
    title.textContent = 'Play List';
    title.style.fontSize = '25px';
    title.style.margin = '0';

    const btn = document.createElement('button');
    btn.className = 'btnAddPlaylist';
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
      const pid = String(p.id);
      const pname = (p.name || `Playlist ${pid}`).trim();
      PL_NAME.set(pid, pname);

      const li = document.createElement('li');
      li.style.display       = 'flex';
      li.style.alignItems    = 'flex-start';
      li.style.marginBottom  = '20px';
      li.style.position      = 'relative';
      li.style.flexDirection = 'column';

      const nameDiv = document.createElement('div');
      nameDiv.innerHTML = `<strong>${pname}</strong>`;
      nameDiv.style.marginBottom = '8px';
      li.appendChild(nameDiv);

      const mediaContainer = document.createElement('div');
      mediaContainer.style.display    = 'flex';
      mediaContainer.style.alignItems = 'flex-start';

      const img = document.createElement('img');
      img.src   = '/static/inicio_sesion/img_playlist.png';
      img.width = 307;
      img.height = 222;
      img.alt   = 'portada';
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => verSongs(pid, PL_NAME.get(pid)));

      mediaContainer.appendChild(img);

      const buttonsDiv = document.createElement('div');
      buttonsDiv.style.display        = 'flex';
      buttonsDiv.style.flexDirection  = 'column';
      buttonsDiv.style.marginLeft     = '10px';
      buttonsDiv.style.justifyContent = 'flex-start';
      buttonsDiv.style.gap            = '8px';

      const likeBtn = document.createElement('button');
      likeBtn.className   = 'btnRoundPlaylist';
      likeBtn.id          = `like-playlist-btn-${pid}`;
      likeBtn.textContent = p.liked
        ? `Liked (${p.likes_count || 0})`
        : `Like (${p.likes_count || 0})`;
      likeBtn.addEventListener('click', () => likePlaylist(pid));

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Editar';
      editBtn.className   = 'btnRoundPlaylist';

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Eliminar';
      deleteBtn.className   = 'btnRoundPlaylist';
      deleteBtn.addEventListener('click', () => eliminarPlaylist(pid));

      buttonsDiv.appendChild(likeBtn);
      buttonsDiv.appendChild(editBtn);
      buttonsDiv.appendChild(deleteBtn);

      mediaContainer.appendChild(buttonsDiv);
      li.appendChild(mediaContainer);
      content.appendChild(li);

      editBtn.addEventListener('click', () => {
        const rect = editBtn.getBoundingClientRect();
        showAlertNewPlaylist(editBtn, rect, "update", pid);
      });
    });
  }

  // Carga de playlists desde el backend
  fetch(`/playlist/getAllList/?u=${encodeURIComponent(getSessionUsername())}&t=${Date.now()}`, {
    credentials: 'same-origin',
    headers: H_FETCH,
    cache: 'no-store'
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

    const lists = Array.isArray(data) ? data : [];
    lists.forEach(p => {
      const pid = String(p.id);
      const pname = (p.name || `Playlist ${pid}`).trim();
      PL_NAME.set(pid, pname);
    });

    try {
      window.__playlists_cache = lists.slice();
      document.dispatchEvent(new CustomEvent('melodify:playlists:loaded', { detail: { lists } }));
    document.addEventListener('melodify:playlists:loaded', async (ev) => {
  try {
    if ((document.getElementById('main-content')?.dataset?.view || '') === 'home') {
      HOME_SONGS_CACHE = null;
      const allSongs = await fetchAllSongsForHome();
      renderHomeArtists(allSongs, false);
      renderHomeSongs(allSongs, false);
      aplicarMensajePlaylistsHome();
    }
  } catch (e) {
    console.warn('HOME: refresh tras playlists:loaded falló', e);
  }
});

    } catch {}

    renderPlaylists(lists, null);
  })
  .catch(error => {
    console.error('Error al cargar playlists:', error);
    renderPlaylists([], 'Error al cargar playlists.');
  });
}

// ===========================================================================
// Popup inline para crear/renombrar playlist
// ===========================================================================

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
  crearBtn.textContent = (option === 'update') ? 'Guardar' : 'Crear';

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

// ==========================================================================
// Detalle de playlist: ver canciones
// ==========================================================================

function verSongs(playlistId, playlistName) {
  currentViewPlaylist = "allSongsPlayList";
  const pid = String(playlistId);

  let totalSongs = 0;

  fetch(`/playlist/${pid}/songs/`, { credentials: 'same-origin' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      totalSongs = Array.isArray(data?.songs) ? data.songs.length : 0;

      if (!content) { console.error("No existe #content"); return; }

      const songs = Array.isArray(data?.songs) ? data.songs : [];
      const stableName =
        (playlistName && playlistName.trim()) ||
        PL_NAME.get(pid) ||
        (data && (data.name || data.playlist?.name)) ||
        `Playlist ${pid}`;

      PL_NAME.set(pid, stableName);

      try {
        const idsSet = new Set((songs || []).map(s => String(s.id)));
        window.__currentPlaylistContext = { id: pid, name: stableName, songIds: idsSet };
      } catch (e) { console.warn('No se pudo actualizar __currentPlaylistContext:', e); }

      content.innerHTML = '';

      const headerContainer = document.createElement('div');
      headerContainer.style.display        = 'flex';
      headerContainer.style.justifyContent = 'center';
      headerContainer.style.alignItems     = 'center';
      headerContainer.style.gap            = '20px';
      headerContainer.style.margin         = '20px 0 50px 0';

      const title = document.createElement('h2');
      title.textContent    = stableName;
      title.style.fontSize = '25px';
      title.style.margin   = '0';

      const btn = document.createElement('button');
      btn.className   = 'btnAddPlaylist';
      btn.textContent = '♫+';
      btn.addEventListener('click', function () {
        showAlertSongSelector(btn, pid, totalSongs, stableName);
      });

      headerContainer.appendChild(title);
      headerContainer.appendChild(btn);
      content.appendChild(headerContainer);

      if (!songs.length) {
        const p = document.createElement('p');
        p.textContent = 'No hay canciones en esta playlist.';
        content.appendChild(p);

        const main = document.getElementById('main-content');
        if (main) main.dataset.view = 'playlist';
        try { window.MDFCore?.rebindReproductor?.(); } catch {}
        return;
      }

      const pickFirst = (...c) => c.find(v => typeof v === 'string' && v.trim().length) || "";

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
          song.artist_display_name, song.artist, song.author, song.singer
        ) || "—";
        const genre  = pickFirst(song.genre, song.genero, song.gen) || "";

        normSongs.push({ id: idSong ?? null, title, author, coverUrl: cover, audioUrl: audio, genre });

        const esc = s => String(s ?? '').replace(/"/g, '&quot;');

        const liked  = !!song.liked;
        const likesN = song.likes_count ?? song.likes ?? 0;
        const extraClass = liked ? " liked" : "";

        return `
          <li class="song-item"
              data-playlist-name="${esc(stableName)}"
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
              <button class="btnRoundPlaylist js-like-btn${extraClass}"
                      id="like-song-btn-${idSong}"
                      onclick="likeSong(event, ${idSong})">
                ${liked ? `Liked (${likesN})` : `Like (${likesN})`}
              </button>
              <button class="btnRoundPlaylist js-delete-btn"
                      onclick="deleteFromPlaylistSong(
                        event, ${idSong}, ${pid},
                        this.closest('.song-item') && this.closest('.song-item').getAttribute('data-playlist-name')
                      )">
                eliminar
              </button>
            </div>
          </li>`;
      }).filter(Boolean).join("");

      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = `<ul style="list-style:none;padding:0;margin:0">${rowsHTML}</ul>`;
      content.appendChild(tempContainer.firstElementChild);

      const main = document.getElementById('main-content');
      if (main) main.dataset.view = 'playlist';

      try {
        const prev = Array.isArray(window._playlists) ? window._playlists : [];
        const plId = `pl:${pid}`;
        const others = prev.filter(p => String(p.id) !== String(plId) && String(p.id) !== 'my' && String(p.id) !== '1');
        window._playlists = [{ id: plId, name: stableName, songs: normSongs }, ...others];
      } catch (e) {
        console.warn('No se pudo actualizar window._playlists en verSongs:', e);
      }

      try {
        window.MDFCore?.rebindReproductor?.();
        document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow', { bubbles: true, detail: {} }));
      } catch (e) {
        console.warn('No se pudo rebindear el reproductor:', e);
      }
    })
    .catch(error => {
      console.error('Error:', error);
      if (content) content.innerHTML = `<p style="color:red;">Error: ${error.message}</p>`;
    });
}

// ===========================================================================
// Popup para elegir canción y agregarla a la playlist
// ===========================================================================

function showAlertSongSelector(btn, idPlaylist, totalSongs, playlistName) {
  if (document.getElementById('song-selector-popup')) return;

  const rect = btn.getBoundingClientRect();

  const overlay = document.createElement('div');
  overlay.id = 'song-selector-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0'; overlay.style.left = '0';
  overlay.style.width = '100%'; overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.4)';
  overlay.style.zIndex = '998';

  const popup = document.createElement('div');
  popup.id = 'song-selector-popup';
  popup.style.position = 'absolute';
  popup.style.left = rect.right + window.scrollX + 'px';
  popup.style.top  = rect.top   + window.scrollY + 'px';
  popup.style.transform = 'translateY(-50%)';
  popup.style.backgroundColor = '#1a1a1a';
  popup.style.border = '1px solid #333';
  popup.style.borderRadius = '8px';
  popup.style.maxHeight = '900px';
  popup.style.overflowY = 'auto';
  popup.style.zIndex = '999';
  popup.style.minWidth = '280px';
  popup.style.boxShadow = '0 4px 16px rgba(0,0,0,0.5)';
  popup.style.fontFamily = 'sans-serif';

  popup.innerHTML = '<div style="padding:16px; color:#888;">Cargando canciones...</div>';

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  fetch(`/playlist/allsongs/?t=${Date.now()}`, {
    credentials: 'same-origin',
    headers: H_FETCH,
    cache: 'no-store'
  })
  .then(response => response.json())
  .then(songs => {
    if (!Array.isArray(songs) || songs.length === 0) {
      popup.innerHTML = '<div style="padding:16px; color:#888;">No hay canciones disponibles.</div>';
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
    popup.innerHTML = '<div style="padding:16px; color:red;">Error al cargar canciones.</div>';
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

function addSongToPlaylist(idSong, idPlaylist, totalSong, playlistName) {
  const ctx       = window.__currentPlaylistContext;
  const pid       = String(idPlaylist);
  const songIdStr = String(idSong);

  if (ctx && String(ctx.id) === pid && ctx.songIds && ctx.songIds.has(songIdStr)) {
    notifyPlaylistSongAlready(playlistName || ctx.name);
    return;
  }

  const position = (Number(totalSong) || 0) + 1;
  const csrf = getCookie('csrftoken');

  fetch('/playlist/addsong/', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? {'X-CSRFToken': csrf} : {})
    },
    body: JSON.stringify({ song_id: idSong, playlist_id: idPlaylist, position })
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || `Error ${r.status}`); }))
  .then(_data => {
    if (ctx && String(ctx.id) === pid && ctx.songIds) {
      ctx.songIds.add(songIdStr);
    }
    notifyPlaylistSongChange(true, playlistName || ctx?.name || PL_NAME.get(pid));
    verSongs(pid, playlistName || ctx?.name || PL_NAME.get(pid));
  })
  .catch(error => {
    console.error('Error al agregar canción:', error);
    alert('No se pudo agregar la canción:\n' + error.message);
  });
}

function addSongToPlaylistFromSearch(idSong, idPlaylist, playlistName) {
  const pid = String(idPlaylist);
  fetch(`/playlist/${pid}/songs/?t=${Date.now()}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache'
    }
  })
  .then(r => r.json())
  .then(data => {
    const songs = Array.isArray(data?.songs) ? data.songs : [];
    const total = songs.length;

    if (songs.some(s => String(s.id) === String(idSong))) {
      notifyPlaylistSongAlready(playlistName || PL_NAME.get(pid));
      return;
    }
    addSongToPlaylist(idSong, pid, total, playlistName || PL_NAME.get(pid));
  })
  .catch(err => {
    console.error('Error al obtener canciones de la playlist:', err);
    alert('No se pudo agregar la canción a la playlist.');
  });
}

// ===========================================================================
// Selección de playlist (popup) para agregar desde el buscador
// ===========================================================================

function openAddToPlaylistForSong(idSong /* metaOpcional */) {
  if (document.getElementById('playlist-selector-popup')) return;

  const overlay = document.createElement('div');
  overlay.id = 'playlist-selector-overlay';
  Object.assign(overlay.style, {
    position:'fixed', top:'0', left:'0', width:'100%', height:'100%',
    background:'rgba(0,0,0,0.4)', zIndex:'998'
  });

  const popup = document.createElement('div');
  popup.id = 'playlist-selector-popup';
  Object.assign(popup.style, {
    position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    background:'#1a1a1a', border:'1px solid #333', borderRadius:'10px',
    minWidth:'260px', maxWidth:'320px', maxHeight:'70vh', overflowY:'auto',
    padding:'16px', boxShadow:'0 4px 16px rgba(0,0,0,0.5)', zIndex:'999',
    fontFamily:'sans-serif'
  });

  popup.innerHTML = `
    <div style="margin-bottom:10px;"><strong>Agregar a playlist</strong></div>
    <div style="color:#888;">Cargando playlists…</div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  function cerrar() {
    popup.remove();
    overlay.remove();
    document.removeEventListener('click', clickOutside);
  }
  function clickOutside(e) { if (!popup.contains(e.target)) cerrar(); }
  setTimeout(() => document.addEventListener('click', clickOutside), 0);
  overlay.addEventListener('click', cerrar);

  const uname = getSessionUsername();
  const urlPrimary  = `/playlist/getAllList/?u=${encodeURIComponent(uname)}&t=${Date.now()}`;
  const urlFallback = `/playlist/getAllList/?t=${Date.now()}`;

  const renderList = (listsRaw) => {
    const lists = (Array.isArray(listsRaw) ? listsRaw : []).filter(p => /^\d+$/.test(String(p.id)));

    if (!lists.length) {
      popup.innerHTML = '<div style="color:#888;">No tienes playlists creadas.</div>';
      return;
    }

    let html = `
      <div style="margin-bottom:10px;"><strong>Agregar a playlist</strong></div>
      <div style="font-size:12px;color:#aaa;margin-bottom:8px;">Elige una playlist:</div>
    `;
    lists.forEach(p => {
      const pid = String(p.id);
      const pname = (p.name || `Playlist ${pid}`).trim();
      PL_NAME.set(pid, pname);
      html += `
        <div class="playlist-item-selector"
             data-id="${pid}"
             data-name="${(pname || '').replace(/"/g, '&quot;')}"
             style="padding:8px 10px;border-radius:6px;border:1px solid #2a2a2a;margin-bottom:6px;cursor:pointer;">
          ${pname}
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
  };

  fetch(urlPrimary, { credentials: 'same-origin', headers: H_FETCH, cache: 'no-store' })
    .then(async r => {
      let data = null;
      try { data = await r.json(); } catch {}
      if (r.ok && Array.isArray(data) && data.length) {
        renderList(data);
        return;
      }
      return fetch(urlFallback, { credentials: 'same-origin', headers: H_FETCH, cache: 'no-store' })
        .then(rr => rr.json())
        .then(data2 => renderList(data2))
        .catch(e2 => {
          console.error('Fallback getAllList failed:', e2);
          popup.innerHTML = '<div style="color:red;">Error al cargar playlists.</div>';
        });
    })
    .catch(err => {
      console.error('Error getAllList:', err);
      popup.innerHTML = '<div style="color:red;">Error al cargar playlists.</div>';
    });
}

// ===========================================================================
// Likes de canciones dentro de la playlist
// ===========================================================================

async function likeSong(ev, idSong) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }

  const csrf = getCookie('csrftoken');
  const btn = document.getElementById(`like-song-btn-${idSong}`);
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch(`/api/like/song/${idSong}/`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-CSRFToken': csrf || '',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    let data = null;
    try { data = await resp.json(); } catch {}

    if (resp.ok && data) {
      const liked = !!data.liked;
      if (btn) {
        btn.textContent = liked ? `Liked (${data.total})` : `Like (${data.total})`;
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
      throw new Error((data && data.error) || `HTTP ${resp.status}`);
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

function deleteFromPlaylistSong(ev, idSong, playlistId, playlistName) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }

  if (!confirm('¿Quitar esta canción de la playlist?')) return;

  const csrf = getCookie('csrftoken');

  fetch('/playlist/removeSong/', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? {'X-CSRFToken': csrf} : {})
    },
    body: JSON.stringify({ playlist_id: playlistId, song_id: idSong })
  })
  .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || `Error ${r.status}`); }))
  .then(_ => {
    notifyPlaylistSongChange(false, playlistName || PL_NAME.get(String(playlistId)) || window.__currentPlaylistContext?.name);
    verSongs(String(playlistId), playlistName || PL_NAME.get(String(playlistId)) || window.__currentPlaylistContext?.name);
  })
  .catch(error => {
    console.error('Error al eliminar:', error);
    alert('Error: ' + error.message);
  });
}

/* =========================================================================
   Puntos de entrada globales para uso desde Home/Buscador/Muro/Reproductor
   ========================================================================= */
window.initPlayList                = initPlayList;
window.openAddToPlaylistForSong    = openAddToPlaylistForSong;
window.addSongToPlaylistFromSearch = addSongToPlaylistFromSearch;
window.addSongToPlaylist           = addSongToPlaylist;
window.verSongs                    = verSongs;
window.showPlaylists               = showPlaylists;

// Puentes defensivos para exponer funciones en window
(() => {
  const g = window;
  try { if (!g.openAddToPlaylistForSong && typeof openAddToPlaylistForSong === 'function') g.openAddToPlaylistForSong = openAddToPlaylistForSong; } catch {}
  try { if (!g.addSongToPlaylistFromSearch && typeof addSongToPlaylistFromSearch === 'function') g.addSongToPlaylistFromSearch = addSongToPlaylistFromSearch; } catch {}
  try { if (!g.addSongToPlaylist && typeof addSongToPlaylist === 'function') g.addSongToPlaylist = addSongToPlaylist; } catch {}
})();

// Integración con MDFCore para abrir el diálogo de selección de playlist
window.MDFCore = window.MDFCore || {};
if (!window.MDFCore.openAddToPlaylistDialog) {
  window.MDFCore.openAddToPlaylistDialog = function (_ev, idSong) {
    if (typeof window.openAddToPlaylistForSong === 'function') {
      window.openAddToPlaylistForSong(idSong);
    }
  };
}
