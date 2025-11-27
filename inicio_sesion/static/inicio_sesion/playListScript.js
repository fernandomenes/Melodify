// ============================================================================
// Melodify — Playlists de usuario
// Gestión de playlists, canciones y colaboradores desde el frontend.
// ============================================================================

let currentViewPlaylist = "allPlayList"; // "allPlayList" | "allSongsPlayList"
let content = null;
let USERNAME = null;
let USERID = null;

// Caché de nombres de playlist (id -> nombre visible)
const PL_NAME = new Map();
// Permisos de edición por playlist (id -> bool)
const PL_CAN_EDIT = new Map();

// Cabeceras comunes para fetch sin caché
const H_FETCH = {
  "X-Requested-With": "fetch",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

// ---------------------------------------------------------------------------
// Helpers de sesión y cookies
// ---------------------------------------------------------------------------

/**
 * Obtiene el username de la sesión desde distintas fuentes conocidas.
 */
function getSessionUsername() {
  return (
    (window.__SESSION_USER__ &&
      (window.__SESSION_USER__.username || window.__SESSION_USER__.user)) ||
    document.getElementById("main-content")?.dataset?.username ||
    document.querySelector('meta[name="username"]')?.getAttribute("content") ||
    window.__USER__ ||
    document.body?.getAttribute("data-username") ||
    ""
  );
}

/**
 * Obtiene una cookie por nombre.
 */
function getCookie(name) {
  const v = document.cookie.split("; ").find((row) => row.startsWith(name + "="));
  return v ? decodeURIComponent(v.split("=")[1]) : null;
}

// ---------------------------------------------------------------------------
// Eventos / notificaciones globales
// ---------------------------------------------------------------------------

/**
 * Emite un evento global cuando cambian las playlists:
 *   window.addEventListener("melodify:playlists:changed", ...)
 */
function emitPlaylistsChanged() {
  try {
    const ev = new CustomEvent("melodify:playlists:changed");
    window.dispatchEvent(ev);
  } catch (e) {
    console.warn("emitPlaylistsChanged falló:", e);
  }
}

/**
 * Muestra un aviso cuando una canción se agrega o se quita de una playlist.
 * Usa, en orden:
 *   - window.__melodifyShowPlaylistToast(added, name)
 *   - window.__melodifyShowToast(msg)
 *   - elemento #like-toast como último recurso.
 */
function notifyPlaylistSongChange(added, playlistName) {
  const name = (playlistName || "").trim();

  if (typeof window.__melodifyShowPlaylistToast === "function") {
    window.__melodifyShowPlaylistToast(added, name);
    return;
  }
  if (typeof window.__melodifyShowToast === "function") {
    window.__melodifyShowToast(
      added
        ? name
          ? `Añadida a la playlist “${name}”`
          : "Añadida a una playlist"
        : name
          ? `Quitada de la playlist “${name}”`
          : "Quitada de la playlist"
    );
    return;
  }

  const el = document.getElementById("like-toast");
  if (!el) return;
  el.textContent = added
    ? name
      ? `Añadida a la playlist “${name}”`
      : "Añadida a una playlist"
    : name
      ? `Quitada de la playlist “${name}”`
      : "Quitada de la playlist";
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("show"), 1400);
}

/**
 * Muestra un aviso cuando la canción ya pertenece a la playlist.
 */
function notifyPlaylistSongAlready(playlistName) {
  const name = (playlistName || "").trim();
  const msg = name
    ? `La canción ya está en la playlist “${name}”`
    : "La canción ya está en esa playlist";

  if (typeof window.__melodifyShowToast === "function") {
    window.__melodifyShowToast(msg);
    return;
  }
  const el = document.getElementById("like-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove("show"), 1400);
}

// ---------------------------------------------------------------------------
// Confirmación y avisos
// ---------------------------------------------------------------------------

/**
 * Diálogo de confirmación.
 * Utiliza window.mdfConfirm si está disponible, o confirm() como respaldo.
 */
function askConfirm(message, opts = {}) {
  if (typeof window.mdfConfirm === "function") {
    try {
      return window.mdfConfirm(message, opts);
    } catch (e) {
      console.warn("mdfConfirm falló, uso confirm() estándar:", e);
    }
  }
  return Promise.resolve(window.confirm(message));
}

/**
 * Diálogo de aviso.
 * Utiliza window.mdfAlert si está disponible, o alert() como respaldo.
 */
function showMdfAlert(message, opts = {}) {
  const msg = String(message || "");
  if (typeof window.mdfAlert === "function") {
    try {
      return window.mdfAlert(msg, opts);
    } catch (e) {
      console.warn("mdfAlert falló, uso alert() estándar:", e);
    }
  }
  alert(msg);
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Cambio de portada de playlist
// ---------------------------------------------------------------------------

/**
 * Sube una nueva portada para la playlist indicada.
 */
async function uploadPlaylistCover(playlistId, file, imgEl) {
  if (!file) return;

  const csrf = getCookie("csrftoken");
  const fd = new FormData();
  fd.append("cover", file);

  try {
    const resp = await fetch(`/playlist/${playlistId}/cover/`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
      },
      body: fd,
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {
      /* ignore */
    }

    if (!resp.ok || !data || data.ok === false) {
      throw new Error((data && data.error) || `HTTP ${resp.status}`);
    }

    const url = data.cover_url || "";
    if (imgEl && url) {
      const bust = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
      imgEl.src = bust;
    }
    return data;
  } catch (e) {
    console.error("Error al subir portada:", e);
    throw e;
  }
}

/**
 * Abre el selector de archivos para actualizar la portada de una playlist.
 */
function openPlaylistCoverPicker(playlistId, imgEl) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  document.body.appendChild(input);

  input.addEventListener("change", async () => {
    const file = input.files[0];
    document.body.removeChild(input);
    if (!file) return;

    try {
      await uploadPlaylistCover(playlistId, file, imgEl);
    } catch {
      alert("No se pudo actualizar la portada de la playlist.");
    }
  });

  input.click();
}

// ---------------------------------------------------------------------------
// Helpers visuales para playlists (fecha y botón de like)
// ---------------------------------------------------------------------------

/**
 * Formatea una fecha (string o Date) a "12 nov 2025" sin hora.
 */
function formatPlaylistDate(raw) {
  if (!raw) return "";

  try {
    if (raw instanceof Date) {
      return raw.toLocaleDateString("es-MX", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
    }

    const s = String(raw).trim();
    if (!s) return "";

    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(Date.UTC(y, mo, d));
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleDateString("es-MX", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        });
      }
    }

    const dt2 = new Date(s);
    if (!Number.isNaN(dt2.getTime())) {
      return dt2.toLocaleDateString("es-MX", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
    }

    return s.split(" ")[0];
  } catch {
    return "";
  }
}

/**
 * Actualiza el botón de like de una playlist.
 */
function updatePlaylistLikeButton(btn, liked, total) {
  if (!btn) return;
  const n = Number.isFinite(total) ? total : 0;

  btn.dataset.liked = liked ? "1" : "0";
  btn.setAttribute("data-liked", liked ? "1" : "0");
  btn.classList.toggle("is-liked", !!liked);

  const suffix = n > 0 ? ` ${n}` : "";
  btn.textContent = liked ? `♥${suffix}` : `♡${suffix}`;

  btn.style.color = liked ? "#ff4fa3" : "#ffffff";
}

// ---------------------------------------------------------------------------
// Inicialización de módulo de playlists
// ---------------------------------------------------------------------------

/**
 * Punto de entrada del módulo de playlists.
 * - Establece USERNAME y USERID.
 * - Monta la vista principal de playlists.
 */
function initPlayList(username) {
  USERNAME = username || getSessionUsername();
  content = document.getElementById("content");
  showPlaylists();
  getUSerIdLogin(USERNAME).then((id) => {
    USERID = id;
  });
}

/**
 * Botón "volver" desde la vista de canciones a la lista de playlists.
 */
function clickBackBtnPlaylist() {
  if (currentViewPlaylist === "allSongsPlayList") {
    showPlaylists();
  }
}

// ---------------------------------------------------------------------------
// API: obtención de ID de usuario logueado
// ---------------------------------------------------------------------------

/**
 * Llama al endpoint /playlist/getuserid/?user=... para obtener el ID interno.
 */
