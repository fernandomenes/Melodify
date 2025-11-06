import json
from django.contrib import messages

from django.shortcuts import redirect, render
from django.contrib.auth import logout as django_logout
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods


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
        messages.error(request, "Debes iniciar sesión para acceder a esta página.")
        return redirect('login')

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

def pantallaRegistro(request):
    """
    Gestiona el formulario de registro de nuevos usuarios.
    """
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')
        
        # Validaciones
        errors = []
        
        # Verificar que las contraseñas coincidan
        if password != confirm_password:
            errors.append("Las contraseñas no coinciden.")
        
        # Verificar que el usuario no exista
        if Users.objects.filter(user=username).exists():
            errors.append("El nombre de usuario ya existe.")
        
        # Verificar longitud mínima
        if len(password) < 6:
            errors.append("La contraseña debe tener al menos 6 caracteres.")
        
        # Verificar que el username no esté vacío
        if not username.strip():
            errors.append("El nombre de usuario no puede estar vacío.")
        
        # Si no hay errores, crear el usuario
        if not errors:
            try:
                nuevo_usuario = Users(
                    user=username.strip(),
                    password=password,  # En un proyecto real, esto debería estar encriptado
                    type='Usuario',  # Tipo por defecto
                    is_superadmin=False,
                    is_active=True
                )
                nuevo_usuario.save()
                
                messages.success(request, "¡Registro exitoso! Ahora puedes iniciar sesión.")
                return redirect('login')
                
            except Exception as e:
                errors.append(f"Error al crear el usuario: {str(e)}")
        
        # Si hay errores, mostrarlos
        for error in errors:
            messages.error(request, error)
    
    return render(request, 'inicio_sesion/registro.html')


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
            request.session.cycle_key()
            for k in [
                "gestion_undo",
                "gestion_undo_label",
                "mi_muro_undo",
                "mi_muro_undo_label",
                "song_undo",
                "song_undo_label",
                "song_undo_artist",
                "song_undo_artist_label",
            ]:
                request.session.pop(k, None)
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

@require_http_methods(["GET", "POST"])
@csrf_protect
def pantallaLogout(request):
    """
    Cierra la sesión del usuario y establece headers para no cachear.
    """
    # Limpiar toda la sesión
    request.session.flush()
    django_logout(request)
    
    messages.success(request, "Sesión cerrada correctamente.")
    
    # Crear respuesta con headers para no cachear
    response = redirect('login')
    
    # Headers para evitar cacheo del navegador
    response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response['Pragma'] = 'no-cache'
    response['Expires'] = '0'
    
    # Eliminar cookie de sesión si existe
    if hasattr(request, 'session'):
        request.session.flush()
    
    return response