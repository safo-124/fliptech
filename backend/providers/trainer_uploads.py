"""Files a trainer uploads for their own listing.

Two destinations, and the difference is the whole point of this module.

Workshop photographs are public content. They become the photo pins in Screen 2
and the gallery on Screen 3, so they go to the same storage a field officer's
photographs do, through the same size and type checks, with EXIF stripped —
a phone photograph of a workshop carries the GPS coordinates of the owner's
yard and we are not publishing those.

The identity document is not public content and never becomes public content.
It is a ProviderEvidence row of kind ID_DOCUMENT, which writes to
PRIVATE_MEDIA_ROOT: a directory mode 700, deliberately outside the tree Caddy
serves, that Section 10 requires is never publicly served. Nothing in this
module returns a URL for it. The reviewing admin opens it through a
permission-checked view, and the trainer only ever learns whether one is on
file.
"""

import logging

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .admin_upload import validate_image_upload
from .models import ProviderEvidence, ProviderPhoto
from .trainer_serializers import (
    TrainerIdentityDocumentSerializer,
    TrainerIdentityStoredSerializer,
    TrainerLogoSerializer,
    TrainerLogoUploadSerializer,
    TrainerPhotoSerializer,
    TrainerPhotoUploadSerializer,
)

logger = logging.getLogger(__name__)

# Per kind, not per provider. The workshop and the work are asked for
# separately, and a single shared cap lets a trainer who photographed eight
# angles of the yard have no room left for the work — which is the half the
# submission check actually cares about. The cap is here so a review queue
# stays reviewable and one trainer cannot fill the bucket.
MAX_PHOTOS_PER_KIND = 8


def _editable_provider_or_error(account):
    """The trainer's own draft, or a refusal.

    Returns (provider, error_response). Uploading into a listing that is
    already under review would change what the admin is looking at midway
    through the decision, so the same status gate the profile form uses
    applies here.
    """
    from .trainer_profiles import EDITABLE_STATUSES, get_owned_profile

    provider = get_owned_profile(account)
    if provider is None:
        return None, Response(
            {"detail": "Create your workshop details before adding files."},
            status=status.HTTP_409_CONFLICT,
        )
    if provider.status not in EDITABLE_STATUSES:
        return None, Response(
            {"detail": "This listing is locked while it is being reviewed."},
            status=status.HTTP_409_CONFLICT,
        )
    return provider, None


