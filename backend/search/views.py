"""Site search: everything at once as the visitor types, a light list of
suggestions for the box itself, help when nothing matches, and "text me when
one opens" alerts.

All of it reuses the searches the section pages already run (the workshop
filter, browse_courses, the marketplace's browse), so a result here is one
the section page would show for the same words.
"""

from django.contrib.gis.db.models.functions import Distance
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsCustomer, _account
from catalog.models import Programme, Trade
from geography.models import Area
from providers.filters import ProviderFilter
from providers.models import Provider
from providers.views import _point_from_query, sort_providers

from .log import record
from .models import TrainingAlert
from .understand import normalise, understand

WORKSHOPS = 6
COURSES = 4
PRODUCTS = 4
SHOPS = 4
NEARBY = 3


def _trade_payload(trade):
    return {"slug": trade.slug, "name": trade.name, "colour": trade.colour}


def _area_payload(area):
    return {"slug": area.slug, "name": area.name, "region": area.region.name}


def _workshops(query, origin, request):
    from providers.serializers import ProviderListSerializer

    base = Provider.objects.published().for_card().with_related()
    params = {"q": query}
    if origin is not None:
        base = base.annotate(distance=Distance("location", origin))
        params["sort"] = "nearest"
    found = sort_providers(ProviderFilter(data={"q": query}, queryset=base).qs, params)
    return found.count(), ProviderListSerializer(
        found[:WORKSHOPS], many=True, context={"request": request}
    ).data


def _courses(understood, query, request):
    from providers.learning import CourseCardSerializer, browse_courses

    found = None
    if understood.trade is not None:
        params = {"trade": understood.trade.slug}
        if understood.words:
            params["q"] = understood.words
        found = browse_courses(params)
        if understood.words and not found.exists():
            found = browse_courses({"trade": understood.trade.slug})
    if found is None or not found.exists():
        found = browse_courses({"q": query})
    return found.count(), CourseCardSerializer(
        found[:COURSES], many=True, context={"request": request}
    ).data


def _products(understood, query, request):
    from marketplace.serializers import ProductCardSerializer
    from marketplace.views import _with_ratings, browse

    found = None
    if understood.trade is not None:
        params = {"trade": understood.trade.slug}
        if understood.area is not None:
            params["area"] = understood.area.slug
        if understood.words:
            params["q"] = understood.words
        found = browse(params)
        if not found.exists():
            found = None
    if found is None:
        found = browse({"q": query})
    return found.count(), _with_ratings(ProductCardSerializer, found[:PRODUCTS], request)


def _shops(understood, query, request):
    from django.contrib.postgres.search import TrigramSimilarity

    from marketplace.models import Product, SellerAccount
    from marketplace.serializers import SellerCardSerializer

    words = understood.words or query
    selling = Product.objects.visible().filter(seller=OuterRef("pk"))
    found = (
        SellerAccount.objects.filter(Exists(selling))
        .annotate(similarity=TrigramSimilarity("business_name", words))
        .filter(Q(similarity__gt=0.2) | Q(business_name__icontains=words))
        .select_related("area", "area__region", "provider")
        .order_by("-similarity", "business_name", "pk")
    )
    return found.count(), SellerCardSerializer(
        found[:SHOPS], many=True, context={"request": request}
    ).data


def _matching_trades(understood, query):
    ids = ([understood.trade.pk] if understood.trade else []) + list(understood.also)
    if not ids and query:
        ids = list(
            Trade.objects.filter(is_active=True)
            .filter(Q(name__icontains=query) | Q(synonyms__icontains=query))
            .values_list("pk", flat=True)[:4]
        )
    trades = {
        trade.pk: trade
        for trade in Trade.objects.filter(pk__in=ids, is_active=True).annotate(
            provider_count=Count(
                "programmes__provider",
                distinct=True,
                filter=Q(
                    programmes__is_active=True,
                    programmes__provider__status=Provider.Status.PUBLISHED,
                ),
            )
        )
    }
    return [
        {**_trade_payload(trades[pk]), "provider_count": trades[pk].provider_count}
        for pk in ids
        if pk in trades
    ]


