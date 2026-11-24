"""Add all of Ghana: the sixteen regions and their main towns, all live.

The site launched with Greater Accra alone, so it was the only region with
areas. A trainer in Kumasi had no area to choose, and the footer and the
/training banner said "Greater Accra" because that was the only live region.

This only adds. A region or area already there (matched by slug, or by name
within its region) is left as it is, and nothing is deleted or renamed. The
one change to existing rows is switching every region on (is_launched), which
--apply does unless --keep-launch is given.

    manage.py load_ghana_places            # show what would be added
    manage.py load_ghana_places --apply    # add it
"""

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand
from django.db import transaction

from geography.models import Area, Region

# Region name -> [(town, latitude, longitude)]. Each point is the town's
# centre: a workshop pin more than 25 km from it is refused
# (geography/bounds.py), so these are the towns themselves, not districts.
PLACES = {
    "Greater Accra": [
        ("Accra Central", 5.5502, -0.2174),
        ("Tema", 5.6698, 0.0166),
        ("Madina", 5.6830, -0.1660),
        ("Kaneshie", 5.5680, -0.2360),
        ("Adenta", 5.7090, -0.1680),
        ("Osu", 5.5560, -0.1820),
        ("Dansoman", 5.5480, -0.2650),
        ("Achimota", 5.6200, -0.2290),
        ("Lapaz", 5.6060, -0.2500),
        ("Dome", 5.6500, -0.2350),
        ("East Legon", 5.6350, -0.1600),
        ("Spintex", 5.6350, -0.1000),
        ("Teshie", 5.5830, -0.1070),
        ("Nungua", 5.6010, -0.0770),
        ("Ashaiman", 5.6940, -0.0290),
        ("Kpone", 5.6950, 0.0560),
        ("Amasaman", 5.7020, -0.3010),
        ("Weija", 5.5600, -0.3360),
        ("Dodowa", 5.8820, -0.0980),
        ("Prampram", 5.7110, 0.1080),
        ("Ada Foah", 5.7880, 0.6290),
    ],
    "Ashanti": [
        ("Kumasi", 6.6885, -1.6244),
        ("Suame", 6.7170, -1.6280),
        ("Ejisu", 6.7240, -1.4720),
        ("Obuasi", 6.2020, -1.6680),
        ("Konongo", 6.6170, -1.2160),
        ("Mampong", 7.0630, -1.4000),
        ("Bekwai", 6.4580, -1.5770),
        ("Agogo", 6.8000, -1.0830),
    ],
    "Central": [
        ("Cape Coast", 5.1053, -1.2466),
        ("Kasoa", 5.5340, -0.4240),
        ("Winneba", 5.3510, -0.6230),
        ("Elmina", 5.0850, -1.3500),
        ("Mankessim", 5.2730, -1.0150),
        ("Agona Swedru", 5.5340, -0.7000),
        ("Saltpond", 5.2090, -1.0610),
        ("Assin Fosu", 5.7010, -1.2760),
        ("Twifo Praso", 5.6080, -1.5490),
        ("Dunkwa-on-Offin", 5.9660, -1.7790),
    ],
    "Western": [
        ("Takoradi", 4.8980, -1.7600),
        ("Sekondi", 4.9430, -1.7040),
        ("Tarkwa", 5.3000, -1.9830),
        ("Prestea", 5.4330, -2.1430),
        ("Shama", 5.0130, -1.6290),
        ("Axim", 4.8670, -2.2410),
        ("Agona Nkwanta", 4.8870, -1.9650),
        ("Half Assini", 5.0500, -2.8830),
    ],
    "Western North": [
        ("Sefwi Wiawso", 6.2060, -2.4850),
        ("Bibiani", 6.4630, -2.3190),
        ("Sefwi Bekwai", 6.2000, -2.3330),
        ("Juaboso", 6.3300, -2.8300),
        ("Enchi", 5.8200, -2.8200),
    ],
    "Eastern": [
        ("Koforidua", 6.0940, -0.2590),
        ("Nkawkaw", 6.5510, -0.7660),
        ("Nsawam", 5.8090, -0.3500),
        ("Suhum", 6.0400, -0.4500),
        ("Akim Oda", 5.9260, -0.9860),
        ("Kibi", 6.1670, -0.5500),
        ("Asamankese", 5.8600, -0.6630),
        ("Aburi", 5.8480, -0.1750),
        ("Akropong", 5.9740, -0.0880),
        ("Somanya", 6.1040, -0.0150),
        ("Akosombo", 6.2960, 0.0590),
        ("Begoro", 6.3870, -0.3790),
    ],
    "Volta": [
        ("Ho", 6.6008, 0.4713),
        ("Hohoe", 7.1520, 0.4730),
        ("Kpando", 6.9960, 0.2920),
        ("Keta", 5.9180, 0.9870),
        ("Aflao", 6.1170, 1.1940),
        ("Akatsi", 6.1270, 0.8000),
        ("Sogakope", 6.0060, 0.5940),
        ("Anloga", 5.7940, 0.8970),
    ],
    "Oti": [
        ("Dambai", 8.0670, 0.1800),
        ("Jasikan", 7.4040, 0.4640),
        ("Kadjebi", 7.5300, 0.4700),
        ("Nkwanta", 8.2610, 0.5160),
        ("Kete Krachi", 7.7900, -0.0400),
    ],
    "Bono": [
        ("Sunyani", 7.3349, -2.3123),
        ("Berekum", 7.4530, -2.5840),
        ("Dormaa Ahenkro", 7.2780, -2.8730),
        ("Wenchi", 7.7390, -2.1050),
    ],
    "Bono East": [
        ("Techiman", 7.5860, -1.9380),
        ("Kintampo", 8.0560, -1.7300),
        ("Nkoranza", 7.5650, -1.7050),
        ("Atebubu", 7.7490, -0.9870),
        ("Yeji", 8.2240, -0.6560),
    ],
    "Ahafo": [
        ("Goaso", 6.8040, -2.5170),
        ("Bechem", 7.0900, -2.0250),
        ("Duayaw Nkwanta", 7.1700, -2.1000),
        ("Kenyasi", 6.9700, -2.4000),
    ],
    "Northern": [
        ("Tamale", 9.4034, -0.8393),
        ("Savelugu", 9.6240, -0.8250),
        ("Tolon", 9.4300, -1.0640),
        ("Yendi", 9.4430, -0.0100),
        ("Bimbilla", 8.8580, 0.0580),
    ],
    "Savannah": [
        ("Damongo", 9.0830, -1.8200),
        ("Salaga", 8.5510, -0.5180),
        ("Bole", 9.0310, -2.4850),
        ("Buipe", 8.7800, -1.4600),
        ("Sawla", 9.2800, -2.4200),
    ],
    "North East": [
        ("Nalerigu", 10.5270, -0.3690),
        ("Gambaga", 10.5300, -0.4400),
        ("Walewale", 10.3500, -0.8000),
        ("Chereponi", 10.1400, 0.2800),
    ],
    "Upper East": [
        ("Bolgatanga", 10.7856, -0.8514),
        ("Navrongo", 10.8950, -1.0920),
        ("Paga", 10.9890, -1.1150),
        ("Bawku", 11.0600, -0.2420),
        ("Zebilla", 10.9500, -0.4800),
        ("Sandema", 10.7300, -1.2900),
    ],
    "Upper West": [
        ("Wa", 10.0601, -2.5099),
        ("Tumu", 10.8800, -1.9800),
        ("Lawra", 10.6400, -2.9000),
        ("Jirapa", 10.5300, -2.7000),
        ("Nandom", 10.8500, -2.7600),
    ],
}


