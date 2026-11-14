# Original MIKO puppy. No third-party meshes, textures, or HDRIs.
# Blender file is Z-up and the puppy faces -Y.
# The glTF export is metres, Y-up, facing +Z, origin on the ground
# between the paws. Walk and Idle are in-place clips.

import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = "/Users/sairampranav/PET_BOT/art/miko-puppy"
TEX_DIR = os.path.join(ROOT, "textures")
PREVIEW = os.path.join(ROOT, "preview")
SOURCE = os.path.join(ROOT, "source")

# Slow puppy walk. Stance travel matches this stride so planted paws
# do not skate when the app moves the rig at STRIDE / CYCLE metres per second.
STRIDE = 0.14
CYCLE = 1.0
DUTY = 0.75
REACH = STRIDE * DUTY * 0.5
SWING = 1.0 - DUTY
FPS = 30

# Swing starts at this phase. One paw is in the air at a time.
BEAT = {
    "front_left": 0.50,
    "front_right": 0.00,
    "back_left": 0.75,
    "back_right": 0.25,
}

# Blender space: Z up, forward is -Y. X+ is the puppy's left.
PAWS = {
    "front_left": Vector((0.058, -0.090, 0.0)),
    "front_right": Vector((-0.058, -0.090, 0.0)),
    "back_left": Vector((0.052, 0.100, 0.0)),
    "back_right": Vector((-0.052, 0.100, 0.0)),
}


def argv_after_double_dash():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def srgb_to_linear(channel):
    c = channel / 255.0
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def smoothstep(edge0, edge1, value):
    if edge1 == edge0:
        return 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    scene.render.fps = FPS
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0


def add_sphere(co, radius, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=16,
        ring_count=10,
        radius=radius,
        location=co,
    )
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return obj


def build_body():
    parts = []

    def ball(co, radius, scale=(1.0, 1.0, 1.0)):
        parts.append(add_sphere(co, radius, scale))

    def mirror(co, radius, scale=(1.0, 1.0, 1.0)):
        ball(co, radius, scale)
        if abs(co[0]) > 0.001:
            flipped = (-scale[0], scale[1], scale[2])
            ball((-co[0], co[1], co[2]), radius, flipped)

    # Round head sitting on a short neck. Muzzle is short and low.
    ball((0.0, -0.05, 0.332), 0.064, (1.16, 1.02, 0.98))
    ball((0.0, -0.055, 0.382), 0.036, (1.05, 0.9, 0.8))
    mirror((0.042, -0.055, 0.322), 0.034, (1.0, 0.95, 0.9))
    ball((0.0, -0.092, 0.308), 0.030, (0.82, 0.95, 0.68))
    ball((0.0, -0.072, 0.292), 0.024, (0.9, 1.0, 0.75))

    def capsule(start, end, radius_start, radius_end, scale=(1.0, 1.0, 1.0)):
        start = Vector(start)
        end = Vector(end)
        step = min(radius_start, radius_end) * 0.42
        steps = max(3, int((end - start).length / step))
        for i in range(steps + 1):
            t = i / steps
            radius = radius_start * (1.0 - t) + radius_end * t
            ball(tuple(start.lerp(end, t)), radius, scale)

    # Ears overlap the sides of the head and hang beside the cheeks.
    for sign in (1.0, -1.0):
        capsule(
            (sign * 0.05, -0.04, 0.365),
            (sign * 0.102, -0.048, 0.268),
            0.032,
            0.022,
            (0.7, 0.5, 1.0),
        )

    # Short neck into a longer, deeper torso. Withers near 0.25 m.
    ball((0.0, -0.035, 0.262), 0.050, (1.1, 1.0, 0.8))
    ball((0.0, 0.0, 0.195), 0.070, (1.25, 1.35, 0.86))
    ball((0.0, 0.07, 0.188), 0.058, (1.12, 1.25, 0.8))
    ball((0.0, 0.125, 0.192), 0.062, (1.08, 1.05, 0.9))
    ball((0.0, 0.03, 0.148), 0.050, (1.15, 1.3, 0.72))

    for name in ("front_left", "front_right"):
        paw = PAWS[name]
        sign = 1.0 if paw.x > 0 else -1.0
        capsule((sign * 0.04, -0.02, 0.17), (sign * 0.055, -0.055, 0.09), 0.046, 0.034)
        capsule((sign * 0.055, -0.055, 0.09), (paw.x, paw.y, 0.032), 0.034, 0.030)
        ball((paw.x, paw.y - 0.004, 0.018), 0.034, (1.12, 1.25, 0.58))

    for name in ("back_left", "back_right"):
        paw = PAWS[name]
        sign = 1.0 if paw.x > 0 else -1.0
        capsule((sign * 0.036, 0.09, 0.17), (sign * 0.052, 0.125, 0.09), 0.046, 0.034)
        capsule((sign * 0.052, 0.125, 0.09), (paw.x, paw.y, 0.030), 0.034, 0.028)
        ball((paw.x, paw.y, 0.016), 0.033, (1.1, 1.28, 0.55))

    capsule((0.0, 0.150, 0.188), (0.008, 0.188, 0.162), 0.044, 0.036)
    capsule((0.008, 0.188, 0.162), (0.016, 0.228, 0.128), 0.036, 0.024)
    ball((0.018, 0.232, 0.124), 0.022)

    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "MikoBody"
    return body


