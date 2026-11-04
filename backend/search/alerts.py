"""The daily text for training alerts: "a new welding workshop in Tema"."""

from datetime import timedelta

from django.conf import settings
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from marketplace.alerts import _site, _text


def tell_training_alerts(now=None):
    """One text per alert with a workshop published since it last looked, at
    most once a day. Returns how many were texted."""
    from catalog.models import Programme
    from providers.models import Provider

    from .models import TrainingAlert

    now = now or timezone.now()
    told = 0
    alerts = (
        TrainingAlert.objects.select_related("account", "trade", "area")
        .filter(account__is_active=True, trade__is_active=True)
        .filter(Q(last_told_at__isnull=True) | Q(last_told_at__lte=now - timedelta(hours=20)))
    )
    for alert in alerts:
        teaching = Programme.objects.filter(
            provider=OuterRef("pk"), is_active=True, trade=alert.trade
        )
        new = Provider.objects.published().filter(
            Exists(teaching), published_at__gt=alert.checked_at
        )
        if alert.area_id:
            new = new.filter(area=alert.area)
        first = new.select_related("area").order_by("published_at").first()
        alert.checked_at = now
        if first is None:
            alert.save(update_fields=["checked_at"])
            continue
        where = f" in {alert.area.name}" if alert.area_id else ""
        count = new.count()
        what = (
            f"a new {alert.trade.name.lower()} workshop{where}: {first.name}"
            if count == 1
            else f"{count} new {alert.trade.name.lower()} workshops{where}"
        )
        link = _site(f"/{first.area.slug}/{first.slug}" if count == 1 else _search_path(alert))
        _text(alert.account.phone, f"{settings.BRAND_NAME}: {what}. {link}")
        alert.last_told_at = now
        alert.save(update_fields=["checked_at", "last_told_at"])
        told += 1
    return told


def _search_path(alert):
    path = f"/training?trade={alert.trade.slug}"
    return path + (f"&area={alert.area.slug}" if alert.area_id else "")
