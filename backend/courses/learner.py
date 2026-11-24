"""The learner's side of online learning, beyond watching and paying.

  Progress       where each lesson was left, and which are finished.
  My courses     everything a trainee has started or bought, with how far.
  Certificates   issued when every lesson is finished; checkable by anyone.
  Reviews        stars and words, from people who have watched.
  Questions      under a lesson, answered by the trainer.
  Plays          a count per lesson per day, for the trainer's numbers.
  Captions       a lesson's words on screen, behind the lesson's own lock.

Progress, reviews and questions need a trainee sign-in. Nothing here lets
anyone see a locked lesson they could not already watch: progress on a
locked lesson, a question under one, and its captions are all refused by
the same gate the video files are (courses/access.py).
"""

import logging
import secrets
from datetime import UTC, datetime

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count, F, Max
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from appsupport.notify import notify
from core.sms import send_sms
from providers.learning import CourseCardSerializer, _courses
from providers.models import ProviderVideo
from trainees.access import own_trainee_account

from .access import gate_for
from .models import (
    Certificate,
    CourseReview,
    LessonCaption,
    LessonPlayDay,
    LessonProgress,
    LessonQuestion,
)

logger = logging.getLogger(__name__)

# A lesson counts as finished once 90% of it has actually been played: the
# parts played are kept as time ranges (LessonProgress.watched), so seeking to
# the end adds nothing.
FINISHED_SHARE = 0.9
# Played time can only come in as fast as time passes (allowing 2x speed and
# a little slack for a request that was held back): ranges claiming more
# than that are refused.
MAX_SPEED = 2
SLACK_SECONDS = 30


def _lesson_or_404(video_id):
    video = (
        ProviderVideo.objects.shown()
        .select_related("provider", "provider__area")
        .filter(pk=video_id)
        .first()
    )
    if video is None or video.provider.status != video.provider.Status.PUBLISHED:
        raise NotFound(_("No such lesson."))
    return video


def _course_or_404(area_slug, slug):
    course = _courses().filter(area__slug=area_slug, slug=slug).first()
    if course is None:
        raise NotFound(_("No such course."))
    return course


def _sign_in_needed():
    return Response(
        {"detail": _("Sign in to keep your progress."), "sign_in": True},
        status=status.HTTP_401_UNAUTHORIZED,
    )


def first_name(trainee):
    name = (trainee.display_name or "").strip()
    return name.split()[0] if name else _("A learner")


# --------------------------------------------------------------------------
# Progress and certificates


def merge_ranges(ranges):
    """[[start, end], ...] sorted and joined where they touch or overlap."""
    merged = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def clean_ranges(raw, length):
    """The played ranges a client sent, as whole seconds inside the lesson.
    Anything that is not a [start, end] pair of numbers is dropped."""
    cleaned = []
    if not isinstance(raw, list):
        return cleaned
    for pair in raw[:200]:
        try:
            start, end = (float(pair[0]), float(pair[1]))
        except (TypeError, ValueError, IndexError, KeyError):
            continue
        start, end = max(0, int(start)), int(round(end))
        if length:
            end = min(end, length)
        if end > start:
            cleaned.append([start, end])
    return cleaned


def watched_total(ranges):
    return sum(end - start for start, end in ranges)


def is_finished(video, watched_seconds):
    length = video.duration_seconds or 0
    if length <= 0:
        # No length known (an outside video): played at all is all we can say.
        return watched_seconds > 0
    return watched_seconds >= length * FINISHED_SHARE


def add_watched(row, video, raw, now):
    """Fold newly played ranges into the row. Returns False when they claim
    more playing than the time since the last report allows."""
    added = clean_ranges(raw, video.duration_seconds or 0)
    if not added:
        return True
    merged = merge_ranges([list(pair) for pair in row.watched or []] + added)
    total = watched_total(merged)
    gained = total - (row.watched_seconds or 0)
    since = row.updated_at or row.created_at or now
    elapsed = max(0, (now - since).total_seconds()) if row.pk else 0
    if gained > elapsed * MAX_SPEED + SLACK_SECONDS:
        return False
    row.watched = merged
    row.watched_seconds = total
    return True


