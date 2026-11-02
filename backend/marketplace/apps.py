from django.apps import AppConfig


class MarketplaceConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "marketplace"
    verbose_name = "Marketplace"

    def ready(self):
        # Product and shop pages refresh as soon as a seller changes them.
        from . import page_refresh

        page_refresh.connect()