async function getUSerIdLogin(username) {
  const url = `/playlist/getuserid/?user=${encodeURIComponent(username)}`;
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      return data.id;
    } else {
      console.error("Error:", data.error);
      return null;
    }
  } catch (error) {
    console.error("Error de red o parsing:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CRUD de Playlists (crear / like / editar / eliminar)
// ---------------------------------------------------------------------------

/**
 * Crea una playlist para el usuario actual.
 * extra: { description?: string, coverFile?: File }
 */
/**
 * Crea una playlist para el usuario actual.
 * extra: { coverFile?: File }
 */
function crearPlaylist(namePlaylist, extra = {}) {
  const csrf = getCookie("csrftoken");
  const coverFile = extra.coverFile || null;

  fetch("/playlist/create/", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
    body: JSON.stringify({
      user: USERNAME,
      name: namePlaylist,
    }),
  })
    .then((r) =>
      r.ok
        ? r.json()
        : r.json().then((e) => {
            throw new Error(e.error || `HTTP ${r.status}`);
          })
    )
    .then(async (data) => {
      if (data && data.id) {
        const pid = String(data.id);
        PL_NAME.set(pid, data.name || namePlaylist);

        if (coverFile) {
          try {
            await uploadPlaylistCover(pid, coverFile, null);
          } catch (e) {
            console.warn("Playlist creada pero la portada falló:", e);
          }
        }
      }
      showPlaylists();
    })
    .catch((err) => {
      console.error("Error al crear playlist:", err);
      const msg =
        "No se pudo crear la playlist:\n" +
        (err && err.message ? err.message : "Ocurrió un error inesperado.");
      showMdfAlert(msg, { title: "Error al crear playlist" });
    });
}


/**
 * Cambia el like de una playlist y actualiza el contador.
 */
async function likePlaylist(id) {
  const csrf = getCookie("csrftoken");
  const btn = document.getElementById(`like-playlist-btn-${id}`);
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch(`/api/like/playlist/${id}/`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-CSRFToken": csrf || "",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {}

    if (resp.ok && data) {
      const liked = !!data.liked;
      const total =
        (typeof data.total === "number" && data.total) ||
        (typeof data.likes_count === "number" && data.likes_count) ||
        0;

      updatePlaylistLikeButton(btn, liked, total);
    } else if (resp.status === 401 || (data && data.error === "login_required")) {
      window.location.href = "/login/";
    } else {
      throw new Error((data && data.error) || `HTTP ${resp.status}`);
    }
  } catch (e) {
    console.error("Error likePlaylist:", e);
    showMdfAlert("No se pudo procesar el like de la playlist.", {
      title: "Error al marcar favorito",
    });
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Actualiza el nombre de una playlist.
 */
function editarPlaylist(playListId, newname, idUSer) {
  const csrf = getCookie("csrftoken");
  fetch(`/playlist/${playListId}/update/`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
    body: JSON.stringify({ name: newname }),
  })
    .then((r) =>
      r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error || `HTTP ${r.status}`); })
    )
    .then(() => {
      PL_NAME.set(String(playListId), newname);
      showPlaylists();
    })
    .catch((error) => {
      console.error("Error al actualizar:", error);
      alert("Error: " + error.message);
    });
}

/**
 * Elimina una playlist (sólo si el usuario actual es el owner).
 */
async function eliminarPlaylist(playlistId, idUSer) {
  if (idUSer.toString() !== USERID.toString()) {
    alert("No has Creado la PlayList. No podrás editarla o eliminarla.");
    return;
  }

  const ok = await askConfirm(
    "¿Seguro que quieres eliminar esta playlist?\nEsta acción no se puede deshacer.",
    { title: "Eliminar playlist", danger: true }
  );
  if (!ok) return;

  const csrf = getCookie("csrftoken");

  fetch(`/playlist/${playlistId}/delete/`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
  })
    .then((r) =>
      r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error || `HTTP ${r.status}`); })
    )
    .then(() => {
      PL_NAME.delete(String(playlistId));
      showPlaylists();
    })
    .catch((error) => {
      console.error("Error al eliminar:", error);
      alert("Error: " + error.message);
    });
}

/**
 * Renderiza el listado de playlists del usuario.
 */
