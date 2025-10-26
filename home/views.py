from django.shortcuts import render

# Create your views here.
def pantallaHome(request):
    print("<--- pantallaHome--->")
    return render(request, 'home/homebase.html')

