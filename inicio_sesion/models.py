from django.db import models

# Modelo pata Tabla de Usiarios
class Users(models.Model):
    # La columna 'id' es automática en Django
    user = models.CharField(max_length=100, unique=True)
    password = models.CharField(max_length=100) # Renombrado a 'password' para evitar conflicto con 'pass'
    type = models.CharField(max_length=50)

    def __str__(self):
        return self.user

    # Asegúrate de que el nombre de la tabla coincida si es una tabla existente
    class Meta:
        db_table = 'Users' # Si la tabla existente se llama exactamente 'User'