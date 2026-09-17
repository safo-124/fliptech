"""Asynchronous photograph upload for the back office.

Section 09 calls working on a phone over a mobile connection "a specific
requirement, not a general aspiration", with photographs uploading in the
background. Stock Django admin cannot do that: images ride along in the form
POST, so a dropped connection in a workshop loses the whole visit — the fee
schedule, the owner's name, everything typed, not just the photographs.

Each photograph is uploaded on its own the moment it is chosen, against a
provider that has already been saved. Three consequences that matter in the
field:

* A failed photograph costs one photograph, not the visit.
* The officer keeps typing while photographs upload behind them.
* A retry re-sends one image over a bad link rather than the whole form.

The client retries with backoff; these endpoints only have to be idempotent
enough that a duplicate arrival is a duplicate row rather than an error.
"""

import logging

from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST

from .models import Provider, ProviderPhoto

logger = logging.getLogger(__name__)

# A modern phone photograph is 2-6 MB. The ceiling is generous enough not to
# reject real evidence and low enough that one bad file cannot fill the disk.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def validate_image_upload(upload):
    """Return a human-readable refusal, or None when the file may be accepted.

    Shared with the trainer-facing upload endpoint so the two cannot drift.
    A trainer uploading their own workshop photograph has to clear exactly the
    limits a field officer does — the file ends up in the same public bucket.
    """
    if upload is None:
        return "No file was received."
    if upload.size > MAX_UPLOAD_BYTES:
        return (
            f"That image is {upload.size // (1024 * 1024)} MB. "
            f"The limit is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )
    # content_type is client-supplied and therefore a hint, not proof. The real
    # check is Pillow: strip_exif re-encodes the image on save and returns None
    # for anything it cannot read, so a mislabelled file cannot become a photo.
    if upload.content_type and upload.content_type not in ALLOWED_CONTENT_TYPES:
        return f"{upload.content_type} is not an image we can accept."
    return None


def _photo_payload(photo):
    return {
        "id": photo.pk,
        "kind": photo.kind,
        "url": photo.image.url,
        "caption": photo.caption,
        "exif_stripped": photo.exif_stripped,
    }


def _may_edit(request):
    return request.user.has_perm("providers.change_provider")


@staff_member_required
@require_POST
def upload_photo(request, provider_id):
    """Accept one photograph for an already-saved provider."""
    if not _may_edit(request):
        return JsonResponse({"detail": "You cannot edit providers."}, status=403)

    provider = get_object_or_404(Provider, pk=provider_id)
    upload = request.FILES.get("image")
    refusal = validate_image_upload(upload)
    if refusal is not None:
        return JsonResponse({"detail": refusal}, status=400)

    # A field officer photographs both the premises and finished work on the
    # same visit, so the staff uploader has to be able to say which this is.
    # Anything unrecognised falls back to the workshop: a work photo labelled
    # as premises is cosmetic, while the reverse would let a picture of a yard
    # satisfy "show me the work".
    kind = request.POST.get("kind")
    if kind not in ProviderPhoto.Kind.values:
        kind = ProviderPhoto.Kind.WORKSHOP

    photo = ProviderPhoto(provider=provider, kind=kind, uploaded_by=request.user)
    photo.image = upload
    try:
        photo.save()
    except Exception:
        logger.exception("Photograph upload failed for provider %s", provider_id)
        return JsonResponse({"detail": "That image could not be read. Try another."}, status=400)

    if not photo.exif_stripped:
        # strip_exif returns None for anything Pillow cannot decode. A file that
        # reaches here unstripped is not an image, so it must not be kept: it
        # would be served from the public bucket with whatever metadata it
        # carries.
        photo.delete()
        return JsonResponse({"detail": "That file is not a readable image."}, status=400)

    return JsonResponse(_photo_payload(photo), status=201)


@staff_member_required
@require_POST
def delete_photo(request, provider_id, photo_id):
    if not _may_edit(request):
        return JsonResponse({"detail": "You cannot edit providers."}, status=403)

    photo = get_object_or_404(ProviderPhoto, pk=photo_id, provider_id=provider_id)
    photo.delete()
    return JsonResponse({"deleted": photo_id})


@staff_member_required
@require_POST
def caption_photo(request, provider_id, photo_id):
    if not _may_edit(request):
        return JsonResponse({"detail": "You cannot edit providers."}, status=403)

    photo = get_object_or_404(ProviderPhoto, pk=photo_id, provider_id=provider_id)
    photo.caption = (request.POST.get("caption") or "")[:200]
    photo.save(update_fields=["caption", "updated_at"])
    return JsonResponse(_photo_payload(photo))


@staff_member_required
def photos_base(request, provider_id):
    """List the photographs on a provider.

    This exists mainly so the uploader has a resolvable URL prefix to build
    "<base><photo_id>/delete/" from, rather than assembling admin paths by
    string concatenation that would break the day the admin moves. It returns
    real data so it is also usable on its own.
    """
    provider = get_object_or_404(Provider, pk=provider_id)
    return JsonResponse({"photos": [_photo_payload(p) for p in provider.photos.all()]})