function showPlaylists() {
  currentViewPlaylist = "allPlayList";

  if (!content) content = document.getElementById("content");
  if (!content) {
    console.error("No se encontró #content para playlists");
    return;
  }

  /**
   * Renderiza la lista de playlists o un mensaje vacío.
   */
  function renderPlaylists(data, messageIfEmpty) {
    content.innerHTML = "";

    // Encabezado
    const headerContainer = document.createElement("div");
    headerContainer.style.display = "flex";
    headerContainer.style.justifyContent = "space-between";
    headerContainer.style.alignItems = "center";
    headerContainer.style.gap = "20px";
    headerContainer.style.margin = "20px 0 24px 0";

    const title = document.createElement("h2");
    title.textContent = "Tus playlists";
    title.style.fontSize = "24px";
    title.style.margin = "0";

    const btn = document.createElement("button");
    btn.className = "btnAddPlaylist";
    btn.type = "button";
    btn.innerHTML = '📂<sup>+</sup>';
    btn.setAttribute("aria-label", "Nueva playlist");

    btn.addEventListener("click", function () {
      const rect = btn.getBoundingClientRect();
      showAlertNewPlaylist(btn, rect, "new", null, null);
    });

    headerContainer.appendChild(title);
    headerContainer.appendChild(btn);
    content.appendChild(headerContainer);

    if (!Array.isArray(data) || data.length === 0) {
      const p = document.createElement("p");
      p.textContent =
        messageIfEmpty ||
        "No tienes playlists personales disponibles. Crea una con el botón «Nueva playlist».";
      p.style.color = "#b3b3b3";
      p.style.marginTop = "8px";
      content.appendChild(p);
      return;
    }

    // Contenedor grid
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(240px, 1fr))";
    grid.style.gap = "20px";
    grid.style.marginBottom = "40px";

    data.forEach((p) => {
      const pid = String(p.id);
      const uid = String(p.idUser);
      const isOwner = USERID && USERID.toString() === uid.toString();

      const pUserCreated = String(p.userCreated || p.owner || p.username || p.user || "");
      const pname = (p.name || `Playlist ${pid}`).trim();
      PL_NAME.set(pid, pname);
      const canEdit = !!p.canEdit;
      PL_CAN_EDIT.set(pid, canEdit);

      // Visibilidad (privada/pública)
      const isPrivate =
        p.is_private === true ||
        p.isprivate === true ||
        p.private === true;

      // Fecha de creación
      const rawDate =
        p.created ||
        p.created_at ||
        p.fecha_creacion ||
        p.fecha ||
        p.createdAt ||
        null;
      const createdLabel = formatPlaylistDate(rawDate);

      // Tarjeta
      const card = document.createElement("article");
      card.className = "playlist-card";
      Object.assign(card.style, {
        background: "#181818",
        borderRadius: "16px",
        border: "1px solid #333",
        padding: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.45)",
        cursor: "pointer",
        transition: "transform .15s ease, box-shadow .15s ease, border-color .15s ease",
      });

      card.addEventListener("mouseenter", () => {
        card.style.transform = "translateY(-3px)";
        card.style.boxShadow = "0 16px 35px rgba(0,0,0,0.6)";
        card.style.borderColor = "#ff4fa355";
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "translateY(0)";
        card.style.boxShadow = "0 10px 25px rgba(0,0,0,0.45)";
        card.style.borderColor = "#333";
      });

      // Click en tarjeta -> canciones
      card.addEventListener("click", () => {
        verSongs(pid, PL_NAME.get(pid));
      });

      // Portada + like + candado
      const coverWrap = document.createElement("div");
      coverWrap.style.position = "relative";
      coverWrap.style.borderRadius = "12px";
      coverWrap.style.overflow = "hidden";
      coverWrap.style.marginBottom = "6px";
      coverWrap.style.background = "linear-gradient(135deg,#2b1b33,#101010)";

      const img = document.createElement("img");

      const rawCover =
        p.coverUrl ||
        p.cover_url ||
        p.portada ||
        "";
      const coverUrl =
        rawCover && typeof rawCover === "string"
          ? rawCover
          : "";

      img.src = coverUrl || "/static/inicio_sesion/img_playlist.png";
      img.alt = `Portada de ${pname}`;
      img.style.width = "100%";
      img.style.display = "block";
      img.style.aspectRatio = "16 / 10";
      img.style.objectFit = "cover";
      img.style.cursor = "pointer";

      img.addEventListener("click", (ev) => {
        ev.stopPropagation();
        verSongs(pid, PL_NAME.get(pid));
      });

      coverWrap.appendChild(img);

      // Botón like (corazón + número)
      const likeBtn = document.createElement("button");
      likeBtn.className = "song-like-btn playlist-like-btn";
      likeBtn.id = `like-playlist-btn-${pid}`;
      Object.assign(likeBtn.style, {
        position: "absolute",
        right: "8px",
        top: "8px",
        minWidth: "34px",
        height: "34px",
        borderRadius: "999px",
        border: "none",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "14px",
        padding: "0 8px",
        cursor: "pointer",
      });

      const initialLiked = !!p.liked;
      const initialTotal =
        (typeof p.likes_count === "number" && p.likes_count) ||
        (typeof p.total_likes === "number" && p.total_likes) ||
        0;
      updatePlaylistLikeButton(likeBtn, initialLiked, initialTotal);

      likeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        likePlaylist(pid);
      });

      coverWrap.appendChild(likeBtn);

      // Botón candado (pública/privada)
      const lockBtn = document.createElement("button");
      lockBtn.className = "playlist-lock-btn";
      Object.assign(lockBtn.style, {
        position: "absolute",
        left: "8px",
        top: "8px",
        width: "30px",
        height: "30px",
        borderRadius: "999px",
        border: "none",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        cursor: isOwner ? "pointer" : "default",
        color: "#f5f5f5",
      });

      function updateLockButton(privateNow) {
        const priv = !!privateNow;
        lockBtn.dataset.private = priv ? "1" : "0";
        lockBtn.setAttribute("data-private", priv ? "1" : "0");
        lockBtn.textContent = priv ? "🔒" : "🔓";
        lockBtn.title = priv
          ? "Playlist privada (solo tú la ves)"
          : "Playlist pública (otros pueden descubrirla)";
      }

      updateLockButton(isPrivate);

      if (isOwner) {
        lockBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();

          const wasPrivate = lockBtn.dataset.private === "1";
          const nextPrivate = !wasPrivate;

          // UI optimista
          updateLockButton(nextPrivate);

          const csrf = getCookie("csrftoken");

          try {
            const resp = await fetch(`/playlist/${pid}/update/`, {
              method: "PUT",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                ...(csrf ? { "X-CSRFToken": csrf } : {}),
              },
              body: JSON.stringify({ isprivate: nextPrivate }),
            });

            let data = null;
            try {
              data = await resp.json();
            } catch {}

            if (!resp.ok || (data && data.error)) {
              updateLockButton(wasPrivate);
              const msg =
                (data && data.error) ||
                `No se pudo actualizar la visibilidad (HTTP ${resp.status}).`;
              alert(msg);
              return;
            }

            const finalPriv =
              (data &&
                (("isprivate" in data && data.isprivate) ||
                 ("isPrivate" in data && data.isPrivate))) ??


              nextPrivate;

            updateLockButton(!!finalPriv);

            try {
              if (
                window.MDFCore &&
                typeof window.MDFCore.syncPlaylistVisibilityFromClient ===
                  "function"
              ) {
                window.MDFCore.syncPlaylistVisibilityFromClient(
                  `pl:${pid}`,
                  !finalPriv
                );
              }
            } catch (e) {
              console.warn("Error notificando visibilidad al reproductor:", e);
            }
          } catch (e) {
            console.error("Error al cambiar visibilidad de playlist:", e);
            updateLockButton(wasPrivate);
            alert(
              "No se pudo cambiar la visibilidad de la playlist (error de red)."
            );
          }
        });
      } else {
        lockBtn.disabled = true;
        lockBtn.setAttribute("aria-disabled", "true");
        lockBtn.style.opacity = "0.8";
      }

      coverWrap.appendChild(lockBtn);

      // Botón para cambiar portada (sólo dueño)
      if (USERID && USERID.toString() === uid.toString()) {
        const changeCoverBtn = document.createElement("button");
        changeCoverBtn.type = "button";
        changeCoverBtn.className = "btnRoundPlaylist btnRoundPlaylist--cover";
        changeCoverBtn.innerHTML = '<i class="fa-solid fa-image"></i>';
        changeCoverBtn.title = "Cambiar portada de la playlist";

        Object.assign(changeCoverBtn.style, {
          position: "absolute",
          right: "8px",
          bottom: "8px",
          width: "30px",
          height: "30px",
          borderRadius: "999px",
          border: "none",
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#ffd54f",
          fontSize: "14px",
        });

        changeCoverBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openPlaylistCoverPicker(pid, img);
        });

        coverWrap.appendChild(changeCoverBtn);
      }

      card.appendChild(coverWrap);

      // Título
      const nameDiv = document.createElement("div");
      nameDiv.classList.add("glow-namePL");
      nameDiv.style.fontSize = "16px";
      nameDiv.style.fontWeight = "600";
      nameDiv.style.marginBottom = "4px";
      nameDiv.textContent = pname;
      card.appendChild(nameDiv);

      // Metadatos
      const metaBlock = document.createElement("div");
      metaBlock.style.display = "flex";
      metaBlock.style.flexDirection = "column";
      metaBlock.style.gap = "2px";
      metaBlock.style.fontSize = "11px";
      metaBlock.style.color = "#b3b3b3";

      const ownerRow = document.createElement("div");
      ownerRow.style.display = "flex";
      ownerRow.style.alignItems = "center";
      ownerRow.style.justifyContent = "flex-start";
      ownerRow.style.gap = "8px";

      const ownerInfo = document.createElement("div");
      ownerInfo.textContent =
        pUserCreated && pUserCreated !== "null"
          ? `Creada por ${pUserCreated}`
          : "Creador desconocido";

      ownerRow.appendChild(ownerInfo);
      metaBlock.appendChild(ownerRow);

      if (createdLabel) {
        const dateLine = document.createElement("div");
        dateLine.textContent = `Creada el ${createdLabel}`;
        metaBlock.appendChild(dateLine);
      }

      const collabLine = document.createElement("div");
      collabLine.textContent = "Colaboradores: ...";
      metaBlock.appendChild(collabLine);

      fetchCollaborators(pid)
        .then((collabs) => {
          if (!collabLine.isConnected) return;
          if (!Array.isArray(collabs) || collabs.length === 0) {
            collabLine.textContent = "Colaboradores: (ninguno)";
          } else {
            const names = collabs
              .map(
                (c) =>
                  c.username ||
                  c.user ||
                  c.name ||
                  c.display_name ||
                  c
              )
              .join(", ");
            collabLine.textContent = `Colaboradores: ${names}`;
          }
        })
        .catch((err) => {
          console.warn("No se pudieron obtener colaboradores:", err);
          if (collabLine.isConnected) {
            collabLine.textContent = "Colaboradores: (no disponible)";
          }
        });

      card.appendChild(metaBlock);

      // Acciones del dueño
      const actionsRow = document.createElement("div");
      actionsRow.style.display = "flex";
      actionsRow.style.justifyContent = "flex-end";
      actionsRow.style.gap = "8px";
      actionsRow.style.marginTop = "8px";

      if (USERID && USERID.toString() === uid.toString()) {
        // Botón colaboradores 👤+
        const collabBtn = document.createElement("button");
        collabBtn.type = "button";
        collabBtn.className = "btnRoundPlaylist btnRoundPlaylist--collabs";
        collabBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
        collabBtn.title = "Gestionar colaboradores";

        Object.assign(collabBtn.style, {
          width: "30px",
          height: "30px",
          borderRadius: "999px",
          border: "none",
          background: "#2d3748",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#f9fafb",
          fontSize: "14px",
        });

        collabBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openPlaylistCollaboratorsDialog(pid, pname);
        });

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "btnRoundPlaylist btnRoundPlaylist--edit";
        editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
        editBtn.title = "Renombrar playlist";

        editBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const rect = editBtn.getBoundingClientRect();
          showAlertNewPlaylist(editBtn, rect, "update", pid, uid);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "btnRoundPlaylist btnRoundPlaylist--delete";
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.title = "Eliminar playlist";

        deleteBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          eliminarPlaylist(pid, uid);
        });

        // Orden: colaboradores – editar – eliminar
        actionsRow.appendChild(collabBtn);
        actionsRow.appendChild(editBtn);
        actionsRow.appendChild(deleteBtn);
      }

      card.appendChild(actionsRow);


      grid.appendChild(card);
    });

    content.appendChild(grid);
  }

  // Carga de playlists desde el backend
  fetch(
    `/playlist/getAllList/?u=${encodeURIComponent(
      getSessionUsername()
    )}&t=${Date.now()}`,
    {
      credentials: "same-origin",
      headers: H_FETCH,
      cache: "no-store",
    }
  )
    .then(async (r) => {
      let data = null;
      try {
        data = await r.json();
      } catch (err) {
        const text = await r.text().catch(() => "");
        console.error(
          "Respuesta no JSON al cargar playlists:",
          err,
          text.slice(0, 200)
        );
        renderPlaylists(
          [],
          "No se pudieron cargar tus playlists (respuesta no válida del servidor)."
        );
        return;
      }

      if (!r.ok) {
        console.warn("HTTP error al cargar playlists:", r.status, data);
        renderPlaylists(
          [],
          "Ocurrió un error al cargar tus playlists. Intenta de nuevo más tarde."
        );
        return;
      }

      const lists = Array.isArray(data) ? data : [];
      lists.forEach((p) => {
        const pid = String(p.id);
        const pname = (p.name || `Playlist ${pid}`).trim();
        PL_NAME.set(pid, pname);
        PL_CAN_EDIT.set(pid, !!p.canEdit);
      });

      try {
        window.__playlists_cache = lists.slice();
        document.dispatchEvent(
          new CustomEvent("melodify:playlists:loaded", { detail: { lists } })
        );
        document.addEventListener("melodify:playlists:loaded", async () => {
          try {
            if (
              (document.getElementById("main-content")?.dataset?.view || "") ===
              "home"
            ) {
              HOME_SONGS_CACHE = null;
              const allSongs = await fetchAllSongsForHome();
              renderHomeArtists(allSongs, false);
              renderHomeSongs(allSongs, false);
              aplicarMensajePlaylistsHome();
            }
          } catch (e) {
            console.warn("HOME: refresh tras playlists:loaded falló", e);
          }
        });
      } catch {}

      renderPlaylists(lists, null);
    })
    .catch((error) => {
      console.error("Error al cargar playlists:", error);
      renderPlaylists([], "Error al cargar playlists.");
    });
}

