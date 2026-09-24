"""Click-to-chat links.

Free, unlike the Cloud API: wa.me opens the app with a message already typed
and the person presses send themselves. Only a business-initiated template —
the provider alert nobody has credentials for yet — is billed per send.

One module because there are two directions and they must agree on the format.
A trainee opens a chat with the workshop; a workshop opens a chat with the
trainee who asked. Both quote the reference, which is the only thing tying a
WhatsApp conversation back to a row in this database.
"""

from urllib.parse import quote

from django.conf import settings


def chat_url(phone, text):
    """wa.me wants the number without a plus and without spaces."""
    number = str(phone).lstrip("+").replace(" ", "")
    return f"https://wa.me/{number}?text={quote(text)}"


def trainee_to_provider(enquiry):
    programme = enquiry.programme.title if enquiry.programme else "your training"
    return chat_url(
        enquiry.provider.contact_phone,
        f"Hello, I found you on {settings.BRAND_NAME} Skills Hub. "
        f"My reference is {enquiry.reference_code}. "
        f"I am interested in {programme}.",
    )


def provider_to_trainee(enquiry):
    """The reply. It opens with who is writing, because the trainee enquired
    with several workshops and a bare "hello" from an unknown number tells
    them nothing."""
    greeting = f"Hello {enquiry.trainee_name}, " if enquiry.trainee_name else "Hello, "
    return chat_url(
        enquiry.trainee_phone,
        f"{greeting}this is {enquiry.provider.name}, replying to your enquiry on "
        f"{settings.BRAND_NAME} Skills Hub. Your reference is {enquiry.reference_code}.",
    )
