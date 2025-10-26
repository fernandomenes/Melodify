// se mete dentro de esta funcion para  asegurar que el JavaScript se ejecute solo después de que todo el HTML esté listo.
document.addEventListener('DOMContentLoaded', function () {

    const menuLateral = document.getElementById('menuLateral');
    const mainContent = document.getElementById('main-content');
    const header = document.getElementById('header');
    const contentDiv = document.getElementById('content');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    //Menu flotante de usuario
    const userTrigger = document.getElementById('user-trigger');
    const userMenu = document.getElementById('user-menu');


    let USERNAME = "";


    //btn flotante que muestra el menu lateral--------------------------------------------------------------------------
    menuToggleBtn.addEventListener('click', clickMenuToggleBtn);
    document.getElementById('toggle-menu').addEventListener('click', clickMenuToggleBtn);

    //-------------------menu flotante de usuario-----------------------------------------------------------------------
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

    //Acciones del menú flotante ---------------------------------------------------------------------------------------
    document.getElementById('menu-perfil').addEventListener('click', (e) => {
        e.preventDefault();
        // Ir a la vista de perfil
        document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
        document.querySelector('.menu-item[data-view="perfil"]').classList.add('active');

        const html = '<h2>PERFIL </h2><p>ir a html de perfil.</p>'
        contentDiv.innerHTML = html

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
    //------------------------------------------------------------------------------------------------------------------


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


            if (view === 'home') {

                const html = '<h2>HOME Bienvenido a Melodify</h2><p>Selecciona una opción del menú para comenzarrrr.</p>'
                contentDiv.innerHTML = html

            }else if (view === 'playlist') {

                const html = '<h2>PLAYLIST </h2><p>ir a html de playList.</p>'
                contentDiv.innerHTML = html

            } else if (view === 'gestion') {

                const html = '<h2>GESTION </h2><p>ir a html de gestion.</p>'
                contentDiv.innerHTML = html

            } else if (view === 'perfil') {

                const html = '<h2>PERFIL </h2><p>ir a html de perfil.</p>'
                contentDiv.innerHTML = html


            }
        });
    });



    function inicializarApp() {

        USERNAME = "Carlos";
        document.getElementById('username').textContent = USERNAME;

    }

    inicializarApp();//con esto simpre ejecutara esta funcion al inciar home despues de loguearse


});
