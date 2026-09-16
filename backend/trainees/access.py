"""Who a trainee API request is acting for.

Either the trainee themselves, signed in with their phone, or a member of staff
in a live support session. Views never look at request.user directly; they ask
for a TraineeContext, so the support rules cannot be forgotten in one view.
"""

from dataclasses import dataclass

from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import SupportSession, TraineeAccount
from .support import active_support_session, record


@dataclass(frozen=True)
class TraineeContext:
    account: TraineeAccount
    support: SupportSession | None = None

    @property
    def is_support(self):
        return self.support is not None

    @property
    def can_write(self):
        return self.support is None or self.support.can_edit


def own_trainee_account(request):
    """The signed-in trainee's own account, ignoring support mode."""
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated or user.is_staff:
        return None
    try:
        account = user.trainee_account
    except TraineeAccount.DoesNotExist:
        return None
    return account if account.is_active else None


def resolve(request):
    account = own_trainee_account(request)
    if account is not None:
        return TraineeContext(account=account)
    user = getattr(request, "user", None)
    if user and user.is_authenticated and user.is_staff:
        session = active_support_session(request)
        if session is not None:
            return TraineeContext(account=session.trainee, support=session)
    return None


def context_for(request):
    """Resolve once per request and cache it on the request."""
    holder = getattr(request, "_request", request)
    if not hasattr(holder, "_trainee_context"):
        holder._trainee_context = resolve(request)
    return holder._trainee_context


def forget_context(request):
    holder = getattr(request, "_request", request)
    if hasattr(holder, "_trainee_context"):
        del holder._trainee_context


class IsTraineeOrSupport(BasePermission):
    message = "Sign in with your phone number to see this page."

    def has_permission(self, request, view):
        ctx = context_for(request)
        if ctx is None:
            return False
        if ctx.is_support:
            record(
                ctx.support,
                "viewed" if request.method in SAFE_METHODS else "changed",
                method=request.method,
                path=request.path,
            )
            if request.method not in SAFE_METHODS and not ctx.can_write:
                raise PermissionDenied("Support view is read-only. Nothing was changed.")
        return True