def watcher_runs_the_course(trainee, course):
    """The workshop's own trainers and its shop owner preview their course;
    they are not its learners and get no certificate for it."""
    user_id = trainee.user_id
    if course.trainer_memberships.filter(trainer__user_id=user_id).exists():
        return True
    seller = getattr(course, "seller_account", None)
    try:
        return bool(seller and seller.user_id == user_id)
    except Exception:  # noqa: BLE001 - no shop
        return False


def certificate_name_problem(name):
    """Why a name cannot go on a certificate, or None: the full name, in at
    least two words, and a real one."""
    from core.placeholders import name_problem

    name = " ".join(str(name or "").split())
    words = [word for word in name.split(" ") if any(ch.isalpha() for ch in word)]
    if len(words) < 2:
        return _("Write your full name, first name and surname, as it should appear.")
    return name_problem(name)


def course_title(course):
    """What the course is called: its own title, else the workshop's first
    in-person course, else the workshop's name."""
    offer = getattr(course, "course_offer", None)
    try:
        if offer is not None and offer.title.strip():
            return offer.title.strip()
    except Exception:  # noqa: BLE001 - no offer row
        pass
    programme = course.programmes.filter(is_active=True).order_by("pk").first()
    if programme is not None and programme.title.strip():
        return programme.title.strip()
    return course.name


def course_progress(trainee, course, lessons=None):
    """{lesson id: {...}} for one trainee and one course's current lessons."""
    if lessons is None:
        lessons = list(course.videos.shown().in_course_order())
    ids = [lesson.pk for lesson in lessons]
    rows = LessonProgress.objects.filter(trainee=trainee, video_id__in=ids)
    return {
        str(row.video_id): {
            "position": row.position,
            "furthest": row.furthest,
            "completed": row.completed_at is not None,
            "updated_at": row.updated_at,
        }
        for row in rows
    }


def certificate_payload(certificate, request=None):
    if certificate is None:
        return None
    return {
        "code": certificate.code,
        "trainee_name": certificate.trainee_name,
        "course_name": certificate.course_name,
        "area_name": certificate.area_name,
        "trade_name": certificate.trade_name,
        "lessons": certificate.lessons,
        "total_seconds": certificate.total_seconds,
        "issued_at": certificate.created_at,
        "is_revoked": certificate.is_revoked,
        "path": f"/certificates/{certificate.code}",
    }


def _new_code():
    # No 0/O or 1/I/L: read aloud or typed from paper, they get confused.
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def issue_certificate(trainee, course, *, name=None):
    """The trainee's certificate for this course: the one they have, or a new
    one when every current lesson is finished. None when not yet earned."""
    existing = Certificate.objects.filter(trainee=trainee, provider=course).first()
    if existing is not None:
        return existing
    lessons = list(course.videos.shown().in_course_order())
    if not lessons:
        return None
    done = LessonProgress.objects.filter(
        trainee=trainee, video__in=lessons, completed_at__isnull=False
    ).count()
    if done < len(lessons):
        return None
    # Only a name the learner confirmed for the certificate (item: "This
    # name will appear on your certificate"), and never for their own course.
    holder = " ".join(str(name or "").split())
    if not holder or certificate_name_problem(holder):
        return None
    if watcher_runs_the_course(trainee, course):
        return None
    from providers.learning import _trade

    if not hasattr(course, "active_programmes"):
        course = _courses().filter(pk=course.pk).first() or course
    trade = _trade(course) if hasattr(course, "active_programmes") else None
    for _attempt in range(5):
        try:
            with transaction.atomic():
                return Certificate.objects.create(
                    code=_new_code(),
                    trainee=trainee,
                    provider=course,
                    trainee_name=holder[:120],
                    course_name=course_title(course)[:200],
                    area_name=course.area.name if course.area_id else "",
                    trade_name=(trade or {}).get("name", "")[:120],
                    lessons=len(lessons),
                    total_seconds=sum(lesson.duration_seconds or 0 for lesson in lessons),
                )
        except IntegrityError:
            existing = Certificate.objects.filter(trainee=trainee, provider=course).first()
            if existing is not None:
                return existing
    return None


