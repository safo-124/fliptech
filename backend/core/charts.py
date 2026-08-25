"""Charts for the back-office dashboard, rendered as inline SVG on the server.

No charting library and no CDN. Three reasons, in order of weight:

1. The back office is used in the field on a phone over a mobile connection.
   A charting bundle is 50-150 KB before it draws anything, and it draws
   nothing until it has hydrated. These render with the page.
2. Django's admin has no build step. Adding one for a dashboard would put a
   JavaScript toolchain in the path of every future admin change.
3. Colours come from the admin's own CSS variables, so light and dark mode
   work without a second palette to maintain.

Every function returns a `SafeString` of SVG with a viewBox and no fixed
width, so the chart scales with its container.
"""

from django.utils.html import escape
from django.utils.safestring import mark_safe

# Deliberately not the admin's accent colours. These carry meaning that has to
# survive the theme: a site visit and a government record are different claims
# and must never read as the same thing.
# shadcn charts draw from --chart-1..5 and never from the text colour, so a
# chart never competes with the type around it.
INK = "var(--chart-1, oklch(0.646 0.222 41.116))"
GOOD = "var(--sh-positive, oklch(0.62 0.14 155))"
WARN = "var(--sh-caution, oklch(0.72 0.15 75))"
BAD = "var(--destructive, oklch(0.577 0.245 27.325))"
MUTED = "var(--muted-foreground, oklch(0.556 0 0))"
SURFACE = "var(--muted, oklch(0.97 0 0))"


def _points(values, width, height, pad):
    """Map values onto SVG coordinates, with a flat line for an empty series."""
    if not values:
        return []
    top = max(values) or 1
    inner_w = width - pad * 2
    inner_h = height - pad * 2
    step = inner_w / max(len(values) - 1, 1)
    return [(pad + i * step, pad + inner_h - (v / top) * inner_h) for i, v in enumerate(values)]


def sparkline(values, labels=None, height=64, colour=None, fill=True):
    """A small area chart. Used for volume over time."""
    colour = colour or INK
    width, pad = 240, 6
    pts = _points(values, width, height, pad)
    if not pts:
        return mark_safe("")

    line = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = f"{pad},{height - pad} {line} {width - pad},{height - pad}"
    last_x, last_y = pts[-1]

    title = ""
    if labels and len(labels) == len(values):
        # A plain <title> gives a tooltip on hover and is read by screen
        # readers, without any script.
        title = f"<title>{escape(', '.join(f'{lb}: {v}' for lb, v in zip(labels, values, strict=True)))}</title>"

    # shadcn's area charts fade the fill from 0.8 to 0.1 down the y-axis
    # rather than using one flat tint.
    gradient_id = f"shg{abs(hash(line)) % 100000}"
    fill_svg = (
        f'<defs><linearGradient id="{gradient_id}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="5%" stop-color="{colour}" stop-opacity="0.8"/>'
        f'<stop offset="95%" stop-color="{colour}" stop-opacity="0.1"/>'
        f"</linearGradient></defs>"
        f'<polygon points="{area}" fill="url(#{gradient_id})"/>'
        if fill
        else ""
    )
    return mark_safe(
        f'<svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" '
        f'style="width:100%;height:{height}px;display:block" role="img">{title}'
        f"{fill_svg}"
        f'<polyline points="{line}" fill="none" stroke="{colour}" stroke-width="2" '
        f'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'
        f'<circle cx="{last_x:.1f}" cy="{last_y:.1f}" r="3" fill="{colour}"/>'
        f"</svg>"
    )


def column_chart(values, labels, height=110, colour=None):
    """Vertical columns with labels. Used for weekly and monthly counts."""
    colour = colour or INK
    if not values:
        return mark_safe("")
    width = max(len(values) * 34, 120)
    pad_bottom, pad_top = 18, 8
    top = max(values) or 1
    inner_h = height - pad_bottom - pad_top
    gap = 6
    bar_w = (width - gap * (len(values) + 1)) / len(values)

    bars = []
    for i, (v, label) in enumerate(zip(values, labels, strict=True)):
        h = (v / top) * inner_h
        x = gap + i * (bar_w + gap)
        y = pad_top + inner_h - h
        # A zero-height bar is invisible and reads as missing data rather than
        # as a real zero, so give it a 2px stub.
        h = max(h, 2)
        # Flat fill with rounded top corners, as shadcn's bar charts do. An
        # opacity ramp would imply a second variable that is not there.
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{h:.1f}" rx="4" '
            f'fill="{colour}">'
            f"<title>{escape(str(label))}: {v}</title></rect>"
            f'<text x="{x + bar_w / 2:.1f}" y="{height - 4}" text-anchor="middle" '
            f'font-size="10" fill="{MUTED}">{escape(str(label))}</text>'
        )
    return mark_safe(
        f'<svg viewBox="0 0 {width} {height}" style="width:100%;height:{height}px;display:block" '
        f'role="img">{"".join(bars)}</svg>'
    )


