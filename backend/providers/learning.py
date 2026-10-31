"""Online learning: the workshops' approved videos, browsed as courses.

A course is a workshop's lessons, in the order they were added. It is not a
separate thing a trainer creates: a workshop that has sent "Lesson 1",
"Lesson 2" and so on already has one, and asking them to build a course
around their uploads would be a form standing between them and teaching.

Only what the listing itself would show: a published workshop, and videos
staff have approved. The same two rules as the profile page, so nothing can
be watched here that could not be watched there.
"""

from django.db.models import Count, Max, Prefetch, Q, Sum
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, extend_schema_field
from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Programme
from core.media import public_url

from .models import Provider, ProviderVideo
from .serializers import ProviderVideoSerializer

APPROVED = Q(videos__status=ProviderVideo.Status.APPROVED)


def _courses():
    """Published workshops with at least one approved lesson, newest first.

    Videos are the only many-valued join here, so the count and the sum are
    each over one workshop's videos and nothing else. The trade filter is a
    subquery for the same reason: joining courses as well would count every
    lesson once per course.
    """
    return (
        Provider.objects.published()
        .annotate(
            lesson_count=Count("videos", filter=APPROVED),
            total_seconds=Sum("videos__duration_seconds", filter=APPROVED),
            last_approved=Max("videos__reviewed_at", filter=APPROVED),
        )
        .filter(lesson_count__gt=0)
        .select_related("area", "course_offer")
        .prefetch_related(
            Prefetch(
                "videos",
                queryset=ProviderVideo.objects.shown().order_by("created_at"),
                to_attr="shown_videos",
            ),
            Prefetch(
                "programmes",
                queryset=Programme.objects.filter(is_active=True, trade__is_active=True)
                .select_related("trade")
                .order_by("fee", "pk"),
                to_attr="active_programmes",
            ),
        )
        .order_by("-last_approved", "pk")
    )


def _trade(provider):
    programme = next(iter(provider.active_programmes), None)
    if programme is None:
        return None
    trade = programme.trade
    return {"name": trade.name, "slug": trade.slug, "colour": trade.colour}


def _poster(video, request):
    if video.is_youtube:
        return video.thumbnail_url
    if video.public_poster:
        return public_url(video.public_poster.url, request)
    return None


class CourseCardSerializer(serializers.ModelSerializer):
    area = serializers.CharField(source="area.name", read_only=True)
    area_slug = serializers.CharField(source="area.slug", read_only=True)
    lessons = serializers.IntegerField(source="lesson_count", read_only=True)
    total_seconds = serializers.IntegerField(read_only=True, allow_null=True)
    trade = serializers.SerializerMethodField()
    poster = serializers.SerializerMethodField()
    price = serializers.SerializerMethodField()

    class Meta:
        model = Provider
        fields = [
            "id",
            "name",
            "slug",
            "area",
            "area_slug",
            "trade",
            "lessons",
            "total_seconds",
            "poster",
            "price",
        ]

    @extend_schema_field(serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True))
    def get_price(self, obj):
        """Cedis for the whole course, or null when it is free to watch."""
        from courses.access import offer_for

        offer = offer_for(obj)
        return f"{offer.price:.2f}" if offer is not None and offer.is_paid else None

    @extend_schema_field(OpenApiTypes.OBJECT)
    def get_trade(self, obj):
        return _trade(obj)

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_poster(self, obj):
        first = next(iter(obj.shown_videos), None)
        return _poster(first, self.context.get("request")) if first else None


class CourseListView(ListAPIView):
    """Every course, optionally for one trade (?trade=<slug>)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = CourseCardSerializer

    def get_queryset(self):
        courses = _courses()
        trade = self.request.query_params.get("trade")
        if trade:
            teaching = Programme.objects.filter(
                is_active=True, trade__is_active=True, trade__slug=trade
            ).values("provider_id")
            courses = courses.filter(pk__in=teaching)
        return courses


class CourseDetailView(APIView):
    """One workshop's lessons, in order, at /learn/<area>/<workshop>."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, area_slug, slug):
        course = _courses().filter(area__slug=area_slug, slug=slug).first()
        # No approved lessons is a 404 rather than an empty course: an empty
        # page at a public address reads as a broken one.
        if course is None:
            raise NotFound("No such course.")
        # Cached and served to everybody, so always the stranger's view:
        # locked lessons without their files. /access/ adds what this viewer
        # may watch, after the page has loaded.
        from courses.access import gate_for

        lessons = list(course.shown_videos)
        context = {"request": request, "gates": {course.pk: gate_for(course, None, videos=lessons)}}
        return Response(
            {
                "course": CourseCardSerializer(course, context=context).data,
                "lessons": ProviderVideoSerializer(lessons, many=True, context=context).data,
            }
        )
