"""Operational geography administration.

Regions decide where public discovery can launch; areas provide the inventory
and fallback map origin that make those pages useful. Counts are annotated on
the list query so the admin never issues one query per row.
"""

from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin
from django.contrib.gis.db.models import GeometryField
from django.contrib.gis.db.models.functions import IsEmpty
from django.db.models import Count, Q, Subquery
from django.db.models.functions import Cast
from django.utils.html import format_html

from providers.views import MIN_LISTINGS_FOR_GENERATED_PAGE

from .models import Area, Region


def _reset_url(request):
    """Clear list state while retaining Django's popup selection contract."""
    params = request.GET.copy()
    for key in tuple(params):
        if key not in {"_popup", "_to_field"}:
            params.pop(key)
    return f"?{params.urlencode()}" if params else "?"


def _areas_with_usable_centroids():
    """Exclude null and legacy POINT EMPTY values from readiness counts.

    ``centroid`` is stored as PostGIS geography, while ``ST_IsEmpty`` accepts
    geometry. Casting inside the subquery keeps the operational aggregates
    truthful without adding per-row queries.
    """
    return (
        Area.objects.filter(centroid__isnull=False)
        .annotate(
            admin_centroid_is_empty=IsEmpty(Cast("centroid", output_field=GeometryField(srid=4326)))
        )
        .filter(admin_centroid_is_empty=False)
        .order_by()
    )


def _has_usable_centroid(area):
    return area.centroid is not None and not area.centroid.empty


def _region_inventory(queryset):
    """Aggregate the filtered changelist without reusing grouped annotations."""
    region_ids = queryset.order_by().values("pk")
    return Region.objects.filter(pk__in=Subquery(region_ids)).aggregate(
        launched_total=Count("pk", filter=Q(is_launched=True), distinct=True),
        area_total=Count("areas", distinct=True),
        centroid_ready_total=Count(
            "areas",
            filter=Q(areas__pk__in=Subquery(_areas_with_usable_centroids().values("pk"))),
            distinct=True,
        ),
        provider_total=Count("areas__providers", distinct=True),
        published_total=Count(
            "areas__providers",
            filter=Q(areas__providers__status="published"),
            distinct=True,
        ),
        programme_total=Count(
            "areas__providers__programmes",
            filter=Q(
                areas__providers__status="published",
                areas__providers__programmes__is_active=True,
            ),
            distinct=True,
        ),
    )


def _area_inventory(queryset):
    """Aggregate the filtered area list for its summary strip."""
    area_ids = queryset.order_by().values("pk")
    return Area.objects.filter(pk__in=Subquery(area_ids)).aggregate(
        region_total=Count("region", distinct=True),
        centroid_ready_total=Count(
            "pk",
            filter=Q(pk__in=Subquery(_areas_with_usable_centroids().values("pk"))),
            distinct=True,
        ),
        provider_total=Count("providers", distinct=True),
        published_total=Count(
            "providers",
            filter=Q(providers__status="published"),
            distinct=True,
        ),
        programme_total=Count(
            "providers__programmes",
            filter=Q(providers__status="published", providers__programmes__is_active=True),
            distinct=True,
        ),
    )


