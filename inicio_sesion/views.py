from django.shortcuts import render
from django.http import HttpResponse
# Create your views here.

def pantallaPrincipal(request):
    return render(request, 'inicio_sesion/principal.html')

def pantallaLogin(request):
    return render(request, 'inicio_sesion/login.html')

def pantallaHome(request):
    return render(request, 'inicio_sesion/home.html')