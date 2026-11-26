"""The marketplace's eight kinds of thing, in a shopper's words.

The pictures at the top of /marketplace ("Hair & beauty", "Clothes", "Bags &
shoes"...) are how someone who does not read much finds what they came for.
Products are tagged with a trade or a trade category, and those are a
trainer's words: "Fashion, Beauty & Leather Craft" holds a wig, a dress and a
bag alike. So a kind matches on the product's own name as well: whole words
at the start (a "chair" is not "hair"), plus the trades and categories that
can only mean it.

The lists are deliberately plain and easy to extend: a word sellers use that
is missing here is a one-line change.
"""

import re

from django.db.models import Q

# slug: (words in a product's name, trade slugs, category slugs)
KINDS = {
    "hair-beauty": (
        [
            "hair",
            "wig",
            "wigs",
            "braid",
            "braids",
            "weave",
            "closure",
            "frontal",
            "curls",
            "curly",
            "lace",
            "bob",
            "pixie",
            "extension",
            "extensions",
            "lashes",
            "nail",
            "nails",
            "makeup",
            "make-up",
            "lipstick",
            "salon",
        ],
        ["hairdressing"],
        [],
    ),
    "clothes": (
        [
            "dress",
            "dresses",
            "shirt",
            "shirts",
            "kaba",
            "slit",
            "ankara",
            "smock",
            "gown",
            "suit",
            "suits",
            "trouser",
            "trousers",
            "skirt",
            "blouse",
            "top",
            "tops",
            "jeans",
            "shorts",
            "jacket",
            "kaftan",
            "agbada",
            "uniform",
            "fabric",
            "cloth",
            "kente",
            "batik",
            "tie-dye",
            "jumpsuit",
            "wear",
        ],
        ["tailoring"],
        [],
    ),
    "bags-shoes": (
        [
            "bag",
            "bags",
            "handbag",
            "purse",
            "backpack",
            "wallet",
            "clutch",
            "shoe",
            "shoes",
            "sandal",
            "sandals",
            "slipper",
            "slippers",
            "sneaker",
            "sneakers",
            "heel",
            "heels",
            "boot",
            "boots",
            "belt",
            "belts",
            "leather",
        ],
        [],
        [],
    ),
    "furniture": (
        [
            "chair",
            "chairs",
            "stool",
            "stools",
            "table",
            "tables",
            "bed",
            "beds",
            "cabinet",
            "shelf",
            "shelves",
            "sofa",
            "couch",
            "wardrobe",
            "desk",
            "door",
            "doors",
            "bench",
            "furniture",
            "drawer",
            "drawers",
        ],
        [],
        [],
    ),
    "food": (
        [
            "food",
            "snack",
            "snacks",
            "pastry",
            "pastries",
            "bread",
            "cake",
            "cakes",
            "juice",
            "sobolo",
            "spice",
            "spices",
            "pepper",
            "shito",
            "cookies",
            "chips",
            "drink",
            "drinks",
            "honey",
            "jam",
            "chocolate",
            "groundnut",
            "gari",
            "rice",
            "meal",
            "kebab",
            "pie",
            "pies",
            "doughnut",
            "doughnuts",
        ],
        [],
        ["hospitality-culinary"],
    ),
    "soap-oils": (
        [
            "soap",
            "soaps",
            "shea",
            "oil",
            "oils",
            "cream",
            "creams",
            "lotion",
            "pomade",
            "perfume",
            "balm",
            "scrub",
            "body",
            "detergent",
            "sanitizer",
        ],
        [],
        [],
    ),
    "tools": (
        [
            "tool",
            "tools",
            "drill",
            "hammer",
            "spanner",
            "wrench",
            "saw",
            "grinder",
            "machine",
            "generator",
            "welding",
            "welder",
            "plier",
            "pliers",
            "toolbox",
            "screwdriver",
            "compressor",
            "ladder",
            "trowel",
            "mixer",
            "sewing machine",
        ],
        ["welding", "plumbing", "auto-mechanics", "electrical-installation"],
        ["engineering-technical", "construction-building"],
    ),
    "crafts": (
        [
            "bead",
            "beads",
            "basket",
            "baskets",
            "painting",
            "paintings",
            "art",
            "carving",
            "carvings",
            "pottery",
            "pot",
            "pots",
            "craft",
            "crafts",
            "sculpture",
            "jewellery",
            "jewelry",
            "necklace",
            "bracelet",
            "earring",
            "earrings",
            "drum",
            "drums",
            "frame",
            "frames",
            "candle",
            "candles",
        ],
        [],
        ["creative-arts-craft"],
    ),
}


def kind_q(slug):
    """The filter for one kind, or None for an unknown slug."""
    if slug not in KINDS:
        return None
    words, trades, categories = KINDS[slug]
    # Postgres: \m is the start of a word and \M its end, so "hair" finds
    # "Hair oil" and "hair" but not "chair", and "bag" finds "bags" only
    # through the plural listed beside it.
    pattern = r"\m(" + "|".join(re.escape(word) for word in words) + r")\M"
    match = Q(name__iregex=pattern)
    if trades:
        match |= Q(trade__slug__in=trades)
    if categories:
        match |= Q(trade__category__slug__in=categories)
    return match
