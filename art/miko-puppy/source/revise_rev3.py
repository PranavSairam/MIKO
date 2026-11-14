# Rev 3 replaces only the head of Rev 2. Body, stance, paws, and scale stay.
# Blender Z-up, the puppy faces -Y.

import math
import os

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = "/Users/sairampranav/PET_BOT/art/miko-puppy"
SOURCE = os.path.join(ROOT, "source")
PREVIEW = os.path.join(ROOT, "preview", "rev3")
REV2 = os.path.join(SOURCE, "miko-puppy-rev2.blend")
REV3 = os.path.join(SOURCE, "miko-puppy-rev3.blend")

EYES = (
    Vector((0.027, -0.090, 0.316)),
    Vector((-0.027, -0.090, 0.316)),
)

FRONT_LOC = (0.0, -0.75, 0.312)
FRONT_TARGET = (0.0, -0.02, 0.312)
FRONT_SCALE = 0.26
FACE3_LOC = (-0.34, -0.50, 0.36)
FACE3_TARGET = (0.0, -0.03, 0.310)
FACE3_SCALE = 0.26
FULL_LOC = (-0.72, -0.95, 0.30)
FULL_TARGET = (0.0, -0.01, 0.18)
FULL_SCALE = 0.58


def srgb(channel):
    c = channel / 255.0
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(srgb(int(hex_color[i : i + 2], 16)) for i in (0, 2, 4)) + (1.0,)


