from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from core.media import public_url

from .models import Trade


class TradeSerializer(serializers.ModelSerializer):
    provider_count = serializers.IntegerField(read_only=True)
    picture = serializers.SerializerMethodField()

    class Meta:
        model = Trade
        fields = ["id", "name", "slug", "description", "colour", "picture", "provider_count"]

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_picture(self, obj):
        """The painted signboard picture, or null until one is uploaded."""
        return public_url(obj.picture.url, self.context.get("request")) if obj.picture else None