def apply_modifier(obj, modifier):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def shape_face(obj):
    for vertex in obj.data.vertices:
        co = vertex.co
        mouth = Vector((0.0, -0.105, 0.298))
        distance = (co - mouth).length
        if distance < 0.02 and co.y < -0.07:
            falloff = 1.0 - distance / 0.02
            co.y += 0.005 * falloff
            co.z -= 0.002 * falloff
        for eye_x in (0.034, -0.034):
            brow = Vector((eye_x, -0.07, 0.362))
            brow_distance = (co - brow).length
            if brow_distance < 0.02:
                falloff = 1.0 - brow_distance / 0.02
                co.y -= 0.007 * falloff
                co.z += 0.004 * falloff
    obj.data.update()


def sculpt_surface(obj):
    remesh = obj.modifiers.new("Remesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = 0.0055
    remesh.use_smooth_shade = True
    apply_modifier(obj, remesh)

    smooth = obj.modifiers.new("Smooth", "SMOOTH")
    smooth.iterations = 5
    smooth.factor = 0.4
    apply_modifier(obj, smooth)

    fluff = bpy.data.textures.new("Fluff", "CLOUDS")
    fluff.noise_scale = 0.055
    displace = obj.modifiers.new("Fluff", "DISPLACE")
    displace.texture = fluff
    displace.strength = 0.0038
    displace.mid_level = 0.5
    apply_modifier(obj, displace)

    shape_face(obj)
    plant_paws(obj)
    bpy.ops.object.shade_smooth()


def plant_paws(obj):
    for vertex in obj.data.vertices:
        co = vertex.co
        if co.z > 0.02:
            continue
        for paw in PAWS.values():
            flat = math.hypot(co.x - paw.x, co.y - paw.y)
            if flat > 0.034:
                continue
            edge = flat / 0.034
            pad = 0.0015 + (edge * edge) * 0.012
            if co.z < pad:
                co.z = pad
            break
        if co.z < 0.0:
            co.z = 0.0
    obj.data.update()


def fur_color(co, normal):
    body = rgb("#E0B083")
    chest = rgb("#F6EBDA")
    gold = rgb("#D39B62")
    muzzle = rgb("#F3E0C8")
    ear = rgb("#C4894E")
    shadow = rgb("#C49268")

    chest_mask = (
        smoothstep(0.20, 0.15, co.z)
        * smoothstep(0.02, -0.04, co.y)
        * smoothstep(0.055, 0.02, abs(co.x))
        * smoothstep(0.12, 0.16, co.z)
    )
    muzzle_mask = smoothstep(-0.06, -0.09, co.y) * smoothstep(0.05, 0.0, abs(co.x)) * smoothstep(0.28, 0.33, co.z)
    ear_mask = smoothstep(0.07, 0.095, abs(co.x)) * smoothstep(0.26, 0.37, co.z)
    back_mask = smoothstep(0.04, 0.14, co.y) * smoothstep(0.0, 0.4, normal.z)
    grain = 0.5 + 0.5 * math.sin(co.x * 47.0 + co.y * 31.0) * math.sin(co.z * 39.0 + co.x * 17.0)
    shade = smoothstep(0.15, -0.55, normal.z)

    color = [body[i] for i in range(3)]
    for i in range(3):
        color[i] = color[i] * (1.0 - chest_mask) + chest[i] * chest_mask
        color[i] = color[i] * (1.0 - muzzle_mask) + muzzle[i] * muzzle_mask
        color[i] = color[i] * (1.0 - ear_mask) + ear[i] * ear_mask
        color[i] = color[i] * (1.0 - back_mask * 0.45) + gold[i] * (back_mask * 0.45)
        color[i] = color[i] * (0.96 + 0.06 * grain)
        color[i] = color[i] * (1.0 - 0.28 * shade) + shadow[i] * (0.28 * shade)
    return color


def paint_vertex_colors(obj):
    attribute = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for vertex in obj.data.vertices:
        color = fur_color(vertex.co, vertex.normal)
        attribute.data[vertex.index].color = (color[0], color[1], color[2], 1.0)


def set_principled(bsdf, **values):
    aliases = {
        "roughness": ["Roughness"],
        "specular": ["Specular IOR Level", "Specular"],
        "coat": ["Coat Weight", "Coat"],
        "sheen": ["Sheen Weight", "Sheen"],
    }
    for key, value in values.items():
        for name in aliases.get(key, [key]):
            if name in bsdf.inputs:
                bsdf.inputs[name].default_value = value
                break


def make_material(name, color, roughness, specular=0.15):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    set_principled(bsdf, roughness=roughness, specular=specular)
    return material


def assign_fur_material(obj):
    material = make_material("Fur", rgb("#E4BC90"), 0.84, 0.12)
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    color_node = nodes.new("ShaderNodeVertexColor")
    color_node.layer_name = "Col"
    material.node_tree.links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.append(material)
    return material


def add_face(collection):
    parts = []

    def sphere(name, co, radius, material):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=radius, location=co)
        obj = bpy.context.object
        obj.name = name
        obj.data.materials.append(material)
        bpy.ops.object.shade_smooth()
        parts.append(obj)
        return obj

    eye_mat = make_material("Eye", rgb("#4A3424"), 0.18, 0.45)
    pupil_mat = make_material("Pupil", rgb("#1A120E"), 0.25, 0.2)
    catch_mat = make_material("Catchlight", rgb("#FFFFFF"), 0.05, 0.8)
    nose_mat = make_material("Nose", rgb("#241C18"), 0.32, 0.55)

    for sign, side in ((1.0, "L"), (-1.0, "R")):
        center = Vector((sign * 0.033, -0.098, 0.342))
        sphere(f"Eye{side}", center, 0.0152, eye_mat)
        pupil_co = center + Vector((0.0, -0.0095, -0.001))
        sphere(f"Pupil{side}", pupil_co, 0.0072, pupil_mat)
        catch = center + Vector((sign * -0.004, -0.011, 0.006))
        sphere(f"Catch{side}", catch, 0.0028, catch_mat)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1.0, location=(0.0, -0.118, 0.312))
    nose = bpy.context.object
    nose.name = "Nose"
    nose.scale = (0.014, 0.010, 0.010)
    bpy.ops.object.transform_apply(scale=True)
    nose.data.materials.append(nose_mat)
    bpy.ops.object.shade_smooth()
    parts.append(nose)
    return parts


