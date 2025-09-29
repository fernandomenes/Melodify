
from django.urls import path
from . import views

urlpatterns = [
    path('', views.pantallaPrincipal, name='principal'),
    path('login', views.pantallaLogin, name='login'),
    path('home', views.pantallaHome, name='home'),
]