def nearby(trade, area, request, exclude_area=True):
    """The closest workshops teaching a trade, measured from an area's centre.

    For a search that found nothing in the place asked for: "no welding in
    Tema, but there are 3 in Madina, 8 km away".
    """
    from providers.serializers import ProviderListSerializer

    teaching = Programme.objects.filter(
        provider=OuterRef("pk"), is_active=True, trade=trade, trade__is_active=True
    )
    found = Provider.objects.published().for_card().with_related().filter(Exists(teaching))
    if area is not None and exclude_area:
        found = found.exclude(area=area)
    if area is not None and area.centroid is not None:
        found = found.annotate(distance=Distance("location", area.centroid)).order_by(
            "distance", "name", "pk"
        )
    else:
        found = found.order_by("name", "pk")
    return ProviderListSerializer(found[:NEARBY], many=True, context={"request": request}).data


def _trades_in(area):
    """What is taught in an area, for "or try one of these here"."""
    if area is None:
        return []
    return [
        _trade_payload(trade)
        for trade in Trade.objects.filter(
            is_active=True,
            programmes__is_active=True,
            programmes__provider__status=Provider.Status.PUBLISHED,
            programmes__provider__area=area,
        )
        .distinct()
        .order_by("display_order", "name")[:6]
    ]


class SearchView(APIView):
    """Everything that matches, a few of each, for the search page as the
    visitor types. ?log=1 counts it in the staff report: the page sends it
    once the visitor stops typing, not on every key."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("q", OpenApiTypes.STR),
            OpenApiParameter("lat", OpenApiTypes.NUMBER),
            OpenApiParameter("lng", OpenApiTypes.NUMBER),
            OpenApiParameter("log", OpenApiTypes.BOOL),
        ],
        responses={200: None},
    )
    def get(self, request):
        query = normalise(request.query_params.get("q"))
        if not query:
            return Response({"detail": _("Type something to search for.")}, status=400)
        understood = understand(query)
        origin = _point_from_query(request.query_params)

        workshop_count, workshops = _workshops(query, origin, request)
        course_count, courses = _courses(understood, query, request)
        product_count, products = _products(understood, query, request)
        shop_count, shops = _shops(understood, query, request)
        total = workshop_count + course_count + product_count + shop_count

        body = {
            "q": query,
            "understood": {
                "trade": _trade_payload(understood.trade) if understood.trade else None,
                "area": _area_payload(understood.area) if understood.area else None,
                "words": understood.words,
            },
            "trades": _matching_trades(understood, query),
            "workshops": {"count": workshop_count, "results": workshops},
            "courses": {"count": course_count, "results": courses},
            "products": {"count": product_count, "results": products},
            "shops": {"count": shop_count, "results": shops},
            "nearby": [],
            "trades_here": [],
        }
        if not workshop_count and understood.trade is not None:
            body["nearby"] = nearby(understood.trade, understood.area, request)
            body["trades_here"] = _trades_in(understood.area)
        if request.query_params.get("log") in ("1", "true"):
            record(query, "all", total, request)
        return Response(body)


class SuggestView(APIView):
    """A short list under the search box as someone types: trades, "trade in
    area", areas, and workshops, courses and products by name. Light enough to
    ask for on every key."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(parameters=[OpenApiParameter("q", OpenApiTypes.STR)], responses={200: None})
    def get(self, request):
        query = normalise(request.query_params.get("q"))
        if len(query) < 2:
            return Response({"results": []})
        understood = understand(query)
        items = []

        if understood.trade is not None and understood.area is not None:
            items.append(
                {
                    "kind": "trade_area",
                    "label": _("%(trade)s in %(area)s")
                    % {"trade": understood.trade.name, "area": understood.area.name},
                    "trade": understood.trade.slug,
                    "area": understood.area.slug,
                }
            )
        for trade in _matching_trades(understood, query)[:3]:
            items.append(
                {
                    "kind": "trade",
                    "label": trade["name"],
                    "trade": trade["slug"],
                    "count": trade["provider_count"],
                }
            )
        if understood.area is None:
            for area in Area.objects.select_related("region").filter(name__istartswith=query)[:2]:
                items.append({"kind": "area", "label": area.name, "area": area.slug})

        words = understood.words or (query if understood.trade is None else "")
        if words:
            workshops = Provider.objects.published().filter(name__icontains=words)
            if understood.trade is not None:
                # "weld tem": Tema workshops that teach welding, not every Tema workshop.
                workshops = workshops.filter(
                    Exists(
                        Programme.objects.filter(
                            provider=OuterRef("pk"), is_active=True, trade=understood.trade
                        )
                    )
                )
            workshops = workshops.select_related("area").order_by("name")[:3]
            items += [
                {
                    "kind": "workshop",
                    "label": w.name,
                    "sub": w.area.name,
                    "slug": w.slug,
                    "area": w.area.slug,
                }
                for w in workshops
            ]
            from marketplace.models import Product

            products = (
                Product.objects.visible()
                .filter(name__icontains=words)
                .select_related("seller")
                .order_by("-created_at")[:2]
            )
            items += [
                {"kind": "product", "label": p.name, "sub": p.seller.business_name, "id": p.pk}
                for p in products
            ]
        return Response({"q": query, "results": items[:8]})