// ---------------------------------------------------------------------------
// Crear / actualizar playlist con portada opcional (sin descripción)
// ---------------------------------------------------------------------------

/**
 * Crea una playlist con portada opcional.
 */
async function createPlaylistWithOptionalCover(name, coverFile) {
  const csrf = getCookie("csrftoken");
  const payload = { user: USERNAME, name: name };

  const resp = await fetch("/playlist/create/", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {
    /* ignore */
  }

  if (!resp.ok || (data && data.error)) {
    throw new Error((data && data.error) || `HTTP ${resp.status}`);
  }

  if (data && data.id) {
    const pid = String(data.id);
    PL_NAME.set(pid, data.name || name);

    if (coverFile) {
      try {
        await uploadPlaylistCover(pid, coverFile, null);
      } catch (e) {
        console.warn("Portada opcional falló, pero la playlist sí se creó:", e);
      }
    }
  }

  showPlaylists();
  emitPlaylistsChanged();
  return data;
}

/**
 * Actualiza una playlist y su portada opcional.
 */
async function updatePlaylistWithOptionalCover(playlistId, newName, coverFile) {
  const csrf = getCookie("csrftoken");

  const resp = await fetch(`/playlist/${playlistId}/update/`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
    body: JSON.stringify({ name: newName }),
  });

  let data = null;
  try {
    data = await resp.json();
  } catch {
    /* ignore */
  }

  if (!resp.ok || (data && data.error)) {
    throw new Error((data && data.error) || `HTTP ${resp.status}`);
  }

  PL_NAME.set(String(playlistId), newName);

  if (coverFile) {
    try {
      await uploadPlaylistCover(playlistId, coverFile, null);
    } catch (e) {
      console.warn("Portada opcional falló al actualizar:", e);
    }
  }

  showPlaylists();
  emitPlaylistsChanged();
  return data;
}

// ---------------------------------------------------------------------------
// Popup inline para crear/renombrar playlist
// ---------------------------------------------------------------------------

/**
 * Popup flotante para crear o renombrar una playlist.
 * option: "new" | "update"
 */
function showAlertNewPlaylist(btn, rectPosition, option, idPlaylist, idUser) {
  const existing = document.querySelector(".playlist-form");
  if (existing) existing.remove();

  const isUpdate = option === "update";

  const formContainer = document.createElement("div");
  formContainer.className = "playlist-form";

  const offsetRight = Math.max(16, window.innerWidth - rectPosition.right);
  formContainer.style.position = "fixed";
  formContainer.style.top = rectPosition.bottom + 10 + "px";
  formContainer.style.right = offsetRight + "px";
  formContainer.style.left = "auto";
  formContainer.style.transform = "none";
  formContainer.style.zIndex = "1000";

  formContainer.innerHTML = `
  <div class="playlist-form__header">
    <h3 class="playlist-form__title">
      ${isUpdate ? "Renombrar playlist" : "Nueva playlist"}
    </h3>
  </div>
  <div class="playlist-form__body">
    <label class="playlist-form__field">
      <span class="playlist-form__label">Nombre</span>
      <input
        type="text"
        class="playlist-form__input"
        placeholder="Nombre de la playlist"
      />
    </label>
    ${
      isUpdate
        ? ""
        : `
    <label class="playlist-form__field">
      <span class="playlist-form__label">
        Portada <span class="playlist-form__label--muted">(opcional)</span>
      </span>
      <div class="playlist-form__file-wrapper">
        <input
          type="file"
          accept="image/*"
          class="playlist-form__file"
        />
        <span class="playlist-form__file-label">
          Elegir imagen…
        </span>
      </div>
      <p class="playlist-form__hint">
        JPG o PNG, idealmente horizontal. Si no eliges una, usaremos una portada por defecto.
      </p>
    </label>`
    }
  </div>
  <div class="playlist-form__footer">
    <button type="button" class="btn-cancel">Cancelar</button>
    <button type="button" class="btn-create">
      ${isUpdate ? "Guardar" : "Crear"}
    </button>
  </div>
`;

  document.body.appendChild(formContainer);

const nameInput = formContainer.querySelector(".playlist-form__input");
const fileInput = formContainer.querySelector(".playlist-form__file");
const crearBtn = formContainer.querySelector(".btn-create");
const cancelarBtn = formContainer.querySelector(".btn-cancel");
  // Prellenar en modo edición
  if (isUpdate) {
    const currentName = PL_NAME.get(String(idPlaylist)) || "";
    if (nameInput) nameInput.value = currentName;
  }

  if (nameInput) {
    nameInput.focus();
    nameInput.select();
    nameInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        crearBtn?.click();
      }
    });
  }

  crearBtn.addEventListener("click", () => {
    const name = (nameInput?.value || "").trim();
    if (!name) {
      if (nameInput) {
        nameInput.focus();
        nameInput.classList.add("playlist-form__input--error");
        setTimeout(
          () => nameInput.classList.remove("playlist-form__input--error"),
          160
        );
      }
      return;
    }

    if (isUpdate) {
  editarPlaylist(idPlaylist, name, idUser);
  if (formContainer.parentNode) {
    formContainer.parentNode.removeChild(formContainer);
  }
  return;
}

const coverFile =
  fileInput?.files && fileInput.files[0] ? fileInput.files[0] : null;

crearPlaylist(name, { coverFile });

if (formContainer.parentNode) {
  formContainer.parentNode.removeChild(formContainer);
}

  });

  cancelarBtn.addEventListener("click", () => {
    if (formContainer.parentNode) {
      formContainer.parentNode.removeChild(formContainer);
    }
  });

  // Cerrar si se hace click fuera
  const closeOnClickOutside = (e) => {
    if (!formContainer.contains(e.target) && e.target !== btn) {
      if (formContainer.parentNode) {
        formContainer.parentNode.removeChild(formContainer);
      }
      document.removeEventListener("click", closeOnClickOutside);
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnClickOutside), 0);
}

// ---------------------------------------------------------------------------
// Detalle de playlist: ver canciones
// ---------------------------------------------------------------------------

/**
 * Carga y muestra las canciones de una playlist concreta.
 */
