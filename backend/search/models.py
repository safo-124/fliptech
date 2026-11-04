"""What people search for, and the training alerts they ask for.

The log is the reason search can get better: staff see the top searches and,
more usefully, the ones that found nothing ("solar installation", "phone
repair"), which says which trainers to recruit next and which words to add to
a trade's synonyms.
"""

from django.db import models


class SearchLog(models.Model):
    class Scope(models.TextChoices):
        ALL = "all", "Whole site"
        TRAINING = "training", "Training"
        LEARN = "learn", "Online learning"
        MARKET = "market", "Marketplace"

    class Source(models.TextChoices):
        WEB = "web", "Website"
        APP = "app", "App"

    # Lowercased and with spaces collapsed, so "Welding " and "welding" count
    # as one search in the report.
    query = models.CharField(max_length=100, db_index=True)
    scope = models.CharField(max_length=10, choices=Scope.choices)
    results = models.PositiveIntegerField()
    source = models.CharField(max_length=5, choices=Source.choices, default=Source.WEB)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "search"
        verbose_name_plural = "searches"

    def __str__(self):
        return f'"{self.query}" ({self.results})'


class TrainingAlert(models.Model):
    """ "Text me when a welding workshop opens in Tema." Asked for from a search
    that found nothing; checked once a day (search.alerts.tell_training_alerts)."""

    LIMIT = 10

    account = models.ForeignKey(
        "accounts.CustomerAccount", on_delete=models.CASCADE, related_name="training_alerts"
    )
    trade = models.ForeignKey("catalog.Trade", on_delete=models.CASCADE, related_name="+")
    # Blank: anywhere in Ghana.
    area = models.ForeignKey(
        "geography.Area", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Workshops published after this are new to the alert.
    checked_at = models.DateTimeField()
    last_told_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["account", "trade", "area"], name="one_training_alert_per_place"
            )
        ]

    def __str__(self):
        where = self.area.name if self.area_id else "anywhere"
        return f"{self.trade.name} in {where}"
