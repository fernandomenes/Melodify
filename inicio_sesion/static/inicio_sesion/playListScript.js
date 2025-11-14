

let currentViewPlaylist  = "allPlayList";//vistas dentro de playlist solo hay 2 (allPlayList,"allSongsPlayList")
let content = null;//se usa para insertar el contenido dentro de div content en home.html
let USERNAME = null
let titleAllSongsPlayList = ""


function initPlayList(username){
    USERNAME = username
    content = document.getElementById('content');
    showPlaylists();
}


function clickBackBtnPlaylist(){

    if(currentViewPlaylist  === "allSongsPlayList"){
        showPlaylists();

    }
}


function crearPlaylist(namePlaylist){

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
                // Intentar leer el cuerpo del error
                return response.json().then(err => {
                    throw new Error(err.error || `HTTP ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log('Playlist creada:', data);
            showPlaylists(); // recargar lista
        })
        .catch(error => {
            console.error('Error al crear playlist:', error);
            alert('No se pudo crear la playlist:\n' + error.message);
        });

}


// Helper para leer cookie CSRF
function getCookie(name) {
    const v = document.cookie.split('; ').find(row => row.startsWith(name + '='));
    return v ? decodeURIComponent(v.split('=')[1]) : null;
}

async function likePlaylist(id) {
    console.log('Like en playlist:', id);
    const csrf = getCookie('csrftoken');

    // Evitar doble click mientras se procesa
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

        // Intentar parsear JSON de forma segura
        let data = null;
        try {
            data = await resp.json();
        } catch (err) {
            console.error('Respuesta no JSON:', err);
        }

        if (resp.ok && data) {
            // Actualiza texto y clase visual
            if (btn) {
                btn.textContent = data.liked ? `Liked (${data.total})` : `Like (${data.total})`;
                btn.classList.toggle('liked', !!data.liked);
            }
        } else if (resp.status === 401 || (data && data.error === 'login_required')) {
            // No autenticado: ir a login
            window.location.href = '/login/';
        } else {
            console.warn('Error likePlaylist', resp.status, data);
            alert('No se pudo procesar el like. Revisa la consola para más info.');
        }
    } catch (e) {
        console.error('Error likePlaylist:', e);
        alert('Error de red al intentar dar like.');
    } finally {
        // Rehabilitar botón
        if (btn) btn.disabled = false;
    }
}

function editarPlaylist(id,newname) {
    console.log('Editar playlist:', id);
    fetch(`/playlist/${id}/update/`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
            name: newname
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
            console.log('Éxito:', data.message);
            // Opcional: recargar la lista o actualizar en el DOM
            showPlaylists(); // tu función existente
        })
        .catch(error => {
            console.error('Error al actualizar:', error);
            alert('Error: ' + error.message);
        });
}


function eliminarPlaylist(playlistId) {

    if (!confirm('¿Seguro que deseas eliminar esta playlist?')) {
        return;
    }

    fetch(`/playlist/${playlistId}/delete/`, {
        method: 'DELETE',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            // No necesitas Content-Type para DELETE sin body
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
            console.log('Éxito:', data.message);
            // Opcional: recargar la lista de playlists
            showPlaylists(); // tu función existente
        })
        .catch(error => {
            console.error('Error al eliminar:', error);
            alert('Error: ' + error.message);
        });

}

// Función principal que muestra las playlists
function showPlaylists() {
    currentViewPlaylist  = "allPlayList";
    fetch('/playlist/getAllList')
        .then(r => r.json())
        .then(data => {
            if (data.length === 0) {
                content.innerHTML = '<li>No hay playlists.</li>';
                return;
            }
            content.innerHTML = '';

            // Crear contenedor flexible
            const headerContainer = document.createElement('div');
            headerContainer.style.display = 'flex';
            headerContainer.style.justifyContent = 'center'; // centrado horizontal
            headerContainer.style.alignItems = 'center';     // centrado vertical
            headerContainer.style.gap = '20px';              // espacio entre título y botón
            headerContainer.style.margin = '20px 0 50px 0';  // margen superior e inferior

            // Crear el título
            const title = document.createElement('h2');
            title.textContent = 'Play List';
            title.style.fontSize = '25px';
            title.style.margin = '0'; // resetear márgenes por defecto de <h2>

            // Crear el botón
            const btn = document.createElement('button');
            btn.className = 'btnAddPlaylist';
            btn.textContent = '+';
            btn.addEventListener('click', function () {
                const rect = btn.getBoundingClientRect();
                showAlertNewPlaylist(btn,rect,"new",null);
            });

            // Añadir título y botón al contenedor
            headerContainer.appendChild(title);
            headerContainer.appendChild(btn);
            content.appendChild(headerContainer);

            data.forEach(p => {
                const li = document.createElement('li');
                li.style.display = 'flex';
                li.style.alignItems = 'flex-start';
                li.style.marginBottom = '20px';
                li.style.position = 'relative';
                li.style.flexDirection = 'column';

                // Nombre de la playlist (encima de todo)
                const nameDiv = document.createElement('div');
                nameDiv.innerHTML = `<strong>${p.name}</strong>`;
                nameDiv.style.marginBottom = '8px';
                li.appendChild(nameDiv);

                // Contenedor para imagen + botones
                const mediaContainer = document.createElement('div');
                mediaContainer.style.display = 'flex';
                mediaContainer.style.alignItems = 'flex-start';

                // Imagen clickeable
                const img = document.createElement('img');
                img.src = '/static/inicio_sesion/img_playlist.png';
                img.width = 307;
                img.height = 222;
                img.alt = 'portada';
                img.style.cursor = 'pointer';
                titleAllSongsPlayList=p.name
                img.addEventListener('click', () => verSongs(p.id));

                mediaContainer.appendChild(img);

                // Contenedor de botones (alineados verticalmente)
                const buttonsDiv = document.createElement('div');
                buttonsDiv.style.display = 'flex';
                buttonsDiv.style.flexDirection = 'column';
                buttonsDiv.style.marginLeft = '10px';
                buttonsDiv.style.justifyContent = 'flex-start';
                buttonsDiv.style.gap = '8px';

                const likeBtn = document.createElement('button');
                likeBtn.textContent = `Like (${p.likes_count || 0})`;
                likeBtn.className = 'btnRoundPlaylist';
                likeBtn.id = `like-playlist-btn-${p.id}`; // <- id único
                likeBtn.addEventListener('click', () => likePlaylist(p.id));

                // (inicializa texto según estado del backend)
                if (p.liked) {
                    likeBtn.textContent = `Liked (${p.likes_count || 0})`;
                } else {
                    likeBtn.textContent = `Like (${p.likes_count || 0})`;
                }

                const editBtn = document.createElement('button');
                editBtn.textContent = 'Editar';
                editBtn.className = 'btnRoundPlaylist';

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Eliminar';
                deleteBtn.className = 'btnRoundPlaylist';
                deleteBtn.addEventListener('click', () => eliminarPlaylist(p.id));

                buttonsDiv.appendChild(likeBtn);
                buttonsDiv.appendChild(editBtn);
                buttonsDiv.appendChild(deleteBtn);

                mediaContainer.appendChild(buttonsDiv);
                li.appendChild(mediaContainer);
                content.appendChild(li);

                const rect = editBtn.getBoundingClientRect();
                editBtn.addEventListener('click', () => showAlertNewPlaylist(editBtn,rect,"update",p.id)

                );
            });
        })
        .catch(err => console.error('Error al cargar playlists:', err));
}


function showAlertNewPlaylist(btn,rectPosition,option,idPlaylist){
    const formContainer = document.createElement('div');
    formContainer.className = 'playlist-form';
    formContainer.style.left = rectPosition.right + window.scrollX + 'px';
    formContainer.style.top = rectPosition.top + window.scrollY + 'px';
    formContainer.style.transform = 'translateY(-50%)';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Nombre de la playlist';

    const buttons = document.createElement('div');
    buttons.className = 'form-buttons';

    const crearBtn = document.createElement('button');
    crearBtn.className = 'btn-create';
    crearBtn.textContent = 'Crear';

    const cancelarBtn = document.createElement('button');
    cancelarBtn.className = 'btn-cancel';
    cancelarBtn.textContent = 'Cancelar';

    // Evento "Crear"
    crearBtn.addEventListener('click', () => {
        const name = input.value.trim();
        if (name) {
            if(option==="new")crearPlaylist(name);
            else if(option==="update")editarPlaylist(idPlaylist,name);
            document.body.removeChild(formContainer);
        } else {
            input.focus();
        }
    });

    // Evento "Cancelar"
    cancelarBtn.addEventListener('click', () => {
        document.body.removeChild(formContainer);
    });

    // Cerrar con Enter
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') crearBtn.click();
    });

    // Armar el formulario
    buttons.appendChild(cancelarBtn);
    buttons.appendChild(crearBtn);
    formContainer.appendChild(input);
    formContainer.appendChild(buttons);
    document.body.appendChild(formContainer);
    input.focus();

    // Cerrar al hacer clic fuera
    const closeOnClickOutside = (e) => {
        if (!formContainer.contains(e.target) && e.target !== btn) {
            document.body.removeChild(formContainer);
            document.removeEventListener('click', closeOnClickOutside);
        }
    };
    setTimeout(() => document.addEventListener('click', closeOnClickOutside), 0);

}


function verSongs(playlistId) {
  currentViewPlaylist = "allSongsPlayList";

  console.log("[Playlist] fetch ->", `/playlist/${playlistId}/songs/`);

  let totalSongs=0;

  fetch(`/playlist/${playlistId}/songs/`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {

      totalSongs = data.songs.length;

      if (!content) {
        console.error("No existe #content");
        return;
      }

      const songs = Array.isArray(data?.songs) ? data.songs : [];


        content.innerHTML = '';
        // Crear contenedor flexible
        const headerContainer = document.createElement('div');
        headerContainer.style.display = 'flex';
        headerContainer.style.justifyContent = 'center'; // centrado horizontal
        headerContainer.style.alignItems = 'center';     // centrado vertical
        headerContainer.style.gap = '20px';              // espacio entre título y botón
        headerContainer.style.margin = '20px 0 50px 0';  // margen superior e inferior
        // Crear el título
        const title = document.createElement('h2');
        title.textContent = titleAllSongsPlayList;
        title.style.fontSize = '25px';
        title.style.margin = '0'; // resetear márgenes por defecto de <h2>
        // Crear el botón
        const btn = document.createElement('button');
        btn.className = 'btnAddPlaylist';
        btn.textContent = '♫+';
        btn.addEventListener('click', function () {
            showAlertSongSelector(btn,playlistId,totalSongs);
        });

        // Añadir título y botón al contenedor
        headerContainer.appendChild(title);
        headerContainer.appendChild(btn);
        content.appendChild(headerContainer);



      if (!songs.length) {

        let musHTML = '<p>No hay canciones en esta playlist.</p>';
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = musHTML;
        const ulElement = tempContainer.firstElementChild;
        content.appendChild(ulElement);



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

        const cover  = pickFirst(
          song.coverUrl, song.cover_url, song.cover, song.thumbnail, song.thumb,
          song?.cover?.url, song?.image?.url, song?.media?.cover
        ) || "/static/inicio_sesion/img_song.png";

        const idSond = song.id
        const title  = pickFirst(song.title, song.name) || "—";
        const author = pickFirst(song.artist_display_name, song.artist, song.author, song.singer) || "—";
        const genre  = pickFirst(song.genre, song.genero, song.gen) || "";

        normSongs.push({ title, author, coverUrl: cover, audioUrl: audio, genre });

        return `
          <li class="song-item"
              data-audio-url="${audio}"
              data-title="${title.replace(/"/g,'&quot;')}"
              data-author="${author.replace(/"/g,'&quot;')}"
              ${genre ? `data-genre="${genre.replace(/"/g,'&quot;')}"` : ""}
              ${cover ? `data-cover-url="${cover.replace(/"/g,'&quot;')}"` : ""}>
            <img class="song-cover" src="${cover}" alt="${title.replace(/"/g,'&quot;')}"
                 style="width:56px;height:56px;border-radius:10px;object-fit:cover;">
            <div class="song-info">
              <div class="song-title"><strong>${title}</strong></div>
              <div class="song-author"><small style="color:#b3b3b3">${author}</small></div>
              <br>
            ${(() => {
                const liked = song.liked ? true : false;
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


        let musHTML = `<ul style="list-style:none;padding:0;margin:0">${rowsHTML}</ul>`;
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = musHTML;
        const ulElement = tempContainer.firstElementChild;
        content.appendChild(ulElement);


        const main = document.getElementById('main-content');
      if (main) main.dataset.view = 'playlist';

      try {
        const prev = Array.isArray(window._playlists) ? window._playlists : [];
        const plId = `pl:${playlistId}`;
        const plName = (data && (data.name || data.playlist?.name)) || `Playlist ${playlistId}`;
        const others = prev.filter(p => String(p.id) !== String(plId) && String(p.id) !== 'my' && String(p.id) !== '1');
        window._playlists = [{ id: plId, name: plName, songs: normSongs }, ...others];
      } catch {}

      // Rebind para que los <li.song-item> hagan play
      try {
        window.MDFCore?.rebindReproductor?.();
        document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow', { bubbles:true, detail:{} }));
      } catch (e) { console.warn('No pude rebindear el reproductor:', e); }
    })
    .catch(error => {
      console.error('Error:', error);
      const content = document.getElementById('content');
      if (content) content.innerHTML = `<p style="color:red;">Error: ${error.message}</p>`;
    });
}



