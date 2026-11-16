"""Closing the whole account, from /account. One login, one Close account.

What goes (deleted):
    the login and the customer account: name, email, photo, delivery
    addresses; saved items and the bag; saved searches and alerts; shops
    followed; chats with shops and workshops; and, for a learner, saved
    workshops, course progress, certificates, course reviews and lesson
    questions. Unpaid course checkouts (never paid for) go too.

What stays (not deleted, no longer linked to the person):
    orders, under the phone number, because they are the seller's sales
    record and the buyer's receipt; enquiries and enrolments sent to
    workshops, because they are the workshop's record (trainees/erasure.py).

When it is refused, and why:
    the login also runs a workshop or a shop: closing would take the
    business with it, so that is a conversation with staff, not a button;
    a course was paid for: the payment record has to stay, so staff close
    the account and keep it.

Erasing personal data on a formal request is separate and staff-only
(trainees/erasure.py, erase_personal_data).
"""

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.translation import gettext as _

from core.identities import roles_of, user_is_unprivileged


class CannotClose(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def why_not(user):
    """None when this login can be closed from the account page."""
    held = set(roles_of(user))
    if not user_is_unprivileged(user):
        return CannotClose("staff", _("A staff login cannot be closed here."))
    if held & {"trainer_account", "seller_account"}:
        return CannotClose(
            "runs_business",
            _(
                "This login also runs a workshop or a shop. Closing it would close "
                "that too, so contact us and we will do it with you."
            ),
        )
    if "trainee_account" in held:
        from courses.models import CoursePurchase

        if CoursePurchase.objects.filter(
            trainee=user.trainee_account, status=CoursePurchase.Status.PAID
        ).exists():
            return CannotClose(
                "paid_courses",
                _(
                    "You have paid for an online course, and that payment record must "
                    "be kept. Contact us and we will close the account for you."
                ),
            )
    return None


@transaction.atomic
def close_login(user):
    """Close everything this login is. Raises CannotClose."""
    problem = why_not(user)
    if problem:
        raise problem
    if "trainee_account" in roles_of(user):
        from courses.models import CoursePurchase
        from trainees.erasure import close_account

        trainee = user.trainee_account
        # Checkouts that were never paid: nothing to keep.
        CoursePurchase.objects.filter(trainee=trainee).exclude(
            status=CoursePurchase.Status.PAID
        ).delete()
        close_account(trainee)
    user = get_user_model().objects.filter(pk=user.pk).first()
    if user is not None:
        # Deletes the customer account and everything that cascades from it.
        user.delete()
