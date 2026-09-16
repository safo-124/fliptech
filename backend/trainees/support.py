"""Staff support access to a trainee's dashboard.

A member of staff with the support permission can open a trainee's dashboard
without signing out of the back office. The staff login is untouched; the
session simply carries the id of a SupportSession row, and the trainee API
treats a staff request carrying a live one as that trainee, read-only unless
the staff member also holds the edit permission.

Four properties matter and each is enforced here rather than in a view:

* a reason is always recorded, and the session ends on its own;
* only an active trainee can be opened, and never a staff account;
* permission is re-checked on every request, so revoking it takes effect at
  once rather than at expiry;
* every request made in support mode is logged against the session.
"""

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from .models import SupportSession, SupportSessionEvent

SESSION_KEY = "trainee_support_session_id"

VIEW_PERMISSION = "trainees.support_access"
EDIT_PERMISSION = "trainees.support_edit"


def staff_can_support(user):
    return bool(
        user
        and user.is_authenticated
        and user.is_active
        and user.is_staff
        and user.has_perm(VIEW_PERMISSION)
    )


def record(session, action, **detail):
    SupportSessionEvent.objects.create(session=session, action=action, detail=detail)


def _end(session, reason):
    if session.ended_at is None:
        session.ended_at = timezone.now()
        session.end_reason = reason
        session.save(update_fields=["ended_at", "end_reason"])
        record(session, "ended", reason=reason)


@transaction.atomic
def start_support_session(request, trainee, reason):
    user = request.user
    if not staff_can_support(user):
        raise PermissionDenied("You do not have support access.")
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValidationError("Give a short reason, for example what the trainee asked for.")
    if not trainee.is_active:
        raise ValidationError("This trainee account is switched off.")
    if trainee.user.is_staff or trainee.user.is_superuser:
        raise PermissionDenied("Staff accounts cannot be opened in support mode.")

    for previous in SupportSession.objects.select_for_update().filter(
        staff_user=user, ended_at__isnull=True
    ):
        _end(previous, SupportSession.EndReason.REPLACED)

    session = SupportSession.objects.create(
        staff_user=user,
        trainee=trainee,
        reason=reason[:300],
        can_edit=user.has_perm(EDIT_PERMISSION),
    )
    record(session, "started", can_edit=session.can_edit)
    request.session[SESSION_KEY] = session.pk
    return session


def active_support_session(request):
    """The live support session for this staff request, or None.

    Expired sessions are closed here, so an expiry is recorded the first time
    anyone tries to use it rather than never.
    """
    user = getattr(request, "user", None)
    session_store = getattr(request, "session", None)
    if session_store is None or SESSION_KEY not in session_store:
        return None

    pk = session_store.get(SESSION_KEY)
    session = (
        SupportSession.objects.select_related("trainee", "trainee__user", "staff_user")
        .filter(pk=pk)
        .first()
    )

    def drop(reason=None):
        if session is not None and reason:
            _end(session, reason)
        session_store.pop(SESSION_KEY, None)
        return None

    if session is None or user is None or session.staff_user_id != user.pk:
        return drop()
    if session.ended_at is not None:
        return drop()
    if not staff_can_support(user):
        return drop(SupportSession.EndReason.ENDED_BY_STAFF)
    if session.expires_at <= timezone.now():
        return drop(SupportSession.EndReason.EXPIRED)
    if not session.trainee.is_active:
        return drop(SupportSession.EndReason.ACCOUNT_DISABLED)
    # Edit rights follow the permission as it is now, not as it was at start.
    if session.can_edit and not user.has_perm(EDIT_PERMISSION):
        session.can_edit = False
        session.save(update_fields=["can_edit"])
    return session


def end_support_session(request, reason=SupportSession.EndReason.ENDED_BY_STAFF):
    session = active_support_session(request)
    if session is not None:
        _end(session, reason)
    request.session.pop(SESSION_KEY, None)
    return session


def end_sessions_for_user(user, reason):
    for session in SupportSession.objects.filter(staff_user=user, ended_at__isnull=True):
        _end(session, reason)
