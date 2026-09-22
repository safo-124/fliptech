"""Serializers for provider search and the provider profile.

The list card carries fee, duration and next intake, because Section 04 calls
that the single most important layout decision in the product: it lets someone
rule a provider out without a tap. Those three come from annotations set in the
queryset, not from per-row queries.
"""

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from catalog.models import Intake, Programme
from core.media import public_url
from geography.models import Area, Region

from .models import GovernmentStatus, Provider, ProviderPhoto, Verification


class RegionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Region
        fields = ["id", "name", "slug"]


class AreaSerializer(serializers.ModelSerializer):
    region = RegionSerializer(read_only=True)

    class Meta:
        model = Area
        fields = ["id", "name", "slug", "region"]


class ProviderPhotoSerializer(serializers.ModelSerializer):
    # Not the plain ImageField: DRF would build the URL from the request, and
    # a server-rendered request arrives on loopback. See core/media.py.
    image = serializers.SerializerMethodField()

    class Meta:
        model = ProviderPhoto
        # kind lets the profile show the workshop and the work as two groups.
        # A picture of a tidy yard and a picture of a finished gate answer
        # different questions, and one undifferentiated gallery loses that.
        fields = ["id", "kind", "image", "caption"]

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_image(self, obj):
        return public_url(obj.image.url, self.context.get("request")) if obj.image else None


class VerificationBadgeSerializer(serializers.ModelSerializer):
    """What Fliiptech checked, when, and by whom — in plain words.

    Never merged with government status. Screen 3 states outright that this is
    not a government accreditation, and that disclaimer holds because the two
    are separate objects all the way down to the database.
    """

    officer = serializers.CharField(source="officer.get_full_name", read_only=True)

    class Meta:
        model = Verification
        fields = ["visited_on", "checks_performed", "outcome", "expires_on", "officer"]


class GovernmentStatusSerializer(serializers.ModelSerializer):
    """CTVET status exactly as documented, never inferred.

    Every field here can say no. `registration_status` defaults to "not_claimed"
    and that value is rendered, not hidden — a field that can say no is what
    makes it mean anything when it says yes.
    """

    registration_status_display = serializers.CharField(
        source="get_registration_status_display", read_only=True
    )
    accreditation_status_display = serializers.CharField(
        source="get_accreditation_status_display", read_only=True
    )

    class Meta:
        model = GovernmentStatus
        fields = [
            "registration_status",
            "registration_status_display",
            "registration_number",
            "accreditation_status",
            "accreditation_status_display",
            "documented_on",
            "source_note",
        ]


class IntakeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Intake
        fields = ["id", "start_date", "places_offered", "places_remaining", "is_open"]


class ProgrammeSerializer(serializers.ModelSerializer):
    trade = serializers.CharField(source="trade.name", read_only=True)
    trade_slug = serializers.CharField(source="trade.slug", read_only=True)
    intakes = serializers.SerializerMethodField()

    class Meta:
        model = Programme
        fields = [
            "id",
            "title",
            "trade",
            "trade_slug",
            "fee",
            "instalments_allowed",
            "instalment_note",
            "duration_weeks",
            "hours_per_week",
            "weekly_schedule",
            "capacity",
            "intakes",
        ]

    @extend_schema_field(IntakeSerializer(many=True))
    def get_intakes(self, obj):
        from django.utils import timezone

        upcoming = sorted(
            (
                intake
                for intake in obj.intakes.all()
                if intake.is_open
                and intake.start_date >= timezone.localdate()
                and (intake.places_remaining is None or intake.places_remaining > 0)
            ),
            key=lambda intake: (intake.start_date, intake.pk),
        )
        return IntakeSerializer(upcoming, many=True).data