def bone_spec():
    paw_l = PAWS["front_left"]
    paw_r = PAWS["front_right"]
    hind_l = PAWS["back_left"]
    hind_r = PAWS["back_right"]
    return [
        ("root", None, (0.0, 0.0, 0.02), (0.0, 0.0, 0.10)),
        ("spine", "root", (0.0, 0.07, 0.185), (0.0, -0.01, 0.20)),
        ("chest", "spine", (0.0, -0.01, 0.20), (0.0, -0.035, 0.225)),
        ("neck", "chest", (0.0, -0.03, 0.245), (0.0, -0.02, 0.305)),
        ("head", "neck", (0.0, -0.015, 0.315), (0.0, -0.03, 0.40)),
        ("ear_left", "head", (0.055, -0.006, 0.392), (0.092, -0.016, 0.305)),
        ("ear_right", "head", (-0.055, -0.006, 0.392), (-0.092, -0.016, 0.305)),
        ("tail_1", "spine", (0.0, 0.125, 0.20), (0.012, 0.165, 0.196)),
        ("tail_2", "tail_1", (0.012, 0.165, 0.196), (0.026, 0.205, 0.180)),
        ("tail_3", "tail_2", (0.026, 0.205, 0.180), (0.036, 0.248, 0.158)),
        ("front_left_shoulder", "chest", (0.046, -0.04, 0.195), (0.056, -0.072, 0.105)),
        ("front_left_elbow", "front_left_shoulder", (0.056, -0.072, 0.105), (paw_l.x, paw_l.y, 0.040)),
        ("front_left_paw", "front_left_elbow", (paw_l.x, paw_l.y, 0.040), (paw_l.x, paw_l.y - 0.004, 0.010)),
        ("front_right_shoulder", "chest", (-0.046, -0.04, 0.195), (-0.056, -0.072, 0.105)),
        ("front_right_elbow", "front_right_shoulder", (-0.056, -0.072, 0.105), (paw_r.x, paw_r.y, 0.040)),
        ("front_right_paw", "front_right_elbow", (paw_r.x, paw_r.y, 0.040), (paw_r.x, paw_r.y - 0.004, 0.010)),
        ("back_left_hip", "spine", (0.040, 0.075, 0.195), (0.050, 0.102, 0.100)),
        ("back_left_knee", "back_left_hip", (0.050, 0.102, 0.100), (hind_l.x, hind_l.y + 0.006, 0.038)),
        ("back_left_paw", "back_left_knee", (hind_l.x, hind_l.y + 0.006, 0.038), (hind_l.x, hind_l.y, 0.010)),
        ("back_right_hip", "spine", (-0.040, 0.075, 0.195), (-0.050, 0.102, 0.100)),
        ("back_right_knee", "back_right_hip", (-0.050, 0.102, 0.100), (hind_r.x, hind_r.y + 0.006, 0.038)),
        ("back_right_paw", "back_right_knee", (hind_r.x, hind_r.y + 0.006, 0.038), (hind_r.x, hind_r.y, 0.010)),
    ]


