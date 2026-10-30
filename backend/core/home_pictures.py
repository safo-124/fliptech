"""The home page's staff-chosen photographs, by place. See HomePicture."""

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .media import public_url
from .models import HomePicture


class HomePicturesView(APIView):
    """{slot: {url, alt, credit}} for every place that has a picture.

    A place with no picture is simply absent: the page decides what stands
    in for it.
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        return Response(
            {
                picture.slot: {
                    "url": public_url(picture.image.url, request),
                    "alt": picture.alt_text,
                    "credit": picture.credit,
                }
                for picture in HomePicture.objects.exclude(image="")
            }
        )
