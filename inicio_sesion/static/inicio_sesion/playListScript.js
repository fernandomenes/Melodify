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

// Cabeceras comunes para fetch (sin caché)
const H_FETCH = {
  "X-Requested-With": "fetch",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

// ---------------------------------------------------------------------------
// Helpers de sesión y cookies
// ---------------------------------------------------------------------------

/**
 * Intenta obtener el username de la sesión desde varias fuentes:
 * - window.__SESSION_USER__
 * - data-username en #main-content
 * - meta[name="username"]
 * - window.__USER__
 * - data-username en <body>
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
 * Toast para indicar que una canción se agregó/quitó de una playlist.
 * Intenta usar:
 *   - window.__melodifyShowPlaylistToast(added, name)
 *   - window.__melodifyShowToast(msg)
 * y como fallback, #like-toast.
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
 * Toast específico cuando la canción ya estaba en la playlist.
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
// Inicialización de módulo de playlists
// ---------------------------------------------------------------------------

/**
 * Punto de entrada principal del módulo de playlists.
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
      console.log("ID del usuario:", data.id);
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
 * Crear playlist para el usuario actual.
 */
function crearPlaylist(namePlaylist) {
  const csrf = getCookie("csrftoken");
  fetch("/playlist/create/", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    },
    body: JSON.stringify({ user: USERNAME, name: namePlaylist }),
  })
    .then((r) =>
      r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error || `HTTP ${r.status}`); })
    )
    .then((data) => {
      if (data && data.id) {
        PL_NAME.set(String(data.id), data.name || namePlaylist);
      }
      showPlaylists();
    })
    .catch((err) => {
      console.error("Error al crear playlist:", err);
      alert("No se pudo crear la playlist:\n" + err.message);
    });
}

/**
 * Toggle de like para una playlist (botón de cada playlist).
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
      if (btn) {
        btn.textContent = data.liked
          ? `Liked (${data.total})`
          : `Like (${data.total})`;
        btn.classList.toggle("liked", !!data.liked);
      }
    } else if (resp.status === 401 || (data && data.error === "login_required")) {
      window.location.href = "/login/";
    } else {
      throw new Error((data && data.error) || `HTTP ${resp.status}`);
    }
  } catch (e) {
    console.error("Error likePlaylist:", e);
    alert("No se pudo procesar el like.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Editar nombre de una playlist.
 */
