"""Tests for the dashboard charts.

Charts are rendered on the server, so a bad edge case is a 500 on the back
office home page rather than a blank rectangle. The cases below are the ones
that occur in normal operation: a brand-new install with nothing recorded, a
metric that is legitimately zero, and a single data point.
"""

import pytest

from core import charts


def test_sparkline_survives_an_empty_series():
    """A new install has no enquiries. This must not raise."""
    assert charts.sparkline([]) == ""


def test_sparkline_of_all_zeros_still_draws():
    """Zero enquiries for twelve weeks is a real answer, not missing data."""
    svg = charts.sparkline([0] * 12)

    assert "<svg" in svg
    assert "polyline" in svg


def test_sparkline_labels_become_a_hover_title():
    svg = charts.sparkline([1, 5], labels=["1 Jan", "8 Jan"])

    assert "<title>" in svg
    assert "1 Jan: 1" in svg


def test_column_chart_gives_a_zero_bar_a_visible_stub():
    """A zero-height bar reads as missing data rather than as a real zero."""
    svg = charts.column_chart([0, 10], ["Jan", "Feb"])

    assert 'height="2' in svg or 'height="2.' in svg
    assert "Jan" in svg and "Feb" in svg


def test_ring_handles_a_zero_denominator():
    """No published providers yet — dividing by zero would 500 the page."""
    svg = charts.ring(0, 0)

    assert "0%" in svg
    assert "<svg" in svg


def test_ring_reports_a_true_proportion():
    svg = charts.ring(3, 4)

    assert "75%" in svg
    assert "3/4" in svg


def test_stacked_bar_omits_empty_segments():
    svg = charts.stacked_bar([("Published", 5, "#0f0"), ("Suspended", 0, "#f00")])

    assert "Published: 5" in svg
    assert "Suspended" not in svg


def test_stacked_bar_of_all_zeros_does_not_divide_by_zero():
    assert "<svg" in charts.stacked_bar([("A", 0, "#000"), ("B", 0, "#111")])


def test_bar_list_says_so_when_there_is_nothing_to_rank():
    html = charts.bar_list([])

    assert "Nothing recorded yet" in html


def test_bar_list_scales_bars_against_the_largest_value():
    html = charts.bar_list([("Welding", 10), ("Tailoring", 5)])

    assert "width:100.0%" in html
    assert "width:50.0%" in html


def test_heatmap_marks_only_cells_at_or_above_the_threshold():
    html = charts.heatmap(
        ["Welding", "Tailoring"],
        ["Accra", "Tema"],
        [[3, 1], [0, 5]],
        threshold=3,
    )

    # Two cells qualify: 3 and 5. The 1 and the 0 do not.
    assert html.count("sh-hm-ok") == 2


def test_heatmap_leaves_zero_cells_blank_rather_than_printing_nought():
    html = charts.heatmap(["Welding"], ["Accra"], [[0]], threshold=3)

    assert ">0<" not in html


def test_heatmap_handles_a_site_with_no_trades_yet():
    assert "No trades or areas defined yet" in charts.heatmap([], [], [], threshold=3)


@pytest.mark.parametrize(
    "label",
    ['Welding "quoted"', "Tailoring & Sewing", "<script>alert(1)</script>"],
)
def test_labels_are_escaped(label):
    """Trade and area names are staff-entered, so they reach these unescaped."""
    html = charts.heatmap([label], ["Accra"], [[1]], threshold=3)

    assert "<script>" not in html
    assert "&lt;" in html or "&amp;" in html or "&quot;" in html
