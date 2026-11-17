"""Removing a whole account, shop and workshop included.

One clean-up, used from two doors:
    * the person, from "Delete my account" (accounts/views.py CloseView);
    * staff, by deleting a seller, trainer or login in the back office
      (marketplace/admin.py, providers/admin.py, accounts/admin.py).

What goes, at once and for good:
    the shop's products, their photos and options, bundles, discount codes,
    the shop's chats and enquiries; the workshop's page, photos, videos,
    documents, courses on offer and chats; the trainer and seller accounts;
    the customer account (bag, saved items, addresses, follows, alerts); the
    learner's saved workshops, progress and reviews; the login. Image, video
    and document files on the server go with the rows that pointed at them.

What stays, with the person taken out of it:
    money records. A paid order or payment (SellerPayment), a paid course
    sale, a workshop enrolment or a boost cannot be deleted: they are the
    buyer's receipt, the record Paystack disputes and refunds are settled
    against, and the books. The row that holds them on (the shop, the
    workshop, the learner) stays as a hidden, emptied shell: no name, phone,
    email, ID, bank details, photos or text, shown as "Closed shop" or
    "Closed workshop", never on the website. The login under it stays as an
    unusable, emptied row. Nothing else is kept.

Every website page that showed any of it is asked to refresh when the
transaction commits (the page_refresh signals fire on these deletes and saves).
"""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from core.identities import roles_of

logger = logging.getLogger(__name__)

CLOSED_SHOP = "Closed shop"
CLOSED_WORKSHOP = "Closed workshop"


