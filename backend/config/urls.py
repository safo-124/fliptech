"""Root URL configuration."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from core.staff_email_login import staff_email_login
from core.views import health

# The back office is the product for the first two build stages, so the admin
# is mounted at a guessable-but-not-default path rather than /admin/.
urlpatterns = [
    # Before the admin mount, so it is not swallowed by the catch-all the
    # AdminSite installs for its own pages.
    path("back-office/email-login/", staff_email_login, name="staff-email-login"),
    path("back-office/", admin.site.urls),
    path("healthz/", health, name="health"),
    path("api/", include("config.api_urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