function showAlertSongSelector(btn,idPlaylist,totalSongs){

    console.log('idSond to add playlist', idPlaylist);

    // Evitar múltiples popups
    if (document.getElementById('song-selector-popup')) {
        return;
    }

    const rect = btn.getBoundingClientRect();

    // Crear overlay oscuro (opcional, pero mejora UX)
    const overlay = document.createElement('div');
    overlay.id = 'song-selector-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.4)';
    overlay.style.zIndex = '998';

    // Crear popup
    const popup = document.createElement('div');
    popup.id = 'song-selector-popup';
    popup.style.position = 'absolute';
    popup.style.left = rect.right + window.scrollX + 'px';
    popup.style.top = rect.top + window.scrollY + 'px';
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

    // Mostrar mensaje de carga
    popup.innerHTML = '<div style="padding:16px; color:#888;">Cargando canciones...</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // Cargar canciones
    fetch('/playlist/allsongs')
        .then(response => response.json())
        .then(songs => {
            if (songs.length === 0) {
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
                    </div>
                `;
            });
            popup.innerHTML = html;

            // Añadir eventos a cada canción
            popup.querySelectorAll('.song-item-selector').forEach(item => {
                item.addEventListener('click', function () {
                    const idSong = this.dataset.id;
                    addSongToPlaylist(idSong,idPlaylist,totalSongs);
                    // Cerrar popup
                    document.body.removeChild(popup);
                    document.body.removeChild(overlay);
                });
            });
        })
        .catch(error => {
            console.error('Error al cargar canciones:', error);
            popup.innerHTML = '<div style="padding:16px; color:red;">Error al cargar canciones.</div>';
        });

    // Cerrar al hacer clic fuera
    const closePopup = (e) => {
        if (!popup.contains(e.target) && e.target !== btn) {
            document.body.removeChild(popup);
            document.body.removeChild(overlay);
            document.removeEventListener('click', closePopup);
        }
    };
    setTimeout(() => document.addEventListener('click', closePopup), 0);

}



function addSongToPlaylist(idSong,idPlaylist,totalSong) {
    console.log('Agregando canción con ID:'+idSong+ '    totalSongs:'+totalSong);

    const position = totalSong + 1;

    fetch('/playlist/addsong/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
            song_id: idSong,
            playlist_id: idPlaylist,
            position: position
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
            // Opcional: recargar la playlist actual
            verSongs(idPlaylist); // tu función existente
        })
        .catch(error => {
            console.error('Error al agregar canción:', error);
            alert('No se pudo agregar la canción:\n' + error.message);
        });

}

async function likeSong(ev, idSong) {
    // Muy importante: detener el click para que NO suba al <li class="song-item">
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
            if (btn) {
                btn.textContent = data.liked
                    ? `Liked (${data.total})`
                    : `Like (${data.total})`;

                btn.classList.toggle("liked", !!data.liked);
            }
        }
        else if (resp.status === 401 || (data && data.error === "login_required")) {
            window.location.href = "/login/";
        }
        else {
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

function deleteFromPlaylistSong(ev, idSong, playlistId){
    // Igual: que no dispare el play/pause del reproductor
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
            song_id: idSong
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
            console.log('Éxito:', data.message);
            // Recargar la playlist actual
            verSongs(playlistId);
        })
        .catch(error => {
            console.error('Error al eliminar:', error);
            alert('Error: ' + error.message);
        });
}

    fetch('/playlist/removeSong/', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
            playlist_id: playlistId,
            song_id: idSong
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
            console.log('Éxito:', data.message);
            // Recargar la playlist actual
            verSongs(playlistId);
        })
        .catch(error => {
            console.error('Error al eliminar:', error);
            alert('Error: ' + error.message);
        });

