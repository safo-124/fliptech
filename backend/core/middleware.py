"""Answer the public API in the visitor's language, and nowhere else."""

from django.utils import translation
from django.utils.cache import patch_vary_headers


class ApiLanguageMiddleware:
    """The site's language cookie, honoured on /api/ only.

    The public site and the back office share a domain, and so a browser. A
    member of staff who looked at the site in Twi would otherwise find the
    back office trying to speak Twi too, with only some of its strings
    translated. Django's own LocaleMiddleware would do exactly that, so this
    is the same idea restricted to the API.

    The language comes from the cookie, then Accept-Language, and only from
    settings.LANGUAGES. One with no compiled catalogue falls back to English.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith("/api/"):
            return self.get_response(request)

        language = translation.get_language_from_request(request)
        translation.activate(language)
        request.LANGUAGE_CODE = translation.get_language()
        try:
            response = self.get_response(request)
        finally:
            translation.deactivate()
        response.headers.setdefault("Content-Language", request.LANGUAGE_CODE)
        # The answer depends on these, so a cache must not hand one visitor's
        # language to the next.
        patch_vary_headers(response, ("Accept-Language", "Cookie"))
        return response
