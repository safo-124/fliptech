"""Demo data for developing the frontend against.

Every provider name, fee and figure here is invented, exactly as the product
documentation says of its own mockups. Real coordinates are used so that radius
search and the map behave the way they will in Accra.

Idempotent: re-running updates rather than duplicating.
"""

import random
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand
from django.utils import timezone

from billing.models import Subscription
from catalog.models import Intake, Programme, Trade
from enquiries.models import Enquiry, EnquiryOutcome, Enrolment
from geography.models import Area, Region
from providers.models import GovernmentStatus, Provider, Verification

TRADES = [
    ("Welding", "welding", ["welder", "fabrication", "arc welding"]),
    ("Tailoring", "tailoring", ["sewing", "dressmaking", "fashion"]),
    ("Plumbing", "plumbing", ["pipe fitting", "plumber"]),
    ("Auto mechanics", "auto-mechanics", ["fitter", "mechanic", "car repair"]),
    ("Hairdressing", "hairdressing", ["barbering", "salon", "beauty"]),
    ("Electrical installation", "electrical-installation", ["electrician", "wiring"]),
]

# Real places in Greater Accra.
AREAS = [
    ("Accra Central", "accra-central", 5.5502, -0.2174),
    ("Tema", "tema", 5.6698, 0.0166),
    ("Madina", "madina", 5.6830, -0.1660),
    ("Kaneshie", "kaneshie", 5.5680, -0.2360),
    ("Adenta", "adenta", 5.7090, -0.1680),
]

WORKSHOP_SUFFIXES = ["Works", "Centre", "Institute", "Training School", "Enterprise"]


