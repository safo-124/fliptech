"""Closing an account, and erasing a trainee's personal data on request.

Two different things, deliberately:

close_account
    What a trainee can do themselves. The account, its login and the saved
    list go. Enquiries and enrolments stay with the provider they were sent
    to, unlinked, because they are also that workshop's business record and
    feed the enrolment numbers the subscription is judged on.

erase_personal_data
    What staff do on a formal request under the Data Protection Act. On top of
    closing the account it removes the trainee's own words (name and message)
    from every enquiry and enrolment on that number, and deletes the
    verification-code log for it. The phone number itself is kept on
    enquiry and enrolment rows as the provider's record; whether that is
    enough is a question for whoever handles the DPC registration.
"""

from django.contrib.admin.models import DELETION, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.db import transaction

from enquiries.models import Enquiry, Enrolment, PhoneVerification


@transaction.atomic
def close_account(account):
    phone = account.phone
    user = account.user
    Enquiry.objects.filter(trainee=account).update(trainee=None)
    Enrolment.objects.filter(trainee=account).update(trainee=None)
    account.delete()
    user.delete()
    return phone


@transaction.atomic
def erase_personal_data(account, *, actor):
    phone = account.phone
    pk = account.pk
    label = f"Trainee #{pk} (erased)"
    enquiries = Enquiry.objects.filter(trainee_phone=phone).update(
        trainee_name="", message="", trainee=None
    )
    enrolments = Enrolment.objects.filter(trainee_phone=phone).update(trainee_name="", trainee=None)
    codes, _ = PhoneVerification.objects.filter(phone=phone).delete()
    history_model = account.history.model
    close_account(account)

    # Change history and the admin log both name the trainee by phone. The
    # history goes entirely (including the row the deletion itself just
    # wrote); the admin log keeps who did what, under a neutral label.
    history_model.objects.filter(id=pk).delete()
    content_type = ContentType.objects.get_for_model(account.__class__)
    LogEntry.objects.filter(content_type=content_type, object_id=str(pk)).update(object_repr=label)
    LogEntry.objects.create(
        user_id=actor.pk,
        content_type=content_type,
        object_id=str(pk),
        object_repr=label,
        action_flag=DELETION,
        change_message="Personal data erased on request.",
    )
    return {"enquiries": enquiries, "enrolments": enrolments, "codes": codes}
