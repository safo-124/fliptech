"""Common words people type for each trade, added to whatever staff already
keep on it (never replacing). Matched by the trade's slug, so a trade staff
named differently is simply left alone; staff can edit all of these in the
back office (Trades -> synonyms)."""

from django.db import migrations

WORDS = {
    "weld": ["welder", "welders", "fabrication", "metal work", "metalwork", "steel work"],
    "tailor": [
        "sewing", "seamstress", "dressmaking", "dressmaker", "fashion", "fashion design",
        "kaba", "tailor",
    ],
    "hair": ["barbing", "barber", "braiding", "braids", "salon", "hair", "cornrows", "weaving"],
    "plumb": ["plumber", "pipe fitting", "pipe fitter", "pipes"],
    "electric": ["electrician", "wiring", "house wiring", "solar", "solar installation"],
    "mechanic": ["mechanic", "fitter", "fitting shop", "car repair", "auto repair", "garage"],
    "carpent": ["carpenter", "joinery", "furniture", "woodwork"],
    "mason": ["mason", "masonry", "block laying", "building"],
    "cater": ["cooking", "chef", "baking", "pastry", "food"],
}


def add(apps, schema_editor):
    Trade = apps.get_model("catalog", "Trade")
    for trade in Trade.objects.all():
        words = set(trade.synonyms or [])
        for stem, extra in WORDS.items():
            if stem in trade.slug:
                words.update(extra)
        words.discard(trade.name.lower())
        if words != set(trade.synonyms or []):
            trade.synonyms = sorted(words)
            trade.save(update_fields=["synonyms"])


class Migration(migrations.Migration):
    dependencies = [
        ("search", "0001_initial"),
        ("catalog", "0005_programme_extra_costs"),
    ]

    operations = [migrations.RunPython(add, migrations.RunPython.noop)]