def build_armature():
    arm = bpy.data.armatures.new("MikoArmature")
    obj = bpy.data.objects.new("Miko", arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name, parent, head, tail in bone_spec():
        bone = arm.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.use_deform = name != "root"
        if parent:
            bone.parent = edit[parent]
            bone.use_connect = False
        edit[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


LEG_BONES = [
    "front_left_shoulder",
    "front_left_elbow",
    "front_left_paw",
    "front_right_shoulder",
    "front_right_elbow",
    "front_right_paw",
    "back_left_hip",
    "back_left_knee",
    "back_left_paw",
    "back_right_hip",
    "back_right_knee",
    "back_right_paw",
]


def bind(body, arm):
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.ops.object.mode_set(mode="OBJECT")
    cleanup_weights(body)
    boost_region_weights(body)


def vertex_weight(group, index):
    for item in group.weight(index) if False else []:
        pass
    try:
        return group.weight(index)
    except RuntimeError:
        return 0.0


def cleanup_weights(body):
    groups = {group.name: group for group in body.vertex_groups}
    torso = ["spine", "chest", "neck", "head"]
    for vertex in body.data.vertices:
        co = vertex.co
        # Keep the chest and head from being pulled apart by the legs.
        if abs(co.x) < 0.034 and co.z > 0.13 and -0.02 < co.y < 0.12:
            for name in LEG_BONES:
                group = groups.get(name)
                if group and vertex_weight(group, vertex.index) > 0.0:
                    group.remove([vertex.index])
        # Paws and lower legs stay with the leg, not the spine.
        if co.z < 0.07 and abs(co.x) > 0.03:
            for name in torso + ["tail_1", "tail_2", "tail_3"]:
                group = groups.get(name)
                if group and vertex_weight(group, vertex.index) > 0.0:
                    group.remove([vertex.index])
    normalize_groups(body)


def boost_region_weights(body):
    groups = {group.name: group for group in body.vertex_groups}

    def near_segment(co, a, b, radius):
        ab = b - a
        length_sq = ab.length_squared
        if length_sq == 0.0:
            return (co - a).length <= radius
        t = max(0.0, min(1.0, (co - a).dot(ab) / length_sq))
        closest = a + ab * t
        return (co - closest).length <= radius

    regions = {
        "ear_left": (Vector((0.055, -0.006, 0.392)), Vector((0.094, -0.018, 0.298)), 0.034),
        "ear_right": (Vector((-0.055, -0.006, 0.392)), Vector((-0.094, -0.018, 0.298)), 0.034),
        "tail_1": (Vector((0.0, 0.125, 0.20)), Vector((0.014, 0.17, 0.195)), 0.04),
        "tail_2": (Vector((0.014, 0.17, 0.195)), Vector((0.028, 0.21, 0.178)), 0.034),
        "tail_3": (Vector((0.028, 0.21, 0.178)), Vector((0.038, 0.255, 0.154)), 0.028),
    }
    for name, (a, b, radius) in regions.items():
        group = groups.get(name)
        if group is None:
            continue
        for vertex in body.data.vertices:
            if not near_segment(vertex.co, a, b, radius):
                continue
            if name.startswith("ear") and abs(vertex.co.x) < 0.045:
                continue
            group.add([vertex.index], 0.9, "REPLACE")
    normalize_groups(body)


def normalize_groups(body):
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def parent_keep(obj, arm, bone_name):
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    bpy.context.view_layer.update()
    obj.matrix_world = world


def measure(body, parts):
    points = [body.matrix_world @ vertex.co for vertex in body.data.vertices]
    for part in parts:
        points.extend(part.matrix_world @ Vector(corner) for corner in part.bound_box)
    xs = [point.x for point in points]
    ys = [point.y for point in points]
    zs = [point.z for point in points]
    withers = max((point.z for point in points if abs(point.x) < 0.02 and 0.04 < point.y < 0.10), default=0.0)
    print(
        "BBOX",
        f"x {min(xs):.3f}..{max(xs):.3f}",
        f"y {min(ys):.3f}..{max(ys):.3f}",
        f"z {min(zs):.3f}..{max(zs):.3f}",
    )
    print(f"WITHERS {withers:.3f}  VERTS {len(body.data.vertices)}  FACES {len(body.data.polygons)}")
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def bake_fur_texture(body):
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.03)
    bpy.ops.object.mode_set(mode="OBJECT")

    image = bpy.data.images.new("miko_fur", 1024, 1024, alpha=False)
    image.filepath = os.path.join(TEX_DIR, "miko_fur.png")
    material = body.data.materials[0]
    nodes = material.node_tree.nodes
    tex = nodes.new("ShaderNodeTexImage")
    tex.name = "FurBake"
    tex.image = image
    tex.select = True
    nodes.active = tex

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    bpy.ops.object.bake(type="DIFFUSE")
    image.file_format = "PNG"
    image.save()

    # The exported material uses the baked image. Vertex paint remains in the blend.
    bsdf = nodes.get("Principled BSDF")
    material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    print("BAKED", image.filepath)


def studio(bounds_min, bounds_max):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 48
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.78, 0.76, 0.73, 1.0)
    background.inputs[1].default_value = 0.55

    def light(name, location, energy, size, color):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        data.color = color
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        direction = Vector((0.0, 0.02, 0.22)) - Vector(location)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return obj

    light("Key", (-0.45, -0.85, 0.62), 14, 0.7, (1.0, 0.95, 0.88))
    light("Fill", (0.7, -0.4, 0.35), 7, 0.9, (0.88, 0.92, 1.0))
    light("Rim", (0.15, 0.75, 0.48), 6, 0.45, (1.0, 0.94, 0.86))

    center = Vector((
        (bounds_min[0] + bounds_max[0]) * 0.5,
        (bounds_min[1] + bounds_max[1]) * 0.5,
        (bounds_min[2] + bounds_max[2]) * 0.46,
    ))
    line = bpy.data.curves.new("GroundLine", "CURVE")
    line.dimensions = "3D"
    spline = line.splines.new("POLY")
    spline.points.add(1)
    spline.points[0].co = (bounds_min[0] - 0.04, center.y, 0.0, 1.0)
    spline.points[1].co = (bounds_max[0] + 0.04, center.y, 0.0, 1.0)
    line.bevel_depth = 0.0011
    line_obj = bpy.data.objects.new("GroundLine", line)
    bpy.context.scene.collection.objects.link(line_obj)
    line_mat = make_material("GroundLineMat", (0.45, 0.43, 0.40, 1.0), 1.0, 0.0)
    line_obj.data.materials.append(line_mat)
    return center


