"""Subscription.

Deliberately simple until pricing is tested. Section 12 lists willingness to
pay as untested and the dashboard tiers as hypotheses, and the product
documentation commits to testing pricing with the first fifty providers — so
this table exists to be changed without a rebuild.

Note there is no payment integration in version 1: online payment is deferred
until enrolment volume justifies it, so a subscription is recorded here and
collected offline, usually by mobile money.
"""

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from core.models import TimeStampedModel


class Subscription(TimeStampedModel):
    class Tier(models.TextChoices):
        FREE = "free", "Free listing"
        STANDARD = "standard", "Standard"
        FEATURED = "featured", "Featured"

    class State(models.TextChoices):
        ACTIVE = "active", "Active"
        PENDING = "pending", "Pending payment"
        LAPSED = "lapsed", "Lapsed"
        CANCELLED = "cancelled", "Cancelled"

    provider = models.ForeignKey(
        "providers.Provider", on_delete=models.CASCADE, related_name="subscriptions"
    )
    tier = models.CharField(max_length=20, choices=Tier.choices, default=Tier.FREE)

    # Cedis per period. Zero is valid: providers get free listings until the
    # enquiry volume is provable.
    price = models.DecimalField(
        max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(0)]
    )
    period_start = models.DateField()
    period_end = models.DateField()
    state = models.CharField(max_length=20, choices=State.choices, default=State.ACTIVE)

    note = models.CharField(max_length=300, blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ["-period_start"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(period_end__gt=models.F("period_start")),
                name="subscription_period_ends_after_it_starts",
            )
        ]

    def __str__(self):
        return f"{self.provider.name}: {self.get_tier_display()} to {self.period_end:%d %b %Y}"