def make_material(name, color, roughness=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    for label in ("Roughness",):
        bsdf.inputs[label].default_value = roughness
    for label in ("Specular IOR Level", "Specular"):
        if label in bsdf.inputs:
            bsdf.inputs[label].default_value = 0.02
            break
    return material


def apply_modifier(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def is_head(co):
    # Cranium and ears sit above the withers. The muzzle is the forward mass.
    if co.z > 0.258 and co.y < 0.07:
        return True
    if co.y < -0.05 and co.z > 0.235:
        return True
    if abs(co.x) > 0.06 and 0.235 < co.z < 0.36 and co.y < 0.03:
        return True
    return False


def paw_bbox(obj):
    lows = [v.co.z for v in obj.data.vertices if v.co.z < 0.03]
    return (min(lows), max(lows), len(lows)) if lows else None


def delete_head(obj):
    before = paw_bbox(obj)
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    dead = [vert for vert in bm.verts if is_head(vert.co)]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    boundary = [edge for edge in bm.edges if edge.is_boundary]
    bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    print("CUT", len(dead), "paws", before, "->", paw_bbox(obj))


def add_sphere(co, radius, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=radius, location=co)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return obj


def build_ear(sign):
    mesh = bpy.data.meshes.new("Ear")
    obj = bpy.data.objects.new("Ear", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    rows, cols = 14, 9
    grid = []
    for j in range(rows):
        v = j / (rows - 1)
        line = []
        breadth = 0.050 * (1.0 - 0.28 * v * v)
        for i in range(cols):
            u = i / (cols - 1) - 0.5
            hang = math.sin(v * math.pi * 0.9)
            x = sign * (0.042 + 0.022 * hang + u * breadth)
            y = -0.022 - 0.016 * v - 0.02 * hang
            z = 0.342 - 0.09 * v - 0.014 * v * (u * u)
            line.append(bm.verts.new((x, y, z)))
        grid.append(line)
    for j in range(rows - 1):
        for i in range(cols - 1):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    solid = obj.modifiers.new("Solid", "SOLIDIFY")
    solid.thickness = 0.016
    solid.offset = 0.0
    apply_modifier(obj, solid)
    return obj


def build_head():
    parts = [
        add_sphere((0.0, -0.038, 0.322), 0.058, (1.16, 0.98, 0.94)),
        add_sphere((0.0, -0.03, 0.368), 0.030, (1.1, 0.85, 0.7)),
        add_sphere((0.040, -0.062, 0.298), 0.030),
        add_sphere((-0.040, -0.062, 0.298), 0.030),
        add_sphere((0.0, -0.072, 0.312), 0.020, (1.3, 0.7, 0.55)),
        add_sphere((0.0, -0.088, 0.294), 0.022, (1.05, 0.85, 0.72)),
        add_sphere((0.012, -0.098, 0.286), 0.011),
        add_sphere((-0.012, -0.098, 0.286), 0.011),
        add_sphere((0.0, -0.058, 0.276), 0.024),
        add_sphere((0.0, -0.01, 0.236), 0.062, (1.2, 1.15, 0.85)),
    ]
    parts.append(build_ear(1.0))
    parts.append(build_ear(-1.0))
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    head = bpy.context.view_layer.objects.active
    head.name = "Head"
    remesh = head.modifiers.new("Remesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = 0.0032
    remesh.use_smooth_shade = True
    apply_modifier(head, remesh)
    smooth = head.modifiers.new("Smooth", "SMOOTH")
    smooth.iterations = 2
    smooth.factor = 0.3
    apply_modifier(head, smooth)
    return head


def cut_socket(head, eye):
    cutter = add_sphere(eye, 0.011, (1.05, 0.72, 0.98))
    cutter.name = "SocketCutter"
    mod = head.modifiers.new("Socket", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.object = cutter
    mod.solver = "FLOAT"
    apply_modifier(head, mod)
    bpy.data.objects.remove(cutter, do_unlink=True)


def shape_lids_and_muzzle(obj):
    for vertex in obj.data.vertices:
        co = vertex.co
        for eye in EYES:
            dx = co.x - eye.x
            dz = co.z - eye.z
            radial = math.hypot(dx, dz * 1.05)
            if co.y > eye.y + 0.01 or radial > 0.018:
                continue
            if 0.0095 < radial < 0.017 and dz > 0.002:
                amount = 1.0 - (radial - 0.0095) / 0.0075
                co.z -= 0.0024 * amount
                co.y -= 0.0016 * amount
            elif 0.009 < radial < 0.016 and dz < -0.001:
                amount = 1.0 - (radial - 0.009) / 0.007
                co.z += 0.0022 * amount
        if abs(co.x) < 0.004 and co.y < -0.075 and 0.286 < co.z < 0.312:
            co.y += 0.0024 * (1.0 - abs(co.x) / 0.004)
        mouth_z = abs(co.z - 0.279)
        if mouth_z < 0.0035 and co.y < -0.078 and abs(co.x) < 0.016:
            co.y += 0.0026 * (1.0 - mouth_z / 0.0035)
    obj.data.update()


def build_nose():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, radius=0.009, location=(0.0, -0.112, 0.294))
    nose = bpy.context.object
    nose.name = "Nose"
    for vertex in nose.data.vertices:
        x, y, z = vertex.co
        if z > 0.0:
            x *= 1.45
            z *= 1.05
        else:
            x *= 0.62
            z *= 0.82
        for side in (0.0034, -0.0034):
            dist = math.hypot(x - side, z - 0.0004)
            if dist < 0.0024 and y < 0.0:
                y += 0.0024 * (1.0 - dist / 0.0024)
        vertex.co = (x, y, z)
    nose.data.materials.append(make_material("Nose", rgb("#241C18"), 0.72))
    bpy.ops.object.shade_smooth()
    return nose


def build_eyes():
    eyes = []
    iris_mat = make_material("Iris", rgb("#5A3A22"), 0.4)
    pupil_mat = make_material("Pupil", rgb("#140E0C"), 0.35)
    catch_mat = make_material("Catch", rgb("#F6F3EE"), 0.45)
    for eye, side in zip(EYES, ("L", "R")):
        sign = 1.0 if eye.x > 0 else -1.0
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=0.0082, location=eye + Vector((0.0, 0.004, -0.001)))
        iris = bpy.context.object
        iris.name = f"Iris{side}"
        iris.data.materials.append(iris_mat)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, radius=0.0036, location=eye + Vector((0.0, -0.004, -0.001)))
        pupil = bpy.context.object
        pupil.name = f"Pupil{side}"
        pupil.data.materials.append(pupil_mat)
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=12,
            ring_count=8,
            radius=0.0015,
            location=eye + Vector((sign * -0.0022, -0.0065, 0.0028)),
        )
        catch = bpy.context.object
        catch.name = f"Catch{side}"
        catch.data.materials.append(catch_mat)
        for obj in (iris, pupil, catch):
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.shade_smooth()
            eyes.append(obj)
    return eyes


def weld_and_restore(body, reference):
    remesh = body.modifiers.new("Weld", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = 0.0034
    remesh.use_smooth_shade = True
    apply_modifier(body, remesh)
    for eye in EYES:
        cut_socket(body, eye)
    shape_lids_and_muzzle(body)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(reference, depsgraph)
    restored = 0
    for vertex in body.data.vertices:
        co = vertex.co
        keep_new = co.z > 0.20 and co.y < 0.08
        if keep_new:
            continue
        hit, _normal, _index, dist = bvh.find_nearest(co)
        if hit is not None and dist < 0.025:
            vertex.co = hit
            restored += 1
    smooth_band(body)
    body.data.update()
    print("RESTORED", restored)


def smooth_band(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    band = [vert for vert in bm.verts if 0.18 < vert.co.z < 0.255 and abs(vert.co.x) < 0.09 and vert.co.y < 0.06]
    for _ in range(10):
        updates = []
        for vert in band:
            neighbors = [edge.other_vert(vert).co.copy() for edge in vert.link_edges]
            if not neighbors:
                continue
            average = sum(neighbors, Vector()) / len(neighbors)
            updates.append((vert, vert.co.lerp(average, 0.65)))
        for vert, co in updates:
            vert.co = co
    bm.to_mesh(obj.data)
    bm.free()


def union_head(body, head):
    mod = body.modifiers.new("Head", "BOOLEAN")
    mod.operation = "UNION"
    mod.object = head
    mod.solver = "FLOAT"
    apply_modifier(body, mod)
    bpy.data.objects.remove(head, do_unlink=True)


def coat(obj):
    material = make_material("Coat", rgb("#E0B184"), 0.98)
    obj.data.materials.clear()
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()


def studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 48
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = bpy.data.worlds.new("Studio") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is None:
        background = world.node_tree.nodes.new("ShaderNodeBackground")
    background.inputs[0].default_value = (0.62, 0.62, 0.62, 1.0)
    background.inputs[1].default_value = 0.55
    for name, loc, energy, size in (
        ("Key", (-0.35, -0.7, 0.55), 5.5, 0.9),
        ("Fill", (0.6, -0.35, 0.32), 3.0, 1.0),
        ("Top", (0.0, 0.1, 0.8), 2.0, 0.7),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = loc
        direction = Vector((0.0, -0.02, 0.22)) - Vector(loc)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if "Ground" not in bpy.data.objects:
        mesh = bpy.data.meshes.new("Ground")
        plane = bpy.data.objects.new("Ground", mesh)
        bpy.context.scene.collection.objects.link(plane)
        mesh.from_pydata(
            [(-0.22, -0.18, -0.0004), (0.22, -0.18, -0.0004), (0.22, 0.30, -0.0004), (-0.22, 0.30, -0.0004)],
            [],
            [(0, 1, 2, 3)],
        )
        plane.data.materials.append(make_material("Ground", (0.52, 0.52, 0.52, 1.0)))


def look_camera(name, location, target, scale):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    data.type = "ORTHO"
    data.ortho_scale = scale
    bpy.context.scene.camera = obj


def render_to(path, width, height):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("RENDER", path)


def render_set(prefix):
    look_camera("Front", FRONT_LOC, FRONT_TARGET, FRONT_SCALE)
    render_to(os.path.join(PREVIEW, f"{prefix}_front.png"), 900, 900)
    look_camera("Face3", FACE3_LOC, FACE3_TARGET, FACE3_SCALE)
    render_to(os.path.join(PREVIEW, f"{prefix}_three.png"), 900, 900)
    look_camera("Full", FULL_LOC, FULL_TARGET, FULL_SCALE)
    render_to(os.path.join(PREVIEW, f"{prefix}_full168.png"), 168, 200)


def hide_except_body():
    for obj in bpy.data.objects:
        obj.hide_render = obj.type == "MESH" and obj.name not in {"MikoBody", "Nose", "IrisL", "IrisR", "PupilL", "PupilR", "CatchL", "CatchR", "Ground"}


def main():
    os.makedirs(PREVIEW, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=REV2)
    for name in ("EyeL", "EyeR", "CatchL", "CatchR", "Nose"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)
    studio()
    hide_except_body()
    render_set("rev2")

    body = bpy.data.objects["MikoBody"]
    print("PAWS BEFORE", paw_bbox(body))
    reference = body.copy()
    reference.data = body.data.copy()
    reference.name = "BodyRef"
    bpy.context.scene.collection.objects.link(reference)
    reference.hide_render = True
    delete_head(body)
    head = build_head()
    union_head(body, head)
    weld_and_restore(body, reference)
    bpy.data.objects.remove(reference, do_unlink=True)
    build_nose()
    build_eyes()
    coat(body)
    hide_except_body()
    print("PAWS AFTER", paw_bbox(body), "VERTS", len(body.data.vertices))
    render_set("rev3")
    bpy.ops.wm.save_as_mainfile(filepath=REV3)
    print("BLEND", REV3)


if __name__ == "__main__":
    main()