def new_camera(name, location, target, ortho, scale):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if ortho:
        data.type = "ORTHO"
        data.ortho_scale = scale
    else:
        data.type = "PERSP"
        data.lens = 85
    bpy.context.scene.camera = obj
    return obj


def render_to(path, width, height):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDER", path)


def frame_scale(bounds_min, bounds_max, horizontal, vertical, pixel_aspect):
    span_h = horizontal * 1.34
    span_v = vertical * 1.34
    if pixel_aspect >= 1.0:
        return max(span_h, span_v * pixel_aspect)
    return max(span_v, span_h / pixel_aspect)


def render_stills(center, bounds_min, bounds_max):
    height = bounds_max[2] - bounds_min[2]
    length = bounds_max[1] - bounds_min[1]
    width = bounds_max[0] - bounds_min[0]
    target = (center.x, center.y, center.z + 0.01)
    side_scale = frame_scale(bounds_min, bounds_max, length, height, 1400 / 1600)
    side_loc = (center.x + 1.4, center.y, center.z)
    new_camera("Side", side_loc, target, True, side_scale)
    render_to(os.path.join(PREVIEW, "stand_side.png"), 1400, 1600)
    render_to(os.path.join(PREVIEW, "stand_side_168.png"), 168, 200)

    diagonal = math.hypot(width, length)
    three_scale = frame_scale(bounds_min, bounds_max, diagonal, height, 1400 / 1600)
    three_loc = (center.x - 1.15, center.y - 1.25, center.z + 0.22)
    new_camera("ThreeQuarter", three_loc, target, True, three_scale)
    render_to(os.path.join(PREVIEW, "stand_threequarter.png"), 1400, 1600)
    render_to(os.path.join(PREVIEW, "stand_threequarter_168.png"), 168, 200)


