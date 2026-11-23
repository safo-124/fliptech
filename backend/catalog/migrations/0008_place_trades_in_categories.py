"""The seven trade categories, and today's trades placed in them.

There is no "Others": a trade that fits nowhere is a sign a category is
missing, not a reason for a dumping ground. Electrical installation sits
with engineering (beside solar and electronics), not with building.

Only trades with no category yet are placed, so running this again, or after
staff have moved a trade, changes nothing they chose.
"""

from django.db import migrations

CATEGORIES = [
    (
        "engineering-technical",
        "Engineering & Technical Trades",
        "cog",
        "Machines, metal, engines and electrics: welding, auto mechanics, electrical "
        "installation, solar, refrigeration, electronics and phone repair.",
        ["engineering", "technical", "machines", "metalwork"],
    ),
    (
        "construction-building",
        "Construction & Building Trades",
        "bricks",
        "Building and finishing houses: masonry, plumbing, carpentry, tiling, painting and "
        "steel bending.",
        ["construction", "building", "builder"],
    ),
    (
        "fashion-beauty-leather",
        "Fashion, Beauty & Leather Craft",
        "scissors",
        "What people wear and how they look: tailoring, dressmaking, hairdressing, barbering, "
        "make-up, nails, and leather shoes and bags.",
        ["fashion", "beauty", "leather", "leatherwork"],
    ),
    (
        "creative-arts-craft",
        "Creative Arts & Craft",
        "palette",
        "Handmade objects and art: beads, weaving, pottery, carving, sign painting and "
        "decoration.",
        ["art", "arts", "craft", "crafts", "handmade"],
    ),
    (
        "hospitality-culinary",
        "Hospitality & Culinary Arts",
        "chef",
        "Food and guests: catering, baking, pastry, cooking, events and hotel work.",
        ["hospitality", "culinary", "food", "cooking"],
    ),
    (
        "digital-creative",
        "Digital & Creative Skills",
        "laptop",
        "Work done on a computer or phone: graphic design, photography and video editing, "
        "web design and social media.",
        ["digital", "computer", "ict"],
    ),
    (
        "personal-home-lifestyle",
        "Personal, Home & Lifestyle Skills",
        "house",
        "Skills for the home and everyday life: soap and detergent making, interior decor, "
        "cleaning, childcare and gardening.",
        ["home", "lifestyle", "household"],
    ),
]

# Trade slugs, live and likely, by category.
PLACES = {
    "engineering-technical": [
        "welding",
        "fabrication",
        "auto-mechanics",
        "auto-electrical",
        "electrical-installation",
        "electronics",
        "solar",
        "solar-installation",
        "refrigeration",
        "refrigeration-and-air-conditioning",
        "phone-repair",
        "machining",
    ],
    "construction-building": [
        "plumbing",
        "masonry",
        "carpentry",
        "carpentry-and-joinery",
        "tiling",
        "painting",
        "painting-and-decorating",
        "steel-bending",
        "aluminium-fabrication",
    ],
    "fashion-beauty-leather": [
        "tailoring",
        "dressmaking",
        "fashion-design",
        "hairdressing",
        "barbering",
        "make-up",
        "makeup",
        "cosmetology",
        "nail-technology",
        "leatherwork",
        "shoemaking",
    ],
    "creative-arts-craft": [
        "bead-making",
        "beads",
        "weaving",
        "kente-weaving",
        "pottery",
        "wood-carving",
        "carving",
        "sign-painting",
        "batik",
        "tie-and-dye",
    ],
    "hospitality-culinary": [
        "catering",
        "baking",
        "pastry",
        "cooking",
        "food-processing",
        "events",
        "hotel",
    ],
    "digital-creative": [
        "graphic-design",
        "photography",
        "video-editing",
        "web-design",
        "social-media",
        "computer-repair",
    ],
    "personal-home-lifestyle": [
        "soap-making",
        "detergent-making",
        "interior-decor",
        "interior-decoration",
        "cleaning",
        "childcare",
        "gardening",
    ],
}


def place(apps, schema_editor):
    TradeCategory = apps.get_model("catalog", "TradeCategory")
    Trade = apps.get_model("catalog", "Trade")
    for order, (slug, name, icon, description, synonyms) in enumerate(CATEGORIES):
        category, _created = TradeCategory.objects.get_or_create(
            slug=slug,
            defaults={
                "name": name,
                "icon": icon,
                "description": description,
                "synonyms": synonyms,
                "display_order": order * 10,
            },
        )
        Trade.objects.filter(slug__in=PLACES[slug], category__isnull=True).update(
            category=category
        )


def unplace(apps, schema_editor):
    apps.get_model("catalog", "Trade").objects.update(category=None)
    apps.get_model("catalog", "TradeCategory").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0007_trade_categories"),
    ]

    operations = [migrations.RunPython(place, unplace)]