def slug_of(name: str) -> str:
    from django.utils.text import slugify

    return slugify(name)


class Command(BaseCommand):
    help = "Add Ghana's sixteen regions and their main towns, and switch every region on."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Save. Without it, only show.")
        parser.add_argument(
            "--keep-launch",
            action="store_true",
            help="Add the places but leave each region's 'launched' switch as it is.",
        )

    def handle(self, *args, apply=False, keep_launch=False, **options):
        with transaction.atomic():
            added_regions, added_areas, launched, skipped = self._load(keep_launch)
            if not apply:
                transaction.set_rollback(True)

        for line in skipped:
            self.stdout.write(f"  skipped {line}")
        verb = "Added" if apply else "Would add"
        self.stdout.write(
            f"{verb} {added_regions} regions and {added_areas} areas; "
            f"{'switched on' if apply else 'would switch on'} {launched} regions."
        )
        if not apply:
            self.stdout.write("Nothing saved. Run again with --apply to save.")

    def _load(self, keep_launch):
        added_regions = added_areas = launched = 0
        skipped = []
        # Every slug is a public URL's first segment, shared by regions and
        # areas (Region.clean / Area.clean), so both sets are checked.
        area_slugs = set(Area.objects.values_list("slug", flat=True))
        region_slugs = set(Region.objects.values_list("slug", flat=True))
        for region_name, towns in PLACES.items():
            region_slug = slug_of(region_name)
            region = (
                Region.objects.filter(slug=region_slug).first()
                or Region.objects.filter(name__iexact=region_name).first()
            )
            if region is None:
                if region_slug in area_slugs:
                    skipped.append(f"region {region_name}: an area already uses /{region_slug}")
                    continue
                region = Region.objects.create(
                    name=region_name, slug=region_slug, is_launched=not keep_launch
                )
                region_slugs.add(region_slug)
                added_regions += 1
                self.stdout.write(f"+ region {region_name}")
                if not keep_launch:
                    launched += 1
            elif not keep_launch and not region.is_launched:
                region.is_launched = True
                region.save(update_fields=["is_launched", "updated_at"])
                launched += 1
                self.stdout.write(f"~ region {region.name} switched on")

            existing_names = {name.lower() for name in region.areas.values_list("name", flat=True)}
            for town, latitude, longitude in towns:
                slug = slug_of(town)
                if town.lower() in existing_names or slug in area_slugs:
                    continue  # already there, as it is
                if slug in region_slugs:
                    skipped.append(f"area {town}: a region already uses /{slug}")
                    continue
                Area.objects.create(
                    region=region,
                    name=town,
                    slug=slug,
                    centroid=Point(longitude, latitude, srid=4326),
                )
                area_slugs.add(slug)
                added_areas += 1
                self.stdout.write(f"+ area {town}, {region.name}")
        return added_regions, added_areas, launched, skipped
