"""The trainer's course studio: everything about their course beyond the
price and payout (courses/views.py) and the uploads (providers/trainer_videos).

  Details     the course page in their words: summary, what you will learn,
              what you need, the level, and a launch price.
  Lessons     the order, the section each sits in, a description, captions.
  Codes       promo codes for money off.
  Numbers     plays, who started and finished each lesson, sales, ratings.
  Learners    questions to answer and reviews to reply to.
  Featured    paying to be shown first on /learn and the home page.

All of it is scoped to the signed-in trainer's own workshop: an id from
another workshop is a 404, never somebody else's lesson.
"""

import logging
import re
import secrets
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext as _
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.sms import send_sms
from providers.trainer_views import IsActiveTrainer, _account, _profile_for

from . import paystack
from .learner import question_payload, rating_summary, review_payload
from .models import (
    MAX_PRICE,
    MIN_PRICE,
    CourseBoost,
    CourseOffer,
    CoursePromoCode,
    CoursePurchase,
    CourseReview,
    LessonCaption,
    LessonPlayDay,
    LessonProgress,
    LessonQuestion,
)

logger = logging.getLogger(__name__)

CAPTION_MAX_BYTES = 200 * 1024
CAPTION_LANGUAGES = {
    "en": "English",
    "tw": "Twi",
    "ee": "Ewe",
    "gaa": "Ga",
    "dag": "Dagbani",
    "ha": "Hausa",
    "fr": "French",
}


class TrainerView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated, IsActiveTrainer]

    def provider(self, request):
        provider = _profile_for(_account(request))
        if provider is None:
            raise NotFound(_("Create your workshop details first."))
        return provider


def parse_day_or_time(value):
    """A moment from a date ("2026-12-01", the end of that day) or a full
    timestamp. None when it is neither."""
    text = str(value or "").strip()
    if not text:
        return None
    moment = parse_datetime(text)
    if moment is None:
        try:
            moment = datetime.combine(datetime.fromisoformat(text).date(), time(23, 59))
        except ValueError:
            return None
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment)
    return moment


def _bad(field, message):
    return Response({field: [message]}, status=status.HTTP_400_BAD_REQUEST)


# --------------------------------------------------------------------------
# Details


def details_payload(offer):
    return {
        "summary": offer.summary,
        "outcomes": offer.outcomes,
        "tools": offer.tools,
        "level": offer.level,
        "levels": [{"value": v, "label": label} for v, label in CourseOffer.Level.choices],
        "price": f"{offer.price:.2f}" if offer.price else None,
        "sale_price": f"{offer.sale_price:.2f}" if offer.sale_price else None,
        "sale_ends_at": offer.sale_ends_at,
        "on_sale": offer.on_sale,
        "featured_until": offer.featured_until if offer.is_featured else None,
        # Where learners find it, once it has an approved lesson and is live.
        "course_path": (
            f"/learn/{offer.provider.area.slug}/{offer.provider.slug}"
            if offer.provider.status == offer.provider.Status.PUBLISHED
            and offer.provider.videos.shown().exists()
            else None
        ),
    }


class StudioDetailsView(TrainerView):
    @extend_schema(responses={200: None})
    def get(self, request):
        offer, _created = CourseOffer.objects.get_or_create(provider=self.provider(request))
        return Response(details_payload(offer))

    @extend_schema(request=None, responses={200: None})
    def patch(self, request):
        offer, _created = CourseOffer.objects.get_or_create(provider=self.provider(request))
        data = request.data
        fields = []
        for name, limit in (("summary", 1200), ("outcomes", 1500), ("tools", 1000)):
            if name in data:
                setattr(offer, name, str(data.get(name) or "").strip()[:limit])
                fields.append(name)
        if "level" in data:
            level = str(data.get("level") or "")
            if level and level not in CourseOffer.Level.values:
                return _bad("level", _("Choose a level from the list."))
            offer.level = level
            fields.append("level")
        if "sale_price" in data:
            raw = data.get("sale_price")
            if raw in (None, "", 0, "0"):
                offer.sale_price = None
                offer.sale_ends_at = None
            else:
                try:
                    sale = Decimal(str(raw)).quantize(Decimal("0.01"))
                except (InvalidOperation, ValueError):
                    return _bad("sale_price", _("Enter the price in cedis, like 99."))
                if not offer.price:
                    return _bad("sale_price", _("Set the course price first."))
                if sale < MIN_PRICE or sale >= offer.price or sale > MAX_PRICE:
                    return _bad(
                        "sale_price", _("A launch price must be lower than the full price.")
                    )
                offer.sale_price = sale
                ends = data.get("sale_ends_at")
                parsed = parse_day_or_time(ends)
                if ends and parsed is None:
                    return _bad("sale_ends_at", _("Choose the day the launch price ends."))
                if parsed is not None and parsed <= timezone.now():
                    return _bad("sale_ends_at", _("Choose a day after today."))
                offer.sale_ends_at = parsed
            fields += ["sale_price", "sale_ends_at"]
        if fields:
            offer.save(update_fields=[*fields, "updated_at"])
        return Response(details_payload(offer))


