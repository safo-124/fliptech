"""Search filters for Screen 1: trade, area, fee ceiling, next intake, verified only.

Two of these are subtler than they look:

* `max_fee` filters providers that have *any* active programme at or below the
  ceiling, not providers whose every programme is cheap. Someone with a budget
  wants to see the workshop if one of its courses fits.
* `verified_only` means a Fliiptech site visit that has not expired. It does not
  mean CTVET registration, and the two are never combined into one filter,
  because a single "verified" toggle spanning both is the legal problem
  DATA_MODEL.md warns about, in filter form.
"""

import django_filters
from django.db.models import Q
from django.utils import timezone

from providers.models import Provider


class ProviderFilter(django_filters.FilterSet):
    trade = django_filters.CharFilter(method="filter_trade")
    area = django_filters.CharFilter(field_name="area__slug", lookup_expr="iexact")
    region = django_filters.CharFilter(field_name="area__region__slug", lookup_expr="iexact")

    max_fee = django_filters.NumberFilter(method="filter_max_fee")
    starts_before = django_filters.DateFilter(method="filter_starts_before")
    starts_after = django_filters.DateFilter(method="filter_starts_after")

    verified_only = django_filters.BooleanFilter(method="filter_verified_only")
    q = django_filters.CharFilter(method="filter_search")

    class Meta:
        model = Provider
        fields = []

    def filter_trade(self, queryset, name, value):
        """Match the trade slug, its name, or any of its synonyms."""
        return queryset.filter(
            Q(programmes__trade__slug__iexact=value)
            | Q(programmes__trade__name__iexact=value)
            | Q(programmes__trade__synonyms__contains=[value.lower()]),
            programmes__is_active=True,
            programmes__trade__is_active=True,
        ).distinct()

    def filter_max_fee(self, queryset, name, value):
        return queryset.filter(
            programmes__fee__lte=value,
            programmes__is_active=True,
            programmes__trade__is_active=True,
        ).distinct()

    def filter_starts_before(self, queryset, name, value):
        return queryset.filter(
            Q(programmes__intakes__places_remaining__isnull=True)
            | Q(programmes__intakes__places_remaining__gt=0),
            programmes__is_active=True,
            programmes__trade__is_active=True,
            programmes__intakes__start_date__lte=value,
            programmes__intakes__start_date__gte=timezone.localdate(),
            programmes__intakes__is_open=True,
        ).distinct()

    def filter_starts_after(self, queryset, name, value):
        return queryset.filter(
            Q(programmes__intakes__places_remaining__isnull=True)
            | Q(programmes__intakes__places_remaining__gt=0),
            programmes__is_active=True,
            programmes__trade__is_active=True,
            programmes__intakes__start_date__gte=max(value, timezone.localdate()),
            programmes__intakes__is_open=True,
        ).distinct()

    def filter_verified_only(self, queryset, name, value):
        if not value:
            return queryset
        today = timezone.now().date()
        return queryset.filter(
            Q(verifications__expires_on__gte=today) | Q(verifications__expires_on__isnull=True),
            verifications__outcome__in=["passed", "passed_with_notes"],
        ).distinct()

    def filter_search(self, queryset, name, value):
        """Trigram search, so "welder" finds "Welding Works".

        Plain full-text search cannot do this, and it is the reason pg_trgm is
        in the extensions migration.
        """
        from django.contrib.postgres.search import TrigramSimilarity

        return (
            queryset.annotate(similarity=TrigramSimilarity("name", value))
            .filter(
                Q(similarity__gt=0.15)
                | Q(name__icontains=value)
                | Q(
                    programmes__is_active=True,
                    programmes__trade__is_active=True,
                    programmes__trade__name__icontains=value,
                )
                | Q(
                    programmes__is_active=True,
                    programmes__trade__is_active=True,
                    programmes__trade__synonyms__contains=[value.lower()],
                )
            )
            .distinct()
        )
