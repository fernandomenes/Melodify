// static/inicio_sesion/homeScript.js

document.addEventListener('DOMContentLoaded', async () => {
const RP = await import('/static/reproductor/reproductor.js?v=1');

  // ====== Nodos base y dataset ======
  const menuLateral   = document.getElementById('menuLateral');
  const mainContent   = document.getElementById('main-content');
  const header        = document.getElementById('header');
  const contentDiv    = document.getElementById('content');
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const toggleLogo    = document.getElementById('toggle-menu');
  if (!mainContent || !contentDiv) return;

  // Datos inyectados por plantilla
  let ROLE = (mainContent.dataset.role || '').toLowerCase();
  if (!ROLE) {
    const h1 = document.querySelector('.page h1')?.textContent?.toLowerCase() || '';
    if (h1.includes('gestión')) ROLE = 'administrador';
  }

  let   USERNAME    = (mainContent.dataset.username || '').trim();
  const AVATAR      = (mainContent.dataset.avatar || '').trim();
  const DESCRIPTION = (mainContent.dataset.description || '').trim();
  const CREATED_AT  = (mainContent.dataset.createdAt || '').trim();

  const URL_MI_MURO        = mainContent.dataset.urlMiMuro        || '/mi-muro/';
  const URL_MUSICA         = mainContent.dataset.urlMusica        || '/musica/';
  const URL_GESTION        = mainContent.dataset.urlGestion       || '/gestion/';
  const URL_HOME           = mainContent.dataset.urlHome          || '/home/';
  const URL_MI_MUSICA_JSON = mainContent.dataset.urlMiMusicaJson  || '/mi-musica/json/';

  const urlParams    = new URLSearchParams(location.search);
  const hashView     = (location.hash || '').replace(/^#/, '');
  const INITIAL_VIEW = (urlParams.get('view') || hashView || mainContent.dataset.initialView || '').trim();

  // ====== Estado SPA ======
  let historyStack = [];
  let currentView  = null;

  // ====== Playlists iniciales (JSON embebido) ======
  let playlists = [];
  try {
    const jsonEl = document.getElementById('playlists-data-json');
    playlists = JSON.parse(jsonEl?.textContent || '[]');
  } catch {}
  if (ROLE === 'artista' && (!Array.isArray(playlists) || playlists.length === 0)) {
    playlists = [{ id: 1, name: 'Mi música', songs: [] }];
  }
  window._playlists = playlists;

  // ====== Utils de la SPA ======
  function showContent(html){ contentDiv.innerHTML = html; decorateDangerButtons(contentDiv); }
  function pushHistory(html){ historyStack.push({ view: currentView, content: html }); }
  function escapeHtml(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function aplicarAvatarHeader() {
    const iconEl = document.querySelector('#user-trigger .user-icon');
    if (!iconEl) return;
    if (AVATAR) {
      iconEl.innerHTML = `<img src="${AVATAR}" alt="${escapeHtml(USERNAME)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`;
    } else {
      iconEl.textContent = (USERNAME || 'U').trim().charAt(0).toUpperCase();
    }
  }
  function aplicarPermisosMenu() {
    const show = (sel, v) => { const el = document.querySelector(sel); if (el) el.style.display = v ? 'block' : 'none'; };
    if (ROLE === 'administrador') {
      show('.menu-item[data-view="home"]', true);
      show('.menu-item[data-view="playlist"]', false);
      show('.menu-item[data-view="reproductor"]', false);
      show('.menu-item[data-view="perfil"]', true);
      show('.menu-item[data-view="mi-muro"]', false);
      show('.menu-item[data-view="gestion"]', true);
      show('.menu-item[data-view="musica"]', true);
    } else if (ROLE === 'artista') {
      show('.menu-item[data-view="gestion"]', false);
      show('.menu-item[data-view="musica"]', false);
      show('.menu-item[data-view="mi-muro"]', true);
      show('.menu-item[data-view="reproductor"]', true);
      show('.menu-item[data-view="playlist"]', true);
      show('.menu-item[data-view="perfil"]', true);
      show('.menu-item[data-view="home"]', true);
    } else {
      show('.menu-item[data-view="gestion"]', false);
      show('.menu-item[data-view="musica"]', false);
      show('.menu-item[data-view="mi-muro"]', false);
      show('.menu-item[data-view="home"]', true);
      show('.menu-item[data-view="playlist"]', true);
      show('.menu-item[data-view="reproductor"]', true);
      show('.menu-item[data-view="perfil"]', true);
    }
  }

  // ====== Vistas  ======
  function renderMenuHome() {
    mainContent.dataset.view = 'home';
    const html = `<h2>HOME • Bienvenido a Melodify</h2><p>Selecciona una opción del menú para comenzar.</p>`;
    pushHistory(html); showContent(html);
  }

  function renderMenuPlaylists() {
    mainContent.dataset.view = 'playlist';
    const isArtist = ROLE === 'artista';
    const P = Array.isArray(window._playlists) ? window._playlists : [];
    let html = '';

    if (isArtist) {
      html += '<ul class="item-list"><li data-playlist-id="1">Mi música</li></ul>';
    } else if (P.length) {
      html += '<ul class="item-list">' +
        P.map(pl => `<li data-playlist-id="${pl.id}">${escapeHtml(pl.name || '—')}</li>`).join('') +
      '</ul>';
    } else {
      html += '<p style="color:#b3b3b3;">No hay playlists.</p>';
    }

    pushHistory(html); showContent(html);
    document.querySelectorAll('[data-playlist-id]').forEach(item => {
      item.addEventListener('click', () => console.log('Abrir playlist', item.getAttribute('data-playlist-id')));
    });
  }

  function renderMenuPerfil() {
    mainContent.dataset.view = 'perfil';
    const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const avatarHTML = AVATAR
      ? `<img src="${esc(AVATAR)}" alt="${esc(USERNAME)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px #2b2b2b;">`
      : `<div style="width:96px;height:96px;border-radius:50%;background:#2a2a2a;display:flex;align-items:center;justify-content:center;font-size:36px;">${esc((USERNAME || 'U').charAt(0).toUpperCase())}</div>`;
    const roleLabel = (ROLE ? ROLE.charAt(0).toUpperCase() + ROLE.slice(1) : '—');
    const descHTML  = (ROLE === 'artista') ? `<p style="margin:6px 0 0;color:#bbb;">Descripción: ${esc(DESCRIPTION || '—')}</p>` : '';
    const fechaHTML = `<p style="margin:0 0 4px;">Registrado: ${esc(CREATED_AT || '—')}</p>`;
    const html = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;"><h2 style="margin:0;">Perfil</h2></div>
      <div style="display:flex;gap:16px;align-items:center;background:#1e1e1e;border:1px solid #2b2b2b;border-radius:12px;padding:16px;max-width:720px;">
        ${avatarHTML}
        <div>
          <p style="margin:0 0 4px;">Nombre: ${esc(USERNAME || '—')}</p>
          <p style="margin:0 0 4px;">Rol: ${esc(roleLabel)}</p>
          ${fechaHTML}
          ${descHTML}
        </div>
      </div>`;
    pushHistory(html); showContent(html);
  }

  // ====== Router / menú ======
  function clickMenuToggleBtn() {
    if (menuLateral) menuLateral.classList.toggle('collapsed');
    mainContent.classList.toggle('menuLateral-collapsed');
    if (header) header.classList.toggle('menuLateral-collapsed');
    const bar = document.querySelector('._mdf-player-bar');
    if (bar) bar.classList.toggle('menuLateral-collapsed');
  }
  menuToggleBtn?.addEventListener('click', clickMenuToggleBtn);
  toggleLogo?.addEventListener('click', clickMenuToggleBtn);

  const userTrigger = document.getElementById('user-trigger');
  const userMenu    = document.getElementById('user-menu');
  if (userTrigger && userMenu) {
    userTrigger.addEventListener('click', (e) => { e.stopPropagation(); userMenu.classList.toggle('show'); });
    document.addEventListener('click', () => userMenu.classList.remove('show'));
    userMenu.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('menu-perfil')?.addEventListener('click', (e) => {
      e.preventDefault(); userMenu.classList.remove('show'); activarItemMenu('perfil'); navegarSPA('perfil');
    });

    //---------------------------------
  }

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      navegarSPA(item.getAttribute('data-view') || '');
    });
  });
  document.querySelectorAll('.menu-item[data-view] a[href]').forEach(a => {
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  });
  function activarItemMenu(view) {
    document.querySelectorAll('.menu-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === view);
    });
  }

  async function navegarSPA(view) {
    currentView = view;
    mainContent.dataset.view = view || '';
    historyStack = [];

    switch (view) {
      case 'home':
        await RP.stopReproductorIfLoaded(); window.location.href = URL_HOME; break;
      case 'playlist':
        await RP.stopReproductorIfLoaded(); renderMenuPlaylists(); break;
      case 'reproductor':
        await RP.renderMenuReproductor({ mainContent, contentDiv, ROLE, URL_MI_MUSICA_JSON }); break;
      case 'perfil':
        await RP.stopReproductorIfLoaded(); renderMenuPerfil(); break;
      case 'gestion':
        await RP.stopReproductorIfLoaded(); window.location.href = URL_GESTION; break;
      case 'mi-muro':
      case 'mi-musica':
        await RP.stopReproductorIfLoaded(); window.location.href = URL_MI_MURO; return;
      case 'musica':
        await RP.stopReproductorIfLoaded(); window.location.href = URL_MUSICA; break;
      default:
        await RP.stopReproductorIfLoaded(); window.location.href = URL_HOME; break;
    }
  }

  // ====== Decorado de acciones peligrosas (eliminar) ======
  function decorateDangerButtons(root = document) {
    const attrMatches = root.querySelectorAll(
      'button[name*="delete" i], button[id*="delete" i], button[data-action="delete"], button[data-danger],' +
      'input[type="submit"][value*="eliminar" i], input[type="submit"][name*="delete" i],' +
      'a[href*="eliminar" i].button, a[role="button"][data-danger]'
    );
    attrMatches.forEach(el => el.classList.add('btnDanger'));
    root.querySelectorAll('button, input[type="submit"], a[href], [role="button"]').forEach(el => {
      if (el.classList?.contains('btnDanger')) return;
      const txt = (el.value || el.textContent || '').trim().toLowerCase();
      const looksDelete = ['eliminar','borrar','suprimir','remove','delete'].some(w => txt.includes(w));
      const hrefDelete = (el.getAttribute?.('href') || '').toLowerCase().includes('eliminar');
      if (looksDelete || hrefDelete) el.classList.add('btnDanger');
    });
  }

  // ====== Arranque ======
  function inicializarApp() {
    if (!USERNAME) USERNAME = 'Usuario';
    const userLbl = document.getElementById('username'); if (userLbl) userLbl.textContent = USERNAME;

    aplicarAvatarHeader();
    aplicarPermisosMenu();

    // Conectar eventos del reproductor
    RP.wireReproductorPlaylistEvents({ mainContent, ROLE, URL_MI_MUSICA_JSON });

    const first = INITIAL_VIEW || 'home';
    activarItemMenu(first);
    mainContent.dataset.view = first;

    if (first === 'home') renderMenuHome();
    else if (first === 'playlist') renderMenuPlaylists();
    else if (first === 'perfil') renderMenuPerfil();
    else if (first === 'reproductor') RP.renderMenuReproductor({ mainContent, contentDiv, ROLE, URL_MI_MUSICA_JSON });

    if (!contentDiv.innerHTML.trim()) { activarItemMenu('home'); mainContent.dataset.view = 'home'; renderMenuHome(); }
  }

  inicializarApp();

  // Mantiene data-view sincronizado durante navegación en el menu
  const main = document.getElementById('main-content');
  if (main) {
    const SPA_VIEWS = new Set(['home', 'playlist', 'reproductor', 'perfil']);
    main.dataset.view = (main.dataset.view || INITIAL_VIEW || 'home');
    document.querySelectorAll('#menuLateral .menu-item[data-view]').forEach(item => {
      const view = item.getAttribute('data-view');
      if (!SPA_VIEWS.has(view)) return;
      item.addEventListener('click', () => { main.dataset.view = view || 'home'; });
    });
  }
});