class CannotRemove(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def closed_phone(prefix, pk):
    """A number no phone can have (Ghana numbers never start +2330), unique
    per row, so the phone a closed account used is free to sign up again."""
    return f"+2330{prefix}{pk:08d}"


# --- files -------------------------------------------------------------------


class _Files:
    """Files to delete once the transaction commits, so a rollback never
    leaves a row pointing at a file already gone. A file another row still
    uses (a photo copied onto a second product shares its file) is kept."""

    def __init__(self):
        self.names = []

    def add(self, file):
        if file and file.name:
            self.names.append((file.storage, file.name))

    def add_all(self, queryset, field):
        for row in queryset.only("pk", field):
            self.add(getattr(row, field))

    def delete_on_commit(self):
        names = list(self.names)
        if names:
            transaction.on_commit(lambda: _delete_files(names))


def _still_used(name):
    from marketplace.models import PendingProductPhoto, ProductPhoto, SellerAccount
    from providers.models import Provider, ProviderPhoto

    return (
        ProductPhoto.objects.filter(image=name).exists()
        or PendingProductPhoto.objects.filter(image=name).exists()
        or ProviderPhoto.objects.filter(image=name).exists()
        or SellerAccount.objects.filter(banner=name).exists()
        or Provider.objects.filter(logo=name).exists()
    )


def _delete_files(names):
    for storage, name in names:
        try:
            if not _still_used(name):
                storage.delete(name)
        except Exception:  # A file left behind never fails the removal.
            logger.warning("Could not delete file %s", name, exc_info=True)


# --- the shop ----------------------------------------------------------------


def remove_seller(seller, files):
    """The shop and everything on it. Kept as an emptied, hidden shell only
    when paid orders or payments hang off it."""
    from marketplace.models import Conversation, PendingProductPhoto, ProductPhoto

    files.add_all(ProductPhoto.objects.filter(product__seller=seller), "image")
    files.add_all(PendingProductPhoto.objects.filter(seller=seller), "image")
    files.add(seller.banner)
    files.add(seller.id_document)

    if not (seller.orders.exists() or seller.payments.exists()):
        seller.delete()  # Products, photos, bundles, codes, chats cascade.
        return "deleted"

    # Off the website first, in the same transaction as everything else.
    seller.products.all().delete()
    seller.pending_photos.all().delete()
    seller.bundles.all().delete()
    seller.codes.all().delete()
    seller.followers.all().delete()
    seller.enquiries.all().delete()
    seller.notices.all().delete()
    Conversation.objects.filter(seller=seller).delete()

    seller.is_active = False
    seller.business_name = CLOSED_SHOP
    seller.about = ""
    seller.phone = closed_phone("1", seller.pk)
    seller.phone_verified_at = None
    seller.email = None
    seller.email_verified_at = None
    seller.banner = ""
    seller.id_document = ""
    seller.id_note = ""
    seller.payout_bank_code = ""
    seller.payout_bank_name = ""
    seller.payout_account_last4 = ""
    seller.payout_account_name = ""
    seller.delivery_area = ""
    seller.away_note = ""
    seller.verification_note = ""
    seller.approval_note = ""
    seller.provider = None
    # paystack_subaccount and paystack_recipient stay: they are Paystack's
    # references for the kept payments, not personal details.
    seller.save()
    return "kept"


# --- the workshop ------------------------------------------------------------


def remove_provider(provider, files):
    """The workshop's page and everything on it. Kept as an emptied, hidden
    shell only when paid course sales, enrolments, boosts or certificates
    hang off it."""
    from courses.models import Certificate, CourseOffer
    from marketplace.models import Conversation
    from providers.models import ProviderEvidence, ProviderPhoto, ProviderVideo

    files.add(provider.logo)
    files.add_all(ProviderPhoto.objects.filter(provider=provider), "image")
    files.add_all(ProviderEvidence.objects.filter(provider=provider), "file")

    kept = (
        provider.course_purchases.exists()
        or provider.enrolments.exists()
        or provider.course_boosts.exists()
        or Certificate.objects.filter(provider=provider).exists()
    )
    if not kept:
        provider.delete()  # Videos take their files with them (providers/apps.py).
        return "deleted"

    ProviderPhoto.objects.filter(provider=provider).delete()
    ProviderVideo.objects.filter(provider=provider).delete()
    ProviderEvidence.objects.filter(provider=provider).delete()
    CourseOffer.objects.filter(provider=provider).delete()
    Conversation.objects.filter(provider=provider).delete()
    # Enrolments point at a course, so the course rows stay, switched off.
    provider.programmes.update(is_active=False)

    provider.status = provider.Status.SUSPENDED
    provider.name = CLOSED_WORKSHOP
    provider.owner_name = ""
    provider.owner_phone = ""
    provider.contact_phone = closed_phone("2", provider.pk)
    provider.address = ""
    provider.landmark = ""
    provider.directions = ""
    provider.lead_trainer_name = ""
    provider.logo = ""
    provider.review_note = ""
    provider.save()
    return "kept"


def remove_trainer(trainer, files):
    """The trainer account and the workshop they run (one trainer per
    workshop: ProviderMembership)."""
    from providers.models import Provider

    results = {}
    for provider in Provider.objects.filter(trainer_memberships__trainer=trainer).distinct():
        results[provider.pk] = remove_provider(provider, files)
    trainer.delete()
    return results


# --- the learner -------------------------------------------------------------


def remove_trainee(trainee, files):
    from courses.models import CoursePurchase
    from trainees.erasure import close_account

    files.add(getattr(trainee, "avatar", None))
    CoursePurchase.objects.filter(trainee=trainee).exclude(
        status=CoursePurchase.Status.PAID
    ).delete()
    if not CoursePurchase.objects.filter(trainee=trainee).exists():
        close_account(trainee)
        return "deleted"

    # Paid course sales point at the learner: empty the row, keep the sale.
    from enquiries.models import Enquiry, Enrolment

    Enquiry.objects.filter(trainee=trainee).update(trainee=None)
    Enrolment.objects.filter(trainee=trainee).update(trainee=None)
    for relation in (
        "saved_providers",
        "lesson_progress",
        "certificates",
        "course_reviews",
        "lesson_questions",
    ):
        getattr(trainee, relation).all().delete()
    trainee.phone = closed_phone("3", trainee.pk)
    trainee.phone_verified_at = None
    trainee.email = None
    trainee.email_verified_at = None
    trainee.display_name = ""
    trainee.avatar = ""
    trainee.institution_name = ""
    trainee.field_of_study = ""
    trainee.is_active = False
    trainee.save()
    return "kept"


# --- the whole login ---------------------------------------------------------


def why_not(user):
    if user.is_staff or user.is_superuser:
        return CannotRemove("staff", _("A staff login cannot be deleted here."))
    return None


@transaction.atomic
def remove_login(user):
    """Everything this login is. Returns what happened, for the log."""
    from accounts.closing import _forget_shared_numbers
    from accounts.models import AppToken, CustomerAccount

    problem = why_not(user)
    if problem:
        raise problem
    files = _Files()
    done = {}
    held = set(roles_of(user))

    if "seller_account" in held:
        done["shop"] = remove_seller(user.seller_account, files)
    if "trainer_account" in held:
        done["workshops"] = remove_trainer(user.trainer_account, files)
    if "trainee_account" in held:
        done["learner"] = remove_trainee(user.trainee_account, files)

    user = get_user_model().objects.filter(pk=user.pk).first()
    if user is None:  # closing the learner already took the login
        files.delete_on_commit()
        return done
    if "customer_account" in roles_of(user):
        _forget_shared_numbers(user)
        CustomerAccount.objects.filter(user=user).delete()
    AppToken.objects.filter(user=user).delete()

    user_pk = user.pk
    # A fresh copy: the one in hand still remembers the rows just deleted.
    user = get_user_model().objects.get(pk=user_pk)
    left = set(roles_of(user))
    if not left:
        user.delete()
        done["login"] = "deleted"
    else:
        # A kept shell (paid orders or courses) still points at this login.
        user.username = f"closed-{user.pk}"
        user.first_name = ""
        user.last_name = ""
        user.email = ""
        user.is_active = False
        user.set_unusable_password()
        user.save()
        done["login"] = "emptied"
    _end_sessions(user_pk)
    files.delete_on_commit()
    logger.info("Account removed at %s: %s", timezone.now().isoformat(), done)
    return done


def _end_sessions(user_pk):
    """Sign the login out everywhere: every browser session it has."""
    from django.contrib.sessions.models import Session

    try:
        for session in Session.objects.filter(expire_date__gt=timezone.now()).iterator():
            if str(session.get_decoded().get("_auth_user_id")) == str(user_pk):
                session.delete()
    except Exception:  # Sessions may live in the cache instead.
        logger.debug("Sessions not in the database", exc_info=True)
