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

from drf_spectacular.utils import extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

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
