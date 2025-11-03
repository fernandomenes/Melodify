import json

from django.shortcuts import redirect, render

from .models import ArtistProfile, Song, Users


def pantallaPrincipal(request):
    """Renderiza la pantalla principal (pública)."""
    return render(request, "inicio_sesion/principal.html")


def _safe_file_url(f):
    try:
        return f.url if getattr(f, "name", "") else ""
    except Exception:
        return ""


def pantallaHome(request):
    """
    Renderiza la pantalla autenticada: inyecta datos de sesión y, si el rol
    es Artista, la playlist “Mi música” con canciones públicas del usuario.
    """
    if "user" not in request.session:
        return redirect("login")

    session_user = request.session.get("user", "")
    session_role = request.session.get("role", "")
    role_lower = (session_role or "").lower()

    avatar_url = ""
    artist_description = ""
    created_at_str = ""

    try:
        u = Users.objects.get(user=session_user)
        if getattr(u, "avatar", None):
            try:
                avatar_url = u.avatar.url
            except Exception:
                avatar_url = str(u.avatar)
        if getattr(u, "created_at", None):
            created_at_str = u.created_at.strftime("%Y-%m-%d %H:%M")
        if role_lower == "artista":
            try:
                artist_description = (u.artist_profile.description or "").strip()
            except ArtistProfile.DoesNotExist:
                artist_description = ""
    except Users.DoesNotExist:
        pass

    playlists = []
    if role_lower == "artista":
        qs = Song.objects.filter(owner_user=session_user, visibility="public").only(
            "id", "title", "artist_display_name", "audio_file", "cover_image", "genre"
        )
        songs = [
            {
                "id": s.id,
                "title": s.title,
                "author": s.artist_display_name,
                "audioUrl": _safe_file_url(s.audio_file) or str(s.audio_file),
                "coverUrl": _safe_file_url(s.cover_image)
                or (str(s.cover_image) if s.cover_image else None),
                "genre": getattr(s, "genre", "") or "",
            }
            for s in qs
        ]
        playlists.append({"id": 1, "name": "Mi música", "songs": songs})

    ctx = {
        "session_user": session_user,
        "session_role": session_role,
        "session_avatar_url": avatar_url,
        "session_description": artist_description,
        "session_created_at": created_at_str,
        "playlists_json": json.dumps(playlists),
    }
    return render(request, "inicio_sesion/home.html", ctx)


def pantallaLogin(request):
    """
    Gestiona el formulario de inicio de sesión.
    En POST valida credenciales contra Users y crea la sesión.
    """
    if request.method == "POST":
        user = request.POST.get("user")
        password = request.POST.get("password")
        try:
            usuario_db = Users.objects.get(user=user, password=password)
            request.session["user"] = usuario_db.user
            request.session["role"] = usuario_db.type or ""
            return redirect("home")
        except Users.DoesNotExist:
            return render(
                request,
                "inicio_sesion/login.html",
                {"error": "Usuario o contraseña incorrectos"},
            )
    return render(request, "inicio_sesion/login.html")