# --------------------------------------------------------------------------
# Lessons


def lesson_payload(video, request=None):
    from providers.serializers import lesson_captions

    return {
        "id": video.id,
        "title": video.title,
        "status": video.status,
        "position": video.position,
        "section": video.section,
        "description": video.description,
        "duration_seconds": video.duration_seconds,
        "poster": (
            request.build_absolute_uri(video.public_poster.url)
            if request is not None and video.public_poster
            else None
        ),
        "kind": "youtube" if video.is_youtube else "upload",
        "stream": video.hls_state,
        "captions": lesson_captions(video, request),
    }


class StudioLessonsView(TrainerView):
    """Every lesson of the workshop, in course order, with its place."""

    @extend_schema(responses={200: None})
    def get(self, request):
        provider = self.provider(request)
        lessons = provider.videos.in_course_order().prefetch_related("captions")
        return Response(
            {
                "lessons": [lesson_payload(video, request) for video in lessons],
                "languages": [
                    {"value": code, "label": label} for code, label in CAPTION_LANGUAGES.items()
                ],
            }
        )

    @extend_schema(request=None, responses={200: None})
    def put(self, request):
        """The new order: [{id, section}], first to last. Lessons left out
        keep their place after these."""
        provider = self.provider(request)
        items = request.data.get("lessons")
        if not isinstance(items, list) or not items:
            return _bad("lessons", _("Send the lessons in their new order."))
        mine = {video.pk: video for video in provider.videos.all()}
        seen = []
        for item in items:
            try:
                video_id = int(item.get("id"))
            except (AttributeError, TypeError, ValueError):
                return _bad("lessons", _("Send the lessons in their new order."))
            if video_id not in mine or video_id in seen:
                return _bad("lessons", _("That is not one of your lessons."))
            seen.append(video_id)
        with transaction.atomic():
            position = 0
            for item in items:
                position += 1
                video = mine[int(item["id"])]
                video.position = position
                if "section" in item:
                    video.section = " ".join(str(item.get("section") or "").split())[:80]
                video.save(update_fields=["position", "section", "updated_at"])
            for video in sorted(
                (v for pk, v in mine.items() if pk not in seen),
                key=lambda v: (v.position, v.created_at),
            ):
                position += 1
                video.position = position
                video.save(update_fields=["position", "updated_at"])
        return self.get(request)


class StudioLessonView(TrainerView):
    def lesson(self, request, video_id):
        video = self.provider(request).videos.filter(pk=video_id).first()
        if video is None:
            raise NotFound(_("No such lesson."))
        return video

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, video_id):
        """A lesson's section and description."""
        video = self.lesson(request, video_id)
        fields = []
        if "section" in request.data:
            video.section = " ".join(str(request.data.get("section") or "").split())[:80]
            fields.append("section")
        if "description" in request.data:
            video.description = str(request.data.get("description") or "").strip()[:2000]
            fields.append("description")
        if fields:
            video.save(update_fields=[*fields, "updated_at"])
        return Response(lesson_payload(video, request))


TIMESTAMP = re.compile(
    r"(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}"
)
TAG = re.compile(r"<[^>]{0,200}>")


def to_vtt(text):
    """WebVTT from what a trainer has: a .vtt, a .srt, or None if neither."""
    text = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿").strip()
    if not TIMESTAMP.search(text):
        return None
    body = text.split("\n", 1)[1] if text.startswith("WEBVTT") else text
    lines = []
    for line in body.split("\n"):
        # SRT writes 00:00:01,500; WebVTT wants 00:00:01.500.
        line = re.sub(r"(\d{2}),(\d{1,3})", r"\1.\2", line) if "-->" in line else TAG.sub("", line)
        lines.append(line)
    return "WEBVTT\n\n" + "\n".join(lines).strip() + "\n"


