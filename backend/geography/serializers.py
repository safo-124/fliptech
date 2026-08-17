from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Area, Region


class AreaSerializer(serializers.ModelSerializer):
    provider_count = serializers.IntegerField(read_only=True)
    region_slug = serializers.CharField(source="region.slug", read_only=True)
    centroid_lat = serializers.SerializerMethodField()
    centroid_lng = serializers.SerializerMethodField()

    class Meta:
        model = Area
        fields = [
            "id",
            "name",
            "slug",
            "region_slug",
            "provider_count",
            "centroid_lat",
            "centroid_lng",
        ]

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_centroid_lat(self, obj):
        return obj.centroid.y if obj.centroid else None

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_centroid_lng(self, obj):
        return obj.centroid.x if obj.centroid else None


class RegionSerializer(serializers.ModelSerializer):
    areas = AreaSerializer(many=True, read_only=True)

    class Meta:
        model = Region
        fields = ["id", "name", "slug", "is_launched", "areas"]
