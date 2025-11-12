// static/inicio_sesion/homeScript.js

// Si una vista de servidor pone window.__DISABLE_HOME_SCRIPT__, NO inicializamos la SPA.
// Solo quitamos la clase en main-content para evitar layouts raros.
const __SPA_DISABLED__ = !!window.__DISABLE_HOME_SCRIPT__;

if (__SPA_DISABLED__) {
  document.addEventListener('DOMContentLoaded', () => {
    const mc = document.getElementById('main-content');
    if (mc) mc.classList.remove('menuLateral-collapsed');
  });
} else {
  document.addEventListener('DOMContentLoaded', async () => {
    // ========= Carga dinámica del módulo del reproductor con fallback =========
    let RP;
    try {
      const src = (window.REPRODUCTOR_SRC || '/static/reproductor/reproductor.js?v=1');
      RP = await import(src);
    } catch {
      RP = {
        stopReproductorIfLoaded: async () => {},
        renderMenuReproductor:   async () => {},
        wireReproductorPlaylistEvents: () => {}
      };
    }

    // ========= Referencias a nodos base =========
    const $ = (s, r=document) => r.querySelector(s);
    const menuLateral   = $('#menuLateral');
    const mainContent   = $('#main-content');
    const header        = $('#header');
    const contentDiv    = $('#content');
    const menuToggleBtn = $('#menu-toggle-btn');
    const toggleLogo    = $('#toggle-menu');
    const botonBack     = $('#back-btn');

    if (!mainContent || !contentDiv) return;

    // ========= Buscador (UI) =========
    const searchForm  = $('#search-form');
    const searchInput = $('#search-input');
    const searchPanel = $('#search-panel');
    searchForm?.addEventListener('submit', (e) => e.preventDefault());

    // ========= Datos inyectados por plantilla =========
    let ROLE_RAW     = (mainContent.dataset.role || '');
    // Normaliza rol: sin acentos, trim, minúsculas
    let ROLE = ROLE_RAW.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

    let USERNAME    = (mainContent.dataset.username || '').trim();
    const AVATAR      = (mainContent.dataset.avatar || '').trim();
    const DESCRIPTION = (mainContent.dataset.description || '').trim();
    const CREATED_AT  = (mainContent.dataset.createdAt || '').trim();

    const URL_MI_MURO        = mainContent.dataset.urlMiMuro       || '/mi-muro/';
    const URL_MUSICA         = mainContent.dataset.urlMusica       || '/musica/';
    const URL_GESTION        = mainContent.dataset.urlGestion      || '/gestion/';
    const URL_HOME           = mainContent.dataset.urlHome         || '/home/';
    const URL_MI_MUSICA_JSON = mainContent.dataset.urlMiMusicaJson || '/mi-musica/json/';

    const urlParams    = new URLSearchParams(location.search);
    const hashView     = (location.hash || '').replace(/^#/, '');
    const INITIAL_VIEW = (urlParams.get('view') || hashView || mainContent.dataset.initialView || 'home').trim();

    // ========= Inferencia de rol si viene vacío =========
    if (!ROLE) {
      const h1 = document.querySelector('.page h1')?.textContent?.toLowerCase() || '';
      if (h1.includes('gestion') || h1.includes('gestión')) ROLE = 'administrador';
    }

    // ========= Estado SPA =========
    let currentView  = null;
    let historyStack = [];

    // ========= Playlists iniciales desde JSON inyectado =========
    let playlists = [];
    try {
      const jsonEl = $('#playlists-data-json');
      playlists = JSON.parse(jsonEl?.textContent || '[]');
    } catch {}
    if (ROLE === 'artista' && (!Array.isArray(playlists) || playlists.length === 0)) {
      playlists = [{ id: 1, name: 'Mi música', songs: [] }];
    }
    window._playlists = playlists;

    // ========= Utils de presentación =========
    function escapeHtml(s) {
      return String(s ?? '').replace(/&/g,'&amp;')
                            .replace(/</g,'&lt;')
                            .replace(/>/g,'&gt;')
                            .replace(/"/g,'&quot;');
    }
    function showContent(html){
      contentDiv.innerHTML = html;
      decorateDangerButtons(contentDiv);
    }
    function pushHistory(html){ historyStack.push({ view: currentView, content: html }); }

    // ========= Buscador incremental (UI) =========
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }
    function initSearch() {
      const sf  = $('#search-form');
      const si  = $('#search-input');
      const pnl = $('#search-panel');
      if (sf && si) {
        sf.addEventListener('submit', (e) => {
          const query = si.value.trim();
          if (!query) {
            e.preventDefault();
            si.focus();
            return;
          }
        });
        if (pnl) {
          const performSearch = debounce(async (query) => {
            if (query.length < 2) {
              pnl.hidden = true;
              return;
            }
            try {
              pnl.hidden = false;
              pnl.innerHTML = `<div style="padding:10px;color:#888;">Presiona Enter para buscar "${escapeHtml(query)}"</div>`;
            } catch (err) {
              console.error('Error en búsqueda:', err);
              pnl.hidden = true;
            }
          }, 300);
          si.addEventListener('input', (e) => performSearch(e.target.value.trim()));
          document.addEventListener('click', (e) => { if (!sf.contains(e.target)) pnl.hidden = true; });
          si.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pnl.hidden = true; si.blur(); } });
        }
      }
    }

    // ========= Render básicos =========
    function renderMenuHome() {
      mainContent.dataset.view = 'home';

      const ctaMuro = (ROLE === 'artista')
        ? `<a id="muro-fab" class="fab-muro" href="${URL_MI_MURO}?no_spa=1" data-external="true">Muro del artista <span class="sub">creador</span></a>`
        : '';

      const ctaGestion = (ROLE === 'administrador')
        ? `<a id="gestion-fab" class="fab-gestion" href="${URL_GESTION}?no_spa=1" data-external="true">Gestión <span class="sub">moderador</span></a>`
        : '';

      const html = `
        ${ctaMuro}
        ${ctaGestion}
        <h2>HOME • Bienvenido a Melodify</h2>
        <p>Selecciona una opción del menú para comenzar.</p>
      `;
      pushHistory(html);
      showContent(html);
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
      pushHistory(html);
      showContent(html);
    }

    function renderMenuPerfil() {
      mainContent.dataset.view = 'perfil';
      const avatarHTML = AVATAR
        ? `<img src="${escapeHtml(AVATAR)}" alt="${escapeHtml(USERNAME)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px #2b2b2b;">`
        : `<div style="width:96px;height:96px;border-radius:50%;background:#2a2a2a;display:flex;align-items:center;justify-content:center;font-size:36px;">${escapeHtml((USERNAME || 'U').charAt(0).toUpperCase())}</div>`;
      const roleLabel = ROLE ? ROLE.charAt(0).toUpperCase() + ROLE.slice(1) : '—';
      const descHTML  = (ROLE === 'artista') ? `<p style="margin:6px 0 0;color:#bbb;">Descripción: ${escapeHtml(DESCRIPTION || '—')}</p>` : '';
      const fechaHTML = `<p style="margin:0 0 4px;">Registrado: ${escapeHtml(CREATED_AT || '—')}</p>`;
      const html = `
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;"><h2 style="margin:0;">Perfil</h2></div>
        <div style="display:flex;gap:16px;align-items:center;background:#1e1e1e;border:1px solid #2b2b2b;border-radius:12px;padding:16px;max-width:720px;">
          ${avatarHTML}
          <div>
            <p style="margin:0 0 4px;">Nombre: ${escapeHtml(USERNAME || '—')}</p>
            <p style="margin:0 0 4px;">Rol: ${escapeHtml(roleLabel)}</p>
            ${fechaHTML}
            ${descHTML}
          </div>
        </div>`;
      pushHistory(html);
      showContent(html);
    }

    // ========= Permisos del menú lateral según rol (ROBUSTO) =========
    function aplicarPermisosMenu() {
      const hideAll = (view) => {
        document.querySelectorAll(`#menuLateral .menu-item[data-view="${view}"]`).forEach(el => {
          el.style.setProperty('display', 'none', 'important');
          el.setAttribute('hidden', '');
          el.classList.add('vis-hidden');
        });
      };
      const showAll = (view) => {
        document.querySelectorAll(`#menuLateral .menu-item[data-view="${view}"]`).forEach(el => {
          el.style.removeProperty('display');
          el.removeAttribute('hidden');
          el.classList.remove('vis-hidden');
        });
      };

      // Re-sanea ROLE por si fue reasignado dinámicamente
      ROLE = (ROLE || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

      // Base visible
      ['home','playlist','reproductor','perfil'].forEach(showAll);

      if (ROLE === 'administrador') {
        hideAll('mi-muro');   // admin no ve muro
        showAll('gestion');   // admin sí ve gestión
      } else if (ROLE === 'artista') {
        showAll('mi-muro');   // artista sí ve muro
        hideAll('gestion');   // artista no ve gestión
      } else {
        hideAll('mi-muro');   // usuario normal
        hideAll('gestion');
      }
    }

    // ========= Router / navegación =========
    function clickMenuToggleBtn() {
      menuLateral?.classList.toggle('collapsed');
      mainContent.classList.toggle('menuLateral-collapsed');
      header?.classList.toggle('menuLateral-collapsed');
      document.querySelector('._mdf-player-bar')?.classList.toggle('menuLateral-collapsed');
    }
    menuToggleBtn?.addEventListener('click', clickMenuToggleBtn);
    toggleLogo?.addEventListener('click', clickMenuToggleBtn);

    // Los <a data-external="true"> dejan la navegación al navegador (vistas servidor)
    document.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[data-external="true"]');
      if (a) return;
    }, true);

    // Menú de usuario en encabezado
    const userTrigger = $('#user-trigger');
    const userMenu    = $('#user-menu');
    if (userTrigger && userMenu) {
      userTrigger.addEventListener('click', (e) => { e.stopPropagation(); userMenu.classList.toggle('show'); });
      document.addEventListener('click', () => userMenu.classList.remove('show'));
      userMenu.addEventListener('click', (e) => e.stopPropagation());
      $('#menu-perfil')?.addEventListener('click', (e) => {
        e.preventDefault();
        userMenu.classList.remove('show');
        activarItemMenu('perfil');
        navegarSPA('perfil');
      });
    }

    // Ítems SPA del sidebar
    document.querySelectorAll('#menuLateral .menu-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        if (item.tagName === 'A') { e.preventDefault(); e.stopPropagation(); }
        document.querySelectorAll('#menuLateral .menu-item[data-view]').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        const view = item.getAttribute('data-view') || '';
        navegarSPA(view);
      });
    });

    function activarItemMenu(view) {
      document.querySelectorAll('#menuLateral .menu-item[data-view]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-view') === view);
      });
    }

    // Botón Back con delegación
    function clickBackBtn() {
      switch (currentView) {
        case 'playlist':
          if (typeof window.clickBackBtnPlaylist === 'function') {
            window.clickBackBtnPlaylist();
          } else {
            activarItemMenu('home');
            navegarSPA('home');
          }
          break;
        default:
          activarItemMenu('home');
          navegarSPA('home');
          break;
      }
    }
    botonBack?.addEventListener('click', (e) => { e.preventDefault(); clickBackBtn(); });

    // ========= Controlador central de navegación =========
    async function navegarSPA(view) {
      currentView = view;
      mainContent.dataset.view = view || '';
      historyStack = [];

      switch (view) {
        case 'home': {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow'));
          renderMenuHome();
          break;
        }
        case 'playlist': {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow'));
          if (typeof window.showPlaylists === 'function') {
            window.initPlayList?.(USERNAME);
            window.showPlaylists();
          } else {
            renderMenuPlaylists();
          }
          break;
        }
        case 'reproductor': {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow'));
          window.__SKIP_MY_MUSIC_REFRESH__ = true;
          await RP.renderMenuReproductor({ mainContent, contentDiv, ROLE, URL_MI_MUSICA_JSON });
          break;
        }
        case 'perfil': {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow'));
          renderMenuPerfil();
          break;
        }

        // Vistas de servidor → pausa audio, oculta barra y redirige
        case 'gestion': {
          try { window.MDFCore?.getAudio()?.pause(); } catch {}
          window.__MDF_FORMS_HIDE_BAR__ = true;
          window.location.href = URL_GESTION + '?no_spa=1';
          return;
        }
        case 'mi-muro':
        case 'mi-musica': {
          try { window.MDFCore?.getAudio()?.pause(); } catch {}
          window.__MDF_FORMS_HIDE_BAR__ = true;
          window.location.href = URL_MI_MURO + '?no_spa=1';
          return;
        }
        case 'musica': {
          try { window.MDFCore?.getAudio()?.pause(); } catch {}
          window.__MDF_FORMS_HIDE_BAR__ = true;
          window.location.href = URL_MUSICA + '?no_spa=1';
          return;
        }

        default: {
          renderMenuHome();
          break;
        }
      }
    }

    // ========= Marcado de acciones peligrosas =========
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

    // ========= Header (avatar/usuario) =========
    function aplicarAvatarHeader() {
      const iconEl = $('#user-trigger .user-icon');
      const nameEl = $('#username');
      if (nameEl) nameEl.textContent = USERNAME || 'Usuario';
      if (!iconEl) return;
      if (AVATAR) {
        iconEl.innerHTML = `<img src="${escapeHtml(AVATAR)}" alt="${escapeHtml(USERNAME || 'Usuario')}"
                             style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`;
      } else {
        iconEl.textContent = (USERNAME || 'U').trim().charAt(0).toUpperCase();
      }
    }

    // ========= Inicialización =========
    function inicializarApp() {
      if (!USERNAME) USERNAME = 'Usuario';
      aplicarAvatarHeader();

      // Aplica permisos de menú (dos veces: por si el DOM se altera inmediatamente después)
      aplicarPermisosMenu();
      setTimeout(aplicarPermisosMenu, 0);

      initSearch();

      // Si ya había audio, pide mostrar la barra
      try {
        if (window.MDFCore?.getAudio?.()?.src) {
          window.__MDF_FORMS_HIDE_BAR__ = false;
          document.dispatchEvent(new CustomEvent('melodify:bar:shouldShow'));
        }
      } catch {}

      // Conexión de eventos del reproductor
      RP.wireReproductorPlaylistEvents({ mainContent, ROLE, URL_MI_MUSICA_JSON });

      const first = INITIAL_VIEW || 'home';
      activarItemMenu(first);
      mainContent.dataset.view = first;

      if (first === 'home') {
        renderMenuHome();
      } else if (first === 'playlist') {
        if (typeof window.showPlaylists === 'function') window.showPlaylists();
        else renderMenuPlaylists();
      } else if (first === 'perfil') {
        renderMenuPerfil();
      } else if (first === 'reproductor') {
        RP.renderMenuReproductor({ mainContent, contentDiv, ROLE, URL_MI_MUSICA_JSON });
      } else {
        renderMenuHome();
      }

      // Mantiene sincronizado data-view al interactuar con el menú lateral (solo vistas SPA)
      const main = $('#main-content');
      if (main) {
        const SPA_VIEWS = new Set(['home', 'playlist', 'reproductor', 'perfil']);
        main.dataset.view = (main.dataset.view || first);
        document.querySelectorAll('#menuLateral .menu-item[data-view]').forEach(item => {
          const view = item.getAttribute('data-view');
          if (!SPA_VIEWS.has(view)) return;
          item.addEventListener('click', () => { main.dataset.view = view || 'home'; });
        });
      }
    }

    // Si #menuLateral cambia dinámicamente (por merges/plantilla), re-aplica permisos
    if (menuLateral) {
      const mo = new MutationObserver(() => aplicarPermisosMenu());
      mo.observe(menuLateral, { childList: true, subtree: true });
    }

    inicializarApp();
  });
}