function verSongs(playlistId, playlistName) {
  currentViewPlaylist = "allSongsPlayList";
  const pid = String(playlistId);
  const canEdit = !!PL_CAN_EDIT.get(pid);

  let totalSongs = 0;

  fetch(`/playlist/${pid}/songs/`, { credentials: "same-origin" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      totalSongs = Array.isArray(data?.songs) ? data.songs.length : 0;

      if (!content) {
        console.error("No existe #content");
        return;
      }

      const songs = Array.isArray(data?.songs) ? data.songs : [];
      const stableName =
        (playlistName && playlistName.trim()) ||
        PL_NAME.get(pid) ||
        (data && (data.name || data.playlist?.name)) ||
        `Playlist ${pid}`;

      PL_NAME.set(pid, stableName);

      // Contexto global de la playlist actual
      try {
        const idsSet = new Set((songs || []).map((s) => String(s.id)));
        window.__currentPlaylistContext = {
          id: pid,
          name: stableName,
          songIds: idsSet,
        };
      } catch (e) {
        console.warn("No se pudo actualizar __currentPlaylistContext:", e);
      }

      content.innerHTML = "";

      const headerContainer = document.createElement("div");
      headerContainer.style.display = "flex";
      headerContainer.style.justifyContent = "center";
      headerContainer.style.alignItems = "center";
      headerContainer.style.gap = "20px";
      headerContainer.style.margin = "20px 0 50px 0";

      const title = document.createElement("h2");
      title.textContent = stableName;
      title.style.fontSize = "25px";
      title.style.margin = "0";

      headerContainer.appendChild(title);

      if (canEdit) {
        const btn = document.createElement("button");
        btn.className = "btnAddPlaylist";
        btn.textContent = "♫+";
        btn.addEventListener("click", function () {
          showAlertSongSelector(btn, pid, totalSongs, stableName);
        });
        headerContainer.appendChild(btn);
      }

      content.appendChild(headerContainer);

      if (!songs.length) {
        const p = document.createElement("p");
        p.textContent = "No hay canciones en esta playlist.";
        content.appendChild(p);

        const main = document.getElementById("main-content");
        if (main) main.dataset.view = "playlist";
        try {
          window.MDFCore?.rebindReproductor?.();
        } catch {}
        return;
      }

      const pickFirst = (...c) =>
        c.find((v) => typeof v === "string" && v.trim().length) || "";

      const normSongs = [];
      const rowsHTML = songs
        .map((song) => {
          const audio = pickFirst(
            song.audioUrl,
            song.audio_url,
            song.audio,
            song.file,
            song.file_url,
            song.filePath,
            song.file_path,
            song.audioFile,
            song.audio_file,
            song.audioPath,
            song.audio_path,
            song.src,
            song.source,
            song.stream_url,
            song.streamUrl,
            song?.audio?.url,
            song?.file?.url,
            song?.media?.audio,
            song?.media?.url
          );
          if (!audio) return "";

          const cover =
            pickFirst(
              song.coverUrl,
              song.cover_url,
              song.cover,
              song.thumbnail,
              song.thumb,
              song?.cover?.url,
              song?.image?.url,
              song?.media?.cover
            ) || "/static/inicio_sesion/img_song.png";

          const idSong = song.id;
          const title = pickFirst(song.title, song.name) || "—";
          const author =
            pickFirst(
              song.artist_display_name,
              song.artist,
              song.author,
              song.singer
            ) || "—";
          const genre = pickFirst(song.genre, song.genero, song.gen) || "";

          normSongs.push({
            id: idSong ?? null,
            title,
            author,
            coverUrl: cover,
            audioUrl: audio,
            genre,
          });

          const esc = (s) => String(s ?? "").replace(/"/g, "&quot;");

          const liked = !!song.liked;
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

      <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
        <!-- Like -->
        <button
          class="song-like-btn playlist-song-like-btn${extraClass}"
          id="like-song-btn-${idSong}"
          type="button"
          data-liked="${liked ? "1" : "0"}"
          onclick="likeSong(event, ${idSong})"
          style="
            width:32px;
            height:32px;
            border-radius:999px;
            border:none;
            background:rgba(0,0,0,0.55);
            display:inline-flex;
            align-items:center;
            justify-content:center;
            font-size:18px;
            cursor:pointer;
            color:${liked ? "#ff4fa3" : "#ffffff"};
          "
        >
          ${liked ? "♥" : "♡"}
        </button>

        ${
          canEdit
            ? `
        <!-- Quitar de playlist -->
        <button
          class="song-delete-btn"
          type="button"
          aria-label="Quitar de la playlist"
          onclick="deleteFromPlaylistSong(
            event, ${idSong}, ${pid},
            this.closest('.song-item') && this.closest('.song-item').getAttribute('data-playlist-name')
          )"
          style="
            width:32px;
            height:32px;
            border-radius:999px;
            border:none;
            background:#ff1744;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            font-size:16px;
            cursor:pointer;
            color:#ffffff;
          "
        >
          🗑
        </button>`
            : ""
        }
      </div>
    </div>
  </li>`;
        })
        .filter(Boolean)
        .join("");

      const tempContainer = document.createElement("div");
      tempContainer.innerHTML = `<ul style="list-style:none;padding:0;margin:0">${rowsHTML}</ul>`;
      content.appendChild(tempContainer.firstElementChild);

      const main = document.getElementById("main-content");
      if (main) main.dataset.view = "playlist";

      // Actualiza window._playlists para el reproductor global
      try {
        const prev = Array.isArray(window._playlists) ? window._playlists : [];
        const plId = `pl:${pid}`;
        const others = prev.filter(
          (p) =>
            String(p.id) !== String(plId) &&
            String(p.id) !== "my" &&
            String(p.id) !== "1"
        );
        window._playlists = [
          { id: plId, name: stableName, songs: normSongs },
          ...others,
        ];
      } catch (e) {
        console.warn("No se pudo actualizar window._playlists en verSongs:", e);
      }

      try {
        window.MDFCore?.rebindReproductor?.();
        document.dispatchEvent(
          new CustomEvent("melodify:bar:shouldShow", {
            bubbles: true,
            detail: {},
          })
        );
      } catch (e) {
        console.warn("No se pudo rebindear el reproductor:", e);
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      if (content)
        content.innerHTML = `<p style="color:red;">Error: ${error.message}</p>`;
    });
}

// ---------------------------------------------------------------------------
// Popup de selección de canciones para agregar a playlist
// ---------------------------------------------------------------------------

/**
 * Popup que muestra todas las canciones disponibles para agregarlas
 * a la playlist indicada. Permite buscar y agregar varias sin cerrar.
 */
function showAlertSongSelector(btn, idPlaylist, totalSongs, playlistName) {
  if (document.getElementById("song-selector-popup")) return;

  const ctx = window.__currentPlaylistContext || null;
  let localTotalSongs =
    Number(totalSongs) ||
    (ctx && ctx.songIds && ctx.songIds.size) ||
    0;

  const esc = (s) => String(s ?? "").replace(/"/g, "&quot;");

  // Overlay
  const overlay = document.createElement("div");
  overlay.id = "song-selector-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.45)",
    zIndex: "998",
  });

  // Popup centrado
  const popup = document.createElement("div");
  popup.id = "song-selector-popup";
  Object.assign(popup.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: "#181818",
    border: "1px solid #333",
    borderRadius: "14px",
    minWidth: "420px",
    maxWidth: "720px",
    maxHeight: "70vh",
    overflow: "hidden",
    boxShadow: "0 18px 40px rgba(0,0,0,0.65)",
    zIndex: "999",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: "#f5f5f5",
    display: "flex",
    flexDirection: "column",
  });

  popup.innerHTML = `
    <div style="
      padding: 12px 16px;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    ">
      <div style="display:flex; flex-direction:column; gap:2px;">
        <strong style="font-size:15px;">Agregar canciones a la playlist</strong>
        <span style="font-size:12px; color:#aaa;">
          ${esc(playlistName || "")}
        </span>
      </div>
      <button type="button"
        class="song-selector-close"
        style="
          border:none;
          background:transparent;
          color:#ccc;
          font-size:18px;
          cursor:pointer;
        "
        aria-label="Cerrar"
      >✕</button>
    </div>

    <div style="
      padding: 10px 16px 8px;
      border-bottom: 1px solid #2a2a2a;
    ">
      <input
        id="song-search-input"
        type="text"
        placeholder="Buscar por título o artista..."
        style="
          width:100%;
          padding:8px 10px;
          border-radius:999px;
          border:1px solid #444;
          background:#111;
          color:#f5f5f5;
          font-size:13px;
          outline:none;
        "
      />
    </div>

    <div style="
      padding: 0 0 8px;
      flex:1;
      overflow-y:auto;
    ">
      <table style="
        width:100%;
        border-collapse:collapse;
        font-size:13px;
      ">
        <thead>
          <tr style="background:#202020;">
            <th style="text-align:left; padding:8px 16px; font-weight:500;">Título</th>
            <th style="text-align:left; padding:8px 10px; font-weight:500;">Artista</th>
            <th style="text-align:right; padding:8px 16px; width:90px;"></th>
          </tr>
        </thead>
        <tbody id="song-selector-tbody">
          <tr>
            <td colspan="3" style="padding:12px 16px; color:#888;">
              Cargando canciones…
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  function closePopup() {
    document.removeEventListener("keydown", keyHandler);
    if (popup.parentNode) popup.parentNode.removeChild(popup);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  const keyHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup();
    }
  };
  document.addEventListener("keydown", keyHandler);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePopup();
  });
  popup.querySelector(".song-selector-close")?.addEventListener("click", closePopup);

  const tbody = popup.querySelector("#song-selector-tbody");
  const searchInput = popup.querySelector("#song-search-input");

  // Carga de canciones desde el backend
  fetch(`/playlist/allsongs/?t=${Date.now()}`, {
    credentials: "same-origin",
    headers: H_FETCH,
    cache: "no-store",
  })
    .then((response) => response.json())
    .then((songs) => {
      if (!Array.isArray(songs) || songs.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="3" style="padding:12px 16px; color:#888;">No hay canciones disponibles.</td></tr>';
        return;
      }

      tbody.innerHTML = "";

      songs.forEach((song) => {
        const id = song.id;
        const title = song.title || "—";
        const artist = song.artist_display_name || "—";

        const alreadyIn =
          ctx && ctx.songIds && ctx.songIds.has(String(id));

        const tr = document.createElement("tr");
        tr.dataset.title = (title || "").toLowerCase();
        tr.dataset.artist = (artist || "").toLowerCase();
        tr.style.borderBottom = "1px solid #222";

        tr.innerHTML = `
          <td style="padding:8px 16px;">
            <span style="font-weight:500;">${esc(title)}</span>
          </td>
          <td style="padding:8px 10px; color:#b3b3b3;">
            ${esc(artist)}
          </td>
          <td style="padding:8px 16px; text-align:right;">
            <button type="button"
              class="btn-add-song-to-pl"
              data-id="${esc(id)}"
              style="
                min-width:78px;
                padding:5px 10px;
                border-radius:999px;
                border:none;
                font-size:12px;
                cursor:pointer;
                background:${alreadyIn ? "#2e7d32" : "#ff4fa3"};
                color:#fff;
                opacity:${alreadyIn ? "0.8" : "1"};
              "
              ${alreadyIn ? "disabled" : ""}
            >
              ${alreadyIn ? "Ya está" : "Agregar"}
            </button>
          </td>
        `;

        tbody.appendChild(tr);
      });

      // Añadir canción (sin cerrar el popup)
      tbody.querySelectorAll(".btn-add-song-to-pl").forEach((btnAdd) => {
        btnAdd.addEventListener("click", () => {
          const idSong = btnAdd.dataset.id;
          if (!idSong) return;

          if (btnAdd.disabled) return;

          btnAdd.disabled = true;
          btnAdd.textContent = "Agregada";
          btnAdd.style.background = "#2e7d32";
          btnAdd.style.opacity = "0.9";

          localTotalSongs += 1;
          addSongToPlaylist(idSong, idPlaylist, localTotalSongs, playlistName);
        });
      });

      // Filtro por título / artista
      if (searchInput) {
        searchInput.addEventListener("input", () => {
          const q = searchInput.value.trim().toLowerCase();
          tbody.querySelectorAll("tr").forEach((row) => {
            const t = row.dataset.title || "";
            const a = row.dataset.artist || "";
            const match = !q || t.includes(q) || a.includes(q);
            row.style.display = match ? "" : "none";
          });
        });
      }
    })
    .catch((error) => {
      console.error("Error al cargar canciones:", error);
      tbody.innerHTML =
        '<tr><td colspan="3" style="padding:12px 16px; color:red;">Error al cargar canciones.</td></tr>';
    });
}

// ---------------------------------------------------------------------------
// Agregar canción a playlist (detalle y buscador)
// ---------------------------------------------------------------------------

/**
 * Agrega una canción a una playlist (vista de detalle).
 */
function addSongToPlaylist(idSong, idPlaylist, totalSong, playlistName) {
  const ctx = window.__currentPlaylistContext;
  const pid = String(idPlaylist);
  const songIdStr = String(idSong);

  if (
    ctx &&
    String(ctx.id) === pid &&
    ctx.songIds &&
    ctx.songIds.has(songIdStr)
  ) {
    notifyPlaylistSongAlready(playlistName || ctx.name);
    return;
  }

  const position = (Number(totalSong) || 0) + 1;
  const csrf = getCookie("csrftoken");

  fetch("/playlist/addsong/", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
    body: JSON.stringify({ song_id: idSong, playlist_id: idPlaylist, position }),
  })
    .then((r) =>
      r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error || `Error ${r.status}`); })
    )
    .then(() => {
      if (ctx && String(ctx.id) === pid && ctx.songIds) {
        ctx.songIds.add(songIdStr);
      }

      const finalName = playlistName || ctx?.name || PL_NAME.get(pid);

      notifyPlaylistSongChange(true, finalName);

      const main = document.getElementById("main-content");
      const view = (
        main?.dataset?.view || main?.dataset?.initialView || ""
      ).trim();
      if (view !== "reproductor") {
        verSongs(pid, finalName);
      }

      emitPlaylistsChanged();
    })
    .catch((error) => {
      console.error("Error al agregar canción:", error);
      alert("No se pudo agregar la canción:\n" + error.message);
    });
}

