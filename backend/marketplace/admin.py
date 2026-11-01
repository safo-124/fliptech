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
from django.utils.safestring import mark_safe
from django.views.decorators.http import require_POST

from .admin_outbox import SellerMessagesMixin
from .models import (
    DiscountCode,
    Order,
    OrderItem,
    Product,
    ProductEnquiry,
    ProductPhoto,
    ProductReport,
    QuoteLead,
    QuoteRequest,
    SellerAccount,
    SellerPayment,
    SellerReview,
)

CONFIRM_PERM = "marketplace.confirm_seller"


@admin.register(SellerAccount)
class SellerAccountAdmin(SellerMessagesMixin, admin.ModelAdmin):
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
    actions = (
        "confirm_sellers",
        "decline_sellers",
        "suspend_selling",
        "restore_selling",
        "mark_verified",
        "remove_verified",
    )
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
            return mark_safe('<span style="color:#15803d">Workshop</span>')
        return mark_safe('<span style="color:#b45309">Seller only</span>')

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
            return mark_safe('<span class="row-decided">Confirmed</span>')
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
        rows = mark_safe("")
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
            # Before super(), because the catch-all "<path:object_id>/" the
            # default urls end with would otherwise swallow "messages/" and
            # try to open a seller whose id is the word.
            *self.outbox_urls(),
            path(
                "funnel/",
                self.admin_site.admin_view(self.funnel_view),
                name="marketplace_selleraccount_funnel",
            ),
            *super().get_urls(),
        ]

    def funnel_view(self, request):
        """Views, questions and sales by trade over 30 days: where buyers
        are, and which trades need more makers."""
        from django.template.response import TemplateResponse

        from .funnel import funnel_by_trade

        if not request.user.has_perm("marketplace.view_selleraccount"):
            raise PermissionDenied
        return TemplateResponse(
            request,
            "admin/marketplace/selleraccount/funnel.html",
            {
                **self.admin_site.each_context(request),
                "title": "Marketplace funnel, last 30 days",
                "opts": self.model._meta,
                "rows": funnel_by_trade(),
            },
        )

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

    @admin.action(description="Mark as verified maker (after the visit)")
    def mark_verified(self, request, queryset):
        """The badge, after a member of staff has seen the work being made."""
        if not request.user.has_perm("marketplace.verify_seller"):
            raise PermissionDenied
        n = queryset.filter(verified_at__isnull=True).update(
            verified_at=timezone.now(), verified_by=request.user
        )
        self.message_user(request, f"{n} seller(s) marked as verified makers.")

    @admin.action(description="Remove the verified maker badge")
    def remove_verified(self, request, queryset):
        if not request.user.has_perm("marketplace.verify_seller"):
            raise PermissionDenied
        n = queryset.update(verified_at=None, verified_by=None)
        self.message_user(request, f"Badge removed from {n} seller(s).")

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
            return mark_safe('<span style="color:#6b7280">On request</span>')
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


