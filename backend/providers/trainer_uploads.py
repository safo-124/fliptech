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
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .admin_upload import validate_image_upload
from .models import ProviderEvidence, ProviderPhoto

logger = logging.getLogger(__name__)

# Enough for a workshop: outside, inside, and the equipment. The cap is here so
# a review queue stays reviewable and one trainer cannot fill the bucket.
MAX_PHOTOS_PER_PROVIDER = 8


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

    def post(self, request):
        from .trainer_views import IsActiveTrainer, _account

        if not IsActiveTrainer().has_permission(request, self):
            return Response({"detail": "Not a trainer."}, status=status.HTTP_403_FORBIDDEN)

        account = _account(request)
        provider, error = _editable_provider_or_error(account)
        if error is not None:
            return error

        if provider.photos.count() >= MAX_PHOTOS_PER_PROVIDER:
            return Response(
                {"detail": f"You can add up to {MAX_PHOTOS_PER_PROVIDER} photographs."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        upload = request.FILES.get("image")
        refusal = validate_image_upload(upload)
        if refusal is not None:
            return Response({"detail": refusal}, status=status.HTTP_400_BAD_REQUEST)

        photo = ProviderPhoto(
            provider=provider,
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
            {"id": photo.pk, "caption": photo.caption, "url": photo.image.url},
            status=status.HTTP_201_CREATED,
        )


class TrainerPhotoDeleteView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

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
