from django.urls import path

from . import views

urlpatterns = [
    path("home/", views.pantallaHome, name="home"),
]