@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "is_launched",
        "launch_readiness",
        "inventory_summary",
        "centroid_coverage",
    )
    list_editable = ("is_launched",)
    list_filter = ("is_launched",)
    prepopulated_fields = {"slug": ("name",)}
    search_fields = ("name", "slug")
    search_help_text = "Search regions by name or public URL slug."
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        ("Region identity", {"fields": ("name", "slug")}),
        (
            "Public launch",
            {
                "fields": ("is_launched",),
                "description": (
                    "Launch only when the region has useful published inventory. "
                    f"Generated pages need at least {MIN_LISTINGS_FOR_GENERATED_PAGE} published "
                    "providers before they are suitable for indexing."
                ),
            },
        ),
        ("Record", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )
    change_list_template = "admin/geography/region/change_list.html"
    change_form_template = "admin/geography/region/change_form.html"

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                admin_area_count=Count("areas", distinct=True),
                admin_centroid_count=Count(
                    "areas",
                    filter=Q(areas__pk__in=Subquery(_areas_with_usable_centroids().values("pk"))),
                    distinct=True,
                ),
                admin_provider_count=Count("areas__providers", distinct=True),
                admin_published_count=Count(
                    "areas__providers",
                    filter=Q(areas__providers__status="published"),
                    distinct=True,
                ),
                admin_programme_count=Count(
                    "areas__providers__programmes",
                    filter=Q(
                        areas__providers__status="published",
                        areas__providers__programmes__is_active=True,
                    ),
                    distinct=True,
                ),
            )
        )

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context=extra_context)
        if hasattr(response, "context_data") and response.context_data.get("cl"):
            cl = response.context_data["cl"]
            summary = _region_inventory(cl.queryset)
            response.context_data["geography_workspace"] = {
                "kind": "regions",
                "eyebrow": "Geography operations",
                "title": "Region launch readiness",
                "description": (
                    "Control public market launches and see whether each region has enough "
                    "areas, map origins and published training inventory."
                ),
                "matching": cl.result_count,
                "total": cl.full_result_count,
                "reset_url": _reset_url(request),
                "threshold": MIN_LISTINGS_FOR_GENERATED_PAGE,
                "metrics": (
                    {
                        "label": "Launched",
                        "value": summary["launched_total"],
                        "tone": "positive",
                    },
                    {"label": "Areas", "value": summary["area_total"], "tone": "neutral"},
                    {
                        "label": "Centroids ready",
                        "value": summary["centroid_ready_total"],
                        "tone": "info",
                    },
                    {
                        "label": "Published providers",
                        "value": summary["published_total"],
                        "tone": "positive",
                    },
                ),
            }
        return response

    @admin.display(description="Areas", ordering="admin_area_count")
    def area_count(self, obj):
        return getattr(obj, "admin_area_count", 0)

    @admin.display(description="Providers", ordering="admin_provider_count")
    def provider_count(self, obj):
        return getattr(obj, "admin_provider_count", 0)

    @admin.display(description="Programmes", ordering="admin_programme_count")
    def programme_count(self, obj):
        return getattr(obj, "admin_programme_count", 0)

    @admin.display(description="Launch readiness", ordering="admin_published_count")
    def launch_readiness(self, obj):
        published = getattr(obj, "admin_published_count", 0)
        if obj.is_launched and published >= MIN_LISTINGS_FOR_GENERATED_PAGE:
            tone, label, detail = "positive", "Live", f"{published} published"
        elif obj.is_launched:
            tone, label, detail = "attention", "Live · thin", f"{published} published"
        elif published >= MIN_LISTINGS_FOR_GENERATED_PAGE:
            tone, label, detail = "info", "Ready to launch", f"{published} published"
        else:
            tone, label, detail = "muted", "Building inventory", f"{published} published"
        return format_html(
            '<span class="geo-status geo-status--{}"><strong>{}</strong><small>{}</small></span>',
            tone,
            label,
            detail,
        )

    @admin.display(description="Inventory", ordering="admin_provider_count")
    def inventory_summary(self, obj):
        providers = getattr(obj, "admin_provider_count", 0)
        programmes = getattr(obj, "admin_programme_count", 0)
        return format_html(
            '<span class="geo-inventory"><strong>{} providers</strong><small>{} active programmes</small></span>',
            providers,
            programmes,
        )

    @admin.display(description="Map origins", ordering="admin_centroid_count")
    def centroid_coverage(self, obj):
        ready = getattr(obj, "admin_centroid_count", 0)
        areas = getattr(obj, "admin_area_count", 0)
        tone = "positive" if areas and ready == areas else "warning" if ready else "attention"
        return format_html(
            '<span class="geo-coverage geo-coverage--{}"><strong>{}/{}</strong><small>centroids set</small></span>',
            tone,
            ready,
            areas,
        )


