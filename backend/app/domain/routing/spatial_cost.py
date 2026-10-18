"""Nonnegative spatial penalties, integrated on edges AND endpoint connectors."""

import math


def segment_penalty(a, b, policy):
    if policy is None:
        return 0.0
    delta = [y - x for x, y in zip(a, b)]
    length = math.dist(a, b)
    low, high = 0.0, 1.0
    for k in range(3):
        if abs(delta[k]) < 1e-12:
            if not policy["desktop_min"][k] <= a[k] <= policy["desktop_max"][k]:
                return 0.0
        else:
            ends = [(policy[key][k] - a[k]) / delta[k] for key in ("desktop_min", "desktop_max")]
            low, high = max(low, min(ends)), min(high, max(ends))
    if high <= low or length == 0:
        return 0.0
    start, end = policy["corner_start"], policy["corner_end"]
    axis = [y - x for x, y in zip(start, end)]
    axis2 = sum(v * v for v in axis)
    scale = policy["distance_scale_m"]
    count = max(1, min(128, math.ceil(length * (high - low) / .02)))
    total = 0.0
    for i in range(count):
        t = low + (high - low) * (i + .5) / count
        p = [a[k] + delta[k] * t for k in range(3)]
        u = max(0, min(1, sum((p[k] - start[k]) * axis[k] for k in range(3)) / axis2))
        corner_distance = math.dist(p, [start[k] + u * axis[k] for k in range(3)])
        seat_distance = math.hypot(p[0] - policy["seat_position"][0], p[2] - policy["seat_position"][2])
        total += (policy["corner_weight"] * corner_distance / (scale + corner_distance)
                  + policy["seat_weight"] * scale / (scale + seat_distance))
    return length * (high - low) * total / count
