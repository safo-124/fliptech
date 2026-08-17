from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import Area, Region


@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
    list_display = ("name", "is_launched", "area_count", "provider_count")
    list_editable = ("is_launched",)
    prepopulated_fields = {"slug": ("name",)}
    search_fields = ("name",)

    @admin.display(description="Areas")
    def area_count(self, obj):
        return obj.areas.count()

    @admin.display(description="Providers")
    def provider_count(self, obj):
        from providers.models import Provider

        return Provider.objects.filter(area__region=obj).count()


@admin.register(Area)
class AreaAdmin(GISModelAdmin):
    list_display = ("name", "region", "provider_count", "has_centroid")
    list_filter = ("region",)
    prepopulated_fields = {"slug": ("name",)}
    # Provider admin autocompletes on area, which requires search_fields here.
    search_fields = ("name", "region__name")
    list_select_related = ("region",)

    @admin.display(description="Providers")
    def provider_count(self, obj):
        return obj.providers.count()

    @admin.display(description="Centroid set", boolean=True)
    def has_centroid(self, obj):
        """The fallback origin for radius search when a trainee declines the
        browser location prompt. An area without one cannot anchor a search."""
        return obj.centroid is not None
