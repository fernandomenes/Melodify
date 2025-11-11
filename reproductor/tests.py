"""
Pruebas de integración para el feed JSON del reproductor.

Cubre:
- Entrega de canciones públicas del artista autenticado.
- Respuesta 401 cuando no hay sesión.
- Exclusión de canciones ajenas o con visibilidad 'removed'.
- Estructura mínima requerida por el reproductor.
"""

from django.test import TestCase, Client
from django.urls import reverse, NoReverseMatch
from inicio_sesion.models import Users, Song


class ReproductorTests(TestCase):
    def setUp(self):
        self.client = Client()
        # Artista con una canción pública para el feed JSON
        self.artist, _ = Users.objects.update_or_create(
            user="artist", defaults={"password": "artist123", "type": "Artista", "is_superadmin": False}
        )
        Song.objects.create(
            title="Fuego Interno", artist_display_name="artist", owner_user="artist",
            audio_file="dummy.mp3", visibility="public", genre="rock"
        )
        s = self.client.session
        s["user"] = "artist"
        s["role"] = "Artista"
        s.save()

    def _resolve_first(self, names=(), paths=()):
        for name in names:
            try:
                return reverse(name)
            except NoReverseMatch:
                continue
        for p in paths:
            return p
        return None

    def test_feed_para_reproductor(self):
        """
        Debe devolver canciones públicas del artista autenticado
        en el formato esperado por el reproductor (mi_musica_json).
        """
        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        self.assertIsNotNone(url, "No hay ruta para mi_musica_json.")
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        songs = data.get("songs", [])
        self.assertTrue(any(s.get("title") == "Fuego Interno" for s in songs))

    def test_feed_sin_sesion_401(self):
        """Sin sesión debe responder 401 con {'ok': false, 'error': 'auth'}."""
        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        self.assertIsNotNone(url, "No hay ruta para mi_musica_json.")

        c = Client()  # Cliente sin sesión
        resp = c.get(url)
        self.assertEqual(resp.status_code, 401)
        data = resp.json()
        self.assertFalse(data.get("ok"))
        self.assertEqual(data.get("error"), "auth")

    def test_feed_excluye_ajenos_y_removed(self):
        """
        Debe incluir únicamente canciones 'public' del artista autenticado,
        excluyendo 'removed' y canciones de otros propietarios.
        """
        # Canción pública adicional del propietario
        Song.objects.create(
            title="Otra Propia", artist_display_name="artist", owner_user="artist",
            audio_file="x2.mp3", visibility="public", genre="rock"
        )
        # Canción del propietario con visibilidad 'removed'
        Song.objects.create(
            title="Borrada", artist_display_name="artist", owner_user="artist",
            audio_file="x3.mp3", visibility="removed", genre="rock"
        )
        # Canción pública de un tercero
        Users.objects.update_or_create(
            user="other", defaults={"password": "x", "type": "Artista", "is_superadmin": False}
        )
        Song.objects.create(
            title="De Otro", artist_display_name="other", owner_user="other",
            audio_file="x4.mp3", visibility="public", genre="jazz"
        )

        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        titles = {s.get("title") for s in data.get("songs", [])}

        self.assertIn("Fuego Interno", titles)   # de setUp
        self.assertIn("Otra Propia", titles)     # pública del propietario
        self.assertNotIn("Borrada", titles)      # 'removed' del propietario
        self.assertNotIn("De Otro", titles)      # pública de tercero

    def test_feed_formato_minimo(self):
        """Cada elemento debe incluir los campos mínimos requeridos por el reproductor."""
        url = self._resolve_first(names=("mi_musica_json",), paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/"))
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        song = data.get("songs", [])[0]
        for key in ("id", "title", "artist_display_name", "audio_url", "cover_url", "genre"):
            self.assertIn(key, song, f"Falta campo '{key}' en el payload del feed")

# ================================
# Pruebas de contrato Top 10 (front-driven)
# ================================
#
# Nota: El Top 10 se calcula en el cliente (JS + localStorage).
# Estas pruebas NO ejecutan el JS; verifican que:
#   (1) El backend entrega el "universo" con campos mínimos (shape).
#   (2) Con ese universo, el algoritmo equivalente (portado a Python)
#       produce el orden esperado para los casos documentados (N-1, N-4, N-5, A-2).
#
# Si algún endpoint no existe en tu proyecto, la prueba se auto-salta
# sin romper el suite (usando el mismo patrón _resolve_first que ya usas).

from django.test import TestCase, Client
from django.urls import reverse, NoReverseMatch
from inicio_sesion.models import Users, Song

def _resolve_first(names=(), paths=()):
    for name in names:
        try:
            return reverse(name)
        except NoReverseMatch:
            continue
    for p in paths:
        return p
    return None

class Top10ContractTests(TestCase):
    def setUp(self):
        self.c = Client()

        # Usuario artista en sesión
        self.user, _ = Users.objects.update_or_create(
            user="artist", defaults={"password":"x", "type":"Artista", "is_superadmin":False}
        )
        s = self.c.session
        s["user"] = "artist"
        s["role"] = "Artista"
        s.save()

        # Creamos 12 canciones públicas del mismo artista para tener "universo"
        # suficiente en el feed de "mi_musica_json".
        self.songs = []
        for i in range(1, 13):
            self.songs.append(
                Song.objects.create(
                    title=f"S{i}",
                    artist_display_name="artist",
                    owner_user="artist",
                    audio_file=f"{i}.mp3",
                    visibility="public",
                    genre="rock" if i % 2 else "indie",
                )
            )

        # Ruta al feed que el front consume para "Mi música"
        self.mi_musica_url = _resolve_first(
            names=("mi_musica_json",),
            paths=("/mi-musica.json", "/mi-musica/", "/api/mi-musica/")
        )
        self.assertIsNotNone(self.mi_musica_url, "No hay ruta para mi_musica_json.")

    # -------- Helpers (port mimético del JS) --------
    def _ensure_abs(self, u: str) -> str:
        if not u:
            return ""
        s = str(u).strip()
        if s.startswith("http://") or s.startswith("https://") or s.startswith("/"):
            return s
        return "/" + s.lstrip("/")

    def _song_key_py(self, song_payload: dict) -> str:
        # Igual que _songKey() del front: prioriza ID, si no, URL absoluta
        sid = song_payload.get("id")
        if sid is not None:
            return f"id:{sid}"
        audio_url = self._ensure_abs(song_payload.get("audio_url") or song_payload.get("audioUrl") or "")
        if audio_url:
            return "u:" + audio_url
        return ""

    def _dedup_py(self, arr, key_fn):
        seen = set()
        out = []
        for it in arr:
            k = key_fn(it)
            if not k or k in seen:
                continue
            seen.add(k)
            out.append(it)
        return out

    def _build_frozen_order_py(self, universe_songs, plays_by_key):
        # Port ligero de _buildFrozenOrderFromPlays():
        base = self._dedup_py(universe_songs, self._song_key_py)

        scored = []
        for s in base:
            k = self._song_key_py(s)
            if k:
                scored.append({"key": k, "score": int(plays_by_key.get(k, 0))})

        # Orden desc por score
        scored.sort(key=lambda x: x["score"], reverse=True)

        order = [x["key"] for x in scored[:10]]

        # Completar con universo (sin duplicados) hasta 10
        if len(order) < 10:
            for s in base:
                k = self._song_key_py(s)
                if not k or k in order:
                    continue
                order.append(k)
                if len(order) >= 10:
                    break
        return order[:10]

    def _get_universe_from_backend(self):
        """
        Devuelve una lista de canciones (payload) que imita lo que
        consume normalizeSong() en el front. Usamos mi_musica_json
        como mínimo; si tienes endpoints de playlists puedes ampliarlo.
        """
        r = self.c.get(self.mi_musica_url)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        songs = data.get("songs", [])
        # Shape mínimo requerido por normalizeSong():
        self.assertTrue(len(songs) > 0, "El feed de mi_musica_json no trae canciones.")
        required = {"id", "title", "artist_display_name", "audio_url", "cover_url", "genre"}
        missing = [s for s in songs if not required.issubset(set(s.keys()))]
        self.assertFalse(missing, f"Faltan campos mínimos en alguna canción: {required}")
        return songs

    # -------- Casos (mapeo a tu documento) --------

    def test_N1_congela_por_reproducciones_de_ayer(self):
        """
        N-1: Con ≥10 canciones y puntajes, el orden (congelado) debe ser desc
        por score. Simulamos 'plays' de AYER con un diccionario.
        """
        universe = self._get_universe_from_backend()
        # Tomamos 12 ids del universo
        keys = [self._song_key_py(s) for s in universe][:12]
        self.assertEqual(len(keys), 12)

        # scores descendentes: k11..k2 en top10
        plays = {}
        # Nota: dejamos el primer key (k0) sin score para caer fuera del top10
        for rank, k in enumerate(keys[1:12], start=1):
            plays[k] = rank  # 1..11

        order = self._build_frozen_order_py(universe, plays)
        self.assertEqual(len(order), 10)
        # El más alto es el último insertado (score 11)
        self.assertEqual(order[0], keys[11])
        # El último del top10 tiene score 2 (keys[2])
        self.assertEqual(order[-1], keys[2])

    def test_N4_deduplicacion_por_id_y_por_url(self):
        """
        N-4: Canciones duplicadas (misma ID o misma URL) no deben repetirse
        en el universo considerado.
        """
        universe = self._get_universe_from_backend()

        # Simulamos duplicados: reinyectamos la primera canción dos veces
        first = universe[0].copy()
        dup_id = first.copy()           # mismo id
        dup_url = first.copy()          # sin id, dedup por URL
        dup_url.pop("id", None)

        augmented = [first, dup_id, dup_url] + universe[1:15]
        deduped = self._dedup_py(augmented, self._song_key_py)
        # Debe existir solo una entrada para esa identidad
        ids = [self._song_key_py(x) for x in deduped]
        self.assertEqual(ids.count(self._song_key_py(first)), 1)

    def test_N5_completa_hasta_10_con_universo(self):
        """
        N-5: Si solo hay plays para 6 canciones, completar hasta 10 con el resto
        del universo, sin duplicados.
        """
        universe = self._get_universe_from_backend()
        keys = [self._song_key_py(s) for s in universe][:12]
        self.assertTrue(len(keys) >= 10)

        plays = {}
        for k in keys[:6]:
            plays[k] = 100  # todas con score alto, pero solo 6

        order = self._build_frozen_order_py(universe, plays)
        self.assertEqual(len(order), 10)
        # Las 6 con score están incluidas:
        for k in keys[:6]:
            self.assertIn(k, order)
        # Y no hay duplicados:
        self.assertEqual(len(order), len(set(order)))

    def test_A2_sin_plays_ayer_usar_ultimo_congelado(self):
        """
        A-2: Si ayer no hay reproducciones pero existe orden congelado previo,
        el front usaría ese último. Aquí simulamos el comportamiento: si no hay
        puntajes, nuestro build “toma el universo” y la lógica de 'último congelado'
        quedaría en el cliente; este test valida que el universo es estable y suficiente.
        """
        universe = self._get_universe_from_backend()
        plays = {}  # sin puntajes
        order = self._build_frozen_order_py(universe, plays)
        # Debe construir un orden de 10 elementos (rellenado por universo)
        self.assertEqual(len(order), 10)
        self.assertEqual(len(order), len(set(order)))
