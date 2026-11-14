# MIKO rev 2. Face and anatomy only. No armature and no animation.
# Blender Z-up, puppy faces -Y. Origin on the ground between the paws.

import math
import os

import bmesh
import bpy
from mathutils import Vector

ROOT = "/Users/sairampranav/PET_BOT/art/miko-puppy"
PREVIEW = os.path.join(ROOT, "preview", "rev2")
SOURCE = os.path.join(ROOT, "source")
REV1 = os.path.join(SOURCE, "miko-puppy-rev1.blend")
REV2 = os.path.join(SOURCE, "miko-puppy-rev2.blend")

# Front paws sit under the shoulders. Hind paws sit forward of the hock.
PAWS = {
    "front_left": Vector((0.050, -0.040, 0.0)),
    "front_right": Vector((-0.050, -0.040, 0.0)),
    "back_left": Vector((0.046, 0.072, 0.0)),
    "back_right": Vector((-0.046, 0.072, 0.0)),
}
EYES = (
    Vector((0.030, -0.093, 0.318)),
    Vector((-0.030, -0.093, 0.318)),
)

# Shared cameras so the rev 1 and rev 2 plates match.
SIDE_LOC = (1.35, 0.03, 0.18)
SIDE_TARGET = (0.0, 0.03, 0.18)
SIDE_SCALE = 0.56
THREE_LOC = (-0.72, -0.95, 0.30)
THREE_TARGET = (0.0, -0.01, 0.18)
THREE_SCALE = 0.58


def srgb(channel):
    c = channel / 255.0
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    values = [srgb(int(hex_color[i : i + 2], 16)) for i in (0, 2, 4)]
    return (values[0], values[1], values[2], 1.0)


def smoothstep(edge0, edge1, value):
    if edge1 == edge0:
        return 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = 30
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"


def set_input(node, names, value):
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return


