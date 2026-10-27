"""The marketplace, as staff see it.

Two screens, and between them the super admin can see and change everything
the marketplace does: who is allowed to sell, and what is on sale.

The moderation model is deliberate and it is not the one the training
listings use. A workshop is approved once and its listing reviewed before it
is published, because there is one listing and it changes rarely. A seller has
twenty products that change weekly, so reviewing each one would be a queue
that never empties — and a queue that never empties is a queue nobody reads.

So: the **seller** is confirmed once, by hand, the same way a trainer is. A
confirmed seller then publishes their own products without waiting. Staff keep
the other end — any product can be taken down in one click, and suspending a
seller takes their whole shelf with it, because Product.objects.visible()
asks about the seller as well as the product.
"""

from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.views.decorators.http import require_POST

from .models import Product, ProductPhoto, SellerAccount

CONFIRM_PERM = "marketplace.confirm_seller"


@admin.register(SellerAccount)
class SellerAccountAdmin(admin.ModelAdmin):
    """Who may sell, and whether anyone has checked them.

    Anyone can sign up to sell, so a sign-up is not trusted until someone with
    the confirm permission says so. Until then the seller can fill in their
    shelf and nothing of theirs is public — the same bargain the trainer
    sign-up makes, for the same reason: nobody should wait on staff to start
    typing, and nobody should be published because they typed.

    The phone and the user are read-only. The phone *is* the account, so
    repointing one would hand somebody else's shop to a different number.
    """

    list_display = (
        "business_name",
        "phone",
        "area",
        "kind",
        "approval_summary",
        "decide",
        "product_count",
        "created_at",
    )
    list_filter = ("approval_status", "is_active", "area__region", "area")
    search_fields = ("business_name", "phone", "email", "provider__name")
    ordering = ("-created_at",)
    list_select_related = ("area", "provider")
    autocomplete_fields = ("area", "provider")
    actions = ("confirm_sellers", "decline_sellers", "suspend_selling", "restore_selling")
    readonly_fields = (
        "user",
        "phone",
        "phone_verified_at",
        "email_verified_at",
        "data_consent_at",
        "approval_status",
        "approval_decided_at",
        "approval_decided_by",
        "shelf",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        (None, {"fields": ("business_name", "is_active", "user", "phone", "phone_verified_at")}),
        (
            "The shop",
            {
                "fields": ("about", "area", "provider", "email", "email_verified_at"),
                "description": (
                    "Link a provider when this seller is a workshop already listed for "
                    "training, so a buyer sees the same business in both places. Leave it "
                    "empty for somebody who only sells."
                ),
            },
        ),
        ("What they have listed", {"fields": ("shelf",)}),
        (
            "Confirmation",
            {
                "fields": (
                    "approval_status",
                    "approval_note",
                    "approval_decided_at",
                    "approval_decided_by",
                ),
                "description": (
                    "A verified phone proves somebody holds a SIM, not that they make "
                    "anything. Confirming says a real person sells real goods. Their "
                    "products go live by themselves afterwards, so this is the gate."
                ),
            },
        ),
        ("Record", {"fields": ("data_consent_at", "created_at", "updated_at")}),
    )

    @admin.display(description="Kind")
    def kind(self, obj):
        """Workshop or trader, which changes what confirming them means.

        A linked provider has already been through trainer confirmation and
        possibly a site visit, so there is a record to lean on. A seller with
        no provider has nothing behind them but a phone number, and this
        column is what stops the two being confirmed at the same speed.
        """
        if obj.provider_id:
            return format_html('<span style="color:#15803d">Workshop</span>')
        return format_html('<span style="color:#b45309">Seller only</span>')

    @admin.display(description="Sign-up", ordering="approval_status")
    def approval_summary(self, obj):
        colours = {
            SellerAccount.Approval.CONFIRMED: "#15803d",
            SellerAccount.Approval.PENDING: "#b45309",
            SellerAccount.Approval.DECLINED: "#b91c1c",
        }
        label = obj.get_approval_status_display()
        if not obj.is_active:
            label = f"{label} · switched off"
        return format_html(
            '<span style="color:{}">{}</span>', colours.get(obj.approval_status, "#374151"), label
        )

    @admin.display(description="Products")
    def product_count(self, obj):
        counts = obj.products.values_list("status").order_by()
        total = 0
        live = 0
        for (status,) in counts:
            total += 1
            if status == Product.Status.PUBLISHED:
                live += 1
        if not total:
            return "—"
        return f"{live} live / {total}"

    @admin.display(description="Decision")
    def decide(self, obj):
        """One click to confirm, from the row. Declining is a deliberate trip
        to the record, because the note explaining why is there and a
        one-click decline is how that note ends up empty.

        A POST, not a link: a GET that confirms an account would be followed
        by every crawler and prefetcher that sees the page. `formaction` on a
        button rather than a nested form, because the changelist is already
        one form and HTML has no nested forms.
        """
        if obj.approval_status == SellerAccount.Approval.CONFIRMED:
            return format_html('<span class="row-decided">Confirmed</span>')
        return format_html(
            '<span class="row-decide">'
            '<button type="submit" class="row-confirm" formaction="{}" formmethod="post">'
            "Confirm</button>"
            "</span>"
            '<a class="row-review" href="{}">Review</a>',
            reverse("admin:marketplace_selleraccount_confirm", args=[obj.pk]),
            reverse("admin:marketplace_selleraccount_change", args=[obj.pk]),
        )

    @admin.display(description="What they have listed")
    def shelf(self, obj):
        """Their products, on the page where the decision is made.

        Confirming a seller asks whether this is a real person selling real
        goods, and the goods are the evidence. Without this the decision is
        made in another tab, or not made at all.
        """
        products = list(obj.products.all()[:20])
        if not products:
            return format_html(
                '<p class="review-empty">Nothing listed yet. '
                "Confirming lets them publish what they add.</p>"
            )
        rows = format_html("")
        for product in products:
            rows += format_html(
                '<li><a href="{}">{}</a> — {} · {}</li>',
                reverse("admin:marketplace_product_change", args=[product.pk]),
                product.name,
                product.get_status_display(),
                product.get_availability_display(),
            )
        return format_html("<ul>{}</ul>", rows)

    def get_urls(self):
        return [
            path(
                "<int:pk>/confirm/",
                self.admin_site.admin_view(self.confirm_one),
                name="marketplace_selleraccount_confirm",
            ),
            *super().get_urls(),
        ]

    @method_decorator(require_POST)
    def confirm_one(self, request, pk):
        """Confirm one seller from the list.

        Permission-checked here as well as in the action, because a URL is
        reachable by anyone who can guess it and hiding a bulk action from the
        menu does not stop a POST.
        """
        if not request.user.has_perm(CONFIRM_PERM):
            raise PermissionDenied
        account = get_object_or_404(SellerAccount, pk=pk)
        self._decide(
            request,
            SellerAccount.objects.filter(pk=account.pk),
            status=SellerAccount.Approval.CONFIRMED,
            verb="confirmed",
        )
        return HttpResponseRedirect(
            request.META.get("HTTP_REFERER")
            or reverse("admin:marketplace_selleraccount_changelist")
        )

    def _decide(self, request, queryset, *, status, verb):
        if not request.user.has_perm(CONFIRM_PERM):
            self.message_user(
                request,
                "Confirming sellers needs the confirm seller permission (super admin by default).",
                level=messages.ERROR,
            )
            return
        changed = list(queryset.exclude(approval_status=status))
        now = timezone.now()
        for account in changed:
            account.approval_status = status
            account.approval_decided_at = now
            account.approval_decided_by = request.user
            account.save(
                update_fields=[
                    "approval_status",
                    "approval_decided_at",
                    "approval_decided_by",
                    "updated_at",
                ]
            )
            self.log_change(request, account, f"Seller sign-up {verb}.")
        self.message_user(request, f"{len(changed)} seller sign-up(s) {verb}.")

    @admin.action(description="Confirm selected sign-ups")
    def confirm_sellers(self, request, queryset):
        self._decide(request, queryset, status=SellerAccount.Approval.CONFIRMED, verb="confirmed")

    @admin.action(description="Decline selected sign-ups")
    def decline_sellers(self, request, queryset):
        self._decide(request, queryset, status=SellerAccount.Approval.DECLINED, verb="declined")

    @admin.action(description="Switch off selling for selected")
    def suspend_selling(self, request, queryset):
        """Takes the whole shelf down at once.

        Nothing is deleted and no product changes status: visible() asks about
        the seller too, so this hides everything they have listed and the
        switch back puts it all live again exactly as it was.
        """
        n = queryset.update(is_active=False)
        self.message_user(request, f"{n} seller(s) switched off. Their products are hidden.")

    @admin.action(description="Switch selling back on for selected")
    def restore_selling(self, request, queryset):
        n = queryset.update(is_active=True)
        self.message_user(request, f"{n} seller(s) switched back on.")