@method_decorator(csrf_protect, name="dispatch")
class LessonProgressView(APIView):
    """Where the trainee is in a lesson. Sent every few seconds of playing,
    and when they pause, leave or reach the end."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request, video_id):
        trainee = own_trainee_account(request)
        if trainee is None:
            return _sign_in_needed()
        video = _lesson_or_404(video_id)
        if not gate_for(video.provider, request).may_watch(video):
            raise NotFound(_("No such lesson."))
        try:
            position = max(0, int(float(request.data.get("position") or 0)))
        except (TypeError, ValueError):
            position = 0
        if video.duration_seconds:
            position = min(position, video.duration_seconds)

        now = timezone.now()
        with transaction.atomic():
            row, _created = LessonProgress.objects.select_for_update().get_or_create(
                trainee=trainee, video=video, defaults={"provider": video.provider}
            )
            row.position = position
            row.furthest = max(row.furthest, position)
            # The ranges actually played; a jump to the end plays nothing.
            accepted = add_watched(row, video, request.data.get("watched"), now)
            if row.completed_at is None and is_finished(video, row.watched_seconds):
                row.completed_at = now
            row.save()

        course = video.provider
        lessons = list(course.videos.shown().in_course_order())
        done = LessonProgress.objects.filter(
            trainee=trainee, video__in=lessons, completed_at__isnull=False
        ).count()
        certificate = Certificate.objects.filter(trainee=trainee, provider=course).first()
        own_course = watcher_runs_the_course(trainee, course)
        length = video.duration_seconds or 0
        return Response(
            {
                "lesson": {
                    "position": row.position,
                    "furthest": row.furthest,
                    "watched_seconds": row.watched_seconds,
                    "watched_share": round(row.watched_seconds / length, 3) if length else None,
                    "completed": row.completed_at is not None,
                    "accepted": accepted,
                },
                "course": {
                    "done": done,
                    "total": len(lessons),
                    "finished": done == len(lessons),
                    # Finished: the learner confirms the name to print first.
                    "needs_name": done == len(lessons) and certificate is None and not own_course,
                    "own_course": own_course,
                    "certificate": certificate_payload(certificate, request),
                },
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class CourseCertificateView(APIView):
    """Ask for the certificate, giving the name to print when there is none
    on the account yet."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={201: None})
    def post(self, request, area_slug, slug):
        trainee = own_trainee_account(request)
        if trainee is None:
            return _sign_in_needed()
        course = _course_or_404(area_slug, slug)
        if watcher_runs_the_course(trainee, course):
            return Response(
                {
                    "detail": _(
                        "This is your own course: you can watch it, but a certificate is "
                        "for your learners."
                    ),
                    "code": "own_course",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        existing = Certificate.objects.filter(trainee=trainee, provider=course).first()
        if existing is not None:
            return Response(certificate_payload(existing, request), status=status.HTTP_200_OK)
        lessons = list(course.videos.shown())
        done = LessonProgress.objects.filter(
            trainee=trainee, video__in=lessons, completed_at__isnull=False
        ).count()
        if not lessons or done < len(lessons):
            return Response(
                {"detail": _("Finish every lesson first, then ask again.")},
                status=status.HTTP_409_CONFLICT,
            )
        name = " ".join(str(request.data.get("name") or "").split())[:120]
        problem = certificate_name_problem(name)
        if problem:
            return Response({"name": [problem]}, status=status.HTTP_400_BAD_REQUEST)
        if not trainee.display_name:
            trainee.display_name = name
            trainee.save(update_fields=["display_name", "updated_at"])
        certificate = issue_certificate(trainee, course, name=name)
        if certificate is None:
            return Response(
                {"detail": _("Finish every lesson first, then ask again.")},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(certificate_payload(certificate, request), status=status.HTTP_201_CREATED)


class CertificateCheckView(APIView):
    """Anyone with a certificate's code can check it is real."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, code):
        certificate = (
            Certificate.objects.select_related("provider", "provider__area")
            .filter(code=str(code).upper())
            .first()
        )
        if certificate is None:
            raise NotFound(_("No certificate has that code."))
        payload = certificate_payload(certificate, request)
        payload["course_path"] = (
            f"/learn/{certificate.provider.area.slug}/{certificate.provider.slug}"
        )
        return Response(payload)


class MyCoursesView(APIView):
    """Every course this trainee has started or bought, most recent first."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request):
        trainee = own_trainee_account(request)
        if trainee is None:
            # Not an error: /learn asks for everybody, to offer "continue
            # learning" to those who have something to continue.
            return Response({"results": [], "signed_in": False})
        touched = dict(
            LessonProgress.objects.filter(trainee=trainee)
            .values("provider_id")
            .annotate(last=Max("updated_at"))
            .values_list("provider_id", "last")
        )
        bought = set(
            trainee.course_purchases.filter(status="paid").values_list("provider_id", flat=True)
        )
        ids = set(touched) | bought
        courses = list(_courses().filter(pk__in=ids))
        certificates = {
            c.provider_id: c for c in Certificate.objects.filter(trainee=trainee, provider__in=ids)
        }
        results = []
        for course in courses:
            lessons = course.shown_videos
            progress = course_progress(trainee, course, lessons)
            done = sum(1 for row in progress.values() if row["completed"])
            # Where to carry on: the latest lesson not yet finished, else
            # the first lesson not started.
            resume = None
            latest = sorted(
                (
                    (row["updated_at"], int(video_id))
                    for video_id, row in progress.items()
                    if not row["completed"]
                ),
                reverse=True,
            )
            if latest:
                resume = latest[0][1]
            else:
                resume = next(
                    (lesson.pk for lesson in lessons if str(lesson.pk) not in progress), None
                )
            resume_lesson = next((lesson for lesson in lessons if lesson.pk == resume), None)
            results.append(
                {
                    "course": CourseCardSerializer(course, context={"request": request}).data,
                    "done": done,
                    "total": len(lessons),
                    "bought": course.pk in bought,
                    "last_watched": touched.get(course.pk),
                    "resume": (
                        {
                            "id": resume_lesson.pk,
                            "title": resume_lesson.title,
                            "position": progress.get(str(resume_lesson.pk), {}).get("position", 0),
                            "duration_seconds": resume_lesson.duration_seconds,
                        }
                        if resume_lesson
                        else None
                    ),
                    "certificate": certificate_payload(certificates.get(course.pk), request),
                }
            )
        epoch = datetime(2000, 1, 1, tzinfo=UTC)
        results.sort(key=lambda row: row["last_watched"] or epoch, reverse=True)
        return Response({"results": results, "signed_in": True})


# --------------------------------------------------------------------------
# Reviews


def review_payload(review):
    return {
        "id": review.id,
        "name": first_name(review.trainee),
        "rating": review.rating,
        "body": review.body,
        "reply": review.reply,
        "replied_at": review.replied_at,
        "created_at": review.created_at,
    }


def rating_summary(provider):
    shown = provider.course_reviews.filter(is_hidden=False)
    summary = shown.aggregate(average=Avg("rating"), count=Count("id"))
    spread = dict(shown.values("rating").annotate(n=Count("id")).values_list("rating", "n"))
    return {
        "average": round(summary["average"], 1) if summary["average"] else None,
        "count": summary["count"],
        "spread": {str(stars): spread.get(stars, 0) for stars in range(5, 0, -1)},
    }


def may_review(trainee, course, request):
    """Someone who has finished at least one lesson they were allowed to
    watch: a buyer, for a paid course. Never the workshop's own trainers or
    shop owner: a course cannot rate itself."""
    if trainee is None:
        return False
    if watcher_runs_the_course(trainee, course):
        return False
    gate = gate_for(course, request)
    if gate.price and not gate.owned:
        return False
    return LessonProgress.objects.filter(
        trainee=trainee, provider=course, completed_at__isnull=False
    ).exists()


@method_decorator(csrf_protect, name="dispatch")
class CourseReviewsView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, area_slug, slug):
        course = _course_or_404(area_slug, slug)
        reviews = course.course_reviews.filter(is_hidden=False).select_related("trainee")[:50]
        return Response(
            {
                "summary": rating_summary(course),
                "results": [review_payload(review) for review in reviews],
            }
        )

    @extend_schema(request=None, responses={201: None})
    def post(self, request, area_slug, slug):
        trainee = own_trainee_account(request)
        if trainee is None:
            return _sign_in_needed()
        course = _course_or_404(area_slug, slug)
        if watcher_runs_the_course(trainee, course):
            return Response(
                {
                    "detail": _("This is your own course: reviews are for your learners."),
                    "code": "own_course",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        if not may_review(trainee, course, request):
            return Response(
                {"detail": _("Finish a lesson of this course to review it.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            rating = int(request.data.get("rating"))
        except (TypeError, ValueError):
            rating = 0
        if not 1 <= rating <= 5:
            return Response(
                {"rating": [_("Choose from one to five stars.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        body = str(request.data.get("body") or "").strip()[:1000]
        review, created = CourseReview.objects.update_or_create(
            provider=course, trainee=trainee, defaults={"rating": rating, "body": body}
        )
        return Response(
            {"review": review_payload(review), "summary": rating_summary(course)},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# --------------------------------------------------------------------------
# Questions under a lesson


def question_payload(question):
    return {
        "id": question.id,
        "name": first_name(question.trainee),
        "body": question.body,
        "at_seconds": question.at_seconds,
        "answer": question.answer,
        "answered_at": question.answered_at,
        "created_at": question.created_at,
    }


def trainer_phones(provider):
    phones = [
        str(membership.trainer.phone)
        for membership in provider.trainer_memberships.select_related("trainer")
        if membership.trainer.is_active
    ]
    if not phones and (provider.owner_phone or provider.contact_phone):
        phones = [str(provider.owner_phone or provider.contact_phone)]
    return phones


def _tell_trainer(question):
    lesson = question.video
    message = (
        f'{settings.BRAND_NAME}: a learner asked about your lesson "{lesson.title}": '
        f'"{question.body[:120]}". Answer it in your course studio.'
    )
    for phone in trainer_phones(question.provider):
        try:
            notify(phone, message, send=send_sms)
        except Exception:
            logger.exception("Could not text the trainer about question %s", question.pk)


@method_decorator(csrf_protect, name="dispatch")
class LessonQuestionsView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, video_id):
        video = _lesson_or_404(video_id)
        questions = video.questions.filter(is_hidden=False).select_related("trainee")
        trainee = own_trainee_account(request)
        # Answered first, newest first; your own unanswered ones too.
        visible = list(
            questions.order_by(F("answered_at").desc(nulls_last=True), "-created_at")[:60]
        )
        return Response(
            {
                "results": [question_payload(q) for q in visible],
                "mine": [q.id for q in visible if trainee and q.trainee_id == trainee.pk],
            }
        )

    @extend_schema(request=None, responses={201: None})
    def post(self, request, video_id):
        trainee = own_trainee_account(request)
        if trainee is None:
            return _sign_in_needed()
        video = _lesson_or_404(video_id)
        if watcher_runs_the_course(trainee, video.provider):
            return Response(
                {
                    "detail": _(
                        "This is your own course: answer your learners' questions from the "
                        "course studio."
                    ),
                    "code": "own_course",
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        if not gate_for(video.provider, request).may_watch(video):
            return Response(
                {"detail": _("Buy the course to ask about this lesson.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        body = " ".join(str(request.data.get("body") or "").split())[:800]
        if len(body) < 5:
            return Response(
                {"body": [_("Write your question.")]}, status=status.HTTP_400_BAD_REQUEST
            )
        if is_ratelimited(
            request, group="lesson-question", key="user", rate="10/h", increment=True
        ):
            return Response(
                {"detail": _("Too many questions. Try again later.")},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        try:
            at = int(float(request.data.get("at_seconds")))
        except (TypeError, ValueError):
            at = None
        question = LessonQuestion.objects.create(
            video=video,
            provider=video.provider,
            trainee=trainee,
            body=body,
            at_seconds=at if at is not None and at >= 0 else None,
        )
        transaction.on_commit(lambda: _tell_trainer(question))
        return Response(question_payload(question), status=status.HTTP_201_CREATED)


# --------------------------------------------------------------------------
# Plays and captions


class LessonPlayView(APIView):
    """Count a lesson being started. Anonymous and cookie-free."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, video_id):
        if is_ratelimited(request, group="lesson-play", key="ip", rate="120/h", increment=True):
            return Response(status=status.HTTP_204_NO_CONTENT)
        video = ProviderVideo.objects.shown().filter(pk=video_id).only("pk", "provider_id").first()
        if video is not None:
            today = timezone.localdate()
            updated = LessonPlayDay.objects.filter(video=video, day=today).update(
                plays=F("plays") + 1
            )
            if not updated:
                try:
                    with transaction.atomic():
                        LessonPlayDay.objects.create(
                            video=video, provider_id=video.provider_id, day=today, plays=1
                        )
                except IntegrityError:
                    LessonPlayDay.objects.filter(video=video, day=today).update(
                        plays=F("plays") + 1
                    )
        return Response(status=status.HTTP_204_NO_CONTENT)


class LessonCaptionsView(APIView):
    """One lesson's captions as WebVTT, for the player's <track>."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(responses={200: None})
    def get(self, request, video_id, language):
        video = _lesson_or_404(video_id)
        if not gate_for(video.provider, request).may_watch(video):
            return HttpResponse(status=403)
        caption = LessonCaption.objects.filter(video=video, language=language).first()
        if caption is None:
            raise NotFound(_("No captions in that language."))
        response = HttpResponse(caption.vtt, content_type="text/vtt; charset=utf-8")
        response["Cache-Control"] = "private, max-age=300"
        return response


def learner_state(trainee, course, lessons, request):
    """What the course page adds for a signed-in trainee: progress, their
    certificate and review, and whether they may write one."""
    if trainee is None:
        return {
            "progress": {},
            "certificate": None,
            "my_review": None,
            "can_review": False,
            "own_course": False,
            "full_name": "",
        }
    review = course.course_reviews.filter(trainee=trainee).first()
    return {
        # Previewing their own course: no certificate (watcher_runs_the_course).
        "own_course": watcher_runs_the_course(trainee, course),
        # To fill in the certificate name, for the learner to confirm.
        "full_name": trainee.display_name or "",
        "progress": {
            key: {k: v for k, v in row.items() if k != "updated_at"}
            for key, row in course_progress(trainee, course, lessons).items()
        },
        "certificate": certificate_payload(
            Certificate.objects.filter(trainee=trainee, provider=course).first(), request
        ),
        "my_review": review_payload(review) if review else None,
        "can_review": may_review(trainee, course, request),
    }