@admin.register(ProductEnquiry)
class ProductEnquiryAdmin(admin.ModelAdmin):
    """Who asked about what, which is the number the marketplace is judged on.

    Read-only but for the spam flag. An enquiry is a record of something that
    happened; editing the question somebody asked would make the demand
    figure a thing staff can type rather than a thing that occurred.
    """

    list_display = (
        "reference_code",
        "product_name",
        "seller",
        "buyer_phone",
        "told",
        "state",
        "created_at",
    )
    list_filter = ("state", "seller__area__region", "created_at")
    search_fields = ("reference_code", "product_name", "buyer_phone", "seller__business_name")
    ordering = ("-created_at",)
    list_select_related = ("seller", "product")
    actions = ("mark_spam", "mark_not_spam")
    readonly_fields = (
        "reference_code",
        "seller",
        "product",
        "product_name",
        "buyer_phone",
        "buyer_name",
        "message",
        "phone_verified_at",
        "told",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        (None, {"fields": ("reference_code", "state", "told")}),
        ("What was asked", {"fields": ("product", "product_name", "message")}),
        ("Who asked", {"fields": ("buyer_phone", "buyer_name", "phone_verified_at")}),
        ("Who was asked", {"fields": ("seller",)}),
        ("Record", {"fields": ("created_at", "updated_at")}),
    )

    @admin.display(description="Seller told")
    def told(self, obj):
        """Whether anyone has actually passed this on.

        The honest version of a reply rate. Counting replies to messages no
        seller ever received is how the provider dashboard came to report
        workshops as slow when they had never been told.
        """
        notice = obj.alerts.first()
        if notice is None:
            return mark_safe('<span style="color:#b91c1c">No alert queued</span>')
        if notice.sent_at:
            return format_html(
                '<span style="color:#15803d">Sent {}</span>',
                notice.sent_at.strftime("%d %b %H:%M"),
            )
        return format_html(
            '<a href="{}">Waiting to send</a>',
            reverse("admin:marketplace_selleraccount_messages"),
        )

    @admin.action(description="Mark as spam")
    def mark_spam(self, request, queryset):
        n = queryset.update(state=ProductEnquiry.State.SPAM)
        self.message_user(
            request, f"{n} enquiry(s) marked as spam. Their alerts drop out of the queue."
        )

    @admin.action(description="Not spam after all")
    def mark_not_spam(self, request, queryset):
        n = queryset.update(state=ProductEnquiry.State.SENT)
        self.message_user(request, f"{n} enquiry(s) restored.")


# --------------------------------------------------------------------------
# Money and reviews


