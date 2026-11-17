"""Signing in with a phone number or an email address and a password.

The phone code (enquiries/otp.py) stays, for when SMS can be relied on; this
is the way in that does not need a text to arrive. One login per person, as
before: the password is set on the same Django user the phone code signs in
to, so a person can use either.

  POST /api/account/register/          phone, email, password, name -> signed in
  POST /api/account/sign-in/           login (phone or email), password
  POST /api/account/password/forgot/   login -> a reset link by email
  POST /api/account/password/reset/    uid, token, password -> signed in
  POST /api/account/password/          set or change one's own password
  POST /api/account/email/confirm/     uid, token -> the email is confirmed
  POST /api/account/email/resend/      send the confirmation link again
  POST /api/app/register/ and /api/app/sign-in/: the same, returning a token

Email is required at registration so "Forgot your password?" always has
somewhere to go while SMS cannot be relied on. A number registered this way
is not proven (phone_verified_at stays empty) until a code confirms it.

Staff never sign in here: a login with staff rights, groups or permissions is
refused as if the password were wrong (core.identities.user_is_unprivileged),
so the back office keeps its own door. Wrong passwords are counted and locked
out by django-axes, which authenticate() runs through.
"""

import logging

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, password_validation
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.tokens import PasswordResetTokenGenerator, default_token_generator
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect
from django_ratelimit.core import is_ratelimited
from drf_spectacular.utils import extend_schema
from phonenumber_field.phonenumber import PhoneNumber
from phonenumber_field.serializerfields import PhoneNumberField
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.identities import _role_models, user_for_new_role, user_is_unprivileged
from core.network import ratelimit_client_ip

from .auth import ensure_customer, own_customer_account
from .models import CustomerAccount

logger = logging.getLogger(__name__)

WRONG = "That phone number or email and password do not match."


# --------------------------------------------------------------------------
# Finding the person


def _as_phone(login_text):
    """A Ghana number as stored, from however it was typed, or None."""
    try:
        number = PhoneNumber.from_string(login_text.strip(), region="GH")
    except Exception:  # noqa: BLE001 - not a number at all
        return None
    return number if number.is_valid() else None


def account_for_login(login_text):
    """The role account (customer first) a phone number or email names, or
    None. Only a person's login: never staff."""
    text = (login_text or "").strip()
    if not text:
        return None
    if "@" in text:
        lookup = {"email__iexact": text}
    else:
        phone = _as_phone(text)
        if phone is None:
            return None
        lookup = {"phone": phone}
    for model in _role_models():
        account = model.objects.select_related("user").filter(**lookup).first()
        if account is not None and account.user_id and user_is_unprivileged(account.user):
            return account
    return None


def email_for(user):
    """The address to reach this person at: the customer account's, else any
    of their other accounts'."""
    for relation in ("customer_account", "seller_account", "trainer_account", "trainee_account"):
        account = getattr(user, relation, None)
        try:
            if account is not None and account.email:
                return account.email
        except Exception:  # noqa: BLE001 - no such account
            continue
    return None


