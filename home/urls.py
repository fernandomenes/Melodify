from django.urls import path
from . import views

urlpatterns = [
    path("", views.pantallaHome, name="home"),
]