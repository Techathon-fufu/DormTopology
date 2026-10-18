"""Discrete book posture, independent of dimensions and horizontal heading."""

BOOK_CATEGORIES = {"book", "books"}
BOOK_POSES = {"original", "upright", "flat"}


def turned(item: dict) -> bool:
    pose = item.get("book_pose", "original")
    if pose == "original":
        return False
    _, height, depth = item["size_m"]
    return (height < depth) if pose == "upright" else (height >= depth)


def upright(item: dict) -> bool:
    _, height, depth = item["size_m"]
    return (depth >= height) if turned(item) else (height >= depth)


def pose_point(item: dict, point):
    if not turned(item):
        return tuple(point)
    _, height, depth = item["size_m"]
    x, y, z = point
    return (x, z + depth / 2, height / 2 - y)


def unpose_point(item: dict, point):
    if not turned(item):
        return tuple(point)
    _, height, depth = item["size_m"]
    x, y, z = point
    return (x, height / 2 - z, y - depth / 2)


def pose_direction(item: dict, vector, *, inverse=False):
    x, y, z = vector
    if not turned(item):
        return tuple(vector)
    return (x, -z, y) if inverse else (x, z, -y)


def pose_size(item: dict):
    width, height, depth = item["size_m"]
    return (width, depth, height) if turned(item) else (width, height, depth)
