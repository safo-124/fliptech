"""Admin app configuration.

This lives apart from core/apps.py on purpose: Django picks a default AppConfig
by scanning a module for AppConfig subclasses, and two of them in core.apps
makes the `core` app ambiguous —

    RuntimeError: 'core.apps' declares more than one default AppConfig
"""

from django.contrib.admin.apps import AdminConfig


class SkillsHubAdminConfig(AdminConfig):
    """Swaps in the oversight dashboard as the back-office home page.

    Using AdminConfig.default_site is the supported way to replace the admin
    site: every existing @admin.register call keeps working unchanged, because
    they all register against whatever `admin.site` resolves to.
    """

    default_site = "core.admin_site.SkillsHubAdminSite"
