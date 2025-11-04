# inicio_sesion/migrations/0003_users_extras.py
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    # Si tu 0002 se llama diferente, ajusta la dependencia al nombre real.
    dependencies = [
        ("inicio_sesion", "0002_artistprofile"),
    ]

    operations = [
        migrations.AddField(
            model_name="users",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="users",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="users",
            name="avatar",
            field=models.ImageField(upload_to="uploaded_avatars/", null=True, blank=True),
        ),
    ]
