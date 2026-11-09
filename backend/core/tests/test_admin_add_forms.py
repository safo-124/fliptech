"""Every "Add" form in the back office either refuses or explains itself.

Pressing Save on an empty Add form must show what is missing, never crash.
A model whose required fields are read-only in its form (because people make
them on the site) has no Add form at all; this catches one that slips back in.
"""

import pytest
from django.contrib import admin
from django.urls import reverse


def add_forms():
    return sorted(admin.site._registry, key=lambda model: model._meta.label)


@pytest.mark.django_db
@pytest.mark.parametrize("model", add_forms(), ids=lambda m: m._meta.label)
def test_saving_an_empty_add_form_never_crashes(admin_client, model):
    url = reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_add")

    page = admin_client.get(url)
    if page.status_code == 403:
        return  # no Add form for this one, by design
    assert page.status_code == 200, url

    for button in ("_save", "_continue", "_addanother"):
        response = admin_client.post(url, {button: "1"})
        assert response.status_code in (200, 302), (url, button, response.status_code)