@admin.register(Area)
class AreaAdmin(GISModelAdmin):
    list_display = (
        "name",
        "region",
        "centroid_status",
        "inventory_summary",
        "page_readiness",
    )
    list_filter = ("region",)
    prepopulated_fields = {"slug": ("name",)}
    # Provider admin autocompletes on area, which requires search_fields here.
    search_fields = ("name", "slug", "region__name")
    search_help_text = "Search areas by name, public URL slug, or region."
    list_select_related = ("region",)
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        ("Area identity", {"fields": ("region", "name", "slug")}),
        (
            "Fallback search origin",
            {
                "fields": ("centroid",),
                "description": (
                    "Set the point trainees search from when they choose this area but do "
                    "not share browser location. Longitude and latitude are stored as WGS84."
                ),
            },
        ),
        ("Record", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )
    change_list_template = "admin/geography/area/change_list.html"
    change_form_template = "admin/geography/area/change_form.html"

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("region")
            .annotate(
                admin_provider_count=Count("providers", distinct=True),
                admin_published_count=Count(
                    "providers",
                    filter=Q(providers__status="published"),
                    distinct=True,
                ),
                admin_programme_count=Count(
                    "providers__programmes",
                    filter=Q(
                        providers__status="published",
                        providers__programmes__is_active=True,
                    ),
                    distinct=True,
                ),
            )
        )

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context=extra_context)
        if hasattr(response, "context_data") and response.context_data.get("cl"):
            cl = response.context_data["cl"]
            summary = _area_inventory(cl.queryset)
            response.context_data["geography_workspace"] = {
                "kind": "areas",
                "eyebrow": "Search geography",
                "title": "Area coverage",
                "description": (
                    "Maintain public place URLs, fallback search origins and the provider "
                    "inventory that makes each generated area page useful."
                ),
                "matching": cl.result_count,
                "total": cl.full_result_count,
                "reset_url": _reset_url(request),
                "threshold": MIN_LISTINGS_FOR_GENERATED_PAGE,
                "metrics": (
                    {
                        "label": "Regions",
                        "value": summary["region_total"],
                        "tone": "neutral",
                    },
                    {
                        "label": "Centroids ready",
                        "value": summary["centroid_ready_total"],
                        "tone": "info",
                    },
                    {
                        "label": "Providers",
                        "value": summary["provider_total"],
                        "tone": "neutral",
                    },
                    {
                        "label": "Published providers",
                        "value": summary["published_total"],
                        "tone": "positive",
                    },
                ),
            }
        return response

    @admin.display(description="Providers", ordering="admin_provider_count")
    def provider_count(self, obj):
        return getattr(obj, "admin_provider_count", 0)

    @admin.display(description="Centroid set", boolean=True)
    def has_centroid(self, obj):
        """Whether this area can anchor a fallback radius search."""
        return _has_usable_centroid(obj)

    @admin.display(description="Search origin")
    def centroid_status(self, obj):
        if not _has_usable_centroid(obj):
            return format_html(
                '<span class="geo-status geo-status--attention"><strong>{}</strong>'
                "<small>{}</small></span>",
                "Missing",
                "radius search blocked",
            )
        return format_html(
            '<span class="geo-status geo-status--positive"><strong>Ready</strong>'
            "<small>{}, {}</small></span>",
            f"{obj.centroid.y:.4f}",
            f"{obj.centroid.x:.4f}",
        )

    @admin.display(description="Inventory", ordering="admin_provider_count")
    def inventory_summary(self, obj):
        providers = getattr(obj, "admin_provider_count", 0)
        programmes = getattr(obj, "admin_programme_count", 0)
        return format_html(
            '<span class="geo-inventory"><strong>{} providers</strong><small>{} active programmes</small></span>',
            providers,
            programmes,
        )

    @admin.display(description="Page readiness", ordering="admin_published_count")
    def page_readiness(self, obj):
        published = getattr(obj, "admin_published_count", 0)
        if not _has_usable_centroid(obj):
            tone, label, detail = "attention", "Needs centroid", f"{published} published"
        elif published >= MIN_LISTINGS_FOR_GENERATED_PAGE:
            tone, label, detail = "positive", "Index-ready", f"{published} published"
        else:
            tone, label = "warning", "Thin inventory"
            detail = f"{published}/{MIN_LISTINGS_FOR_GENERATED_PAGE} published"
        return format_html(
            '<span class="geo-status geo-status--{}"><strong>{}</strong><small>{}</small></span>',
            tone,
            label,
            detail,
        )