def ring(done, total, height=104, colour=None):
    """A proportion as a ring. Used for coverage and freshness."""
    colour = colour or GOOD
    pct = (done / total) if total else 0
    size, stroke = 100, 11
    r = (size - stroke) / 2
    circumference = 2 * 3.14159265 * r
    filled = circumference * pct

    return mark_safe(
        f'<svg viewBox="0 0 {size} {size}" style="width:{height}px;height:{height}px;display:block" '
        f'role="img"><title>{done} of {total}</title>'
        f'<circle cx="{size / 2}" cy="{size / 2}" r="{r}" fill="none" stroke="{SURFACE}" '
        f'stroke-width="{stroke}"/>'
        f'<circle cx="{size / 2}" cy="{size / 2}" r="{r}" fill="none" stroke="{colour}" '
        f'stroke-width="{stroke}" stroke-linecap="round" '
        f'stroke-dasharray="{filled:.2f} {circumference:.2f}" '
        f'transform="rotate(-90 {size / 2} {size / 2})"/>'
        f'<text x="50%" y="47%" text-anchor="middle" font-size="20" font-weight="700" '
        f'fill="var(--foreground, #111)">{round(pct * 100)}%</text>'
        f'<text x="50%" y="63%" text-anchor="middle" font-size="9" fill="{MUTED}">'
        f"{done}/{total}</text></svg>"
    )


def stacked_bar(segments, height=26):
    """One horizontal bar split into labelled segments. Used for the pipeline."""
    total = sum(v for _, v, _ in segments) or 1
    x = 0.0
    parts = []
    for label, value, colour in segments:
        w = (value / total) * 100
        if value:
            parts.append(
                f'<rect x="{x:.2f}%" y="0" width="{w:.2f}%" height="{height}" fill="{colour}">'
                f"<title>{escape(label)}: {value}</title></rect>"
            )
        x += w
    return mark_safe(
        f'<svg viewBox="0 0 100 {height}" preserveAspectRatio="none" '
        f'style="width:100%;height:{height}px;display:block;border-radius:4px;overflow:hidden" '
        f'role="img">{"".join(parts)}</svg>'
    )


def bar_list(items, colour=None):
    """Labelled horizontal bars. Used for ranked trades and areas."""
    colour = colour or INK
    if not items:
        return mark_safe('<p class="sh-empty">Nothing recorded yet.</p>')
    top = max(v for _, v in items) or 1
    rows = []
    for label, value in items:
        pct = (value / top) * 100
        rows.append(
            '<div class="sh-bar-row">'
            f'<span class="sh-bar-label" title="{escape(str(label))}">{escape(str(label))}</span>'
            f'<span class="sh-bar-track"><span class="sh-bar-fill" '
            f'style="width:{pct:.1f}%;background:{colour}"></span></span>'
            f'<span class="sh-bar-value">{value}</span>'
            "</div>"
        )
    return mark_safe("".join(rows))


def heatmap(row_labels, col_labels, matrix, threshold):
    """Trade against area, shaded by how many providers each pair holds.

    This is the field team's map of where to go next, and the same grid decides
    which generated pages have enough inventory to be worth indexing. Cells at
    or above the threshold are outlined.
    """
    if not row_labels or not col_labels:
        return mark_safe('<p class="sh-empty">No trades or areas defined yet.</p>')

    top = max((v for row in matrix for v in row), default=0) or 1
    head = "".join(f"<th><span>{escape(str(c))}</span></th>" for c in col_labels)
    body = []
    for label, row in zip(row_labels, matrix, strict=True):
        cells = []
        for v in row:
            intensity = (v / top) if v else 0
            ok = v >= threshold
            cells.append(
                f'<td class="{"sh-hm-ok" if ok else ""}" '
                f'style="--i:{intensity:.2f}" title="{escape(str(label))}: {v} provider(s)">'
                f"{v or ''}</td>"
            )
        body.append(f"<tr><th>{escape(str(label))}</th>{''.join(cells)}</tr>")

    return mark_safe(
        f'<table class="sh-heatmap"><thead><tr><th></th>{head}</tr></thead>'
        f"<tbody>{''.join(body)}</tbody></table>"
    )
