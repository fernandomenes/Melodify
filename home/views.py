from django.shortcuts import render

def pantallaHome(request):
    print("<--- pantallaHome--->")
    return render(request, "home/home.html")  # Cambiado a home.html