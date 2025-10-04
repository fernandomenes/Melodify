from django.shortcuts import render, redirect
from django.http import HttpResponse
from django.contrib import messages
from .models import Users #importa el modelo de la tab la User
# Create your views here.

def pantallaPrincipal(request):
    print("<--- pantallaPrincipal --->") 
    return render(request, 'inicio_sesion/principal.html')

def pantallaHome(request):
    print("<--- pantallaHome--->") 
    return render(request, 'inicio_sesion/home.html')


def pantallaLogin(request):
    if request.method == 'POST':
        print("Validando Login......") 
        user = request.POST.get('user')
        password = request.POST.get('password') # Debe coincidir con el nombre en login.html
        try:
            # Buscar el usuario y validar la contraseña (¡Inseguro!)
            print("Usuario y Pass Correctos....") 
            usuario_db = Users.objects.get(user=user, password=password)
            # Si se encuentra el usuario con esa contraseña
            # NO estamos usando sesiones de Django, solo redirigiendo
            return redirect('home') 

        except Users.DoesNotExist:
            # Si el usuario o la contraseña no coinciden
            print("Error Usuario o Pass Incorrectos") 
            return render(request, 'inicio_sesion/login.html', {'error': 'Usuario o contraseña incorrectos'})

    print("<--- Pantalla Login --->") 
    return render(request, 'inicio_sesion/login.html')



# (Opcional) Puedes renombrar tu vista principal.html si quieres que sea el login por defecto
# O cambiar el contenido de principal.html