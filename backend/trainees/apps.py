from django.apps import AppConfig


class TraineesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "trainees"
    verbose_name = "Trainees"

    def ready(self):
        from django.contrib.auth.signals import user_logged_out

        from .models import SupportSession
        from .support import end_sessions_for_user

        def close_support_sessions(sender, request, user, **kwargs):
            if user is not None and user.is_staff:
                end_sessions_for_user(user, SupportSession.EndReason.STAFF_SIGNED_OUT)

        user_logged_out.connect(
            close_support_sessions, dispatch_uid="trainees.close_support_sessions"
        )
