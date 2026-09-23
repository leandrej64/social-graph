# Social Graph

## Overview

This repository holds roughly 746,000 anonymised profiles and close to 1.5 million relations between them, scraped from a well-known social media platform, together with the static page that visualises them as a graph of directed follower ("seed") → following relationships.

The scraping approach broadly consisted of recursively scraping the followings of a set of selected seed profiles: each qualifying following could itself become a new seed, and that exponential growth is what turned a starting handful of seeds into the full dataset — around 4,500 profiles ended up acting as a seed for at least one other profile. The seeds are based in Germany and on the west coast of the United States, so the graph skews heavily toward followings from those same areas.

This dataset was collected and anonymised by **Noritual Lab**, a brand of Ancora Pacific GmbH — see [Internship](#internship) below for the context it was built in.

## Data format

The data lives in two simple files:

- **`data/graph_edges.bin`** — a raw `Int32Array` (32-bit integers, little-endian), read two at a time as `[source, target]` pairs. `source` is the follower (the "seed" side of the relation), `target` is the following.
- **`data/filters.json`** — one entry per profile giving its city, state (US only) and country where known, or marking it as unknown. It uses the exact same indices as `graph_edges.bin`.

**Note:** the indices used in both files are just positions in an anonymised, re-numbered array built for this export — they are in no way linked to the profiles' real ids on the source platform.

Location remains unknown for the large majority of profiles: about 78% (580,450 of 746,210).

## How the layout works

This tool was primarily built to see whether cities would cluster naturally under an algorithm that computes point placement from the graph's structure alone. Every cluster visible in the graph comes from that placement algorithm — no location data is ever fed into it. A uniform repulsion pushes every pair of points apart regardless of whether they're connected, while an attraction force pulls directly-linked profiles together; a city "cluster" is really just many profiles pulled toward the same shared seeds, close enough to each other as a side effect. Colour, which does use location, is applied afterwards and never influences where a point sits.

For more on the underlying force-directed algorithm, see [cosmos.gl](https://github.com/cosmograph-org/cosmograph) (credited below).

## What you can see

- **City clusters**, as described above.
- **Inferring unknown locations from social neighbourhoods.** A basic heuristic is built into the tool: for a following with an unknown location, assign it a location *l* if the seed(s) reaching it already follow a large-enough share of profiles located in *l* (with an optional correction for a city's relative size, so large cities don't win purely by being large). This is meant for exploring the inference visually — check "Unknown Location" and tune the parameters in the panel to see it in action.
- **Flowers** — the canonical example of profiles discovered through a single seed. A "flower" is a small cluster loosely attached to the main graph, with few connections to any cluster's centre, suggesting a borderline placement. Their presence is a rough gauge of scraping saturation: as long as flowers keep appearing, there's still room for the scrape to grow further.
- **Aggregates** — profiles whose location isn't one of the seeded regions; New York is the clearest example. Since none of these profiles' own followings were ever scraped, there are no edges linking them to each other — they only connect to the graph through whichever seed discovered them. As a result they never form a genuine, self-reinforcing cluster of their own; they simply sit wherever that seed's network placed them.

## Credits

Node placement and rendering are powered by [cosmos.gl](https://github.com/cosmograph-org/cosmograph) (`@cosmograph/cosmos`), pinned at version 2.5.1 — the last release with 3D support before it was dropped in the 3.x line. cosmos.gl is licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

## Internship

Noritual Lab is a matcha brand based between Berlin and Tokyo, with two main activities:

- **B2B** (business-to-business): selling matcha to cafés
- **B2C** (business-to-consumer): selling matcha directly to individual customers

I joined as a Growth Engineering intern on the B2C side for summer 2026. My mission was precise: massively automate influencer sourcing and outreach on social media, to build partnerships and brand visibility. That mission included a web-scraping component, which is where the data for this project comes from.
