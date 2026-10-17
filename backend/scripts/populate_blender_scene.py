"""
Populate Blender Scene with Reconstructed 3D Assets
Imports generated Rodin 3D models and detected desk clutter items,
scales and positions them at detected 3D coordinates on dorm_desk.blend,
and saves the final populated .blend file and renders a preview image.

Usage:
  python backend/scripts/populate_blender_scene.py
"""

import sys
import os
import json
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


BLENDER_SCRIPT_CONTENT = '''
import os
import sys
import json
import math
from pathlib import Path
import bpy
import mathutils

project_root = Path(r"{project_root}")
desk_blend = project_root / "objects" / "dorm_desk.blend"
contract_path = project_root / "tests" / "test_vlm_round2" / "vlm_result_round2.json"
output_blend = project_root / "objects" / "dorm_desk_populated.blend"
preview_img = project_root / "image" / "dorm_desk_populated_preview.png"

print(f"[*] Opening base scene: {desk_blend}")
bpy.ops.wm.open_mainfile(filepath=str(desk_blend))

# Load detection & model data
with open(contract_path, "r", encoding="utf-8") as f:
    data = json.load(f)

items = data.get("items", [])
print(f"[*] Loaded {len(items)} items from data contract.")

# Create collection for detected items
col_name = "Detected_Desktop_Items"
if col_name in bpy.data.collections:
    items_col = bpy.data.collections[col_name]
else:
    items_col = bpy.data.collections.new(col_name)
    bpy.context.scene.collection.children.link(items_col)


def create_placeholder_box(name, size, pos, collection):
    """Creates a placeholder object for items without a generated 3D mesh (e.g. laptop)."""
    sx, sy, sz = size
    px, py, pz = pos
    
    mesh = bpy.data.meshes.new(name + "_Mesh")
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    
    # Create simple box with origin at center-bottom
    hx, hy, hz = sx / 2.0, sy / 2.0, sz
    verts = [
        (-hx, -hy, 0.0), (hx, -hy, 0.0), (hx, hy, 0.0), (-hx, hy, 0.0),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)
    ]
    faces = [
        (3, 2, 1, 0), (4, 5, 6, 7),
        (0, 1, 5, 4), (2, 3, 7, 6),
        (3, 0, 4, 7), (1, 2, 6, 5)
    ]
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    
    obj.location = mathutils.Vector((px, py, pz))
    
    # Create material
    mat_name = "Mat_Placeholder_Box"
    mat = bpy.data.materials.get(mat_name)
    if not mat:
        mat = bpy.data.materials.new(name=mat_name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (0.2, 0.5, 0.9, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.3
    obj.data.materials.append(mat)
    obj.color = (0.2, 0.5, 0.9, 0.8)
    obj.show_wire = True
    return obj


def place_gltf_model(item_id, item_name, model_path, target_pos, target_size, collection, max_deviation=0.60):
    """
    Imports, validates dimension error against VLM (<60%), scales model uniformly
    with 70% VLM + 30% GLB weighting, and locates on desk surface.
    """
    before_objs = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=str(model_path))
    new_objs = [bpy.data.objects[n] for n in (set(bpy.data.objects.keys()) - before_objs)]
    
    if not new_objs:
        print(f"[!] Warning: No objects imported for {item_id} from {model_path}")
        return None

    # Move all newly imported objects into collection
    for o in new_objs:
        for c in o.users_collection:
            c.objects.unlink(o)
        collection.objects.link(o)

    # Find root objects
    roots = [o for o in new_objs if not o.parent or o.parent not in new_objs]
    if len(roots) == 1:
        root = roots[0]
        root.name = f"Item_{item_id}_{item_name}"
    else:
        root = bpy.data.objects.new(f"Item_{item_id}_{item_name}", None)
        collection.objects.link(root)
        for r in roots:
            r.parent = root

    bpy.context.view_layer.update()

    # 1. Measure initial mesh bounds
    mesh_objs = [o for o in new_objs if o.type == 'MESH']
    if not mesh_objs:
        print(f"[!] Warning: No mesh objects found in {model_path}")
        return root

    all_corners = [o.matrix_world @ mathutils.Vector(c) for o in mesh_objs for c in o.bound_box]
    min_x = min(c.x for c in all_corners)
    max_x = max(c.x for c in all_corners)
    min_y = min(c.y for c in all_corners)
    max_y = max(c.y for c in all_corners)
    min_z = min(c.z for c in all_corners)
    max_z = max(c.z for c in all_corners)

    cur_dx = max(max_x - min_x, 1e-4)
    cur_dy = max(max_y - min_y, 1e-4)
    cur_dz = max(max_z - min_z, 1e-4)

    # 2. Convert to physical scale if normalized (~1m to 2m)
    tw, td, th = target_size
    max_raw = max(cur_dx, cur_dy, cur_dz)
    max_vlm = max(tw, td, th)
    scale_norm = (max_vlm / max_raw) if (max_raw > 0.5 and max_vlm < 0.4) else 1.0
    phys_dx = cur_dx * scale_norm
    phys_dy = cur_dy * scale_norm
    phys_dz = cur_dz * scale_norm

    # 3. Check horizontal dimension error against VLM prediction
    err1 = max(abs(phys_dx - tw) / tw, abs(phys_dy - td) / td)
    err2 = max(abs(phys_dy - tw) / tw, abs(phys_dx - td) / td)
    err3 = max(abs(phys_dx - tw) / tw, abs(phys_dz - td) / td)
    min_err = min(err1, err2, err3)

    if min_err > max_deviation:
        print(f"[!] DROP {item_id} ({item_name}): 尺寸误差 {min_err:.1%} > {max_deviation:.0%}, 超过阈值自动剔除!")
        # Delete imported objects
        for o in new_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        if root not in new_objs:
            bpy.data.objects.remove(root, do_unlink=True)
        return None

    # 4. User rule: 尺寸 vlm 占 7，glb 占 3，按照这个占比等比例整体缩放模型
    target_primary_dim = 0.7 * max_vlm + 0.3 * (max_raw * scale_norm)
    uniform_scale = target_primary_dim / max_raw

    root.scale = mathutils.Vector((uniform_scale, uniform_scale, uniform_scale))
    bpy.context.view_layer.update()

    # 5. Translate to target_pos, bottom resting on desk Z
    all_corners = [o.matrix_world @ mathutils.Vector(c) for o in mesh_objs for c in o.bound_box]
    new_min_x = min(c.x for c in all_corners)
    new_max_x = max(c.x for c in all_corners)
    new_min_y = min(c.y for c in all_corners)
    new_max_y = max(c.y for c in all_corners)
    new_min_z = min(c.z for c in all_corners)

    center_x = (new_min_x + new_max_x) / 2.0
    center_y = (new_min_y + new_max_y) / 2.0

    delta_x = target_pos[0] - center_x
    delta_y = target_pos[1] - center_y
    delta_z = target_pos[2] - new_min_z

    root.location += mathutils.Vector((delta_x, delta_y, delta_z))
    bpy.context.view_layer.update()

    final_dims = [new_max_x - new_min_x, new_max_y - new_min_y, max(c.z for c in all_corners) - new_min_z]
    print(f"[+] Placed {item_id} ({item_name}) at {target_pos}, uniform_scale={uniform_scale:.4f}, final_dims={[round(x,3) for x in final_dims]} (误差={min_err:.1%} <= {max_deviation:.0%})")
    return root


# Process all items automatically without manual adjustment
placed_count = 0
dropped_count = 0

for item in items:
    iid = item["id"]
    iname = item["name"]
    pos = item["current_pos"]
    size = item["estimated_size_m"]
    model_rel = item.get("model_url")
    
    # 1. User rule: 插排属于固定标准件，由其他成员负责，本流程自动忽略
    if any(k in iname for k in ['排插', '插排', '接线板']):
        print(f"[*] EXCLUDE {iid} ({iname}): 属于团队标准件，跳过放置")
        continue

    # 2. Try placing GLB model
    if model_rel:
        model_full = project_root / model_rel
        if model_full.exists():
            res = place_gltf_model(iid, iname, model_full, pos, size, items_col)
            if res:
                placed_count += 1
            else:
                dropped_count += 1
            continue
        else:
            print(f"[!] Model file not found: {model_full}")
            
    # 3. Fallback to placeholder box only for items without model_url (e.g. laptop)
    if not model_rel:
        create_placeholder_box(f"Placeholder_{iid}_{iname}", size, pos, items_col)
        print(f"[+] Created placeholder for {iid} ({iname}) at {pos}")
        placed_count += 1


# -------------------------------------------------------------
# Setup Camera & Lighting for Desktop Clutter Overview
# -------------------------------------------------------------
def look_at(cam, target_pos):
    direction = target_pos - cam.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam.rotation_euler = rot_quat.to_euler()

cam = bpy.data.objects.get("Cam_Populated_Desk")
if not cam:
    cam_data = bpy.data.cameras.new("Cam_Populated_Desk_Data")
    cam = bpy.data.objects.new("Cam_Populated_Desk", cam_data)
    bpy.context.scene.collection.objects.link(cam)

cam.data.lens = 28
cam.data.clip_start = 0.05
cam.data.clip_end = 50.0
bpy.context.scene.camera = cam

# Shading & Render Settings
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.color_type = 'TEXTURE'
scene.display.shading.light = 'STUDIO'
scene.display.shading.studio_light = 'Default'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'BOTH'
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080

# -------------------------------------------------------------
# Save populated .blend file
# -------------------------------------------------------------
print(f"[*] Saving populated Blender scene to: {output_blend}")
bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))

# -------------------------------------------------------------
# Render Multi-Angle Verification Views
# -------------------------------------------------------------
# 1. Chair view (Primary Preview: standing/sitting in front of desk looking down at 45 deg)
cam.location = mathutils.Vector((0.95, 1.40, 1.25))
look_at(cam, mathutils.Vector((0.95, 0.40, 0.77)))
scene.render.filepath = str(preview_img)
bpy.ops.render.render(write_still=True)
chair_path = project_root / "image" / "scene_review_chair.png"
scene.render.filepath = str(chair_path)
bpy.ops.render.render(write_still=True)
print(f"[+] Rendered chair view preview to: {preview_img}")

# 2. Top-down layout blueprint view
# Hide upper bed structure and bookshelf so they do not occlude the desk surface
bed_col = bpy.data.collections.get("01_Bed_Structure")
book_col = bpy.data.collections.get("04_Upper_Bookshelf")
if bed_col: bed_col.hide_render = True
if book_col: book_col.hide_render = True

cam.location = mathutils.Vector((0.95, 0.38, 2.10))
cam.rotation_euler = (0, 0, math.pi)
topdown_path = project_root / "image" / "scene_review_topdown.png"
scene.render.filepath = str(topdown_path)
bpy.ops.render.render(write_still=True)
print(f"[+] Rendered top-down blueprint view to: {topdown_path}")

# Restore visibility
if bed_col: bed_col.hide_render = False
if book_col: book_col.hide_render = False

# 3. Isometric 3/4 perspective view
cam.location = mathutils.Vector((2.30, 2.20, 1.70))
look_at(cam, mathutils.Vector((0.95, 0.35, 0.85)))
iso_path = project_root / "image" / "scene_review_iso.png"
scene.render.filepath = str(iso_path)
bpy.ops.render.render(write_still=True)
print(f"[+] Rendered isometric perspective view to: {iso_path}")

print("[+] All multi-angle renders completed successfully!")
'''


def find_blender() -> str:
    """Find local Blender executable."""
    candidate_paths = [
        r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
    ]
    for p in candidate_paths:
        if Path(p).exists():
            return p
    return "blender"


def main():
    blender_exe = find_blender()
    print(f"[*] Using Blender: {blender_exe}")
    
    script_code = BLENDER_SCRIPT_CONTENT.replace("{project_root}", str(PROJECT_ROOT).replace("\\", "\\\\"))
    
    # Write temporary runner script
    temp_script = PROJECT_ROOT / "backend" / "scripts" / "_temp_assemble_scene.py"
    temp_script.write_text(script_code, encoding="utf-8")
    
    try:
        cmd = [blender_exe, "--background", "--python", str(temp_script)]
        print(f"[*] Running: {' '.join(cmd)}", flush=True)
        subprocess.run(cmd, check=True)
        print("[+] SUCCESS! Assembled populated scene.", flush=True)
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] Blender execution failed with code {e.returncode}", flush=True)
        sys.exit(1)
    finally:
        if temp_script.exists():
            temp_script.unlink()


if __name__ == "__main__":
    main()
