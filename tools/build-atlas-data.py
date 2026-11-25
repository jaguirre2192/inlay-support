#!/usr/bin/env python3
"""Builds the web atlas's data (atlas/data/, atlas/art/) from an Inlay app checkout.

    python3 tools/build-atlas-data.py --native ~/Documents/Apps/Inlay

Reads the app's editable sources and writes, with no change to coordinates:
  atlas/data/world.json      destinations, groups, overview frames, labels (no outlines)
  atlas/data/world.inlr      outlines and art plates for every destination, in the app's own
                             INLR format 2 (raw DEFLATE over delta-varint ringsets, see
                             RegionalGeometry.swift), so the web reads one format everywhere
  atlas/data/land.inlr       land contours under the destinations
  atlas/data/regions.json    regional index: kinds, which countries have regions, region rows
  atlas/data/regions/*.inlr  each country's regions: the app's files as they are, plus Italy,
                             the US and Canada written in the same format
  atlas/data/i18n/<lang>.json  interface strings (Localizable) and place names (PlaceNames)
  atlas/data/summaries.json  bundled English Wikipedia introductions
  atlas/art/regions/         regional art, byte for byte

Country art is read from /print/assets/art/ (prepare-print-assets.py), which already holds
every country plate the app ships.
"""
import argparse, hashlib, json, shutil, struct, subprocess, zlib
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--native", type=Path, required=True)
args = ap.parse_args()
ROOT = Path(__file__).resolve().parents[1]
RES = args.native / "App" / "Resources"
OUT = ROOT / "atlas" / "data"
ART = ROOT / "atlas" / "art" / "regions"
LANGS = ["en", "ja", "ko", "de", "pt-BR", "it", "fr"]
for d in (OUT, OUT / "regions", OUT / "i18n", ART):
    d.mkdir(parents=True, exist_ok=True)


def j(path):
    return json.loads(path.read_text())


class Writer:
    """INLR format 2: 'INLR' u32 2, then raw DEFLATE of a ringset table and the records."""

    def __init__(self):
        self.rings = []          # encoded ringsets
        self.index = {}          # encoding -> index
        self.body = []

    @staticmethod
    def varint(v):
        z = (v << 1) ^ (v >> 63)  # zigzag
        out = bytearray()
        while True:
            b = z & 0x7F
            z >>= 7
            if z:
                out.append(b | 0x80)
            else:
                out.append(b)
                return bytes(out)

    def ringset(self, rings):
        """Stores a ringset once and returns its index (u32 written by the caller)."""
        rings = [r for r in rings if len(r) >= 3]
        enc = bytearray(struct.pack("<I", len(rings)))
        for ring in rings:
            enc += struct.pack("<I", len(ring))
            x = y = 0
            for px, py in ring:
                ix, iy = round(px * 100), round(py * 100)
                enc += self.varint(ix - x) + self.varint(iy - y)
                x, y = ix, iy
        key = bytes(enc)
        if key not in self.index:
            self.index[key] = len(self.rings)
            self.rings.append(key)
        return self.index[key]

    def u32(self, v): self.body.append(struct.pack("<I", v))
    def f32(self, *v): self.body.append(struct.pack(f"<{len(v)}f", *v))
    def string(self, s):
        b = s.encode()
        self.body.append(struct.pack("<H", len(b)) + b)

    def layers(self, plates):
        self.u32(len(plates))
        for p in plates:
            self.string(p["image"])
            self.f32(*p["frame"])
            self.f32(*p.get("crop", [0, 0, 1, 1]))
            self.u32(self.ringset(p["rings"]))

    def write(self, path):
        table = bytearray(struct.pack("<I", len(self.rings)))
        for r in self.rings:
            table += r
        payload = bytes(table) + b"".join(self.body)
        c = zlib.compressobj(9, zlib.DEFLATED, -15)  # raw DEFLATE, as NSData .zlib writes
        path.write_bytes(b"INLR" + struct.pack("<I", 2) + c.compress(payload) + c.flush())
        return path.stat().st_size


def frame_of(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]


# ---- world: destinations ------------------------------------------------------------------
countries = j(RES / "atlas-countries.json")
italy = j(RES / "atlas-geometry.json")
world = Writer()
rows = []
for c in countries["countries"]:
    plates = c.get("plates", [])
    if c["id"] == "IT":  # the app composes Italy from three pieces
        plates = [{"image": p["name"] + ".jpg", "frame": p["frame"], "crop": [0, 0, 1, 1], "rings": p["rings"]}
                  for p in italy["parts"]]
    # Plates without their own clip draw inside the country outline: give them its rings.
    plates = [{**p, "rings": p.get("rings") or c["rings"]} for p in plates]
    world.string(c["id"])
    world.u32(world.ringset(c["rings"]))
    world.layers(plates)
    rows.append({
        "id": c["id"], "name": c["name"], "short": c.get("shortName") or c["name"], "kind": c["kind"],
        "group": c["group"], "parent": c.get("parentID"), "numeric": c.get("numeric"),
        "bounds": c["bounds"], "focus": c.get("focusFrame", c["bounds"]),
        "art": c.get("artFrame"), "hit": c.get("hitPoint"),
        "labels": [[l["name"], *l["point"]] for l in c.get("labels", [])],
    })
world_bytes = world.write(OUT / "world.inlr")

