"""Screen 5 for a trainer who is signed in, rather than holding a link.

The tokenised dashboard in dashboard.py was written when the only way to reach
Screen 5 was a signed WhatsApp link, because Section 02 assumed owners would
not maintain their own profiles and Section 03 named being asked to log in as
what makes them give up.

Trainer accounts changed that without changing this. A trainer who signed in
with their phone or email saw their listing status and a line telling them
their performance dashboard was still available through a WhatsApp link they
may no longer have. Section 05 is explicit that a subscription renews when the
owner can see what it bought — so the owner has to be able to see it from the
place they already are.

Both doors call the same dashboard_payload, deliberately. An owner who sees
one figure in a link and a different one after signing in stops believing
either.

The token route stays. It is still the only thing that works for a provider
staff onboarded who has never signed in.
"""

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from enquiries.models import Enquiry, EnquiryOutcome

from .dashboard import dashboard_payload, enquiry_payload
from .trainer_views import IsActiveTrainer, _account, _profile_for


class TrainerOwnDashboardView(APIView):
    """The four numbers, scoped to the signed-in trainer's own listing.

    Scoped through the membership rather than an id in the URL: there is no
    provider id to tamper with, so the only listing reachable here is the one
    this account owns.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(responses={200: None})
    def get(self, request):
        provider = _profile_for(_account(request))
        if provider is None:
            raise NotFound("No listing exists for this account yet.")
        return Response(dashboard_payload(provider))


class TrainerOwnEnquiriesView(APIView):
    """The enquiries behind the numbers.

    A count nobody can act on is a vanity metric. This is the list the owner
    calls back, which is the only reason the count matters.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(responses={200: None})
    def get(self, request):
        provider = _profile_for(_account(request))
        if provider is None:
            raise NotFound("No listing exists for this account yet.")
        return Response(enquiry_payload(provider))


class TrainerEnquiryRepliedView(APIView):
    """Let the owner say they have answered an enquiry.

    Until now "replied" could only be set by staff, during the monthly
    conversation. So the owner saw a "needs a reply" list that never shrank
    however many people they answered, and the response rate on their own
    dashboard stayed wrong until someone from Fliiptech got round to asking.

    It is self-reported, which is what every field on EnquiryOutcome already
    is — the conversation happens on WhatsApp and the platform cannot observe
    any of it. The provenance is recorded rather than hidden: recorded_by is
    set to whoever made the change, and a trainer's user is not staff, so the
    back office can tell a provider's own claim from an officer's note. That
    matters, because staff read response rate when judging a listing.

    Reversible on purpose. A mis-tap that permanently mislabels an enquiry
    would make the owner trust the list less than no list at all.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference_code):
        provider = _profile_for(_account(request))
        if provider is None:
            raise NotFound("No listing exists for this account yet.")

        # Scoped by provider as well as reference, so a code belonging to
        # another workshop is not found rather than quietly writable.
        try:
            enquiry = Enquiry.objects.get(provider=provider, reference_code=reference_code)
        except Enquiry.DoesNotExist:
            raise NotFound("No enquiry with that reference on this listing.") from None

        replied = request.data.get("replied", True)
        if not isinstance(replied, bool):
            raise ValidationError({"replied": "Send true or false."})

        outcome, _ = EnquiryOutcome.objects.get_or_create(enquiry=enquiry)
        outcome.replied = replied
        # Cleared when unmarking: a replied_at on an enquiry that is not
        # marked replied is a timestamp for something that did not happen.
        outcome.replied_at = timezone.now() if replied else None
        outcome.recorded_by = request.user
        outcome.save(update_fields=["replied", "replied_at", "recorded_by", "updated_at"])

        return Response({"reference_code": reference_code, "replied": outcome.replied})
