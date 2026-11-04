"""Online learning: the workshops' approved videos, browsed as courses.

A course is a workshop's lessons, in the order they were added. It is not a
separate thing a trainer creates: a workshop that has sent "Lesson 1",
"Lesson 2" and so on already has one, and asking them to build a course
around their uploads would be a form standing between them and teaching.

Only what the listing itself would show: a published workshop, and videos
staff have approved. The same two rules as the profile page, so nothing can
be watched here that could not be watched there.
"""

from datetime import timedelta

from django.db.models import (
    Avg,
    BooleanField,
    Case,
    Count,
    F,
    IntegerField,
    Max,
    OuterRef,
    Prefetch,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce
from django.utils import timezone
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
    from courses.models import CourseReview, LessonPlayDay

    now = timezone.now()
    reviews = CourseReview.objects.filter(provider=OuterRef("pk"), is_hidden=False).values(
        "provider"
    )
    recent_plays = (
        LessonPlayDay.objects.filter(
            provider=OuterRef("pk"), day__gte=timezone.localdate() - timedelta(days=30)
        )
        .values("provider")
        .annotate(total=Sum("plays"))
        .values("total")[:1]
    )
    return (
        Provider.objects.published()
        .annotate(
            lesson_count=Count("videos", filter=APPROVED),
            total_seconds=Sum("videos__duration_seconds", filter=APPROVED),
            last_approved=Max("videos__reviewed_at", filter=APPROVED),
            rating_average=Subquery(reviews.annotate(a=Avg("rating")).values("a")[:1]),
            rating_count=Coalesce(
                Subquery(reviews.annotate(c=Count("id")).values("c")[:1]),
                Value(0),
                output_field=IntegerField(),
            ),
            recent_plays=Coalesce(Subquery(recent_plays), Value(0), output_field=IntegerField()),
            featured=Case(
                When(course_offer__featured_until__gt=now, then=Value(True)),
                default=Value(False),
                output_field=BooleanField(),
            ),
            charges=Case(
                When(
                    Q(course_offer__price__isnull=False) & ~Q(course_offer__paystack_subaccount=""),
                    then=Value(True),
                ),
                default=Value(False),
                output_field=BooleanField(),
            ),
        )
        .filter(lesson_count__gt=0)
        .select_related("area", "course_offer")
        .prefetch_related(
            Prefetch(
                "videos",
                queryset=ProviderVideo.objects.shown()
                .in_course_order()
                .prefetch_related("captions"),
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
        .order_by("-featured", F("last_approved").desc(nulls_last=True), "pk")
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
    full_price = serializers.SerializerMethodField()
    level = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    rating = serializers.SerializerMethodField()
    reviews = serializers.IntegerField(source="rating_count", read_only=True, default=0)
    featured = serializers.BooleanField(read_only=True, default=False)

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
            "full_price",
            "level",
            "summary",
            "rating",
            "reviews",
            "featured",
        ]

    def _offer(self, obj):
        from courses.access import offer_for

        return offer_for(obj)

    @extend_schema_field(serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True))
    def get_price(self, obj):
        """Cedis for the whole course today, or null when it is free to watch."""
        offer = self._offer(obj)
        return f"{offer.current_price:.2f}" if offer is not None and offer.is_paid else None

    @extend_schema_field(serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True))
    def get_full_price(self, obj):
        """The price before a launch sale, while one is on."""
        offer = self._offer(obj)
        return (
            f"{offer.price:.2f}" if offer is not None and offer.is_paid and offer.on_sale else None
        )

    @extend_schema_field(serializers.CharField())
    def get_level(self, obj):
        offer = self._offer(obj)
        return offer.level if offer is not None else ""

    @extend_schema_field(serializers.CharField())
    def get_summary(self, obj):
        offer = self._offer(obj)
        return (offer.summary[:180] if offer is not None else "") or ""

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_rating(self, obj):
        average = getattr(obj, "rating_average", None)
        return round(float(average), 1) if average else None

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

    SORTS = {
        "newest": (F("last_approved").desc(nulls_last=True), "pk"),
        "popular": (
            "-recent_plays",
            "-rating_count",
            F("last_approved").desc(nulls_last=True),
            "pk",
        ),
        "rating": (F("rating_average").desc(nulls_last=True), "-rating_count", "pk"),
        "free": ("charges", "-featured", F("last_approved").desc(nulls_last=True), "pk"),
    }

    def get_queryset(self):
        return browse_courses(self.request.query_params)

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        params = request.query_params
        if params.get("q") and params.get("page") in (None, "", "1"):
            from search.log import record

            record(params.get("q"), "learn", response.data.get("count", 0), request)
        return response


def browse_courses(params):
    """The course list's filters and sort, for the list and for site search."""
    courses = _courses()
    trade = params.get("trade")
    if trade:
        teaching = Programme.objects.filter(
            is_active=True, trade__is_active=True, trade__slug=trade
        ).values("provider_id")
        courses = courses.filter(pk__in=teaching)
    words = " ".join(str(params.get("q") or "").split())[:80]
    if words:
        trades = Programme.objects.filter(is_active=True).filter(
            Q(trade__name__icontains=words) | Q(title__icontains=words)
        )
        lessons = ProviderVideo.objects.shown().filter(
            Q(title__icontains=words) | Q(description__icontains=words)
        )
        courses = courses.filter(
            Q(name__icontains=words)
            | Q(area__name__icontains=words)
            | Q(course_offer__summary__icontains=words)
            | Q(pk__in=trades.values("provider_id"))
            | Q(pk__in=lessons.values("provider_id"))
        )
    level = params.get("level")
    if level:
        courses = courses.filter(course_offer__level=level)
    if params.get("featured") in ("1", "true"):
        courses = courses.filter(featured=True)
    if params.get("price") == "free":
        courses = courses.filter(charges=False)
    elif params.get("price") == "paid":
        courses = courses.filter(charges=True)
    sort = CourseListView.SORTS.get(params.get("sort") or "")
    if sort:
        courses = courses.order_by(*sort)
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
        from courses.access import offer_for
        from courses.learner import rating_summary

        offer = offer_for(course)
        return Response(
            {
                "course": CourseCardSerializer(course, context=context).data,
                "lessons": ProviderVideoSerializer(lessons, many=True, context=context).data,
                "details": {
                    "summary": offer.summary if offer else "",
                    "outcomes": offer.lines("outcomes") if offer else [],
                    "tools": offer.lines("tools") if offer else [],
                    "level": offer.level if offer else "",
                    "sale_ends_at": offer.sale_ends_at if offer and offer.on_sale else None,
                },
                "ratings": rating_summary(course),
                # Learning it in person: the bundle offered once the videos
                # are done.
                "programmes": [
                    {
                        "id": programme.id,
                        "title": programme.title,
                        "trade": programme.trade.name,
                        "fee": f"{programme.fee:.2f}",
                        "duration_weeks": programme.duration_weeks,
                    }
                    for programme in course.active_programmes
                ],
            }
        )
