

let currentViewPlaylist  = "allPlayList";
let content = null;


function initPlayList(){
    content = document.getElementById('content');
    showPlaylists();
}


function clickBackBtnPlaylist(){

    if(currentViewPlaylist  === "allSongsPlayList"){
        showPlaylists();

    }

}


function crearPlaylist(){

}


function likePlaylist(id) {
    console.log('Like en playlist:', id);
}

function editarPlaylist(id) {
    console.log('Editar playlist:', id);
}


function eliminarPlaylist(id) {
    console.log('Eliminar playlist:', id);
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
            title.style.fontSize = '40px';
            title.style.margin = '0'; // resetear márgenes por defecto de <h2>

            // Crear el botón
            const btn = document.createElement('button');
            btn.className = 'btnAddPlaylist';
            btn.textContent = '+';
            btn.addEventListener('click', function () {
                const rect = btn.getBoundingClientRect();
                showAlertNewPlaylist(rect);
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
                img.addEventListener('click', () => verSongs(p.id,p.name));

                mediaContainer.appendChild(img);

                // Contenedor de botones (alineados verticalmente)
                const buttonsDiv = document.createElement('div');
                buttonsDiv.style.display = 'flex';
                buttonsDiv.style.flexDirection = 'column';
                buttonsDiv.style.marginLeft = '10px';
                buttonsDiv.style.justifyContent = 'flex-start';
                buttonsDiv.style.gap = '8px';

                const likeBtn = document.createElement('button');
                likeBtn.textContent = 'Like';
                likeBtn.className = 'btnRoundPlaylist';
                likeBtn.addEventListener('click', () => likePlaylist(p.id));

                const editBtn = document.createElement('button');
                editBtn.textContent = 'Editar';
                editBtn.className = 'btnRoundPlaylist';
                editBtn.addEventListener('click', () => editarPlaylist(p.id));

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
            });
        })
        .catch(err => console.error('Error al cargar playlists:', err));
}


function showAlertNewPlaylist(rectPosition){
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
            crearPlaylist(name);
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


function verSongs(playlistId,namePlaylist) {
  currentViewPlaylist = "allSongsPlayList";

  console.log("[Playlist] fetch ->", `/playlist/${playlistId}/songs/`);

  fetch(`/playlist/${playlistId}/songs/`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      console.log("[Playlist] payload:", data);

      if (!content) {
        console.error("No existe #content");
        return;
      }

      const songs = Array.isArray(data?.songs) ? data.songs : [];
      if (!songs.length) {
        content.innerHTML = '<p>No hay canciones en esta playlist.</p>';
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
              <button class="btnRoundPlaylist" onclick="likeSong(${song.id})">like</button>
              <button class="btnRoundPlaylist" onclick="deleteFromPlaylistSong(${song.id})">eliminar</button>
            </div>
            
            
            
          </li>`;
      }).filter(Boolean).join("");





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
        title.textContent = namePlaylist;
        title.style.fontSize = '40px';
        title.style.margin = '0'; // resetear márgenes por defecto de <h2>
        // Crear el botón
        const btn = document.createElement('button');
        btn.className = 'btnAddPlaylist';
        btn.textContent = '♫+';
        btn.addEventListener('click', function () {
            const rect = btn.getBoundingClientRect();
            addSongToPlaylist(2)
        });


        // Añadir título y botón al contenedor
        headerContainer.appendChild(title);
        headerContainer.appendChild(btn);
        content.appendChild(headerContainer);


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





function addSongToPlaylist(idSong){

    console.log('idSond to add playlist', idSong);

}


function likeSong(idSong){

    console.log('like', idSong);
}


function deleteFromPlaylistSong(idSong){

    console.log('delete', idSong);

}