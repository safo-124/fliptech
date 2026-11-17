"""The back office's Delete for a seller, a trainer, a workshop or a login.

Django's own delete would refuse a shop with paid orders (they are PROTECT)
and, for a trainer, would leave the workshop page and its courses on the
website. These admins run accounts/removal.py instead: the same clean-up the
person gets from "Delete my account", so both doors do the same thing.

The confirmation page lists what will go and what stays, in plain words,
instead of Django's list of every related row.
"""

from django.contrib import messages

from .removal import CLOSED_SHOP, CannotRemove, remove_login, remove_provider


def _count(n, one, many):
    return f"{n} {one if n == 1 else many}"


def describe_login(user):
    """What deleting this login will do, one line per thing."""
    lines = []
    seller = getattr(user, "seller_account", None) if hasattr(user, "seller_account") else None
    if seller is not None:
        lines.append(
            f"Shop “{seller.business_name or seller.phone}”: "
            f"{_count(seller.products.count(), 'product', 'products')} with their photos, "
            "bundles, codes and chats are deleted and leave the website at once."
        )
        paid = seller.orders.count() + seller.payments.count()
        if paid:
            lines.append(
                f"{_count(paid, 'order or payment is', 'orders or payments are')} kept for "
                f"refunds and the books, under “{CLOSED_SHOP}”, with the seller's name, "
                "phone, email, ID and bank details removed."
            )
    trainer = getattr(user, "trainer_account", None) if hasattr(user, "trainer_account") else None
    if trainer is not None:
        for membership in trainer.memberships.select_related("provider"):
            lines.extend(describe_provider(membership.provider))
        lines.append("The trainer account and its ID details are deleted.")
    if hasattr(user, "trainee_account"):
        lines.append("The learner account, saved workshops, progress and reviews are deleted.")
    if hasattr(user, "customer_account"):
        lines.append("The customer account, bag, saved items and addresses are deleted.")
    lines.append("The login is deleted and signed out everywhere. This cannot be undone.")
    return lines


def describe_provider(provider):
    lines = [
        f"Workshop “{provider.name}”: its page, photos, videos, documents, online course "
        "and chats are deleted and leave the website at once."
    ]
    kept = provider.course_purchases.count() + provider.enrolments.count()
    if kept:
        lines.append(
            f"{_count(kept, 'paid course sale or enrolment is', 'paid course sales or enrolments are')} "
            "kept for the records, under “Closed workshop”, with its details removed."
        )
    return lines


class _RemovalAdmin:
    """Shared by the admins below. `removal_user(obj)` names the login."""

    def removal_user(self, obj):
        return obj.user

    def removal_lines(self, obj):
        return describe_login(self.removal_user(obj))

    def get_deleted_objects(self, objs, request):
        lines, refused = [], []
        for obj in objs:
            user = self.removal_user(obj)
            if user is not None and (user.is_staff or user.is_superuser):
                refused.append(f"{obj}: a staff login. Take its staff access away first.")
                continue
            lines.append(str(obj))
            lines.append([str(line) for line in self.removal_lines(obj)])
        return lines, {}, set(), refused

    def delete_model(self, request, obj):
        try:
            remove_login(self.removal_user(obj))
        except CannotRemove as refused:
            self.message_user(request, f"{obj}: {refused.message}", messages.ERROR)

    def delete_queryset(self, request, queryset):
        for obj in list(queryset):
            self.delete_model(request, obj)


class SellerRemovalAdmin(_RemovalAdmin):
    pass


class TrainerRemovalAdmin(_RemovalAdmin):
    pass


class UserRemovalAdmin(_RemovalAdmin):
    def removal_user(self, obj):
        return obj


class ProviderRemovalAdmin(_RemovalAdmin):
    """Deleting a workshop on its own: the page and everything on it go,
    the trainers' logins stay."""

    def removal_user(self, obj):
        return None

    def removal_lines(self, obj):
        return describe_provider(obj)

    def delete_model(self, request, obj):
        from django.db import transaction

        from .removal import _Files

        with transaction.atomic():
            files = _Files()
            remove_provider(obj, files)
            files.delete_on_commit()