class StudioCaptionsView(StudioLessonView):
    @extend_schema(request=None, responses={200: None})
    def put(self, request, video_id, language):
        video = self.lesson(request, video_id)
        if language not in CAPTION_LANGUAGES:
            return _bad("language", _("Choose a language from the list."))
        upload = request.FILES.get("file")
        if upload is not None:
            if upload.size > CAPTION_MAX_BYTES:
                return _bad("file", _("That file is too big for captions."))
            raw = upload.read().decode("utf-8", errors="replace")
        else:
            raw = str(request.data.get("text") or "")
        if len(raw.encode()) > CAPTION_MAX_BYTES:
            return _bad("text", _("Those captions are too long."))
        vtt = to_vtt(raw)
        if vtt is None:
            return _bad(
                "text",
                _("Captions need times, like 00:00:05.000 --> 00:00:08.000, before each line."),
            )
        LessonCaption.objects.update_or_create(
            video=video,
            language=language,
            defaults={"vtt": vtt, "label": CAPTION_LANGUAGES[language]},
        )
        return Response(lesson_payload(video, request))

    @extend_schema(responses={200: None})
    def delete(self, request, video_id, language):
        video = self.lesson(request, video_id)
        LessonCaption.objects.filter(video=video, language=language).delete()
        return Response(lesson_payload(video, request))


# --------------------------------------------------------------------------
# Promo codes


def code_payload(code):
    return {
        "id": code.id,
        "code": code.code,
        "percent_off": code.percent_off,
        "max_uses": code.max_uses,
        "uses": code.uses,
        "expires_at": code.expires_at,
        "is_active": code.is_active,
        "usable": code.usable,
    }


class StudioCodesView(TrainerView):
    @extend_schema(responses={200: None})
    def get(self, request):
        codes = self.provider(request).course_codes.all()
        return Response({"codes": [code_payload(code) for code in codes]})

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        provider = self.provider(request)
        word = re.sub(r"[^A-Z0-9]", "", str(request.data.get("code") or "").upper())[:20]
        if len(word) < 3:
            return _bad("code", _("Use 3 to 20 letters and numbers, like LAUNCH20."))
        try:
            percent = int(request.data.get("percent_off"))
        except (TypeError, ValueError):
            percent = 0
        if not 5 <= percent <= 90:
            return _bad("percent_off", _("Choose from 5% to 90% off."))
        max_uses = request.data.get("max_uses")
        try:
            max_uses = int(max_uses) if max_uses not in (None, "") else None
        except (TypeError, ValueError):
            return _bad("max_uses", _("Enter a number of uses, or leave it empty."))
        if max_uses is not None and max_uses < 1:
            return _bad("max_uses", _("Enter a number of uses, or leave it empty."))
        expires = request.data.get("expires_at")
        expires_at = parse_day_or_time(expires)
        if expires and expires_at is None:
            return _bad("expires_at", _("Choose the last day the code works."))
        if provider.course_codes.filter(code__iexact=word).exists():
            return _bad("code", _("You already have that code."))
        code = CoursePromoCode.objects.create(
            provider=provider,
            code=word,
            percent_off=percent,
            max_uses=max_uses,
            expires_at=expires_at,
        )
        return Response(code_payload(code), status=status.HTTP_201_CREATED)


