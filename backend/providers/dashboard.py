"""The workshop dashboard, Screen 5.

Authentication here implements the recommendation in SETUP.md rather than a
decision the founder has confirmed, so it is written to be easy to replace.

The constraint is that Section 02 says owners will not maintain their own
profiles and Section 03 names being asked to log in as what makes them give up —
yet Screen 5 is a dashboard they open. The only design consistent with both is a
tokenised link delivered over WhatsApp: no password, no username, no account
creation. The token is a signed provider id with a time limit, so there is no
credential to forget and nothing to store.

If the founder decides providers should have real accounts instead, replace
`provider_from_token` and the view keeps working.
"""

from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db.models import Avg, Count, F, Sum
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.money import money
from enquiries.models import Enquiry, Enrolment

from .models import Provider

TOKEN_SALT = "provider-dashboard"


def make_dashboard_token(provider):
    """Signed, expiring, and safe to put in a WhatsApp message."""
    return signing.dumps({"provider_id": provider.pk}, salt=TOKEN_SALT)


def provider_from_token(token):
    try:
        payload = signing.loads(
            token, salt=TOKEN_SALT, max_age=settings.DASHBOARD_TOKEN_TTL_SECONDS
        )
    except signing.SignatureExpired:
        return None, f"This link has expired. Ask {settings.BRAND_NAME} for a new one."
    except signing.BadSignature:
        return None, "This link is not valid."

    try:
        return Provider.objects.get(pk=payload["provider_id"]), None
    except Provider.DoesNotExist:
        return None, "This listing no longer exists."


def _subscription(provider):
    current = (
        provider.subscriptions.filter(state="active", period_end__gte=timezone.now().date())
        .order_by("-period_end")
        .first()
    )
    if current is None:
        return None
    return {
        "tier": current.get_tier_display(),
        "price": money(current.price),
        "period_end": current.period_end,
    }


def dashboard_payload(provider, *, period_days=30):
    """Screen 5 numbers for one provider.

    A plain function rather than a method because two doors now lead here: the
    tokenised WhatsApp link this module was written for, and a trainer signed
    in with their phone or email. They have to show the same figures — an owner
    who sees one number in a link and a different one after signing in stops
    believing either.
    """
    since = timezone.now() - timedelta(days=period_days)
    enquiries = Enquiry.objects.filter(provider=provider, created_at__gte=since)

    # Response rate is defined narrowly and honestly. The conversation moves to
    # WhatsApp by design, so the platform cannot observe a reply; what it can
    # observe is whether someone recorded one within 48 hours. Anything broader
    # would be a number the software cannot actually support.
    answered = enquiries.filter(
        outcome__replied=True,
        outcome__replied_at__lte=F("created_at") + timedelta(hours=48),
    ).count()
    total = enquiries.count()

    enrolments = Enrolment.objects.filter(provider=provider, started_on__gte=since.date())
    enrolment_stats = enrolments.aggregate(
        count=Count("id"), fees=Sum("fee_paid"), average_fee=Avg("fee_paid")
    )

    return {
        "provider": {"name": provider.name, "slug": provider.slug},
        "period_days": period_days,
        "enquiries": total,
        # Profile views need an analytics source, which is not in the stack
        # yet. Reporting null is better than reporting a zero that looks like
        # nobody looked.
        "profile_views": None,
        "response_rate": round(answered / total, 3) if total else None,
        "response_rate_basis": "Enquiries marked replied within 48 hours",
        "enrolments": enrolment_stats["count"],
        "enrolment_fees_cedis": money(enrolment_stats["fees"]),
        "average_fee_cedis": money(enrolment_stats["average_fee"]),
        "enrolments_basis": (
            f"Recorded by {settings.BRAND_NAME} during the monthly visit. Enrolment happens "
            "offline and cannot be measured automatically."
        ),
        "listing": {
            "status": provider.status,
            "last_confirmed_at": provider.last_confirmed_at,
            "is_stale": provider.is_listing_stale,
        },
        "subscription": _subscription(provider),
    }


def enquiry_payload(provider, *, limit=100):
    """The enquiries themselves, so the numbers above can be acted on."""
    enquiries = (
        Enquiry.objects.filter(provider=provider)
        .select_related("programme")
        .order_by("-created_at")[:limit]
    )
    return [
        {
            "reference_code": enquiry.reference_code,
            "programme": enquiry.programme.title if enquiry.programme else None,
            "trainee_name": enquiry.trainee_name,
            "trainee_phone": str(enquiry.trainee_phone),
            "message": enquiry.message,
            "created_at": enquiry.created_at,
            "replied": getattr(enquiry, "outcome", None) is not None and enquiry.outcome.replied,
        }
        for enquiry in enquiries
    ]


class ProviderDashboardView(APIView):
    """The four numbers that justify the subscription fee.

    A subscription renews when the owner can see what it bought, so this leads
    with enquiries, views, response rate and enrolments.
    """

    @extend_schema(responses={200: None})
    def get(self, request, token):
        provider, error = provider_from_token(token)
        if provider is None:
            return Response({"detail": error}, status=status.HTTP_403_FORBIDDEN)
        return Response(dashboard_payload(provider))


class ProviderEnquiryListView(APIView):
    """The enquiries themselves, reached by the tokenised link."""

    @extend_schema(responses={200: None})
    def get(self, request, token):
        provider, error = provider_from_token(token)
        if provider is None:
            return Response({"detail": error}, status=status.HTTP_403_FORBIDDEN)
        return Response(enquiry_payload(provider))