class NearbyView(APIView):
    """For a training search that found nothing: the nearest workshops for the
    trade, and what else is taught in the area."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("trade", OpenApiTypes.STR),
            OpenApiParameter("area", OpenApiTypes.STR),
            OpenApiParameter("q", OpenApiTypes.STR),
        ],
        responses={200: None},
    )
    def get(self, request):
        params = request.query_params
        understood = understand(params.get("q") or "")
        trade = (
            Trade.objects.filter(slug=params.get("trade"), is_active=True).first()
            if params.get("trade")
            else understood.trade
        )
        area = (
            Area.objects.select_related("region").filter(slug=params.get("area")).first()
            if params.get("area")
            else understood.area
        )
        return Response(
            {
                "trade": _trade_payload(trade) if trade else None,
                "area": _area_payload(area) if area else None,
                "nearby": nearby(trade, area, request) if trade else [],
                "trades_here": _trades_in(area),
            }
        )


def _alert_payload(alert):
    return {
        "id": alert.pk,
        "trade": _trade_payload(alert.trade),
        "area": _area_payload(alert.area) if alert.area_id else None,
        "created_at": alert.created_at,
    }


class TrainingAlertsView(APIView):
    """Signed-in: the training alerts kept, and POST {trade, area?} to keep one."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={200: None})
    def get(self, request):
        account = _account(request)
        alerts = account.training_alerts.select_related("trade", "area", "area__region")
        return Response({"results": [_alert_payload(a) for a in alerts]})

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        account = _account(request)
        trade = Trade.objects.filter(slug=request.data.get("trade"), is_active=True).first()
        if trade is None:
            return Response({"detail": _("Choose a trade first.")}, status=400)
        area = None
        if request.data.get("area"):
            area = Area.objects.select_related("region").filter(slug=request.data["area"]).first()
            if area is None:
                return Response({"detail": _("That area is not on the list.")}, status=400)
        existing = account.training_alerts.filter(trade=trade, area=area).first()
        if existing is not None:
            return Response(_alert_payload(existing))
        if account.training_alerts.count() >= TrainingAlert.LIMIT:
            return Response(
                {
                    "detail": _("You can keep %(n)s alerts. Delete one first.")
                    % {"n": TrainingAlert.LIMIT}
                },
                status=status.HTTP_409_CONFLICT,
            )
        alert = TrainingAlert.objects.create(
            account=account, trade=trade, area=area, checked_at=timezone.now()
        )
        return Response(_alert_payload(alert), status=status.HTTP_201_CREATED)


class TrainingAlertView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsCustomer]

    @extend_schema(responses={204: None})
    def delete(self, request, pk):
        account = _account(request)
        account.training_alerts.filter(pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