class TrainerPhotoUploadView(APIView):
    """One workshop photograph per request.

    One per request rather than a batch: these arrive over a mobile connection
    that drops, and Section 10 asks that a failed request be retryable without
    losing what came before. A batch that fails on the fourth file makes the
    trainer start again.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        request={"multipart/form-data": TrainerPhotoUploadSerializer},
        responses={201: TrainerPhotoSerializer},
    )
    def post(self, request):
        from .trainer_views import IsActiveTrainer, _account

        if not IsActiveTrainer().has_permission(request, self):
            return Response({"detail": "Not a trainer."}, status=status.HTTP_403_FORBIDDEN)

        account = _account(request)
        provider, error = _editable_provider_or_error(account)
        if error is not None:
            return error

        upload = request.FILES.get("image")
        refusal = validate_image_upload(upload)
        if refusal is not None:
            return Response({"detail": refusal}, status=status.HTTP_400_BAD_REQUEST)

        # Anything unrecognised falls back to "the workshop", which is the
        # safer default: a work photo mislabelled as premises is a cosmetic
        # error, while the reverse would satisfy the submission check with a
        # picture that does not show the work.
        kind = request.data.get("kind")
        if kind not in ProviderPhoto.Kind.values:
            kind = ProviderPhoto.Kind.WORKSHOP

        if provider.photos.filter(kind=kind).count() >= MAX_PHOTOS_PER_KIND:
            label = ProviderPhoto.Kind(kind).label.lower()
            return Response(
                {"detail": f"You can add up to {MAX_PHOTOS_PER_KIND} photos of {label}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        photo = ProviderPhoto(
            provider=provider,
            kind=kind,
            uploaded_by=request.user,
            caption=(request.data.get("caption") or "")[:200],
        )
        photo.image = upload
        try:
            photo.save()
        except Exception:
            logger.exception("Trainer photograph upload failed for provider %s", provider.pk)
            return Response(
                {"detail": "That image could not be read. Try another."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not photo.exif_stripped:
            # strip_exif returns None for anything Pillow cannot decode, so a
            # file that reaches here unstripped is not an image. It must not be
            # kept: it would be served from the public bucket carrying whatever
            # metadata it arrived with.
            photo.delete()
            return Response(
                {"detail": "That file is not a readable image."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "id": photo.pk,
                "kind": photo.kind,
                "caption": photo.caption,
                "url": photo.image.url,
            },
            status=status.HTTP_201_CREATED,
        )


class TrainerPhotoDeleteView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, photo_id):
        from .trainer_views import IsActiveTrainer, _account

        if not IsActiveTrainer().has_permission(request, self):
            return Response({"detail": "Not a trainer."}, status=status.HTTP_403_FORBIDDEN)

        account = _account(request)
        provider, error = _editable_provider_or_error(account)
        if error is not None:
            return error

        # Scoped to the trainer's own provider, so a guessed id from another
        # listing is a 404 rather than a deletion.
        photo = provider.photos.filter(pk=photo_id).first()
        if photo is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TrainerIdentityDocumentView(APIView):
    """The owner's identity document. Private, and replace-only.

    Replace rather than append: one person has one identity document on file,
    and a queue holding four half-legible attempts is worse for the reviewer
    than one. Section 10's "minimal collection" points the same way.
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        request={"multipart/form-data": TrainerIdentityDocumentSerializer},
        responses={201: TrainerIdentityStoredSerializer},
    )
    def post(self, request):
        from .trainer_views import IsActiveTrainer, _account

        if not IsActiveTrainer().has_permission(request, self):
            return Response({"detail": "Not a trainer."}, status=status.HTTP_403_FORBIDDEN)

        account = _account(request)
        provider, error = _editable_provider_or_error(account)
        if error is not None:
            return error

        upload = request.FILES.get("document")
        refusal = validate_image_upload(upload)
        if refusal is not None:
            return Response({"detail": refusal}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            existing = ProviderEvidence.objects.filter(
                provider=provider, kind=ProviderEvidence.Kind.ID_DOCUMENT
            )
            for row in existing:
                row.delete()

            evidence = ProviderEvidence(
                provider=provider,
                kind=ProviderEvidence.Kind.ID_DOCUMENT,
                uploaded_by=request.user,
                note=f"Uploaded by the trainer during sign-up ({account.get_id_document_type_display() or 'unspecified'})",
            )
            evidence.file = upload
            try:
                evidence.save()
            except Exception:
                logger.exception("Trainer identity upload failed for provider %s", provider.pk)
                return Response(
                    {"detail": "That file could not be read. Try another."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Deliberately no URL in the response. The trainer needs to know it is
        # on file; nobody outside the back office needs a link to it.
        return Response({"stored": True}, status=status.HTTP_201_CREATED)


class TrainerLogoView(APIView):
    """The workshop's own logo. Replace-only, and optional.

    Optional because most workshops in this market do not have one, and
    requiring it would keep real providers off the site. Replace rather than
    append for the same reason the identity document is: a provider has one
    logo, and a gallery of four attempts helps nobody.

    DELETE removes it, because a workshop that uploaded the wrong file needs a
    way back that is not "ask support".
    """

    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(
        request={"multipart/form-data": TrainerLogoUploadSerializer},
        responses={201: TrainerLogoSerializer},
    )
    def post(self, request):
        from .trainer_views import IsActiveTrainer, _account

        if not IsActiveTrainer().has_permission(request, self):
            return Response({"detail": "Not a trainer."}, status=status.HTTP_403_FORBIDDEN)

        provider, error = _editable_provider_or_error(_account(request))
        if error is not None:
            return error

        upload = request.FILES.get("logo")
        refusal = validate_image_upload(upload)
        if refusal is not None:
            return Response({"detail": refusal}, status=status.HTTP_400_BAD_REQUEST)

        provider.logo = upload
        try:
            provider.save(update_fields=["logo", "updated_at"])
        except Exception:
            logger.exception("Logo upload failed for provider %s", provider.pk)
            return Response(
                {"detail": "That image could not be read. Try another."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # prepare_logo returns None for anything Pillow cannot decode, which
        # leaves the original bytes stored unprocessed. That must not be kept:
        # it would be served from the public bucket carrying whatever metadata
        # it arrived with.
        if not provider.logo.name.lower().endswith((".jpg", ".png")):
            provider.logo.delete(save=True)
            return Response(
                {"detail": "That file is not a readable image."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({"url": provider.logo.url}, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses={204: None})
    def delete(self, request):
        from .trainer_views import IsActiveTrainer, _account

        if not IsActiveTrainer().has_permission(request, self):
            return Response({"detail": "Not a trainer."}, status=status.HTTP_403_FORBIDDEN)

        provider, error = _editable_provider_or_error(_account(request))
        if error is not None:
            return error

        if provider.logo:
            provider.logo.delete(save=True)
        return Response(status=status.HTTP_204_NO_CONTENT)
