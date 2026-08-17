from rest_framework import serializers

from .models import Trade


class TradeSerializer(serializers.ModelSerializer):
    provider_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Trade
        fields = ["id", "name", "slug", "description", "provider_count"]