class ProductPhotoInline(admin.TabularInline):
    model = ProductPhoto
    extra = 0
    fields = ("preview", "image", "caption", "display_order")
    readonly_fields = ("preview",)

    @admin.display(description="")
    def preview(self, obj):
        if not obj.image:
            return "—"
        return format_html(
            '<img src="{}" style="height:64px;width:64px;object-fit:cover;border-radius:8px">',
            obj.image.url,
        )


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    """Everything on sale, and the one control that matters: take it down.

    Products are not pre-approved — see the module docstring. This screen is
    how staff see what went up and act on anything that should not have.
    """

    list_display = (
        "name",
        "seller",
        "price_label",
        "trade",
        "availability",
        "status_label",
        "created_at",
    )
    list_filter = ("status", "availability", "trade", "seller__area__region", "seller")
    search_fields = ("name", "description", "seller__business_name", "seller__phone")
    ordering = ("-created_at",)
    list_select_related = ("seller", "trade")
    autocomplete_fields = ("seller", "trade")
    inlines = (ProductPhotoInline,)
    actions = ("take_down", "restore_product")
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("seller", "name", "slug", "trade")}),
        ("What it is", {"fields": ("description", "price", "availability")}),
        (
            "Publication",
            {
                "fields": ("status", "staff_note"),
                "description": (
                    "A confirmed seller publishes their own products. Use Take down for "
                    "anything that should not be up, and say why in the note — the seller "
                    "sees it, and so does whoever reviews the decision later."
                ),
            },
        ),
        ("Record", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="Price", ordering="price")
    def price_label(self, obj):
        if obj.price is None:
            return format_html('<span style="color:#6b7280">On request</span>')
        return f"GH₵{obj.price:,.2f}"

    @admin.display(description="Status", ordering="status")
    def status_label(self, obj):
        colours = {
            Product.Status.PUBLISHED: "#15803d",
            Product.Status.DRAFT: "#6b7280",
            Product.Status.SUSPENDED: "#b91c1c",
        }
        label = obj.get_status_display()
        # A published product whose seller is switched off is not actually
        # visible, and a queue that says "Published" about something nobody
        # can see is the kind of thing that gets acted on wrongly.
        if obj.status == Product.Status.PUBLISHED and not obj.seller.may_sell:
            return format_html('<span style="color:#b45309">Hidden · seller not selling</span>')
        return format_html(
            '<span style="color:{}">{}</span>', colours.get(obj.status, "#374151"), label
        )

    @admin.action(description="Take down selected products")
    def take_down(self, request, queryset):
        n = queryset.exclude(status=Product.Status.SUSPENDED).update(
            status=Product.Status.SUSPENDED
        )
        self.message_user(
            request,
            f"{n} product(s) taken down. Say why in the staff note on each one.",
            level=messages.WARNING if n else messages.INFO,
        )

    @admin.action(description="Put selected products back")
    def restore_product(self, request, queryset):
        n = queryset.filter(status=Product.Status.SUSPENDED).update(status=Product.Status.PUBLISHED)
        self.message_user(request, f"{n} product(s) put back.")
