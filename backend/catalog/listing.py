"""What a trainer or seller files a new course or product under.

Staff asked for the categories ("Engineering & Technical Trades",
"Hospitality & Culinary Arts", ...) to be the choice on the forms, not the
trades inside them (welding, tailoring). Courses and products still carry a
trade, as everything that finds them (search, filters, the map, the back
office) reads the trade. So each category has one trade of the same name, in
that category, and that is what the forms offer. "Others" is the existing
"Other (describe)" trade, which the forms add themselves.

Listings already filed under a specific trade keep it; their owners can move
them to a category when they next edit them.
"""

from .models import OTHER_TRADE_SLUG, Trade, TradeCategory

# The trade's colour, from the category's picture.
COLOUR_FOR_ICON = {
    TradeCategory.Icon.COG: Trade.Colour.STEEL,
    TradeCategory.Icon.BRICKS: Trade.Colour.CLAY,
    TradeCategory.Icon.SCISSORS: Trade.Colour.DYE,
    TradeCategory.Icon.PALETTE: Trade.Colour.VIOLET,
    TradeCategory.Icon.CHEF: Trade.Colour.LEAF,
    TradeCategory.Icon.LAPTOP: Trade.Colour.SIGNAL,
    TradeCategory.Icon.HOUSE: Trade.Colour.TIMBER,
}

# After the specific trades in any list ordered by display_order.
DISPLAY_ORDER_BASE = 9000


def category_trade(category: TradeCategory) -> Trade:
    """The trade a listing filed under this category gets, made on first use."""
    trade = Trade.objects.filter(slug=category.slug).first()
    if trade is None:
        trade, _ = Trade.objects.get_or_create(
            name=category.name,
            defaults={
                "slug": category.slug,
                "category": category,
                "colour": COLOUR_FOR_ICON.get(category.icon, Trade.Colour.VIOLET),
                "display_order": DISPLAY_ORDER_BASE + category.display_order,
            },
        )
    if trade.category_id != category.pk or not trade.is_active:
        trade.category = category
        trade.is_active = True
        trade.save(update_fields=["category", "is_active", "updated_at"])
    return trade


def listing_trades() -> list[Trade]:
    """One trade per active category, in the categories' order."""
    categories = TradeCategory.objects.filter(is_active=True).order_by("display_order", "name")
    return [
        category_trade(category) for category in categories if category.slug != OTHER_TRADE_SLUG
    ]
