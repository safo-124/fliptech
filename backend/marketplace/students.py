"""Student prices: a training workshop's own trainees pay less in its shop.

Who counts as a student of a workshop: a trainee account with an enrolment
there, or a paid purchase of its online course. Asked of the signed-in user
only, never of a phone number typed at checkout, so nobody can claim a
discount for a number that is not theirs.
"""

from django.core.exceptions import ObjectDoesNotExist


def is_student(user, provider):
    if provider is None or user is None or not getattr(user, "is_authenticated", False):
        return False
    try:
        trainee = user.trainee_account
    except ObjectDoesNotExist:
        return False
    from courses.models import CoursePurchase
    from enquiries.models import Enrolment

    return (
        Enrolment.objects.filter(provider=provider, trainee=trainee).exists()
        or CoursePurchase.objects.filter(provider=provider, trainee=trainee, status="paid").exists()
    )


def student_discount_for(seller, user):
    """The percent off this user gets in this shop, or 0."""
    if not seller.student_discount_percent or not seller.provider_id:
        return 0
    return seller.student_discount_percent if is_student(user, seller.provider) else 0


def who_is_asking(request):
    """The signed-in user behind a request to a view with no DRF
    authentication (pricing is open to anyone). DRF has already replaced
    request.user with an anonymous one there, so this reads the app's token
    or the session itself. Only used to show a price, never to act."""
    from django.contrib.auth import get_user

    django_request = getattr(request, "_request", request)
    token = getattr(django_request, "app_token", None)
    if token is not None:
        return token.user
    return get_user(django_request)
