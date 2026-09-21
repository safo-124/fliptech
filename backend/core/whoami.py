"""Which public account area the caller is signed into.

The site header sits on every page, including the search page, so this is the
cheapest possible form of the question: two one-to-one lookups and nothing
serialised. The trainer session endpoint answers a richer version of the same
question, but it serialises the whole listing — far too much to ask for on a
page that only needs to know which link to draw.

It reports the two public areas and nothing else. A member of staff is signed
into the back office, which is not one of them, so for this question they are
in neither, which is the truthful answer rather than a special case.
"""

from django.middleware.csrf import get_token
from drf_spectacular.utils import extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from providers.models import TrainerAccount
from trainees.access import own_trainee_account


def _trainer_account(user):
    """The signed-in trainer's own account.

    Mirrors own_trainee_account: staff are excluded, because a staff user in a
    support session is acting for someone else and is not themselves a trainer.
    """
    if user.is_staff:
        return None
    try:
        account = user.trainer_account
    except TrainerAccount.DoesNotExist:
        return None
    return account if account.is_active else None


def whoami_payload(request):
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return {"trainer": None, "trainee": None}

    trainer = _trainer_account(user)
    trainee = own_trainee_account(request)
    return {
        "trainer": ({"name": trainer.full_name or str(trainer.phone)} if trainer else None),
        "trainee": ({"name": str(trainee)} if trainee else None),
    }


class WhoAmIView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        # Same CSRF bootstrap contract as the two session endpoints, so a page
        # that only renders the header can still make its first write.
        get_token(request._request)
        return Response(whoami_payload(request))