class ProviderListSerializer(serializers.ModelSerializer):
    """The search result card."""

    area = serializers.CharField(source="area.name", read_only=True)
    area_slug = serializers.CharField(source="area.slug", read_only=True)
    region = serializers.CharField(source="area.region.name", read_only=True)

    # Annotated on the queryset. See ProviderQuerySet.for_card.
    lowest_fee = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    shortest_duration_weeks = serializers.IntegerField(read_only=True)
    next_intake = serializers.DateField(read_only=True)
    distance_m = serializers.SerializerMethodField()

    # Two badges, never one.
    site_visit = serializers.SerializerMethodField()
    government_status = serializers.SerializerMethodField()

    primary_photo = serializers.SerializerMethodField()
    logo = serializers.SerializerMethodField()
    # Screen 2 plots these. Without them the map has nothing to draw, which is
    # why they are on the list serializer rather than only on the detail one.
    lat = serializers.SerializerMethodField()
    lng = serializers.SerializerMethodField()
    listing_confirmed_on = serializers.DateTimeField(source="last_confirmed_at", read_only=True)
    is_stale = serializers.BooleanField(source="is_listing_stale", read_only=True)

    class Meta:
        model = Provider
        fields = [
            "id",
            "name",
            "slug",
            "area",
            "area_slug",
            "region",
            "lowest_fee",
            "shortest_duration_weeks",
            "next_intake",
            "distance_m",
            "site_visit",
            "government_status",
            "primary_photo",
            "logo",
            "lat",
            "lng",
            "listing_confirmed_on",
            "is_stale",
        ]

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_distance_m(self, obj):
        distance = getattr(obj, "distance", None)
        return round(distance.m) if distance is not None else None

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_site_visit(self, obj):
        visit = next(iter(obj.verifications.all()), None)
        if visit is None:
            return None
        return {"visited_on": visit.visited_on, "outcome": visit.outcome}

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_government_status(self, obj):
        status = getattr(obj, "government_status", None)
        if status is None:
            # Absent is a real answer and is rendered as such.
            return {"registration_status": "not_claimed", "label": "Not claimed"}
        return {
            "registration_status": status.registration_status,
            "label": status.get_registration_status_display(),
        }

    @extend_schema_field(serializers.FloatField())
    def get_lat(self, obj):
        return obj.location.y

    @extend_schema_field(serializers.FloatField())
    def get_lng(self, obj):
        return obj.location.x

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_logo(self, obj):
        """Absolute, like primary_photo, and null when the workshop has none.

        Most will have none: the target provider is a master craft person in
        the informal sector. The card falls back to initials rather than
        leaving a hole.
        """
        if not obj.logo:
            return None
        return public_url(obj.logo.url, self.context.get("request"))

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_primary_photo(self, obj):
        photo = next(iter(obj.photos.all()), None)
        if photo is None:
            return None
        return public_url(photo.image.url, self.context.get("request"))


class ProviderDetailSerializer(ProviderListSerializer):
    """The profile screen. Everything above the fold answers one question:
    should I trust this workshop with my money."""

    photos = ProviderPhotoSerializer(many=True, read_only=True)
    programmes = serializers.SerializerMethodField()
    verifications = VerificationBadgeSerializer(many=True, read_only=True)
    government_status_detail = serializers.SerializerMethodField()
    contact_phone = serializers.SerializerMethodField()

    class Meta(ProviderListSerializer.Meta):
        fields = ProviderListSerializer.Meta.fields + [
            "address",
            "owner_name",
            "photos",
            "programmes",
            "verifications",
            "government_status_detail",
            "contact_phone",
        ]

    @extend_schema_field(ProgrammeSerializer(many=True))
    def get_programmes(self, obj):
        active = [p for p in obj.programmes.all() if p.is_active and p.trade.is_active]
        return ProgrammeSerializer(active, many=True).data

    @extend_schema_field(GovernmentStatusSerializer(allow_null=True))
    def get_government_status_detail(self, obj):
        status = getattr(obj, "government_status", None)
        if status is None:
            return None
        return GovernmentStatusSerializer(status).data

    @extend_schema_field(serializers.CharField())
    def get_contact_phone(self, obj):
        return str(obj.contact_phone)