# Land under the destinations: the app's detailed 1:10m contours (land-detail.json), which
# don't overlap, as one even-odd ringset. (atlas-geometry.json's coarse land rings overlap and
# the app fills them one ring at a time.)
land = Writer()
land.u32(land.ringset([r for c in j(RES / "land-detail.json")["contours"] for r in c["rings"]]))
land_bytes = land.write(OUT / "land.inlr")

(OUT / "world.json").write_text(json.dumps({
    "schema": 1,
    "frame": [0, 0, italy["width"], italy["height"]],
    "countryCount": countries["countryCount"], "territoryCount": countries["territoryCount"],
    "groups": countries["groups"], "overviews": countries.get("overviewFrames", {}),
    "places": rows,
}, ensure_ascii=False, separators=(",", ":")))

# ---- regions --------------------------------------------------------------------------------
regional = j(RES / "regional-art.json")
region_rows = list(regional["regions"])
files = dict(regional["countries"])
kinds = dict(regional["kinds"])
copied = 0
for cid, name in regional["countries"].items():
    shutil.copyfile(RES / "RegionGeometry" / name, OUT / "regions" / name)
for images in regional["art"].values():
    for image in images:
        src = RES / "RegionArt" / image
        if src.exists():
            shutil.copyfile(src, ART / image)
            copied += 1

# Italy: twenty regions, each with its own plate, written in the same format.
it = j(RES / "italy-regions.json")
w = Writer()
w.layers([])  # no foundation: the country's own pieces stay underneath
w.u32(len(it["regions"]))
for r in it["regions"]:
    rid = "IT-" + r["id"]
    w.string(rid)
    w.u32(w.ringset(r["rings"]))
    w.layers([{"image": r["image"], "frame": r["artFrame"], "crop": [0, 0, 1, 1], "rings": r["rings"]}])
    w.layers([])
    shutil.copyfile(RES / "Regions" / r["image"], ART / r["image"])
    copied += 1
    # In the app Italy's regions are views of the art, not places to mark: marking records IT.
    region_rows.append({"id": rid, "countryID": "IT", "name": r["name"], "markable": False, "bounds": r["bounds"],
                        "focusFrame": r.get("focusFrame", r["bounds"]),
                        "labels": [[l["name"], *l["point"]] for l in r.get("labels", [])]})
w.write(OUT / "regions" / "regions-it.inlr")
files["IT"] = "regions-it.inlr"
kinds["IT"] = "regions"

# US states and Canadian provinces: outlines only (they take the country's own art).
states = j(RES / "atlas-states.json")
for cid in sorted({s["countryID"] for s in states["subregions"]}):
    w = Writer()
    w.layers([])
    subs = [s for s in states["subregions"] if s["countryID"] == cid]
    w.u32(len(subs))
    for s in subs:
        w.string(s["id"])
        w.u32(w.ringset(s["rings"]))
        w.layers([])
        w.layers([])
        region_rows.append({"id": s["id"], "countryID": cid, "name": s["name"],
                            "bounds": s.get("bounds") or frame_of(s["rings"]),
                            "focusFrame": s.get("bounds") or frame_of(s["rings"])})
    name = f"regions-{cid.lower()}.inlr"
    w.write(OUT / "regions" / name)
    files[cid] = name
kinds.update(states["kinds"])

(OUT / "regions.json").write_text(json.dumps({"kinds": kinds, "files": files, "regions": region_rows},
                                             ensure_ascii=False, separators=(",", ":")))

# ---- strings ---------------------------------------------------------------------------------
def catalog(path):
    data = j(path)
    out = {l: {} for l in LANGS}
    for key, entry in data["strings"].items():
        locs = entry.get("localizations", {})
        for lang in LANGS:
            loc = locs.get(lang)
            if not loc:
                if lang == "en":
                    out["en"][key] = key
                continue
            if "substitutions" in loc:
                out[lang][key] = {"value": loc["stringUnit"]["value"], "subs": {
                    name: {"arg": s.get("argNum"), **{form: v["stringUnit"]["value"]
                                                     for form, v in s["variations"]["plural"].items()}}
                    for name, s in loc["substitutions"].items()}}
            elif "stringUnit" in loc:
                out[lang][key] = loc["stringUnit"]["value"]
    return out

ui = catalog(args.native / "App" / "Localizable.xcstrings")
places = catalog(args.native / "App" / "PlaceNames.xcstrings")
for lang in LANGS:
    (OUT / "i18n" / f"{lang}.json").write_text(json.dumps(
        {"ui": ui[lang], "places": places[lang] if lang != "en" else {}},
        ensure_ascii=False, separators=(",", ":")))

shutil.copyfile(RES / "place-summaries.json", OUT / "summaries.json")

source = subprocess.check_output(["git", "-C", str(args.native), "rev-parse", "HEAD"], text=True).strip()
(OUT / "SOURCE.json").write_text(json.dumps({
    "nativeSource": source,
    "nativeCatalogSHA256": hashlib.sha256((RES / "atlas-countries.json").read_bytes()).hexdigest(),
    "coordinatePolicy": "exact native coordinates (stored in hundredths of a map unit, as the app's own region files)",
}, indent=2) + "\n")
print(json.dumps({"destinations": len(rows), "worldBytes": world_bytes, "landBytes": land_bytes,
                  "regionCountries": len(files), "regions": len(region_rows), "regionArtFiles": copied,
                  "uiKeys": len(ui["en"]), "placeNames": len(places["ja"])}))
