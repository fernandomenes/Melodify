

let currentViewPlaylist  = "allPlayList";

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
            const content = document.getElementById('content');
            if (data.length === 0) {
                content.innerHTML = '<li>No hay playlists.</li>';
                return;
            }
            content.innerHTML = ''; // Limpiar contenido previo

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




// Funciones auxiliares (puedes implementar lógica adicional después)
function verSongs(playlistId) {
    currentViewPlaylist  = "allSongsPlayList";
    fetch(`/playlist/${playlistId}/songs/`)  // ← ¡Agrega /api/!
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const content = document.getElementById('content');
            content.innerHTML = '';

            if (!data.songs || data.songs.length === 0) {
                content.innerHTML = '<p>No hay canciones en esta playlist.</p>';
                return;
            }

            const ul = document.createElement('ul');
            ul.style.listStyle = 'none';
            ul.style.padding = '0';

            data.songs.forEach(song => {
                const li = document.createElement('li');
                li.className = 'songItem';
                li.dataset.songId = song.id;

                const img = document.createElement('img');
                img.src = '/static/inicio_sesion/img_song.png';
                img.alt = song.title;
                img.style.width = '50px';
                img.style.height = '50px';
                img.style.borderRadius = '6px';
                img.style.marginRight = '15px';

                const info = document.createElement('div');
                info.innerHTML = `<strong>${song.title}</strong><br><small style="color:#555;">${song.artist_display_name}</small>`;

                li.appendChild(img);
                li.appendChild(info);
                ul.appendChild(li);
            });

            content.appendChild(ul);

            document.getElementById('content').addEventListener('click', function (e) {
                const songItem = e.target.closest('.songItem');
                if (!songItem) return;
                const songId = songItem.dataset.songId;
                if (!songId) return;
                this.querySelectorAll('.songItem.selected').forEach(el => {
                    el.classList.remove('selected');
                });
                songItem.classList.add('selected');
                playSong(songId);
            });

        })
        .catch(error => {
            console.error('Error:', error);
            document.getElementById('content').innerHTML = `<p style="color:red;">Error: ${error.message}</p>`;
        });
}





function playSong(id){
    console.log('Reproduciendo canción con ID:', id);


}


function likeSong(){


}