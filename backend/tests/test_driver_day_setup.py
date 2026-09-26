"""Unit tests for Driver Day Setup / lot→driver lookup (no live API required)."""
from __future__ import annotations

from driver_ranges import lot_first_num, pick_driver, validate_driver_ranges


SAMPLE_DRIVERS = [
    {"range_from": 1, "range_to": 25, "name": "SOMU", "place": "A", "bhada_per_bag": 40},
    {"range_from": 26, "range_to": 36, "name": "BHIG", "place": "B", "bhada_per_bag": 50},
    {"range_from": 37, "range_to": 100, "name": "VITTAL", "place": "C", "bhada_per_bag": 60},
]


def test_lot_first_num_plain_and_split():
    assert lot_first_num("28") == 28
    assert lot_first_num("35/2") == 35
    assert lot_first_num(" 42/10 ") == 42
    assert lot_first_num("") is None
    assert lot_first_num("abc") is None


def test_pick_driver_by_serial_range():
    assert pick_driver(SAMPLE_DRIVERS, "10")[0] == "SOMU"
    assert pick_driver(SAMPLE_DRIVERS, "25")[0] == "SOMU"
    assert pick_driver(SAMPLE_DRIVERS, "26")[0] == "BHIG"
    assert pick_driver(SAMPLE_DRIVERS, "28")[0] == "BHIG"
    assert pick_driver(SAMPLE_DRIVERS, "36")[0] == "BHIG"
    assert pick_driver(SAMPLE_DRIVERS, "42")[0] == "VITTAL"
    assert pick_driver(SAMPLE_DRIVERS, "100")[0] == "VITTAL"
    assert pick_driver(SAMPLE_DRIVERS, "101")[0] is None


def test_pick_driver_split_lot_uses_first_number():
    name, place, bhada = pick_driver(SAMPLE_DRIVERS, "28/5")
    assert name == "BHIG"
    assert place == "B"
    assert bhada == 50.0


def test_validate_ok_and_empty():
    assert validate_driver_ranges(SAMPLE_DRIVERS) is None
    assert validate_driver_ranges([]) is None


def test_validate_start_after_end():
    err = validate_driver_ranges(
        [{"range_from": 10, "range_to": 5, "name": "X", "bhada_per_bag": 0}]
    )
    assert err and "range_from > range_to" in err


def test_validate_serial_must_be_positive():
    err = validate_driver_ranges(
        [{"range_from": 0, "range_to": 5, "name": "X", "bhada_per_bag": 0}]
    )
    assert err and ">= 1" in err


def test_validate_overlap():
    err = validate_driver_ranges(
        [
            {"range_from": 1, "range_to": 30, "name": "SOMU", "bhada_per_bag": 0},
            {"range_from": 26, "range_to": 40, "name": "BHIG", "bhada_per_bag": 0},
        ]
    )
    assert err and "overlap" in err.lower()
    assert "SOMU" in err and "BHIG" in err


def test_validate_adjacent_ranges_ok():
    assert (
        validate_driver_ranges(
            [
                {"range_from": 1, "range_to": 25, "name": "A", "bhada_per_bag": 0},
                {"range_from": 26, "range_to": 50, "name": "B", "bhada_per_bag": 0},
            ]
        )
        is None
    )


def test_validate_accepts_pydantic_like_objects():
    class R:
        def __init__(self, a, b, n):
            self.range_from = a
            self.range_to = b
            self.name = n

    assert validate_driver_ranges([R(1, 10, "A"), R(11, 20, "B")]) is None
    err = validate_driver_ranges([R(1, 15, "A"), R(10, 20, "B")])
    assert err and "overlap" in err.lower()