def leg_phase(name, time_s):
    return (time_s / CYCLE + BEAT[name]) % 1.0


def foot_offset(name, time_s):
    """Return Y offset (Blender forward is -Y), lift, and paw pitch."""
    phase = leg_phase(name, time_s)
    rest_y = PAWS[name].y
    if phase < DUTY:
        u = phase / DUTY
        y = rest_y - REACH + u * (2.0 * REACH)
        return y - rest_y, 0.0, 0.0
    u = (phase - DUTY) / SWING
    y = rest_y + REACH - u * (2.0 * REACH)
    lift = math.sin(math.pi * u) * 0.016
    pitch = math.sin(math.pi * u) * 0.35
    return y - rest_y, lift, pitch


def ensure_action(obj, name):
    obj.animation_data_create()
    action = bpy.data.actions.new(name)
    obj.animation_data.action = action
    return action


def key_quat(pb, frame):
    pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)


def key_loc(pb, frame):
    pb.keyframe_insert(data_path="location", frame=frame)


def add_ik(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    targets = {}
    poles = {}
    chains = {
        "front_left": ("front_left_elbow", Vector((0.10, -0.16, 0.08))),
        "front_right": ("front_right_elbow", Vector((-0.10, -0.16, 0.08))),
        "back_left": ("back_left_knee", Vector((0.10, 0.18, 0.08))),
        "back_right": ("back_right_knee", Vector((-0.10, 0.18, 0.08))),
    }
    for name, (bone_name, pole_co) in chains.items():
        empty = bpy.data.objects.new(f"IK_{name}", None)
        bpy.context.scene.collection.objects.link(empty)
        empty.empty_display_size = 0.02
        rest = PAWS[name].copy()
        rest.z = 0.04
        empty.location = rest
        pole = bpy.data.objects.new(f"POLE_{name}", None)
        bpy.context.scene.collection.objects.link(pole)
        pole.location = pole_co
        pose = arm.pose.bones[bone_name]
        constraint = pose.constraints.new("IK")
        constraint.target = empty
        constraint.pole_target = pole
        constraint.pole_angle = 0.0
        constraint.chain_count = 2
        constraint.use_stretch = False
        targets[name] = empty
        poles[name] = pole
    bpy.ops.object.mode_set(mode="OBJECT")
    return targets


def body_pose(time_s, idle=False):
    if idle:
        breath = math.sin(2.0 * math.pi * time_s / 3.2)
        return {
            "spine": Euler((0.015 * breath, 0.0, 0.0), "XYZ"),
            "chest": Euler((0.02 * breath, 0.0, 0.0), "XYZ"),
            "neck": Euler((-0.012 * breath, 0.0, 0.0), "XYZ"),
            "head": Euler((-0.02 * breath, 0.0, 0.0), "XYZ"),
            "ear_left": Euler((0.0, 0.04 * breath, 0.0), "XYZ"),
            "ear_right": Euler((0.0, -0.04 * breath, 0.0), "XYZ"),
            "tail_1": Euler((0.03 * breath, 0.0, 0.08 * math.sin(2.0 * math.pi * time_s / 3.2)), "XYZ"),
            "tail_2": Euler((0.04 * breath, 0.0, 0.10 * math.sin(2.0 * math.pi * time_s / 3.2 + 0.4)), "XYZ"),
            "tail_3": Euler((0.05 * breath, 0.0, 0.12 * math.sin(2.0 * math.pi * time_s / 3.2 + 0.8)), "XYZ"),
        }
    sway = math.sin(2.0 * math.pi * time_s / CYCLE)
    bob = math.sin(4.0 * math.pi * time_s / CYCLE)
    return {
        "spine": Euler((0.02 * bob, 0.0, 0.05 * sway), "XYZ"),
        "chest": Euler((0.025 * bob, 0.0, -0.04 * sway), "XYZ"),
        "neck": Euler((-0.02 * bob, 0.0, 0.02 * sway), "XYZ"),
        "head": Euler((-0.015 * bob, 0.0, 0.0), "XYZ"),
        "ear_left": Euler((0.0, 0.06 * sway, 0.08 * bob), "XYZ"),
        "ear_right": Euler((0.0, -0.06 * sway, -0.08 * bob), "XYZ"),
        "tail_1": Euler((0.04 * bob, 0.0, -0.12 * sway), "XYZ"),
        "tail_2": Euler((0.05 * bob, 0.0, -0.16 * sway), "XYZ"),
        "tail_3": Euler((0.04 * bob, 0.0, -0.18 * sway), "XYZ"),
    }


def animate(arm, targets, name, seconds, idle):
    scene = bpy.context.scene
    frames = int(round(seconds * FPS))
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pose in arm.pose.bones:
        pose.rotation_mode = "QUATERNION"
    for frame in range(1, frames + 2):
        time_s = (frame - 1) / FPS
        if frame == frames + 1:
            time_s = 0.0 if idle else 0.0
            if not idle:
                time_s = 0.0
        posed = body_pose(time_s, idle=idle)
        for bone_name, euler in posed.items():
            pose = arm.pose.bones[bone_name]
            pose.rotation_quaternion = euler.to_quaternion()
            key_quat(pose, frame)
        if idle:
            lift = 0.0032 * math.sin(2.0 * math.pi * time_s / 3.2)
        else:
            lift = 0.003 * (0.5 - 0.5 * math.cos(4.0 * math.pi * time_s / CYCLE))
        spine = arm.pose.bones["spine"]
        spine.location = (0.0, 0.0, lift)
        key_loc(spine, frame)
        for foot_name, empty in targets.items():
            if idle:
                empty.location = Vector((PAWS[foot_name].x, PAWS[foot_name].y, 0.04))
                pitch = 0.0
            else:
                dy, foot_lift, pitch = foot_offset(foot_name, time_s)
                empty.location = Vector((PAWS[foot_name].x, PAWS[foot_name].y + dy, 0.04 + foot_lift))
            empty.keyframe_insert(data_path="location", frame=frame)
            paw = arm.pose.bones[f"{foot_name}_paw"]
            paw.rotation_quaternion = Euler((pitch, 0.0, 0.0), "XYZ").to_quaternion()
            key_quat(paw, frame)
        scene.frame_set(frame)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_visual(arm, name, frames):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pose in arm.pose.bones:
        pose.bone.select = True
        pose.rotation_mode = "QUATERNION"
    action = bpy.data.actions.new(name)
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    bpy.ops.nla.bake(
        frame_start=1,
        frame_end=frames + 1,
        step=1,
        only_selected=True,
        visual_keying=True,
        clear_constraints=True,
        clear_parents=False,
        use_current_action=True,
        bake_types={"POSE"},
    )
    baked = arm.animation_data.action
    baked.name = name
    # Frame 1 and the frame after the last sample are the same pose.
    # Dropping the duplicate end sample keeps the loop one cycle long.
    baked.frame_range = (1, frames + 1)
    bpy.ops.object.mode_set(mode="OBJECT")
    return baked


def play(arm, action):
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    arm.data.pose_position = "POSE"


def export_glb(arm, body, parts):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    body.select_set(True)
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = arm
    path = os.path.join(ROOT, "miko-puppy.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_materials="EXPORT",
    )
    print("GLB", path)


def save_blend():
    path = os.path.join(SOURCE, "miko-puppy.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print("BLEND", path)


def render_clip(center, camera_name, location, ortho, scale, action, frames, outfile, hold):
    new_camera(camera_name, location, center, ortho, scale)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = frames
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.fps = FPS
    scene.render.filepath = outfile
    if hold == 1:
        bpy.ops.render.render(animation=True)
    else:
        frames_dir = outfile + "_frames"
        os.makedirs(frames_dir, exist_ok=True)
        scene.render.image_settings.file_format = "PNG"
        for frame in range(1, frames + 1):
            scene.frame_set(frame)
            scene.render.filepath = os.path.join(frames_dir, f"{frame:04d}.png")
            bpy.ops.render.render(write_still=True)
        scene.frame_start = 1
        scene.frame_end = frames * hold
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.filepath = outfile
        # Held frames are assembled by repeating each still in a second pass below.
    print("CLIP", outfile, "hold", hold)


def main():
    mode = "stills"
    args = argv_after_double_dash()
    if args:
        mode = args[0]
    reset_scene()
    body = build_body()
    sculpt_surface(body)
    paint_vertex_colors(body)
    assign_fur_material(body)
    parts = add_face(bpy.context.scene.collection)
    bounds_min, bounds_max = measure(body, parts)
    arm = build_armature()
    bind(body, arm)
    for part in parts:
        parent_keep(part, arm, "head")
    center = studio(bounds_min, bounds_max)

    if mode == "stills":
        arm.data.pose_position = "REST"
        render_stills(center, bounds_min, bounds_max)
        save_blend()
        return

    targets = add_ik(arm)
    animate(arm, targets, "WalkControls", CYCLE, idle=False)
    walk = bake_visual(arm, "Walk", int(CYCLE * FPS))
    # Baking cleared the IK constraints. Add them again for Idle.
    targets = add_ik(arm)
    animate(arm, targets, "IdleControls", 3.2, idle=True)
    idle = bake_visual(arm, "Idle", int(3.2 * FPS))
    play(arm, walk)
    save_blend()
    export_glb(arm, body, parts)
    print("ACTIONS", walk.name, idle.name)


if __name__ == "__main__":
    main()