class Command(BaseCommand):
    help = "Create illustrative providers, programmes and intakes for development."

    def add_arguments(self, parser):
        parser.add_argument("--providers", type=int, default=24)

    def handle(self, *args, **options):
        random.seed(20260817)  # reproducible demo data
        User = get_user_model()

        officer, _ = User.objects.get_or_create(
            username="field.officer", defaults={"first_name": "Ama", "last_name": "Mensah"}
        )

        region, _ = Region.objects.update_or_create(
            slug="greater-accra", defaults={"name": "Greater Accra", "is_launched": True}
        )
        areas = [
            Area.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": name,
                    "region": region,
                    "centroid": Point(lng, lat, srid=4326),
                },
            )[0]
            for name, slug, lat, lng in AREAS
        ]
        trades = [
            Trade.objects.update_or_create(
                slug=slug,
                defaults={"name": name, "synonyms": syn, "display_order": i},
            )[0]
            for i, (name, slug, syn) in enumerate(TRADES)
        ]

        count = options["providers"]
        for i in range(count):
            area = areas[i % len(areas)]
            trade = trades[i % len(trades)]
            suffix = WORKSHOP_SUFFIXES[i % len(WORKSHOP_SUFFIXES)]
            name = f"{area.name} {trade.name} {suffix}"
            slug = f"{area.slug}-{trade.slug}-{suffix.lower().replace(' ', '-')}"

            # Scatter workshops within roughly 3km of the area centroid.
            jitter = lambda: random.uniform(-0.025, 0.025)  # noqa: E731
            location = Point(area.centroid.x + jitter(), area.centroid.y + jitter(), srid=4326)

            provider, _ = Provider.objects.update_or_create(
                area=area,
                slug=slug,
                defaults={
                    "name": name,
                    "owner_name": random.choice(
                        ["Kwame Boateng", "Akosua Darko", "Yaw Owusu", "Efua Sarpong"]
                    ),
                    "contact_phone": f"+2332{random.randint(40000000, 49999999)}",
                    "address": f"{random.randint(1, 40)} {area.name} Road",
                    "location": location,
                    "status": Provider.Status.PUBLISHED,
                    "published_at": timezone.now(),
                    "last_confirmed_at": timezone.now() - timedelta(days=random.randint(0, 100)),
                },
            )

            fee = Decimal(random.choice([600, 750, 900, 1200, 1500, 1800, 2400]))
            programme, _ = Programme.objects.update_or_create(
                provider=provider,
                trade=trade,
                title=f"{trade.name} certificate",
                defaults={
                    "fee": fee,
                    "instalments_allowed": random.choice([True, False]),
                    "instalment_note": "Three instalments over the course",
                    "duration_weeks": random.choice([8, 12, 16, 24, 36]),
                    "hours_per_week": random.choice([15, 20, 25]),
                    "weekly_schedule": random.choice(
                        ["Mon-Thu, 8am to 2pm", "Mon-Fri, 9am to 3pm", "Sat only, 8am to 4pm"]
                    ),
                    "capacity": random.randint(8, 30),
                },
            )
            for offset in (random.randint(10, 45), random.randint(80, 140)):
                Intake.objects.update_or_create(
                    programme=programme,
                    start_date=date.today() + timedelta(days=offset),
                    defaults={
                        "places_offered": programme.capacity,
                        "places_remaining": random.randint(0, programme.capacity),
                    },
                )

            # Two thirds visited. The rest are listed but unvisited, so the
            # interface has to render "not visited" honestly.
            if i % 3 != 0:
                Verification.objects.update_or_create(
                    provider=provider,
                    visited_on=date.today() - timedelta(days=random.randint(10, 300)),
                    defaults={
                        "officer": officer,
                        "checks_performed": (
                            "Visited the workshop, saw the equipment in use, confirmed the fee "
                            "schedule with the owner and photographed the premises."
                        ),
                        "outcome": Verification.Outcome.PASSED,
                        "expires_on": date.today() + timedelta(days=365),
                    },
                )

            # A mix of government states, including the ones that say no.
            status = [
                GovernmentStatus.Status.REGISTERED,
                GovernmentStatus.Status.NOT_CLAIMED,
                GovernmentStatus.Status.CLAIMED_NOT_VERIFIED,
                GovernmentStatus.Status.NOT_REGISTERED,
            ][i % 4]
            GovernmentStatus.objects.update_or_create(
                provider=provider,
                defaults={
                    "registration_status": status,
                    "registration_number": (
                        f"CTVET/2025/{1000 + i}"
                        if status == GovernmentStatus.Status.REGISTERED
                        else ""
                    ),
                    "documented_on": date.today() - timedelta(days=random.randint(10, 200)),
                    # The note must match how the record was actually obtained.
                    # Saying "shown during the site visit" on a provider that was
                    # never visited contradicts the screen it appears on.
                    "source_note": (
                        "Recorded from the certificate shown during the site visit."
                        if i % 3 != 0
                        else "Reported by the provider. Not yet checked by Fliiptech."
                    ),
                },
            )

            Subscription.objects.update_or_create(
                provider=provider,
                period_start=date.today() - timedelta(days=15),
                defaults={
                    "tier": random.choice([Subscription.Tier.FREE, Subscription.Tier.STANDARD]),
                    "price": random.choice([Decimal(0), Decimal(120)]),
                    "period_end": date.today() + timedelta(days=15),
                    "state": Subscription.State.ACTIVE,
                },
            )

            # A handful of enquiries and enrolments so the dashboard has numbers.
            for _ in range(random.randint(0, 6)):
                enquiry = Enquiry.objects.create(
                    provider=provider,
                    programme=programme,
                    trainee_phone=f"+2332{random.randint(40000000, 49999999)}",
                    message="Do you take complete beginners?",
                    state=Enquiry.State.SENT,
                    phone_verified_at=timezone.now(),
                )
                if random.random() < 0.7:
                    EnquiryOutcome.objects.create(
                        enquiry=enquiry,
                        replied=True,
                        replied_at=enquiry.created_at + timedelta(hours=random.randint(1, 60)),
                    )

            for _ in range(random.randint(0, 4)):
                started = date.today() - timedelta(days=random.randint(30, 200))
                completed = (
                    started + timedelta(weeks=programme.duration_weeks)
                    if random.random() < 0.5
                    else None
                )
                Enrolment.objects.create(
                    provider=provider,
                    programme=programme,
                    trainee_phone=f"+2332{random.randint(40000000, 49999999)}",
                    started_on=started,
                    fee_paid=fee,
                    completed_on=completed if completed and completed <= date.today() else None,
                    provider_attestation=(
                        Enrolment.Attestation.RECOMMENDED
                        if completed and random.random() < 0.8
                        else Enrolment.Attestation.NOT_ASKED
                    ),
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"{Provider.objects.count()} providers, "
                f"{Programme.objects.count()} programmes, "
                f"{Intake.objects.count()} intakes, "
                f"{Enquiry.objects.count()} enquiries, "
                f"{Enrolment.objects.count()} enrolments."
            )
        )
