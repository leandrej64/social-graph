#!/usr/bin/env python3
"""Minimal reader for this repo's exported data"""
import json
import sys
from array import array
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load_edges():
    """Returns a flat int32 array of (source, target) pairs laid end to end:
    [s, t, s, t, s, t, ...] (one pair per edge).
    source = follower, target = following. The array is sorted by source, so
    the SAME source repeats once per edge it has, back to back, until it
    changes to the next one (e.g. a seed with 500 followings appears 500
    times in a row as the first element of a pair, each time paired with a
    different target. Values are into the same profile space
    as filters.json.)

    The file is little-endian.
    """
    raw = (DATA_DIR / "graph_edges.bin").read_bytes()
    edges = array("i")
    edges.frombytes(raw)
    if sys.byteorder != "little":
        edges.byteswap()
    return edges


def load_filters():
    with open(DATA_DIR / "filters.json", encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    filters = load_filters()
    edges = load_edges()
    print(f"100 first followings of the seed 0 :\n")
    print(edges[:100])
    print('\n')
    print(f"there are {filters['node_count']} nodes in total")
    print('\n')
    print("countries are : ")
    print(list(filters['countries'].keys()))

