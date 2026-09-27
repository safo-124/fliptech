from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("trainees", "0003_historicaltraineeaccount_email_and_more"),
    ]

    operations = [
        # simple_history stores a file field as text: it records the stored
        # name, never the file. See providers/0008 for the same pair.
        migrations.AddField(
            model_name="historicaltraineeaccount",
            name="avatar",
            field=models.TextField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="traineeaccount",
            name="avatar",
            field=models.ImageField(blank=True, upload_to="trainees/%Y/%m/"),
        ),
    ]
