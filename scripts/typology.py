"""Industry-structure typology: group areas by the shape of their location
quotients, with no dependencies beyond the standard library.

Features: log2 of the location quotient for each of the ten CES supersectors
(0 = the national mix). k-means with k-means++ seeding and a fixed random seed,
k chosen by mean silhouette over a range, so the result is reproducible for a
given release and recomputed automatically with each one.

    typology = build_typology({area_id: [profile rows with 'code' and 'lq']}, ...)

Returns {"k", "silhouette", "features", "types": [...], "assignments": {id: type_id}}.
Each type has an id (ordered by size), an automatic name built from the sectors
it over-represents, the mean log2 LQ per sector, and the member count.
"""
import math
import random

SECTOR_SHORT = {
    "20000000": "construction", "30000000": "manufacturing", "40000000": "trade & transport",
    "50000000": "information", "55000000": "finance", "60000000": "professional services",
    "65000000": "education & health", "70000000": "leisure & hospitality",
    "80000000": "other services", "90000000": "government",
}
SECTORS = list(SECTOR_SHORT)


def feature_vector(profile: list[dict]) -> list[float] | None:
    """log2 LQ per sector in fixed order; None if more than two sectors are missing."""
    lq = {row["code"]: row.get("lq") for row in profile if row.get("lq")}
    if len(lq) < len(SECTORS) - 2:
        return None
    return [math.log2(lq[c]) if c in lq else 0.0 for c in SECTORS]


def _dist2(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def _kmeans(points, k, rng, iters=100):
    # k-means++ seeding
    centers = [points[rng.randrange(len(points))]]
    while len(centers) < k:
        d2 = [min(_dist2(p, c) for c in centers) for p in points]
        total = sum(d2)
        r = rng.random() * total
        acc = 0.0
        for p, d in zip(points, d2):
            acc += d
            if acc >= r:
                centers.append(p)
                break
    labels = [0] * len(points)
    for _ in range(iters):
        new = [min(range(k), key=lambda j: _dist2(p, centers[j])) for p in points]
        if new == labels:
            break
        labels = new
        for j in range(k):
            members = [p for p, l in zip(points, labels) if l == j]
            if members:
                centers[j] = [sum(col) / len(members) for col in zip(*members)]
    inertia = sum(_dist2(p, centers[l]) for p, l in zip(points, labels))
    return labels, centers, inertia


def _silhouette(points, labels, k):
    n = len(points)
    d = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            d[i][j] = d[j][i] = math.sqrt(_dist2(points[i], points[j]))
    idx = [[i for i in range(n) if labels[i] == j] for j in range(k)]
    s = []
    for i in range(n):
        own = idx[labels[i]]
        if len(own) <= 1:
            s.append(0.0)
            continue
        a = sum(d[i][j] for j in own if j != i) / (len(own) - 1)
        b = min(sum(d[i][j] for j in other) / len(other) for l, other in enumerate(idx) if l != labels[i] and other)
        s.append((b - a) / max(a, b) if max(a, b) > 0 else 0.0)
    return sum(s) / n


def _name(center: list[float]) -> tuple[str, list[str]]:
    """Name a type by the sectors it over-represents (mean LQ >= 1.15); a type with
    none is named by what it is light on (mean LQ <= 0.85), else 'near the U.S. mix'."""
    ranked = sorted(zip(SECTORS, center), key=lambda t: -t[1])
    lead = [c for c, v in ranked if v >= math.log2(1.15)][:2]
    if lead:
        names = [SECTOR_SHORT[c] for c in lead]
        return (names[0].capitalize() + ("-led" if len(names) == 1 else f" and {names[1]}")), lead
    lag = [c for c, v in reversed(ranked) if v <= math.log2(0.85)][:2]
    if lag:
        return "Diversified, light on " + " and ".join(SECTOR_SHORT[c] for c in lag), []
    return "Diversified, near the U.S. mix", []


def _dedupe(names: list[str]) -> list[str]:
    seen, out = {}, []
    for n in names:
        seen[n] = seen.get(n, 0) + 1
        out.append(n if seen[n] == 1 else f"{n} ({'I' * seen[n]})")
    return out


def build_typology(profiles: dict[str, list[dict]], k_range=range(3, 9), seed=7, restarts=8) -> dict:
    ids, points = [], []
    for aid, prof in profiles.items():
        v = feature_vector(prof)
        if v is not None:
            ids.append(aid)
            points.append(v)
    if len(points) < 12:
        return {"k": 0, "silhouette": None, "features": "log2 location quotient, ten CES supersectors",
                "types": [], "assignments": {}}
    best = None
    for k in k_range:
        if k >= len(points):
            break
        rng = random.Random(seed)
        runs = [_kmeans(points, k, rng) for _ in range(restarts)]
        labels, centers, _ = min(runs, key=lambda r: r[2])
        sil = _silhouette(points, labels, k)
        if best is None or sil > best[0] + 1e-9:
            best = (sil, k, labels, centers)
    sil, k, labels, centers = best
    # order types by size, largest first, and relabel
    sizes = sorted(range(k), key=lambda j: -labels.count(j))
    remap = {old: new for new, old in enumerate(sizes)}
    types = []
    for new, old in enumerate(sizes):
        name, lead = _name(centers[old])
        types.append({"id": new, "name": name, "lead": lead, "n": labels.count(old),
                      "center": {c: round(2 ** v, 3) for c, v in zip(SECTORS, centers[old])}})
    for t, n in zip(types, _dedupe([t["name"] for t in types])):
        t["name"] = n
    assignments = {aid: remap[l] for aid, l in zip(ids, labels)}
    return {"k": k, "silhouette": round(sil, 3), "features": "log2 location quotient, ten CES supersectors",
            "types": types, "assignments": assignments}


def nearest_type(profile: list[dict], typology: dict) -> int | None:
    """Type id whose centre is closest to this profile (for areas outside the pool)."""
    v = feature_vector(profile)
    if v is None or not typology.get("types"):
        return None
    return min(typology["types"], key=lambda t: _dist2(v, [math.log2(t["center"][c]) for c in SECTORS]))["id"]