@admin.register(SellerPayment)
class SellerPaymentAdmin(admin.ModelAdmin):
    """Boosts and Shop plans sellers have paid for, and what Paystack said.

    Read-only, so nothing is marked paid by hand: only Paystack's
    confirmation does that. Refunds happen in the Paystack dashboard.
    """

    list_display = (
        "reference",
        "seller",
        "kind",
        "product",
        "amount",
        "status",
        "starts_at",
        "ends_at",
    )
    list_filter = ("status", "kind")
    search_fields = ("reference", "seller__business_name", "seller__phone")
    readonly_fields = [field.name for field in SellerPayment._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    """Products buyers paid for on the site.

    Read-only. Three actions: release a held payment to the seller, refund
    the buyer through Paystack, or record a refund made in the Paystack
    dashboard. Orders with a reported problem are filtered under Stage.
    """

    list_display = (
        "reference",
        "product_name",
        "seller",
        "quantity",
        "amount",
        "status",
        "stage",
        "payout",
        "buyer_phone",
        "paid_at",
    )
    list_filter = ("status", "stage", "payout", "fulfilment")
    search_fields = ("reference", "product_name", "seller__business_name", "buyer_phone")
    readonly_fields = [field.name for field in Order._meta.fields]
    actions = ["release_to_seller", "refund_buyer", "mark_refunded"]
    inlines = []

    def has_add_permission(self, request):
        return False

    @admin.action(description="Release held payment to the seller")
    def release_to_seller(self, request, queryset):
        from . import payouts

        done = 0
        for order in queryset.filter(status="paid"):
            if order.stage == Order.Stage.PROBLEM:
                # Staff have looked: clearing the problem is the decision.
                order.stage = Order.Stage.RECEIVED
                order.save(update_fields=["stage", "updated_at"])
            order = payouts.release(order)
            if order.payout in (Order.Payout.RELEASED, Order.Payout.SENDING):
                done += 1
            elif order.transfer_note:
                self.message_user(
                    request, f"{order.reference}: {order.transfer_note}", level=messages.WARNING
                )
        self.message_user(request, f"{done} payment(s) sent to sellers.")

    @admin.action(description="Refund the buyer through Paystack")
    def refund_buyer(self, request, queryset):
        from courses import paystack

        from . import payouts

        for order in queryset.filter(status="paid").exclude(stage=Order.Stage.REFUNDED):
            try:
                payouts.refund(order)
                self.message_user(request, f"{order.reference} refunded.")
            except paystack.PaystackError as exc:
                self.message_user(request, f"{order.reference}: {exc}", level=messages.ERROR)

    @admin.action(description="Record as refunded (after refunding in Paystack)")
    def mark_refunded(self, request, queryset):
        changed = queryset.filter(status="paid").update(stage=Order.Stage.REFUNDED)
        self.message_user(request, f"{changed} order(s) recorded as refunded.")


@admin.register(SellerReview)
class SellerReviewAdmin(admin.ModelAdmin):
    """Buyers' reviews. Staff can hide one (abuse, a phone number in the
    text) and show it again; nobody can edit what a buyer wrote."""

    list_display = ("seller", "rating", "bought", "product_name", "visibility", "created_at")
    list_filter = ("visibility", "rating", "bought")
    search_fields = ("seller__business_name", "comment", "product_name")
    readonly_fields = [field.name for field in SellerReview._meta.fields]
    actions = ["hide", "show"]

    def has_add_permission(self, request):
        return False

    @admin.action(description="Hide from the public")
    def hide(self, request, queryset):
        queryset.update(visibility=SellerReview.Visibility.HIDDEN)

    @admin.action(description="Show again")
    def show(self, request, queryset):
        queryset.update(visibility=SellerReview.Visibility.SHOWN)


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    can_delete = False
    readonly_fields = ["product", "product_name", "option_label", "unit_price", "quantity"]

    def has_add_permission(self, request, obj=None):
        return False


OrderAdmin.inlines = [OrderItemInline]


@admin.register(ProductReport)
class ProductReportAdmin(admin.ModelAdmin):
    """Products somebody flagged. Take the product down from here, or close
    the report once dealt with. The seller never sees who reported."""

    list_display = ("product_name", "seller", "reason", "state", "created_at")
    list_filter = ("state", "reason")
    search_fields = ("product_name", "seller__business_name", "details")
    readonly_fields = [
        "product",
        "seller",
        "product_name",
        "reason",
        "details",
        "reporter_phone",
        "created_at",
    ]
    fields = [*readonly_fields, "state", "staff_note"]
    actions = ["take_down_products", "close_reports"]

    def has_add_permission(self, request):
        return False

    @admin.action(description="Take the reported products down and close")
    def take_down_products(self, request, queryset):
        n = 0
        for report in queryset.select_related("product"):
            if report.product and report.product.status != Product.Status.SUSPENDED:
                report.product.status = Product.Status.SUSPENDED
                report.product.staff_note = (
                    f"Taken down after a report: {report.get_reason_display()}"
                )
                report.product.save(update_fields=["status", "staff_note", "updated_at"])
                n += 1
        queryset.update(state=ProductReport.State.CLOSED)
        self.message_user(request, f"{n} product(s) taken down.")

    @admin.action(description="Close (dealt with)")
    def close_reports(self, request, queryset):
        queryset.update(state=ProductReport.State.CLOSED)


@admin.register(QuoteRequest)
class QuoteRequestAdmin(admin.ModelAdmin):
    list_display = ("reference", "title", "trade", "area", "state", "created_at")
    list_filter = ("state", "trade")
    search_fields = ("reference", "title", "details", "buyer_phone")
    readonly_fields = [field.name for field in QuoteRequest._meta.fields if field.name != "state"]
    actions = ["close_quotes"]

    def has_add_permission(self, request):
        return False

    @admin.action(description="Close (no more makers will see it)")
    def close_quotes(self, request, queryset):
        queryset.update(state=QuoteRequest.State.CLOSED)


@admin.register(QuoteLead)
class QuoteLeadAdmin(admin.ModelAdmin):
    list_display = ("quote", "seller", "payment", "created_at")
    readonly_fields = ["quote", "seller", "payment"]

    def has_add_permission(self, request):
        return False


@admin.register(DiscountCode)
class DiscountCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "seller", "percent", "ends_on", "active", "uses")
    list_filter = ("active",)
    search_fields = ("code", "seller__business_name")
    readonly_fields = ["seller", "code", "percent", "uses"]

    def has_add_permission(self, request):
        return False