def make_material(name, color, roughness, specular=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    set_input(bsdf, ["Roughness"], roughness)
    set_input(bsdf, ["Specular IOR Level", "Specular"], specular)
    set_input(bsdf, ["Coat Weight", "Coat"], 0.0)
    set_input(bsdf, ["Sheen Weight", "Sheen"], 0.0)
    return material


def add_sphere(co, radius, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=radius, location=co)
    obj = bpy.context.object
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return obj


def build_body():
    parts = []

    def ball(co, radius, scale=(1.0, 1.0, 1.0)):
        parts.append(add_sphere(co, radius, scale))

    def capsule(start, end, radius_start, radius_end):
        start = Vector(start)
        end = Vector(end)
        step = min(radius_start, radius_end) * 0.4
        count = max(3, int((end - start).length / step))
        for i in range(count + 1):
            t = i / count
            radius = radius_start * (1.0 - t) + radius_end * t
            ball(tuple(start.lerp(end, t)), radius)

    # Head sits lower. Cheeks are round and the muzzle is short.
    ball((0.0, -0.045, 0.312), 0.060, (1.14, 1.0, 0.96))
    ball((0.0, -0.05, 0.358), 0.034, (1.05, 0.9, 0.78))
    ball((0.040, -0.072, 0.292), 0.026)
    ball((-0.040, -0.072, 0.292), 0.026)
    ball((0.0, -0.090, 0.300), 0.024, (0.95, 0.8, 0.72))
    ball((0.0, -0.064, 0.280), 0.024)

    # Throat fills the gap under the jaw so the neck is not a stalk.
    ball((0.0, -0.04, 0.255), 0.046, (1.15, 1.05, 0.85))
    ball((0.0, -0.02, 0.228), 0.050, (1.2, 1.1, 0.8))

    # Floppy ears. Broad enough to frame the cheeks, with a soft folded tip.
    for sign in (1.0, -1.0):
        ball((sign * 0.058, -0.03, 0.340), 0.026, (0.55, 0.42, 1.05))
        ball((sign * 0.078, -0.038, 0.312), 0.024, (0.5, 0.4, 1.15))
        ball((sign * 0.086, -0.046, 0.280), 0.020, (0.48, 0.38, 1.1))
        ball((sign * 0.078, -0.054, 0.258), 0.014, (0.45, 0.36, 0.9))

    # Compact torso. Withers stay near 0.25 m.
    ball((0.0, 0.0, 0.195), 0.070, (1.22, 1.28, 0.84))
    ball((0.0, 0.065, 0.188), 0.056, (1.1, 1.2, 0.8))
    ball((0.0, 0.118, 0.190), 0.060, (1.08, 1.0, 0.92))
    ball((0.0, 0.02, 0.145), 0.048, (1.15, 1.25, 0.7))

    for name in ("front_left", "front_right"):
        paw = PAWS[name]
        sign = 1.0 if paw.x > 0 else -1.0
        # Forearm drops almost straight down under the shoulder.
        capsule((sign * 0.040, -0.012, 0.162), (sign * 0.048, -0.026, 0.085), 0.046, 0.032)
        capsule((sign * 0.048, -0.026, 0.085), (paw.x, paw.y, 0.028), 0.032, 0.028)
        ball((paw.x, paw.y, 0.016), 0.032, (1.15, 1.05, 0.48))
        for toe in (-0.012, 0.0, 0.012):
            ball((paw.x + toe, paw.y - 0.018, 0.012), 0.011)

    for name in ("back_left", "back_right"):
        paw = PAWS[name]
        sign = 1.0 if paw.x > 0 else -1.0
        # Full thigh, hock set back, short lower leg to the paw.
        capsule((sign * 0.034, 0.095, 0.168), (sign * 0.050, 0.122, 0.078), 0.050, 0.032)
        capsule((sign * 0.050, 0.122, 0.078), (sign * 0.054, 0.132, 0.042), 0.028, 0.020)
        capsule((sign * 0.054, 0.132, 0.042), (paw.x, paw.y, 0.020), 0.020, 0.026)
        ball((paw.x, paw.y, 0.014), 0.030, (1.12, 1.15, 0.46))
        for toe in (-0.011, 0.0, 0.011):
            ball((paw.x + toe, paw.y - 0.016, 0.011), 0.010)

    capsule((0.0, 0.155, 0.182), (0.01, 0.195, 0.155), 0.042, 0.034)
    capsule((0.01, 0.195, 0.155), (0.016, 0.232, 0.118), 0.032, 0.020)

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


def sculpt(obj):
    remesh = obj.modifiers.new("Remesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = 0.0046
    remesh.use_smooth_shade = True
    apply_modifier(obj, remesh)

    smooth = obj.modifiers.new("Smooth", "SMOOTH")
    smooth.iterations = 3
    smooth.factor = 0.35
    apply_modifier(obj, smooth)

    for vertex in obj.data.vertices:
        co = vertex.co
        for eye in EYES:
            delta = co - eye
            distance = delta.length
            if distance < 0.013:
                falloff = 1.0 - distance / 0.013
                co.y += 0.0032 * falloff
            elif distance < 0.020:
                falloff = 1.0 - (distance - 0.013) / 0.007
                co.y -= 0.0016 * falloff
            if abs(co.x - eye.x) < 0.014 and eye.z + 0.006 < co.z < eye.z + 0.014 and co.y < -0.07:
                lid = 1.0 - abs(co.z - (eye.z + 0.009)) / 0.006
                co.z -= 0.002 * max(lid, 0.0)
            if abs(co.x - eye.x) < 0.012 and eye.z - 0.012 < co.z < eye.z - 0.005 and co.y < -0.07:
                low = 1.0 - abs(co.z - (eye.z - 0.008)) / 0.004
                co.z += 0.0012 * max(low, 0.0)
        mouth = Vector((0.0, -0.102, 0.284))
        gap = (co - mouth).length
        if gap < 0.016 and abs(co.z - mouth.z) < 0.0045:
            co.y += 0.004 * (1.0 - gap / 0.016)
    smooth_ears(obj)
    bpy.ops.object.shade_smooth()
    obj.data.update()
    toe_bumps(obj)
    flatten_soles(obj)
    obj.data.update()


def smooth_ears(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    flaps = [vert for vert in bm.verts if abs(vert.co.x) > 0.064 and 0.245 < vert.co.z < 0.35]
    for _ in range(4):
        updates = []
        for vert in flaps:
            neighbors = [edge.other_vert(vert).co.copy() for edge in vert.link_edges]
            if not neighbors:
                continue
            average = sum(neighbors, Vector()) / len(neighbors)
            updates.append((vert, vert.co.lerp(average, 0.45)))
        for vert, co in updates:
            vert.co = co
    bm.to_mesh(mesh)
    bm.free()


def flatten_soles(obj):
    for vertex in obj.data.vertices:
        co = vertex.co
        if co.z > 0.016:
            continue
        for paw in PAWS.values():
            flat = math.hypot(co.x - paw.x, co.y - paw.y)
            if flat > 0.036:
                continue
            edge = flat / 0.036
            # Flat sole, with the toe edge allowed to stay slightly round.
            sole = 0.0 if flat < 0.022 else (edge ** 2) * 0.008
            if co.z < sole:
                co.z = sole
            break
        if co.z < 0.0:
            co.z = 0.0


def toe_bumps(obj):
    for paw in PAWS.values():
        for toe_x in (-0.011, 0.0, 0.011):
            center = Vector((paw.x + toe_x, paw.y - 0.016, 0.012))
            for vertex in obj.data.vertices:
                distance = (vertex.co - center).length
                if distance < 0.009:
                    vertex.co += vertex.normal * (0.0035 * (1.0 - distance / 0.009))


def add_eyes(clay):
    del clay
    parts = []
    eye_mat = make_material("Eye", rgb("#3A2A1E"), 0.38, 0.1)
    catch_mat = make_material("Catchlight", rgb("#F7F4EE"), 0.5, 0.15)
    nose_mat = make_material("Nose", rgb("#2A211C"), 0.7, 0.05)

    def sphere(name, co, radius, material):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=radius, location=co)
        obj = bpy.context.object
        obj.name = name
        obj.data.materials.append(material)
        bpy.ops.object.shade_smooth()
        parts.append(obj)
        return obj

    for eye, side in zip(EYES, ("L", "R")):
        sign = 1.0 if eye.x > 0 else -1.0
        sphere(f"Eye{side}", eye, 0.0115, eye_mat)
        sphere(f"Catch{side}", eye + Vector((sign * -0.0035, -0.008, 0.0045)), 0.002, catch_mat)

    sphere("Nose", (0.0, -0.112, 0.300), 0.008, nose_mat)
    return parts


def coat_colors(obj):
    attribute = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    body = rgb("#E2B488")
    bib = rgb("#F6EBDA")
    gold = rgb("#D7A46C")
    ear = rgb("#C99258")
    mouth = rgb("#C9A07A")
    for vertex in obj.data.vertices:
        co = vertex.co
        color = [body[0], body[1], body[2]]
        bib_mask = smoothstep(0.02, -0.03, co.y) * smoothstep(0.055, 0.02, abs(co.x))
        bib_mask *= smoothstep(0.14, 0.20, co.z) * smoothstep(0.30, 0.24, co.z)
        chin = smoothstep(0.30, 0.25, co.z) * smoothstep(-0.04, -0.07, co.y) * smoothstep(0.04, 0.0, abs(co.x))
        bib_mask = max(bib_mask, chin * 0.85)
        ear_mask = smoothstep(0.07, 0.10, abs(co.x)) * smoothstep(0.25, 0.35, co.z)
        back_mask = smoothstep(0.08, 0.16, co.y) * smoothstep(0.12, 0.22, co.z)
        mouth_mask = smoothstep(0.012, 0.0, abs(co.z - 0.276)) * smoothstep(-0.085, -0.10, co.y) * smoothstep(0.02, 0.0, abs(co.x))
        for i in range(3):
            color[i] = color[i] * (1.0 - bib_mask) + bib[i] * bib_mask
            color[i] = color[i] * (1.0 - ear_mask) + ear[i] * ear_mask
            color[i] = color[i] * (1.0 - back_mask * 0.4) + gold[i] * (back_mask * 0.4)
            color[i] = color[i] * (1.0 - mouth_mask * 0.45) + mouth[i] * (mouth_mask * 0.45)
        attribute.data[vertex.index].color = (color[0], color[1], color[2], 1.0)


def assign_coat(obj):
    material = make_material("Coat", rgb("#E2B488"), 0.96, 0.0)
    nodes = material.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    color_node = nodes.new("ShaderNodeVertexColor")
    color_node.layer_name = "Col"
    material.node_tree.links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.clear()
    obj.data.materials.append(material)


def add_clumps(obj):
    centers = [
        Vector((0.0, -0.04, 0.368)),
        Vector((0.02, -0.02, 0.360)),
        Vector((-0.018, -0.03, 0.356)),
        Vector((0.048, -0.07, 0.298)),
        Vector((-0.048, -0.07, 0.298)),
        Vector((0.09, -0.045, 0.312)),
        Vector((-0.09, -0.045, 0.312)),
        Vector((0.012, 0.205, 0.150)),
        Vector((0.016, 0.225, 0.128)),
    ]
    for vertex in obj.data.vertices:
        co = vertex.co
        push = 0.0
        for center in centers:
            distance = (co - center).length
            if distance < 0.02:
                push = max(push, 0.009 * (1.0 - distance / 0.02) ** 2)
        if push:
            co += vertex.normal * push


def studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 48
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.62, 0.62, 0.62, 1.0)
    background.inputs[1].default_value = 0.55

    def light(name, location, energy, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        data.color = (1.0, 0.98, 0.96)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        direction = Vector((0.0, 0.0, 0.18)) - Vector(location)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    light("Key", (-0.35, -0.7, 0.55), 8, 0.85)
    light("Fill", (0.6, -0.35, 0.32), 4, 1.0)
    light("Top", (0.0, 0.1, 0.8), 3, 0.7)

    mesh = bpy.data.meshes.new("Ground")
    plane = bpy.data.objects.new("Ground", mesh)
    bpy.context.scene.collection.objects.link(plane)
    mesh.from_pydata(
        [(-0.22, -0.18, -0.0004), (0.22, -0.18, -0.0004), (0.22, 0.30, -0.0004), (-0.22, 0.30, -0.0004)],
        [],
        [(0, 1, 2, 3)],
    )
    plane.data.materials.append(make_material("Ground", (0.52, 0.52, 0.52, 1.0), 1.0, 0.0))


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
    return obj


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


def render_pair(prefix):
    look_camera("Side", SIDE_LOC, SIDE_TARGET, SIDE_SCALE)
    render_to(os.path.join(PREVIEW, f"{prefix}_side.png"), 1400, 1600)
    render_to(os.path.join(PREVIEW, f"{prefix}_side_168.png"), 168, 200)
    look_camera("Three", THREE_LOC, THREE_TARGET, THREE_SCALE)
    render_to(os.path.join(PREVIEW, f"{prefix}_threequarter.png"), 1400, 1600)
    render_to(os.path.join(PREVIEW, f"{prefix}_threequarter_168.png"), 168, 200)


def render_face(prefix):
    look_camera("Face", (-0.28, -0.42, 0.34), (0.0, -0.05, 0.31), 0.22)
    render_to(os.path.join(PREVIEW, f"{prefix}_face.png"), 900, 900)


def hide_helpers():
    keep_prefix = ("MikoBody", "Eye", "Pupil", "Catch", "Nose", "Lid")
    for obj in bpy.data.objects:
        if obj.name.startswith(keep_prefix):
            obj.hide_render = False
            continue
        obj.hide_render = True


def render_before():
    bpy.ops.wm.open_mainfile(filepath=REV1)
    hide_helpers()
    arm = bpy.data.objects.get("Miko")
    if arm and arm.type == "ARMATURE":
        arm.data.pose_position = "REST"
        arm.hide_render = True
    studio()
    render_pair("before")


def measure(body):
    zs = [vertex.co.z for vertex in body.data.vertices]
    withers = max(vertex.co.z for vertex in body.data.vertices if abs(vertex.co.x) < 0.02 and 0.03 < vertex.co.y < 0.09)
    paw_z = min(vertex.co.z for vertex in body.data.vertices if vertex.co.z < 0.03)
    print(f"HEIGHT {max(zs):.3f} WITHERS {withers:.3f} PAW {paw_z:.4f} VERTS {len(body.data.vertices)}")


def main():
    os.makedirs(PREVIEW, exist_ok=True)
    if not os.path.exists(os.path.join(PREVIEW, "before_side.png")):
        render_before()

    fresh_scene()
    body = build_body()
    sculpt(body)
    measure(body)
    clay = make_material("Clay", rgb("#C8B6A4"), 1.0, 0.0)
    body.data.materials.append(clay)
    lids = add_eyes(clay=True)
    studio()
    render_pair("clay")
    render_face("clay")

    add_clumps(body)
    coat_colors(body)
    assign_coat(body)
    render_pair("coat")
    render_face("coat")

    bpy.ops.wm.save_as_mainfile(filepath=REV2)
    print("BLEND", REV2)


if __name__ == "__main__":
    main()
