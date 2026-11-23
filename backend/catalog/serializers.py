from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from core.media import public_url

from .models import Trade, TradeCategory


class TradeCategoryBriefSerializer(serializers.ModelSerializer):
    """A trade's category, as the trade lists show it."""

    class Meta:
        model = TradeCategory
        fields = ["slug", "name", "icon"]


class TradeSerializer(serializers.ModelSerializer):
    provider_count = serializers.IntegerField(read_only=True)
    picture = serializers.SerializerMethodField()
    category = TradeCategoryBriefSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Trade
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "colour",
            "picture",
            "provider_count",
            "category",
        ]

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_picture(self, obj):
        """The painted signboard picture, or null until one is uploaded."""
        return public_url(obj.picture.url, self.context.get("request")) if obj.picture else None


class CategoryTradeSerializer(serializers.ModelSerializer):
    provider_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Trade
        fields = ["slug", "name", "colour", "provider_count"]


class TradeCategorySerializer(serializers.ModelSerializer):
    """A category with what is live in it: workshops (through their courses),
    online courses and shop items, each counted by the same rule the list it
    links to uses, so a count never promises more than the list shows."""

    provider_count = serializers.IntegerField(read_only=True)
    course_count = serializers.SerializerMethodField()
    product_count = serializers.SerializerMethodField()
    live = serializers.SerializerMethodField()
    trades = CategoryTradeSerializer(many=True, read_only=True, source="active_trades")

    class Meta:
        model = TradeCategory
        fields = [
            "id",
            "name",
            "slug",
            "description",
            "icon",
            "provider_count",
            "course_count",
            "product_count",
            "live",
            "trades",
        ]

    @extend_schema_field(serializers.IntegerField())
    def get_course_count(self, obj):
        from providers.learning import browse_courses

        return browse_courses({"category": obj.slug}).count()

    @extend_schema_field(serializers.IntegerField())
    def get_product_count(self, obj):
        from marketplace.views import browse

        return browse({"category": obj.slug}).count()

    @extend_schema_field(serializers.BooleanField())
    def get_live(self, obj):
        """Something to show in it: the site and the app hide a category without."""
        return bool(obj.provider_count or self.get_course_count(obj) or self.get_product_count(obj))