class PhoneOrEmailBackend(ModelBackend):
    """authenticate(username=<phone or email>, password=...) for a person's
    login. Listed after AxesStandaloneBackend, so failures are counted."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or not password:
            return None
        account = account_for_login(username)
        if account is None:
            # As slow as a real check, so timing does not say who exists.
            get_user_model()().set_password(password)
            return None
        user = account.user
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None


def _locked_out(request, login_text):
    """Whether django-axes has locked this login (or this address) out after
    too many wrong passwords. Asked before trying, so a locked-out person is
    told why instead of "wrong password"."""
    from axes.handlers.proxy import AxesProxyHandler

    if getattr(request, "axes_locked_out", False):
        return True
    return not AxesProxyHandler.is_allowed(request, {"username": login_text})


def check_password_sign_in(request, login_text, password):
    """(user, error): the person if the login and password match."""
    locked = _("Too many wrong tries. Wait an hour, or use “Forgot your password?”.")
    if _locked_out(request._request, login_text):
        return None, locked
    user = authenticate(request._request, username=login_text, password=password)
    if _locked_out(request._request, login_text):
        return None, locked
    if user is None or not user_is_unprivileged(user):
        return None, _(WRONG)
    return user, None


def customer_for(user):
    """The customer account on this login, made if it has none (a seller or
    trainer signing in for the first time with a password)."""
    try:
        return user.customer_account
    except CustomerAccount.DoesNotExist:
        pass
    for relation in ("seller_account", "trainer_account", "trainee_account"):
        account = getattr(user, relation, None)
        try:
            if account is not None and account.phone:
                return ensure_customer(user, account.phone, account.phone_verified_at)
        except Exception:  # noqa: BLE001 - no such account
            continue
    return None


# --------------------------------------------------------------------------
# Links by email


class EmailConfirmTokenGenerator(PasswordResetTokenGenerator):
    """A link that confirms one address: it stops working once the address
    changes or has been confirmed."""

    key_salt = "accounts.passwords.EmailConfirmTokenGenerator"

    def _make_hash_value(self, user, timestamp):
        account = getattr(user, "customer_account", None)
        email = getattr(account, "email", "") or ""
        confirmed = getattr(account, "email_verified_at", None)
        return f"{user.pk}{email}{confirmed}{timestamp}"


email_confirm_token = EmailConfirmTokenGenerator()


def _site(path):
    base = (settings.PUBLIC_SITE_URL or "").rstrip("/")
    return f"{base}{path}"


def _uid(user):
    return urlsafe_base64_encode(force_bytes(user.pk))


def _user_from_uid(uid):
    try:
        pk = force_str(urlsafe_base64_decode(uid))
        return get_user_model().objects.get(pk=pk)
    except (TypeError, ValueError, OverflowError, get_user_model().DoesNotExist):
        return None


def send_confirm_email(account):
    """ "Confirm your email": a link that proves this address is theirs."""
    from core.mail import send_email

    if not account.email or account.email_verified_at:
        return False
    link = _site(
        f"/account/confirm-email?uid={_uid(account.user)}"
        f"&token={email_confirm_token.make_token(account.user)}"
    )
    try:
        return send_email(
            account.email,
            _("Confirm your email for %(brand)s") % {"brand": settings.BRAND_NAME},
            _(
                "Hello%(name)s,\n\nConfirm this is your email address, so you can reset your "
                "password and get your order updates here:\n\n%(link)s\n\n"
                "If you did not make an account on %(brand)s, ignore this email."
            )
            % {
                "name": f" {account.display_name}" if account.display_name else "",
                "link": link,
                "brand": settings.BRAND_NAME,
            },
        )
    except Exception:  # noqa: BLE001 - the account stands without the email
        logger.exception("Could not send the confirmation email to account %s", account.pk)
        return False


def send_reset_email(user, email):
    from core.mail import send_email

    link = _site(
        f"/account/reset-password?uid={_uid(user)}&token={default_token_generator.make_token(user)}"
    )
    try:
        return send_email(
            email,
            _("Reset your %(brand)s password") % {"brand": settings.BRAND_NAME},
            _(
                "Someone asked to reset the password for your %(brand)s account. If it was "
                "you, set a new one here (the link works for %(hours)s hours, once):\n\n"
                "%(link)s\n\nIf it was not you, ignore this email: your password stays as it is."
            )
            % {
                "brand": settings.BRAND_NAME,
                "link": link,
                "hours": settings.PASSWORD_RESET_TIMEOUT // 3600,
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("Could not send the reset email to user %s", user.pk)
        return False


# --------------------------------------------------------------------------
# Serializers


def _clean_password(password, user=None):
    try:
        password_validation.validate_password(password, user)
    except ValidationError as exc:
        raise serializers.ValidationError(list(exc.messages)) from exc
    return password


class RegisterSerializer(serializers.Serializer):
    phone = PhoneNumberField()
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)

    def validate_email(self, value):
        value = value.strip().lower()
        for model in _role_models():
            if model.objects.filter(email__iexact=value).exists():
                raise serializers.ValidationError(
                    _("This email already has an account. Sign in instead.")
                )
        return value

    def validate_phone(self, value):
        from .views import number_has_account

        if number_has_account(value):
            raise serializers.ValidationError(
                _("This number already has an account. Sign in instead.")
            )
        return value

    def validate_password(self, value):
        return _clean_password(value)


class SignInSerializer(serializers.Serializer):
    login = serializers.CharField(max_length=254)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)


class AppSignInSerializer(SignInSerializer):
    device = serializers.CharField(max_length=120, required=False, allow_blank=True)


class AppRegisterSerializer(RegisterSerializer):
    device = serializers.CharField(max_length=120, required=False, allow_blank=True)


class ForgotSerializer(serializers.Serializer):
    login = serializers.CharField(max_length=254)


class LinkSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)


class ResetSerializer(LinkSerializer):
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)


class SetPasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        max_length=128, required=False, allow_blank=True, trim_whitespace=False
    )
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)


# --------------------------------------------------------------------------
# What registering and signing in do, for the website and the app alike


@transaction.atomic
def register(data):
    """The new person's customer account, on a fresh login with their
    password. Raises IntegrityError when the phone or email was taken by a
    request that won a race."""
    user = user_for_new_role(get_user_model(), data["phone"], prefix="customer")
    user.set_password(data["password"])
    user.save(update_fields=["password"])
    account = CustomerAccount.objects.create(
        user=user,
        phone=data["phone"],
        phone_verified_at=None,
        email=data["email"],
        display_name=(data.get("name") or "").strip()[:120],
        last_seen_at=timezone.now(),
    )
    transaction.on_commit(lambda: send_confirm_email(account))
    return account


def _too_many(request, group, rate):
    return is_ratelimited(request, group=group, key=ratelimit_client_ip, rate=rate, increment=True)


def _throttled():
    return Response(
        {"detail": _("Too many tries. Wait a minute and try again.")},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )


def _do_register(request, serializer_class):
    if _too_many(request, "account-register", "10/h"):
        return None, None, _throttled()
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        account = register(serializer.validated_data)
    except IntegrityError:
        return (
            None,
            None,
            Response(
                {"detail": _("This number or email already has an account. Sign in instead.")},
                status=status.HTTP_409_CONFLICT,
            ),
        )
    return account, serializer.validated_data, None


def _do_sign_in(request, serializer_class):
    if _too_many(request, "account-sign-in", "20/m"):
        return None, None, _throttled()
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    user, error = check_password_sign_in(request, data["login"], data["password"])
    if error:
        return None, None, Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
    account = customer_for(user)
    if account is None or not account.is_active:
        return (
            None,
            None,
            Response(
                {"detail": _("This account has been switched off. Contact support.")},
                status=status.HTTP_403_FORBIDDEN,
            ),
        )
    account.last_seen_at = timezone.now()
    account.save(update_fields=["last_seen_at", "updated_at"])
    return user, data, None


def _session(request, user):
    from .views import account_payload

    # login() cycles the session key, preventing session fixation.
    login(request._request, user, backend="django.contrib.auth.backends.ModelBackend")
    request.user = user
    get_token(request._request)
    return account_payload(request)


# --------------------------------------------------------------------------
# Website: a session cookie


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=RegisterSerializer, responses={201: None})
    def post(self, request):
        account, _data, refusal = _do_register(request, RegisterSerializer)
        if refusal is not None:
            return refusal
        return Response(
            {**_session(request, account.user), "joined": True}, status=status.HTTP_201_CREATED
        )


@method_decorator(csrf_protect, name="dispatch")
class SignInView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=SignInSerializer, responses={200: None})
    def post(self, request):
        user, _data, refusal = _do_sign_in(request, SignInSerializer)
        if refusal is not None:
            return refusal
        return Response({**_session(request, user), "joined": False})


# --------------------------------------------------------------------------
# The app: a token instead of a cookie (accounts/app_auth.py)


class AppRegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=AppRegisterSerializer, responses={201: None})
    def post(self, request):
        from .app_auth import issue_token
        from .views import account_payload

        account, data, refusal = _do_register(request, AppRegisterSerializer)
        if refusal is not None:
            return refusal
        token = issue_token(account.user, device=data.get("device") or "")
        request.user = account.user
        return Response(
            {**account_payload(request), "token": token, "joined": True},
            status=status.HTTP_201_CREATED,
        )


class AppSignInView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=AppSignInSerializer, responses={200: None})
    def post(self, request):
        from .app_auth import issue_token
        from .views import account_payload

        user, data, refusal = _do_sign_in(request, AppSignInSerializer)
        if refusal is not None:
            return refusal
        token = issue_token(user, device=data.get("device") or "")
        request.user = user
        return Response({**account_payload(request), "token": token, "joined": False})


# --------------------------------------------------------------------------
# Forgot, reset, set, confirm


class ForgotPasswordView(APIView):
    """Always the same answer, whether or not the account exists, so this
    cannot be used to find out who has an account."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=ForgotSerializer, responses={200: None})
    def post(self, request):
        if _too_many(request, "account-forgot", "10/h"):
            return _throttled()
        serializer = ForgotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = account_for_login(serializer.validated_data["login"])
        if account is not None and account.is_active:
            email = email_for(account.user)
            if email:
                send_reset_email(account.user, email)
        return Response(
            {
                "detail": _(
                    "If that account has an email address, a link to set a new password is on "
                    "its way. Check your inbox and spam folder."
                )
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class ResetPasswordView(APIView):
    """The link from the email: a new password, and signed in. The link also
    proves the address, so the email counts as confirmed."""

    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=ResetSerializer, responses={200: None})
    def post(self, request):
        if _too_many(request, "account-reset", "20/h"):
            return _throttled()
        serializer = ResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = _user_from_uid(data["uid"])
        if (
            user is None
            or not user_is_unprivileged(user)
            or not default_token_generator.check_token(user, data["token"])
        ):
            return Response(
                {"detail": _("This link has expired or was already used. Ask for a new one.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        password = data["password"]
        try:
            password_validation.validate_password(password, user)
        except ValidationError as exc:
            return Response({"password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(password)
        user.save(update_fields=["password"])
        account = customer_for(user)
        if account is not None and account.email and not account.email_verified_at:
            account.email_verified_at = timezone.now()
            account.save(update_fields=["email_verified_at", "updated_at"])
        return Response(_session(request, user))


@method_decorator(csrf_protect, name="dispatch")
class SetPasswordView(APIView):
    """Set a password (an account made with a phone code has none) or change
    it. Changing one asks for the current one."""

    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=SetPasswordSerializer, responses={200: None})
    def post(self, request):
        from django.contrib.auth import update_session_auth_hash

        account = own_customer_account(request)
        if account is None:
            return Response({"detail": _("Sign in first.")}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = SetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = account.user
        if user.has_usable_password() and not user.check_password(
            data.get("current_password") or ""
        ):
            return Response(
                {"current_password": [_("That is not your current password.")]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            password_validation.validate_password(data["password"], user)
        except ValidationError as exc:
            return Response({"password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(data["password"])
        user.save(update_fields=["password"])
        # Signed in here still; other browsers are signed out.
        update_session_auth_hash(request._request, user)
        from .views import account_payload

        return Response(account_payload(request))


@method_decorator(csrf_protect, name="dispatch")
class ConfirmEmailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(request=LinkSerializer, responses={200: None})
    def post(self, request):
        serializer = LinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = _user_from_uid(serializer.validated_data["uid"])
        account = getattr(user, "customer_account", None) if user else None
        if account is not None and account.email_verified_at:
            return Response({"confirmed": True, "email": account.email})
        if (
            account is None
            or not account.email
            or not email_confirm_token.check_token(user, serializer.validated_data["token"])
        ):
            return Response(
                {"detail": _("This link has expired. Sign in and send a new one.")},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account.email_verified_at = timezone.now()
        account.save(update_fields=["email_verified_at", "updated_at"])
        return Response({"confirmed": True, "email": account.email})


@method_decorator(csrf_protect, name="dispatch")
class ResendConfirmEmailView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    @extend_schema(request=None, responses={200: None})
    def post(self, request):
        account = own_customer_account(request)
        if account is None:
            return Response({"detail": _("Sign in first.")}, status=status.HTTP_401_UNAUTHORIZED)
        if _too_many(request, "account-confirm-resend", "5/h"):
            return _throttled()
        if not account.email:
            return Response(
                {"detail": _("Add an email address first.")}, status=status.HTTP_400_BAD_REQUEST
            )
        if account.email_verified_at:
            return Response({"detail": _("This email is already confirmed.")})
        send_confirm_email(account)
        return Response({"detail": _("We sent the link to %(email)s.") % {"email": account.email}})