function editarPlaylist(playListId, newname, idUSer) {
  console.log("editarPlaylist->idUSer:" + idUSer);
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
 * Eliminar una playlist (sólo si el usuario actual es el owner).
 */
function eliminarPlaylist(playlistId, idUSer) {
  if (idUSer.toString() !== USERID.toString()) {
    alert("No has Creado la PlayList No podras Editarla o Eliminarla");
    return;
  }

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

// ---------------------------------------------------------------------------
// Vista principal: listado de playlists del usuario
// ---------------------------------------------------------------------------

/**
 * Render principal de playlists:
 * - Encabezado con título y botón (+).
 * - Lista de playlists con like / editar / eliminar.
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

    const headerContainer = document.createElement("div");
    headerContainer.style.display = "flex";
    headerContainer.style.justifyContent = "center";
    headerContainer.style.alignItems = "center";
    headerContainer.style.gap = "20px";
    headerContainer.style.margin = "20px 0 50px 0";

    const title = document.createElement("h2");
    title.textContent = "Play List";
    title.style.fontSize = "25px";
    title.style.margin = "0";

    const btn = document.createElement("button");
    btn.className = "btnAddPlaylist";
    btn.textContent = "+";
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
        "No tienes playlists personales disponibles. Crea una con el botón (+).";
      p.style.color = "#b3b3b3";
      p.style.marginTop = "8px";
      content.appendChild(p);
      return;
    }

    data.forEach((p) => {
      const pid = String(p.id);
      const uid = String(p.idUser);
      const pUserCreated = String(p.userCreated);
      const isFollow = Boolean(p.isfollow);

      const pname = (p.name || `Playlist ${pid}`).trim();
      PL_NAME.set(pid, pname);

      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.alignItems = "flex-start";
      li.style.marginBottom = "20px";
      li.style.position = "relative";
      li.style.flexDirection = "column";

      const nameDiv = document.createElement("div");
      nameDiv.innerHTML = `<strong>${pname}</strong>`;
      nameDiv.style.marginBottom = "8px";
      nameDiv.classList.add("glow-namePL");
      nameDiv.style.cursor = "default";
      li.appendChild(nameDiv);

      const mediaContainer = document.createElement("div");
      mediaContainer.style.display = "flex";
      mediaContainer.style.alignItems = "flex-start";

      const img = document.createElement("img");
      img.src = "/static/inicio_sesion/img_playlist.png";
      img.width = 307;
      img.height = 222;
      img.alt = "portada";
      img.style.cursor = "pointer";
      img.addEventListener("click", () => verSongs(pid, PL_NAME.get(pid)));

      mediaContainer.appendChild(img);

      const buttonsDiv = document.createElement("div");
      buttonsDiv.style.display = "flex";
      buttonsDiv.style.flexDirection = "column";
      buttonsDiv.style.marginLeft = "10px";
      buttonsDiv.style.justifyContent = "flex-start";
      buttonsDiv.style.gap = "8px";

      const likeBtn = document.createElement("button");
      likeBtn.className = "btnRoundPlaylist";
      likeBtn.id = `like-playlist-btn-${pid}`;
      likeBtn.textContent = p.liked
        ? `Liked (${p.likes_count || 0})`
        : `Like (${p.likes_count || 0})`;
      likeBtn.addEventListener("click", () => likePlaylist(pid));

      const editBtn = document.createElement("button");
      editBtn.textContent = "Editar";
      editBtn.className = "btnRoundPlaylist";

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Eliminar";
      deleteBtn.className = "btnRoundPlaylist";
      deleteBtn.addEventListener("click", () => eliminarPlaylist(pid, uid));

      buttonsDiv.appendChild(likeBtn);
      buttonsDiv.appendChild(editBtn);
      buttonsDiv.appendChild(deleteBtn);

      mediaContainer.appendChild(buttonsDiv);
      li.appendChild(mediaContainer);

      const imgUser = document.createElement("img");
      imgUser.src = "/static/inicio_sesion/icon_user.png";
      imgUser.width = 11;
      imgUser.height = 18;

      const nameCreatorDiv = document.createElement("div");
      nameCreatorDiv.innerHTML = `<strong>${pUserCreated}</strong>`;
      nameCreatorDiv.style.marginBottom = "8px";

      const btnFollow = document.createElement("button");
      btnFollow.className = "btnRoundFollow";
      btnFollow.style.border = "1px solid #6dd7fa";
      if (isFollow) {
        btnFollow.textContent = "UnFollow";
        btnFollow.style.backgroundColor = "#0290be";
      } else {
        btnFollow.textContent = "Follow";
      }

      btnFollow.addEventListener("click", () => {
        setFollow(USERID, uid, isFollow);
        btnFollow.textContent = "UnFollow";
        btnFollow.style.backgroundColor = "#0290be";
      });

      const divContenH = document.createElement("div");
      divContenH.style.display = "flex";
      divContenH.style.flexDirection = "row";
      divContenH.style.marginLeft = "10px";
      divContenH.style.justifyContent = "flex-start";
      divContenH.style.gap = "8px";
      divContenH.appendChild(imgUser);
      divContenH.appendChild(nameCreatorDiv);

      console.log("loginUser:", USERID);
      console.log("userPl:", uid);

      if (USERID.toString() !== uid.toString()) {
        divContenH.appendChild(btnFollow);
      }

      li.appendChild(divContenH);

      content.appendChild(li);

      editBtn.addEventListener("click", () => {
        if (uid.toString() !== USERID.toString()) {
          alert("No has Creado la PlayList No podras Editarla o Eliminarla");
        } else {
          const rect = editBtn.getBoundingClientRect();
          showAlertNewPlaylist(editBtn, rect, "update", pid, uid);
        }
      });
    });
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
        console.log("Response playlists:", data);
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
      });

      // Exponer cache en window y notificar al Home si es necesario
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
// Popup inline para crear/renombrar playlist
// ---------------------------------------------------------------------------

/**
 * Popup flotante para crear o renombrar una playlist.
 * option: "new" | "update"
 */
function showAlertNewPlaylist(btn, rectPosition, option, idPlaylist, idUser) {
  const formContainer = document.createElement("div");
  formContainer.className = "playlist-form";
  formContainer.style.left = rectPosition.right + window.scrollX + "px";
  formContainer.style.top = rectPosition.top + window.scrollY + "px";
  formContainer.style.transform = "translateY(-50%)";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Nombre de la playlist";

  const buttons = document.createElement("div");
  buttons.className = "form-buttons";

  const crearBtn = document.createElement("button");
  crearBtn.className = "btn-create";
  crearBtn.textContent = option === "update" ? "Guardar" : "Crear";

  const cancelarBtn = document.createElement("button");
  cancelarBtn.className = "btn-cancel";
  cancelarBtn.textContent = "Cancelar";

  crearBtn.addEventListener("click", () => {
    const name = input.value.trim();
    if (name) {
      if (option === "new") {
        crearPlaylist(name);
      } else if (option === "update") {
        editarPlaylist(idPlaylist, name, idUser);
      }
      document.body.removeChild(formContainer);
    } else {
      input.focus();
    }
  });

  cancelarBtn.addEventListener("click", () => {
    document.body.removeChild(formContainer);
  });

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") crearBtn.click();
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

      const btn = document.createElement("button");
      btn.className = "btnAddPlaylist";
      btn.textContent = "♫+";
      btn.addEventListener("click", function () {
        showAlertSongSelector(btn, pid, totalSongs, stableName);
      });

      headerContainer.appendChild(title);
      headerContainer.appendChild(btn);
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
        })
        .filter(Boolean)
        .join("");

      const tempContainer = document.createElement("div");
      tempContainer.innerHTML = `<ul style="list-style:none;padding:0;margin:0">${rowsHTML}</ul>`;
      content.appendChild(tempContainer.firstElementChild);

      const main = document.getElementById("main-content");
      if (main) main.dataset.view = "playlist";

      // Actualizar window._playlists para el reproductor global
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
 * a la playlist indicada.
 */
function showAlertSongSelector(btn, idPlaylist, totalSongs, playlistName) {
  if (document.getElementById("song-selector-popup")) return;

  const rect = btn.getBoundingClientRect();

  const overlay = document.createElement("div");
  overlay.id = "song-selector-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.backgroundColor = "rgba(0,0,0,0.4)";
  overlay.style.zIndex = "998";

  const popup = document.createElement("div");
  popup.id = "song-selector-popup";
  popup.style.position = "absolute";
  popup.style.left = rect.right + window.scrollX + "px";
  popup.style.top = rect.top + window.scrollY + 350 + "px";
  popup.style.transform = "translateY(-50%)";
  popup.style.backgroundColor = "#1a1a1a";
  popup.style.border = "1px solid #333";
  popup.style.borderRadius = "8px";
  popup.style.maxHeight = "900px";
  popup.style.overflowY = "auto";
  popup.style.zIndex = "999";
  popup.style.minWidth = "280px";
  popup.style.boxShadow = "0 4px 16px rgba(0,0,0,0.5)";
  popup.style.fontFamily = "sans-serif";

  popup.innerHTML =
    '<div style="padding:16px; color:#888;">Cargando canciones...</div>';

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  fetch(`/playlist/allsongs/?t=${Date.now()}`, {
    credentials: "same-origin",
    headers: H_FETCH,
    cache: "no-store",
  })
    .then((response) => response.json())
    .then((songs) => {
      if (!Array.isArray(songs) || songs.length === 0) {
        popup.innerHTML =
          '<div style="padding:16px; color:#888;">No hay canciones disponibles.</div>';
        return;
      }
      let html = "";
      songs.forEach((song) => {
        html += `
        <div class="song-item-selector" data-id="${song.id}"
             style="padding:10px 16px; cursor:pointer; border-bottom:1px solid #2a2a2a;">
          <strong>${song.title}</strong><br>
          <small style="color:#aaa;">${song.artist_display_name}</small>
        </div>`;
      });
      popup.innerHTML = html;

      popup.querySelectorAll(".song-item-selector").forEach((item) => {
        item.addEventListener("click", function () {
          const idSong = this.dataset.id;
          addSongToPlaylist(idSong, idPlaylist, totalSongs, playlistName);
          document.body.removeChild(popup);
          document.body.removeChild(overlay);
        });
      });
    })
    .catch((error) => {
      console.error("Error al cargar canciones:", error);
      popup.innerHTML =
        '<div style="padding:16px; color:red;">Error al cargar canciones.</div>';
    });

  const closePopup = (e) => {
    if (!popup.contains(e.target) && e.target !== btn) {
      document.body.removeChild(popup);
      document.body.removeChild(overlay);
      document.removeEventListener("click", closePopup);
    }
  };
  setTimeout(() => document.addEventListener("click", closePopup), 0);
}

// ---------------------------------------------------------------------------
// Agregar canción a playlist (detalle y buscador)
// ---------------------------------------------------------------------------

/**
 * Agrega una canción a una playlist (detalle de playlist).
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
 * Agregar canción a playlist desde el buscador (popup de selección de playlist).
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
    const lists = (Array.isArray(listsRaw) ? listsRaw : []).filter((p) =>
      /^\d+$/.test(String(p.id))
    );

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
        btn.textContent = liked ? "Liked (1)" : "Like (0)";
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
 * Quita una canción de una playlist concreta (pero no borra la Song).
 */
function deleteFromPlaylistSong(ev, idSong, playlistId, playlistName) {
  if (ev) {
    ev.stopPropagation();
    ev.preventDefault();
  }

  if (!confirm("¿Quitar esta canción de la playlist?")) return;

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
 * Obtiene lista de colaboradores de una playlist (sólo owner/admin en backend).
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
 * Añade colaborador a una playlist (username, rol opcional).
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

// ---------------------------------------------------------------------------
// Follow de creador de playlist
// ---------------------------------------------------------------------------

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
