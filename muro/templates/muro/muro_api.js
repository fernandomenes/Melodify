// static/muro/muro_api.js
/**
 * API de Muro/Artista
 * - fetchMyMusic(url): devuelve { ok, playlist: { id, name, songs[] } }
 */
export async function fetchMyMusic(url) {
  try {
    const res = await fetch(url, { headers: { 'X-Requested-With': 'fetch' } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data || !data.ok) return { ok: false, error: 'Respuesta no válida' };

    const songs = Array.isArray(data.songs) ? data.songs : [];
    return {
      ok: true,
      playlist: {
        id: 1,
        name: 'Mi música',
        songs
      }
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Error de red' };
  }
}

/**
 * Utilidad opcional: marca “dirty” cuando haya cambios externos (delete/undo).
 * La app principal puede escuchar el evento "melodify:playlistChanged".
 */
export function notifyPlaylistChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('melodify:playlistChanged', { detail }));
  } catch {}
}
