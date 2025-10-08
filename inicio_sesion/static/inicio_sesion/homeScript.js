// se mete dentro de esta funcion para  asegurar que el JavaScript se ejecute solo después de que todo el HTML esté listo.
document.addEventListener('DOMContentLoaded', function () {

    const menuLateral = document.getElementById('menuLateral');
    const mainContent = document.getElementById('main-content');
    const header = document.getElementById('header');
    const contentDiv = document.getElementById('content');
    const backBtn = document.getElementById('back-btn');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    //Menu flotante de usuario
    const userTrigger = document.getElementById('user-trigger');
    const userMenu = document.getElementById('user-menu');
    // Datos simulados debran obtenerse de la BD
    const playlists = [
        { id: 1, name: "Rock Clásico", songs: ["Bohemian Rhapsody", "Stairway to Heaven", "Hotel California"] },
        { id: 2, name: "Electronica", songs: ["Chill Beats", "Rain Sounds", "Focus Flow"] },
        { id: 3, name: "Pop", songs: ["Blinding Lights", "Flowers", "As It Was"] }
    ];
    let USERNAME = "";
    let historyStack = [];
    let currentView = null;





    //btn back
    backBtn.addEventListener('click', goBack);
    //btn flotante que muestra el menu lateral------------------------------------------------------------
    menuToggleBtn.addEventListener('click', clickMenuToggleBtn);
    document.getElementById('toggle-menu').addEventListener('click', clickMenuToggleBtn);

    //-------------------menu flotante de usuario---------------------------------------------------------
    //Mostrar/ocultar
    userTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu.classList.toggle('show');
    });
    //Cerrar menú al hacer clic fuera
    document.addEventListener('click', () => {
        userMenu.classList.remove('show');});
    //Evitar que el clic dentro del menú lo cierre
    userMenu.addEventListener('click', (e) => {
        e.stopPropagation();});

    //Acciones del menú
    document.getElementById('menu-perfil').addEventListener('click', (e) => {
        e.preventDefault();
        // Ir a la vista de perfil
        document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
        document.querySelector('.menu-item[data-view="perfil"]').classList.add('active');
        //denderizar perfil
        renderMenuPerfil();
        backBtn.style.display = 'none';
        userMenu.classList.remove('show');
    });

    document.getElementById('menu-logout').addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('¿Seguro que deseas cerrar sesión?')) {
            // Aquí redirigira a vista de logout
           // window.location.href = '/logout/';
        }
        userMenu.classList.remove('show');
    });



    function updateBackButton() {
        backBtn.style.display = historyStack.length > 1 ? 'inline-block' : 'none';
    }

    function goBack() {
        if (historyStack.length > 1) {
            historyStack.pop();
            const prev = historyStack[historyStack.length - 1];
            currentView = prev.view;
            showContent(prev.content);
            updateBackButton();
        }
        //attachPlaylistListeners()
    }

    function clickMenuToggleBtn() {
        menuLateral.classList.toggle('collapsed');
        mainContent.classList.toggle('menuLateral-collapsed');
        header.classList.toggle('menuLateral-collapsed');
    }


    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');

            const view = item.getAttribute('data-view');
            currentView = view;
            historyStack = [];
            updateBackButton();

            if (view === 'home') {

                renderMenuHome();

            }else if (view === 'playlist') {

                renderMenuPlaylists();

            } else if (view === 'gestion') {

               renderMenuGestion();

            } else if (view === 'perfil') {

                renderMenuPerfil()

            }
        });
    });

    function renderMenuHome() {
        const html = '<h2>HOME Bienvenido a Melodify</h2><p>Selecciona una opción del menú para comenzar.</p>'
        pushHistory(html);
        showContent(html);
    }

    function renderMenuGestion() {
        const html = '<h2>Gestión</h2><p>Panel de administración de usuarios, música, etc.</p>';
        pushHistory(html);
        showContent(html);
    }

    function renderMenuPlaylists() {
        let html = '<h2>PlayLists</h2><ul class="item-list">';
        playlists.forEach(pl => {
            html += `<li data-playlist-id="${pl.id}">${pl.name}</li>`;
        });
        html += '</ul>';
        pushHistory(html);
        showContent(html);
        attachPlaylistListeners();

    }

    function renderMenuPerfil() {
        const html = `<h2>Perfil</h2><p>Nombre: ${USERNAME}<br>Email: user@example.com</p>`;
        pushHistory(html);
        showContent(html);
    }

    function showContent(html) {
        contentDiv.innerHTML = html;

    }

    function pushHistory(html) {
        historyStack.push({ view: currentView, content: html });
        backBtn.style.display = historyStack.length > 1 ? 'inline-block' : 'none';
    }


    //función para  asignar eventos a las playlists
    function attachPlaylistListeners() {
        document.querySelectorAll('[data-playlist-id]').forEach(item => {
            item.removeEventListener('click', handlePlaylistClick);
            item.addEventListener('click', handlePlaylistClick);
        });
    }

    //función para manejar los click sobre las playlist
    function handlePlaylistClick() {
        const id = parseInt(this.getAttribute('data-playlist-id'));
        showPlaylist(id);
    }

    function showPlaylist(id) {
        const pl = playlists.find(p => p.id === id);
        if (!pl) return;
        let html = `
        <h2 class="playlist-title">${pl.name}</h2>
        <div class="item-list">
            ${pl.songs.map(song => `<div class="song-item">${song}</div>`).join('')}
        </div>`;
        pushHistory(html);
        showContent(html);
    }


    function inicializarApp() {
        USERNAME = "Carlos";
        document.getElementById('username').textContent = USERNAME;
        renderMenuHome();
    }

    inicializarApp();//con esto simpre ejecutara esta funcion al inciar home despues de loguearse
});
