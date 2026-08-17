from django.conf import settings
from django.contrib import admin

admin.site.site_header = f"{settings.BRAND_NAME} Skills Hub back office"
admin.site.site_title = "Skills Hub"
admin.site.index_title = "Onboarding, verification and moderation"