class StudioCodeView(TrainerView):
    def code(self, request, code_id):
        code = self.provider(request).course_codes.filter(pk=code_id).first()
        if code is None:
            raise NotFound(_("No such code."))
        return code

    @extend_schema(request=None, responses={200: None})
    def patch(self, request, code_id):
        code = self.code(request, code_id)
        if "is_active" in request.data:
            code.is_active = bool(request.data.get("is_active"))
            code.save(update_fields=["is_active", "updated_at"])
        return Response(code_payload(code))

    @extend_schema(responses={204: None})
    def delete(self, request, code_id):
        self.code(request, code_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Numbers


class StudioStatsView(TrainerView):
    @extend_schema(responses={200: None})
    def get(self, request):
        provider = self.provider(request)
        today = timezone.localdate()
        since = today - timedelta(days=29)
        lessons = list(provider.videos.shown().in_course_order())
        plays = {
            row["video_id"]: row
            for row in LessonPlayDay.objects.filter(provider=provider)
            .values("video_id")
            .annotate(
                total=Sum("plays"),
                recent=Sum("plays", filter=Q(day__gte=since)),
            )
        }
        progress = {
            row["video_id"]: row
            for row in LessonProgress.objects.filter(provider=provider)
            .values("video_id")
            .annotate(
                started=Count("id"),
                finished=Count("id", filter=Q(completed_at__isnull=False)),
            )
        }
        daily = dict(
            LessonPlayDay.objects.filter(provider=provider, day__gte=since)
            .values("day")
            .annotate(total=Sum("plays"))
            .values_list("day", "total")
        )
        paid = CoursePurchase.objects.filter(provider=provider, status=CoursePurchase.Status.PAID)
        sales = paid.aggregate(count=Count("id"), pesewas=Sum("amount_pesewas"))
        recent_sales = paid.filter(paid_at__date__gte=since).aggregate(
            count=Count("id"), pesewas=Sum("amount_pesewas")
        )
        return Response(
            {
                "totals": {
                    "plays": sum(row["total"] or 0 for row in plays.values()),
                    "plays_30": sum(row["recent"] or 0 for row in plays.values()),
                    "learners": LessonProgress.objects.filter(provider=provider)
                    .values("trainee")
                    .distinct()
                    .count(),
                    "certificates": provider.certificates.filter(is_revoked=False).count(),
                    "sales": sales["count"] or 0,
                    "earned": f"{(sales['pesewas'] or 0) / 100:.2f}",
                    "sales_30": recent_sales["count"] or 0,
                    "earned_30": f"{(recent_sales['pesewas'] or 0) / 100:.2f}",
                    "unanswered": provider.lesson_questions.filter(
                        answered_at__isnull=True, is_hidden=False
                    ).count(),
                },
                "ratings": rating_summary(provider),
                "daily": [
                    {
                        "day": (since + timedelta(days=offset)).isoformat(),
                        "plays": daily.get(since + timedelta(days=offset), 0),
                    }
                    for offset in range(30)
                ],
                "lessons": [
                    {
                        "id": video.id,
                        "title": video.title,
                        "plays": (plays.get(video.id) or {}).get("total") or 0,
                        "started": (progress.get(video.id) or {}).get("started") or 0,
                        "finished": (progress.get(video.id) or {}).get("finished") or 0,
                    }
                    for video in lessons
                ],
                "codes": [
                    {"code": row["promo_code"], "uses": row["n"]}
                    for row in paid.exclude(promo_code="")
                    .values("promo_code")
                    .annotate(n=Count("id"))
                    .order_by("-n")
                ],
            }
        )


# --------------------------------------------------------------------------
# Learners' questions and reviews


def _tell_learner(question):
    try:
        send_sms(
            question.trainee.phone,
            f"{settings.BRAND_NAME}: {question.provider.name} answered your question about "
            f'"{question.video.title}": "{question.answer[:140]}"',
        )
    except Exception:
        logger.exception("Could not text the answer to question %s", question.pk)


class StudioQuestionsView(TrainerView):
    @extend_schema(responses={200: None})
    def get(self, request):
        questions = (
            self.provider(request)
            .lesson_questions.filter(is_hidden=False)
            .select_related("trainee", "video")
            .order_by("answered_at", "-created_at")[:100]
        )
        return Response(
            {
                "questions": [
                    {**question_payload(q), "lesson": {"id": q.video_id, "title": q.video.title}}
                    for q in questions
                ]
            }
        )


class StudioAnswerView(TrainerView):
    @extend_schema(request=None, responses={200: None})
    def post(self, request, question_id):
        question = (
            LessonQuestion.objects.select_related("trainee", "video", "provider")
            .filter(provider=self.provider(request), pk=question_id)
            .first()
        )
        if question is None:
            raise NotFound(_("No such question."))
        answer = str(request.data.get("answer") or "").strip()[:1500]
        if len(answer) < 2:
            return _bad("answer", _("Write your answer."))
        first = question.answered_at is None
        question.answer = answer
        question.answered_at = timezone.now()
        question.answered_by = request.user
        question.save(update_fields=["answer", "answered_at", "answered_by", "updated_at"])
        if first:
            transaction.on_commit(lambda: _tell_learner(question))
        return Response(
            {
                **question_payload(question),
                "lesson": {"id": question.video_id, "title": question.video.title},
            }
        )


class StudioReviewsView(TrainerView):
    @extend_schema(responses={200: None})
    def get(self, request):
        provider = self.provider(request)
        reviews = provider.course_reviews.filter(is_hidden=False).select_related("trainee")[:100]
        return Response(
            {
                "summary": rating_summary(provider),
                "reviews": [review_payload(review) for review in reviews],
            }
        )


class StudioReplyView(TrainerView):
    @extend_schema(request=None, responses={200: None})
    def post(self, request, review_id):
        review = (
            CourseReview.objects.select_related("trainee")
            .filter(provider=self.provider(request), pk=review_id)
            .first()
        )
        if review is None:
            raise NotFound(_("No such review."))
        review.reply = str(request.data.get("reply") or "").strip()[:1000]
        review.replied_at = timezone.now() if review.reply else None
        review.save(update_fields=["reply", "replied_at", "updated_at"])
        return Response(review_payload(review))


# --------------------------------------------------------------------------
# Featured


def boost_options():
    return [
        {"days": 7, "price": f"{settings.COURSE_BOOST_WEEK_PRICE:.2f}"},
        {"days": 30, "price": f"{settings.COURSE_BOOST_MONTH_PRICE:.2f}"},
    ]


class StudioBoostView(TrainerView):
    @extend_schema(responses={200: None})
    def get(self, request):
        provider = self.provider(request)
        offer = CourseOffer.objects.filter(provider=provider).first()
        return Response(
            {
                "options": boost_options(),
                "payments_enabled": paystack.enabled(),
                "featured_until": offer.featured_until if offer and offer.is_featured else None,
            }
        )

    @extend_schema(request=None, responses={201: None})
    def post(self, request):
        provider = self.provider(request)
        try:
            days = int(request.data.get("days"))
        except (TypeError, ValueError):
            days = 0
        option = next((o for o in boost_options() if o["days"] == days), None)
        if option is None:
            return _bad("days", _("Choose a week or a month."))
        if not provider.videos.shown().exists():
            return Response(
                {"detail": _("Your course needs an approved lesson before it can be featured.")},
                status=status.HTTP_409_CONFLICT,
            )
        if is_ratelimited(request, group="course-boost", key="user", rate="10/h", increment=True):
            return Response(
                {"detail": _("Too many attempts. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        from marketplace.payments import payer_email

        account = _account(request)
        boost = CourseBoost.objects.create(
            reference=f"fk-{secrets.token_hex(10)}",
            provider=provider,
            days=days,
            amount_pesewas=int(Decimal(option["price"]) * 100),
            added_by=request.user,
        )
        callback = f"{settings.PUBLIC_SITE_URL.rstrip('/')}/trainer/course?boost={boost.reference}"
        try:
            url = paystack.initialize(
                email=payer_email(getattr(account, "email", None), account.phone),
                amount_pesewas=boost.amount_pesewas,
                reference=boost.reference,
                callback_url=callback,
                metadata={"provider_id": provider.pk, "kind": "course_boost"},
            )
        except paystack.PaystackError as exc:
            boost.status = CourseBoost.Status.FAILED
            boost.gateway_response = str(exc)[:200]
            boost.save(update_fields=["status", "gateway_response", "updated_at"])
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(
            {"authorization_url": url, "reference": boost.reference},
            status=status.HTTP_201_CREATED,
        )


class StudioBoostVerifyView(TrainerView):
    @extend_schema(request=None, responses={200: None})
    def post(self, request, reference):
        boost = CourseBoost.objects.filter(
            provider=self.provider(request), reference=reference
        ).first()
        if boost is None:
            raise NotFound(_("No such payment."))
        if boost.status == CourseBoost.Status.PENDING:
            try:
                boost = confirm_boost(reference, paystack.verify(reference)) or boost
            except paystack.PaystackError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"status": boost.status, "ends_at": boost.ends_at})


def confirm_boost(reference, data):
    """Paid only for a successful charge of exactly the amount asked. Adds
    the days after any featuring already running, so paying early loses
    nothing."""
    data = data or {}
    with transaction.atomic():
        boost = CourseBoost.objects.select_for_update().filter(reference=reference).first()
        if boost is None or boost.status == CourseBoost.Status.PAID:
            return boost
        exact = (
            int(data.get("amount") or 0) == boost.amount_pesewas
            and str(data.get("currency") or "").upper() == boost.currency
        )
        boost.gateway_response = str(data.get("gateway_response") or "")[:200]
        boost.channel = str(data.get("channel") or "")[:30]
        state = data.get("status")
        if state == "success" and exact:
            offer, _created = CourseOffer.objects.select_for_update().get_or_create(
                provider=boost.provider
            )
            now = timezone.now()
            start = (
                offer.featured_until if offer.featured_until and offer.featured_until > now else now
            )
            offer.featured_until = start + timedelta(days=boost.days)
            offer.save(update_fields=["featured_until", "updated_at"])
            boost.status = CourseBoost.Status.PAID
            boost.paid_at = now
            boost.ends_at = offer.featured_until
        elif state == "success":
            logger.error("Course boost %s does not match what was asked; not granting", reference)
            boost.status = CourseBoost.Status.FAILED
        elif state in ("failed", "abandoned", "reversed"):
            boost.status = CourseBoost.Status.FAILED
        boost.save()
        return boost