/**
 * Agrega una canción a una playlist desde el buscador.
 */
function addSongToPlaylistFromSearch(idSong, idPlaylist, playlistName) {
  const pid = String(idPlaylist);
  fetch(`/playlist/${pid}/songs/?t=${Date.now()}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  })
    .then((r) => r.json())
    .then((data) => {
      const songs = Array.isArray(data?.songs) ? data.songs : [];
      const total = songs.length;

      if (songs.some((s) => String(s.id) === String(idSong))) {
        notifyPlaylistSongAlready(playlistName || PL_NAME.get(pid));
        return;
      }
      addSongToPlaylist(idSong, pid, total, playlistName || PL_NAME.get(pid));
    })
    .catch((err) => {
      console.error("Error al obtener canciones de la playlist:", err);
      alert("No se pudo agregar la canción a la playlist.");
    });
}

// ---------------------------------------------------------------------------
// Popup de selección de playlist para el buscador
// ---------------------------------------------------------------------------

/**
 * Desde el buscador: abre un popup para elegir a qué playlist agregar la canción.
 */
function openAddToPlaylistForSong(idSong /* metaOpcional */) {
  if (document.getElementById("playlist-selector-popup")) return;

  const overlay = document.createElement("div");
  overlay.id = "playlist-selector-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    background: "rgba(0,0,0,0.4)",
    zIndex: "998",
  });

  const popup = document.createElement("div");
  popup.id = "playlist-selector-popup";
  Object.assign(popup.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "10px",
    minWidth: "260px",
    maxWidth: "320px",
    maxHeight: "70vh",
    overflowY: "auto",
    padding: "16px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    zIndex: "999",
    fontFamily: "sans-serif",
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
    document.removeEventListener("click", clickOutside);
  }
  function clickOutside(e) {
    if (!popup.contains(e.target)) cerrar();
  }
  setTimeout(() => document.addEventListener("click", clickOutside), 0);
  overlay.addEventListener("click", cerrar);

  const uname = getSessionUsername();
  const urlPrimary = `/playlist/getAllList/?u=${encodeURIComponent(
    uname
  )}&t=${Date.now()}`;
  const urlFallback = `/playlist/getAllList/?t=${Date.now()}`;

  /**
   * Renderiza la lista de playlists como opciones clicables.
   */
  const renderList = (listsRaw) => {
    const lists = (Array.isArray(listsRaw) ? listsRaw : [])
      .filter((p) => /^\d+$/.test(String(p.id)))
      .filter((p) => p.canEdit);

    if (!lists.length) {
      popup.innerHTML =
        '<div style="color:#888;">No tienes playlists creadas.</div>';
      return;
    }

    let html = `
      <div style="margin-bottom:10px;"><strong>Agregar a playlist</strong></div>
      <div style="font-size:12px;color:#aaa;margin-bottom:8px;">Elige una playlist:</div>
    `;
    lists.forEach((p) => {
      const pid = String(p.id);
      const pname = (p.name || `Playlist ${pid}`).trim();
      PL_NAME.set(pid, pname);
      PL_CAN_EDIT.set(pid, !!p.canEdit);
      html += `
        <div class="playlist-item-selector"
             data-id="${pid}"
             data-name="${(pname || "").replace(/"/g, "&quot;")}"
             style="padding:8px 10px;border-radius:6px;border:1px solid #2a2a2a;margin-bottom:6px;cursor:pointer;">
          ${pname}
        </div>`;
    });
    popup.innerHTML = html;

    popup.querySelectorAll(".playlist-item-selector").forEach((item) => {
      item.addEventListener("click", function () {
        const idPlaylist = this.dataset.id;
        const playlistName = this.dataset.name || this.textContent.trim();
        addSongToPlaylistFromSearch(idSong, idPlaylist, playlistName);
        cerrar();
      });
    });
  };

  fetch(urlPrimary, {
    credentials: "same-origin",
    headers: H_FETCH,
    cache: "no-store",
  })
    .then(async (r) => {
      let data = null;
      try {
        data = await r.json();
      } catch {}
      if (r.ok && Array.isArray(data) && data.length) {
        renderList(data);
        return;
      }
      return fetch(urlFallback, {
        credentials: "same-origin",
        headers: H_FETCH,
        cache: "no-store",
      })
        .then((rr) => rr.json())
        .then((data2) => renderList(data2))
        .catch((e2) => {
          console.error("Fallback getAllList failed:", e2);
          popup.innerHTML =
            '<div style="color:red;">Error al cargar playlists.</div>';
        });
    })
    .catch((err) => {
      console.error("Error getAllList:", err);
      popup.innerHTML =
        '<div style="color:red;">Error al cargar playlists.</div>';
    });
}

// ---------------------------------------------------------------------------
// Likes de canciones dentro de la playlist
// ---------------------------------------------------------------------------

/**
 * Toggle de like para una canción dentro de la vista de playlist.
 * Sincroniza con el modelo de likes del reproductor (MDFCore) si existe.
 */
async function likeSong(ev, idSong) {
  if (ev) {
    ev.stopPropagation();
    ev.preventDefault();
  }

  const csrf = getCookie("csrftoken");
  const btn = document.getElementById(`like-song-btn-${idSong}`);
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch(`/api/like/song/${idSong}/`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-CSRFToken": csrf || "",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    let data = null;
    try {
      data = await resp.json();
    } catch {}

    if (resp.ok && data) {
      const liked = !!data.liked;

      if (btn) {
        btn.dataset.liked = liked ? "1" : "0";
        btn.textContent = liked ? "♥" : "♡";
        btn.style.color = liked ? "#ff4fa3" : "#ffffff";
        btn.classList.toggle("liked", liked);
      }

      if (
        window.MDFCore &&
        typeof window.MDFCore.syncLikeModelFromClient === "function"
      ) {
        let meta = null;
        const row = btn ? btn.closest(".song-item") : null;
        if (row) {
          meta = {
            title: row.getAttribute("data-title") || "",
            artist: row.getAttribute("data-author") || "",
            audioUrl: row.getAttribute("data-audio-url") || "",
            coverUrl:
              row.querySelector(".song-cover")?.getAttribute("src") || "",
            genre: row.getAttribute("data-genre") || "",
          };
        }
        window.MDFCore.syncLikeModelFromClient(idSong, liked, meta);
      }
    } else if (
      resp.status === 401 ||
      (data && data.error === "login_required")
    ) {
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

// ---------------------------------------------------------------------------
// Quitar canción de playlist (no del catálogo)
// ---------------------------------------------------------------------------

/**
 * Quita una canción de una playlist concreta (no elimina la Song).
 */
async function deleteFromPlaylistSong(ev, idSong, playlistId, playlistName) {
  if (ev) {
    ev.stopPropagation();
    ev.preventDefault();
  }

  const ok = await askConfirm(
    "¿Quitar esta canción de la playlist?",
    { title: "Quitar canción", danger: true }
  );
  if (!ok) return;

  const csrf = getCookie("csrftoken");

  fetch("/playlist/removeSong/", {
    method: "DELETE",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
    body: JSON.stringify({ playlist_id: playlistId, song_id: idSong }),
  })
    .then((r) =>
      r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error || `Error ${r.status}`); })
    )
    .then(() => {
      const pid = String(playlistId);
      const finalName =
        playlistName || PL_NAME.get(pid) || window.__currentPlaylistContext?.name;

      notifyPlaylistSongChange(false, finalName);

      const main = document.getElementById("main-content");
      const view = (
        main?.dataset?.view || main?.dataset?.initialView || ""
      ).trim();
      if (view !== "reproductor") {
        verSongs(pid, finalName);
      }

      emitPlaylistsChanged();
    })
    .catch((error) => {
      console.error("Error al eliminar:", error);
      alert("Error: " + error.message);
    });
}

// ---------------------------------------------------------------------------
// Colaboradores de playlist
// ---------------------------------------------------------------------------

/**
 * Obtiene la lista de colaboradores de una playlist.
 */
async function fetchCollaborators(playlistId) {
  try {
    const resp = await fetch(`/playlist/${playlistId}/collaborators/`, {
      credentials: "same-origin",
    });
    if (!resp.ok) {
      console.warn("No se pudo obtener colaboradores", await resp.json());
      return [];
    }
    const data = await resp.json();
    return data.collaborators || [];
  } catch (e) {
    console.error("fetchCollaborators error", e);
    return [];
  }
}

/**
 * Añade un colaborador a una playlist (username, rol opcional).
 */
async function addCollaborator(playlistId, username, role = "viewer") {
  const csrf = getCookie("csrftoken");
  try {
    const resp = await fetch(`/playlist/${playlistId}/collaborators/add/`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrf,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username, role }),
    });
    return await resp.json();
  } catch (e) {
    console.error("addCollaborator error", e);
    return { error: "network" };
  }
}

/**
 * Elimina un colaborador de una playlist (por userId de Users).
 */
async function removeCollaborator(playlistId, userId) {
  const csrf = getCookie("csrftoken");
  try {
    const resp = await fetch(
      `/playlist/${playlistId}/collaborators/remove/${userId}/`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "X-CSRFToken": csrf,
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );
    return await resp.json();
  } catch (e) {
    console.error("removeCollaborator error", e);
    return { error: "network" };
  }
}
/**
 * Devuelve la lista de usuarios que se pueden usar como colaboradores.
 * El backend debe responder con:
 *   { users: [{id, username, display_name?, avatar_url?}, ...] }
 */
async function fetchAllUsersForCollabs(query = "") {
  try {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    const url = `/playlist/collaborators/candidates/${params}`;

    const resp = await fetch(url, {
      credentials: "same-origin",
      headers: H_FETCH,
    });

    if (!resp.ok) {
      console.warn("fetchAllUsersForCollabs: HTTP", resp.status);
      return [];
    }

    const data = await resp.json();
    return Array.isArray(data.users) ? data.users : [];
  } catch (e) {
    console.error("fetchAllUsersForCollabs error", e);
    return [];
  }
}

/**
 * Popup para gestionar colaboradores de una playlist:
 * - Muestra todos los usuarios con buscador.
 * - Botón Agregar / Agregado (toggle).
 */
async function openPlaylistCollaboratorsDialog(playlistId, playlistName) {
  if (document.getElementById("pl-collab-popup")) return;

  const pid = String(playlistId);
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // Overlay
  const overlay = document.createElement("div");
  overlay.id = "pl-collab-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    background: "rgba(0,0,0,0.45)",
    zIndex: "998",
  });

  // Popup
  const popup = document.createElement("div");
  popup.id = "pl-collab-popup";
  Object.assign(popup.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: "#181818",
    border: "1px solid #333",
    borderRadius: "14px",
    minWidth: "420px",
    maxWidth: "720px",
    maxHeight: "70vh",
    overflow: "hidden",
    boxShadow: "0 18px 40px rgba(0,0,0,0.65)",
    zIndex: "999",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: "#f5f5f5",
    display: "flex",
    flexDirection: "column",
  });

  popup.innerHTML = `
    <div style="
      padding: 12px 16px;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    ">
      <div style="display:flex; flex-direction:column; gap:2px;">
        <strong style="font-size:15px;">Colaboradores de la playlist</strong>
        <span style="font-size:12px; color:#aaa;">
          ${esc(playlistName || "")}
        </span>
      </div>
      <button type="button"
        class="pl-collab-close"
        style="
          border:none;
          background:transparent;
          color:#ccc;
          font-size:18px;
          cursor:pointer;
        "
        aria-label="Cerrar"
      >✕</button>
    </div>

    <div style="
      padding: 8px 16px 4px;
      border-bottom: 1px solid #2a2a2a;
    ">
      <input
        id="pl-collab-search"
        type="text"
        placeholder="Buscar por usuario o nombre..."
        style="
          width:100%;
          padding:8px 10px;
          border-radius:999px;
          border:1px solid #444;
          background:#111;
          color:#f5f5f5;
          font-size:13px;
          outline:none;
        "
      />
      <p id="pl-collab-info"
         style="margin:4px 0 0;font-size:11px;color:#aaa;">
         Cargando usuarios…
      </p>
    </div>

    <div style="padding: 0 0 8px; flex:1; overflow-y:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="background:#202020;">
            <th style="text-align:left; padding:8px 16px; font-weight:500;">Usuario</th>
            <th style="text-align:left; padding:8px 10px; font-weight:500;">Rol</th>
            <th style="text-align:right; padding:8px 16px; width:90px;"></th>
          </tr>
        </thead>
        <tbody id="pl-collab-tbody">
          <tr>
            <td colspan="3" style="padding:12px 16px; color:#888;">
              Cargando usuarios…
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  function closePopup() {
    document.removeEventListener("keydown", keyHandler);
    if (popup.parentNode) popup.parentNode.removeChild(popup);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function keyHandler(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup();
    }
  }

  document.addEventListener("keydown", keyHandler);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePopup();
  });
  popup.querySelector(".pl-collab-close")?.addEventListener("click", closePopup);

  const tbody     = popup.querySelector("#pl-collab-tbody");
  const searchInp = popup.querySelector("#pl-collab-search");
  const infoLine  = popup.querySelector("#pl-collab-info");

  let allUsers = [];
  let collabSet = new Set(); // ids de colaboradores actuales (string)

  function renderRows(list) {
    tbody.innerHTML = "";
    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="3" style="padding:12px 16px; color:#888;">No se encontraron usuarios.</td></tr>';
      return;
    }

    list.forEach((u) => {
      const uid         = String(u.id);
      const username    = u.username || "";
      const displayName = u.display_name || username;
      const avatar      = u.avatar_url || u.avatar || "";

      const isCollab = collabSet.has(uid);

      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid #222";

      const initials = (displayName || username || "?")
        .trim()
        .charAt(0)
        .toUpperCase();

      tr.innerHTML = `
        <td style="padding:6px 16px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="
              width:28px;height:28px;
              border-radius:999px;
              background:#333;
              overflow:hidden;
              display:flex;
              align-items:center;
              justify-content:center;
              font-size:13px;
            ">
              ${
                avatar
                  ? `<img src="${esc(avatar)}" alt="${esc(displayName)}"
                          style="width:100%;height:100%;object-fit:cover;">`
                  : `<span>${esc(initials)}</span>`
              }
            </div>
            <div>
              <div style="font-weight:500;">${esc(displayName)}</div>
              <div style="font-size:11px;color:#b3b3b3;">@${esc(username)}</div>
            </div>
          </div>
        </td>
        <td style="padding:6px 8px;font-size:12px;color:#b3b3b3;">
          ${isCollab ? "Editor" : ""}
        </td>
        <td style="padding:6px 16px;text-align:right;">
          <button type="button"
            class="pl-collab-toggle-btn"
            data-user-id="${uid}"
            data-username="${esc(username)}"
            style="
              min-width:86px;
              padding:5px 10px;
              border-radius:999px;
              border:none;
              font-size:12px;
              cursor:pointer;
              background:${isCollab ? "#2e7d32" : "#3b82f6"};
              color:#fff;
            ">
            ${isCollab ? "Agregado" : "Agregar"}
          </button>
        </td>
      `;

      const roleCell = tr.children[1];
      const btn = tr.querySelector(".pl-collab-toggle-btn");

      btn.addEventListener("click", async () => {
        const currentlyCollab = collabSet.has(uid);
        btn.disabled = true;

        try {
          if (!currentlyCollab) {
            const res = await addCollaborator(pid, username, "editor");
            if (!res || res.error) {
              alert(
                res && res.error
                  ? res.error
                  : "No se pudo añadir colaborador."
              );
              btn.disabled = false;
              return;
            }
            collabSet.add(uid);
          } else {
            const res = await removeCollaborator(pid, uid);
            if (!res || res.error) {
              alert(
                res && res.error
                  ? res.error
                  : "No se pudo quitar colaborador."
              );
              btn.disabled = false;
              return;
            }
            collabSet.delete(uid);
          }

          const now = collabSet.has(uid);
          btn.textContent      = now ? "Agregado" : "Agregar";
          btn.style.background = now ? "#2e7d32" : "#3b82f6";
          roleCell.textContent = now ? "Editor" : "";
        } finally {
          btn.disabled = false;
        }
      });

      tbody.appendChild(tr);
    });
  }

  function applyFilter() {
    const q = (searchInp?.value || "").trim().toLowerCase();
    const filtered = !q
      ? allUsers
      : allUsers.filter((u) => {
          const u1 = (u.username || "").toLowerCase();
          const d1 = (u.display_name || "").toLowerCase();
          return u1.includes(q) || d1.includes(q);
        });
    renderRows(filtered);
  }

  if (searchInp) {
    searchInp.addEventListener("input", () => {
      applyFilter();
    });
  }

  // Carga inicial: colaboradores actuales + listado de usuarios
  (async () => {
    try {
      infoLine.textContent = "Cargando colaboradores y usuarios…";

      const [collabs, users] = await Promise.all([
        fetchCollaborators(pid),
        fetchAllUsersForCollabs(""),
      ]);

      collabSet = new Set(
        (collabs || []).map((c) =>
          String(c.user_id || c.id || c.pk || "")
        )
      );

      // Opcional: excluye al propio dueño si no quieres que salga
      allUsers = (users || []).filter((u) => u.username !== USERNAME);

      renderRows(allUsers);
      infoLine.textContent =
        "Haz clic en “Agregar” para dar permisos de edición a esa persona.";
    } catch (e) {
      console.error("pl-collab load error", e);
      infoLine.textContent = "No se pudieron cargar los usuarios.";
      tbody.innerHTML =
        '<tr><td colspan="3" style="padding:12px 16px; color:red;">Error al cargar usuarios.</td></tr>';
    }
  })();
}

