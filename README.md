# Melodify

Melodify es una plataforma de streaming musical con enfoque social (usuarios, artistas, playlists colaborativas, retos, etc.) desarrollada en **Python/Django**.
Este README resume cómo instalar, ejecutar, probar y contribuir al proyecto.

## EQUIPO: COFFEE & BUGS
- Carlos Eduardo Gónzalez Arceo
- Rodrigo Galeana Vidaurri
- Juan Gabriel López Hernández
- Fernando Mendoza Eslava

![Logo del proyecto](Imágenes/Logo.png)

## Requisitos
- Python 3.11+
- Git
- SQLite (incluido con Python)
- PowerShell (Windows) o make (Linux/macOS)
- Django==4.2.*
- Pillow>=10,<11

## Estructura del proyecto
```
Melodify/
├─ melodify/                 # Proyecto Django
├─ inicio_sesion/            # App principal (modelos, vistas, estáticos, templates)
│  ├─ static/inicio_sesion/  # JS/CSS/imagenes (homeScript, reproductor, etc.)
│  └─ templates/inicio_sesion/  # HTML (home, mi_musica, muro_artista, etc.)
├─ uploaded_media/           # Archivos subidos (audio, portadas, avatares)
├─ static/                   # Raíz de estáticos para dev
├─ requirements.txt
├─ Makefile
├─ run-dev.ps1               # Script de arranque rápido en Windows
└─ manage.py
```

## Instalación y primer arranque

### Opción A — Linux/macOS
Usa make para configurar y ejecutar todo:
```bash
make dev
```
Este comando:
1. Crea el entorno virtual
2. Instala dependencias
3. Aplica migraciones
4. Crea usuarios de prueba
5. Inicia el servidor (localhost:8000)

### Opción B — Windows (recomendado)
Solo necesitas hacer doble clic en run-dev.ps1 o ejecutarlo así:
```powershell
.
un-dev.ps1
```
El script realiza automáticamente:
- Creación de entorno virtual (.venv)
- Instalación de dependencias desde requirements.txt
- Migraciones
- Creación de usuarios de prueba
- Ejecución del servidor en http://127.0.0.1:8000

## Usuarios de prueba
| Rol | Usuario | Contraseña |
|-----|----------|-------------|
| Administrador | admin | admin123 |
| Artista | artist | artist123 |
| Usuario estándar | viewer | viewer123 |

## Frontend: reproductor y SPA
Archivos principales: inicio_sesion/static/inicio_sesion/
- homeScript.js — SPA del Home (router, menús, navegación interna)
- reproductor.js — Lógica completa del reproductor (cola, barra, volumen, reproducción exclusiva)
- ComponentStyles.css, GlobalStyles.css, reproductor.css — Estilos modulares

El reproductor detecta listas .song-item y maneja play/pause, anterior/siguiente, seek, volumen, y evita reproducir múltiples audios simultáneamente.

## Pruebas
```bash
make test
make coverage
```

## Comandos útiles (Makefile)
| Comando | Descripción |
|----------|-------------|
| make dev | Configura entorno, aplica migraciones y ejecuta |
| make run / make runnet | Servidor local / LAN |
| make reset-db | Borra y recrea la base de datos |
| make clean-media | Elimina archivos subidos |
| make superclean | Limpia todo (db, media, pycache) |

## Dependencias (requirements.txt)
```
Django==4.2.*
Pillow>=10,<11
```

## Iteración 1 — Flujos cubiertos
Basado en los documentos de Plan del Proyecto 3.0 y Especificación de Requerimientos — Iteración 1:

- Subir, eliminar y reproducir canciones
- Barra de reproducción persistente
- Validaciones de audio y portadas
- Vista “Mi música” y muro de artista
- Roles: Administrador, Artista, Usuario estándar

## FAQ
1. Si run-dev.ps1 no se ejecuta, desbloquéalo con:
   ```powershell
   Set-ExecutionPolicy -Scope Process RemoteSigned
   ```
2. Si algo falla en migraciones:
   ```powershell
   make reset-db
   ```
3. Si no se ven estilos, verifica que las carpetas static/ y uploaded_media/ existan.
4. Si cambias de rama, puedes limpiar tu entorno con:
   ```powershell
   git clean -fd && git reset --hard origin/Fernando
   ```

Desarrollado por el equipo Coffee & Bugs