// ---------------------------------------------------------------------------
// Follow de creador de playlist
// ---------------------------------------------------------------------------

/**
 * Marca follow/unfollow entre dos usuarios en el contexto de playlists.
 */
async function setFollow(seguidor_id, seguido_id, isFollowing) {
  const form = new FormData();
  form.append("seguidor_id", seguidor_id);
  form.append("seguido_id", seguido_id);
  form.append("action", isFollowing ? "unfollow" : "follow");

  const res = await fetch("/playlist/setFollows/", {
    method: "POST",
    headers: {},
    body: form,
  });
  const data = await res.json();
  console.log("response seguir:", data);
}

/* =========================================================================
   Puntos de entrada globales para uso desde Home/Buscador/Muro/Reproductor
   ========================================================================= */
window.initPlayList = initPlayList;
window.openAddToPlaylistForSong = openAddToPlaylistForSong;
window.addSongToPlaylistFromSearch = addSongToPlaylistFromSearch;
window.addSongToPlaylist = addSongToPlaylist;
window.verSongs = verSongs;
window.showPlaylists = showPlaylists;
window.setFollow = setFollow;

// ---------------------------------------------------------------------------
// Puentes defensivos en window (por si el bundler carga en distinto orden)
// ---------------------------------------------------------------------------
(() => {
  const g = window;
  try {
    if (
      !g.openAddToPlaylistForSong &&
      typeof openAddToPlaylistForSong === "function"
    )
      g.openAddToPlaylistForSong = openAddToPlaylistForSong;
  } catch {}
  try {
    if (
      !g.addSongToPlaylistFromSearch &&
      typeof addSongToPlaylistFromSearch === "function"
    )
      g.addSongToPlaylistFromSearch = addSongToPlaylistFromSearch;
  } catch {}
  try {
    if (!g.addSongToPlaylist && typeof addSongToPlaylist === "function")
      g.addSongToPlaylist = addSongToPlaylist;
  } catch {}
})();
