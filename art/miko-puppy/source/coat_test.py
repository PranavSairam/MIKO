# Appearance test on a copy of Rev 4. No rig, no animation.
# The finish is mesh geometry plus vertex color on a matte material:
# the same thing Three.js MeshStandardMaterial can render
# (vertexColors, roughness, metalness 0). No hair and no Blender-only shader.

import math
import os

import bmesh
import bpy
from mathutils import Vector

ROOT = "/Users/sairampranav/PET_BOT/art/miko-puppy"
PREVIEW = os.path.join(ROOT, "preview", "coat")
SOURCE = os.path.join(ROOT, "source")
REV4 = os.path.join(SOURCE, "miko-puppy-rev4.blend")
COAT = os.path.join(SOURCE, "miko-puppy-rev4-coat.blend")

EYES = (Vector((0.032, -0.098, 0.324)), Vector((-0.032, -0.098, 0.324)))


def srgb(channel):
    channel = channel / 255.0
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return Vector(tuple(srgb(int(hex_color[i : i + 2], 16)) for i in (0, 2, 4)))


CREAM = rgb("#E6C29C")
EAR = rgb("#D09268")
MUZZLE = rgb("#F2DCC6")
CHEST = rgb("#F4E3D0")


def smoothstep(edge0, edge1, value):
    if edge1 == edge0:
        return 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def set_input(node, names, value):
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return


def mix(a, b, t):
    return a * (1.0 - t) + b * t


def coat_rgb(co, ear=False):
    color = CREAM.copy()
    if ear:
        color = mix(CREAM, EAR, 0.85)
        # The root, where the ear leaves the head, eases back toward the cream.
        color = mix(color, CREAM, smoothstep(0.30, 0.35, co.z) * 0.35)
        return color
    muzzle = smoothstep(-0.078, -0.108, co.y) * smoothstep(0.268, 0.300, co.z)
    muzzle *= smoothstep(0.05, 0.018, abs(co.x))
    # Bib on the chest only. Keep the neck the same cream so it does not outline the join.
    chest = smoothstep(0.195, 0.13, co.z) * smoothstep(0.07, 0.12, co.z)
    chest *= smoothstep(0.04, -0.02, co.y) * smoothstep(0.06, 0.025, abs(co.x))
    color = mix(color, MUZZLE, muzzle)
    color = mix(color, CHEST, chest)
    return color


def apply_modifier(obj, modifier):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def make_runtime_material():
    material = bpy.data.materials.new("CoatRuntime")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, ["Roughness"], 0.94)
    set_input(bsdf, ["Metallic"], 0.0)
    set_input(bsdf, ["Specular IOR Level", "Specular"], 0.04)
    set_input(bsdf, ["Coat Weight", "Coat"], 0.0)
    set_input(bsdf, ["Sheen Weight", "Sheen"], 0.0)
    color_node = material.node_tree.nodes.new("ShaderNodeVertexColor")
    color_node.layer_name = "Color"
    material.node_tree.links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])
    return material


def write_colors(obj, ear=False):
    mesh = obj.data
    existing = mesh.color_attributes.get("Color")
    if existing is not None:
        mesh.color_attributes.remove(existing)
    attribute = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="POINT")
    for index, vert in enumerate(mesh.vertices):
        color = coat_rgb(vert.co, ear=ear)
        attribute.data[index].color = (color.x, color.y, color.z, 1.0)


def paw_min(obj):
    lows = [vert.co.z for vert in obj.data.vertices if vert.co.z < 0.04]
    return min(lows) if lows else None


def is_jaw(co):
    return 0.225 < co.z < 0.305 and -0.07 < co.y < 0.03 and abs(co.x) < 0.09


def is_brow(co):
    for eye in EYES:
        delta = co - eye
        flat = math.sqrt(delta.x * delta.x + delta.z * delta.z)
        if 0.009 < flat < 0.030 and delta.z > 0.001 and co.y < -0.05:
            return True
    return False


def soften_finish(obj):
    before = paw_min(obj)
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    pinned = {}
    for edge in bm.edges:
        if not edge.is_boundary:
            continue
        for vert in edge.verts:
            for eye in EYES:
                if (vert.co - eye).length < 0.028:
                    pinned[vert] = vert.co.copy()
    for vert in bm.verts:
        co = vert.co
        if co.z < 0.215:
            pinned[vert] = co.copy()
        elif co.y < -0.098 and co.z > 0.275 and abs(co.x) < 0.045:
            pinned[vert] = co.copy()

    def relax(predicate, iterations, factor):
        for _ in range(iterations):
            moves = []
            for vert in bm.verts:
                if vert in pinned or not predicate(vert.co) or not vert.link_edges:
                    continue
                average = Vector()
                for edge in vert.link_edges:
                    average += edge.other_vert(vert).co
                average /= len(vert.link_edges)
                moves.append((vert, vert.co.lerp(average, factor)))
            for vert, co in moves:
                vert.co = co

    relax(is_jaw, 28, 0.7)
    relax(is_brow, 12, 0.4)
    for vert, co in pinned.items():
        if vert.is_valid:
            vert.co = co
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    after = paw_min(obj)
    print("PAWS", before, "->", after, "PINNED", len(pinned))


def pick_samples(obj, score_fn, predicate, spacing, limit):
    ranked = sorted(obj.data.vertices, key=score_fn, reverse=True)
    chosen = []
    for vert in ranked:
        if not predicate(vert):
            continue
        if any((vert.co - item[0]).length < spacing for item in chosen):
            continue
        normal = vert.normal.normalized()
        if normal.length < 0.5:
            continue
        chosen.append((vert.co.copy(), normal.copy()))
        if len(chosen) >= limit:
            break
    return chosen


def flow_tangent(normal, direction):
    tangent = direction - normal * direction.dot(normal)
    if tangent.length < 1e-5:
        tangent = normal.cross(Vector((0.0, 0.0, 1.0)))
    tangent.normalize()
    return tangent


def append_ribbon(bm, colors, origin, normal, tangent, length, width, lift, color):
    across = normal.cross(tangent).normalized()
    rows, cols = 6, 3
    grid = []
    for i in range(rows):
        t = i / (rows - 1)
        envelope = math.sin(t * math.pi)
        along = (t - 0.2) * length
        rise = 0.0012 + lift * envelope
        line = []
        for j in range(cols):
            u = (j / (cols - 1) - 0.5) * width * (0.4 + 0.6 * envelope)
            point = origin + tangent * along + across * u + normal * rise
            vert = bm.verts.new(point)
            line.append(vert)
            colors.append(color)
        grid.append(line)
    for i in range(rows - 1):
        for j in range(cols - 1):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))


def clump(co, seeds, flow, along, across):
    weight = 0.0
    direction = flow.normalized()
    for seed in seeds:
        delta = co - seed
        forward = delta.dot(direction)
        side = (delta - direction * forward).length
        weight = max(
            weight,
            math.exp(-(forward * forward) / (2.0 * along * along) - (side * side) / (2.0 * across * across)),
        )
    return weight


def protected(co):
    if co.z < 0.23:
        return True
    for eye in EYES:
        if (co - eye).length < 0.015:
            return True
    if co.y < -0.102 and abs(co.x) < 0.035 and co.z > 0.28:
        return True
    return False


def displace_surface(obj, groups):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    moved = 0
    peak = 0.0
    for vert in bm.verts:
        if protected(vert.co):
            continue
        amount = 0.0
        for seeds, flow, along, across, amplitude, mask in groups:
            if not mask(vert.co):
                continue
            amount += amplitude * clump(vert.co, seeds, flow, along, across)
        if amount <= 0.0:
            continue
        vert.co += vert.normal * amount
        moved += 1
        peak = max(peak, amount)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    print(obj.name, "FUR MOVED", moved, "PEAK", round(peak, 4))


def coat_groups(body, ears):
    crown = [
        co
        for co, _normal in pick_samples(
            body,
            lambda vert: vert.co.z,
            lambda vert: vert.co.z > 0.375 and vert.normal.z > 0.25 and vert.normal.y > -0.4,
            0.022,
            8,
        )
    ]
    brow_sets = []
    cheek_sets = []
    for eye in EYES:
        found = [
            co
            for co, _normal in pick_samples(
                body,
                lambda vert, eye=eye: -abs(vert.co.x - eye.x),
                lambda vert, eye=eye: abs(vert.co.x - eye.x) < 0.022
                and 0.006 < vert.co.z - eye.z < 0.020
                and vert.co.y < -0.07,
                0.008,
                5,
            )
        ]
        if found:
            brow_sets.append((found, math.copysign(1.0, eye.x)))
    for sign in (1.0, -1.0):
        found = [
            co
            for co, _normal in pick_samples(
                body,
                lambda vert, sign=sign: sign * vert.co.x,
                lambda vert, sign=sign: sign * vert.co.x > 0.048 and 0.30 < vert.co.z < 0.345 and -0.07 < vert.co.y < -0.02,
                0.012,
                4,
            )
        ]
        if found:
            cheek_sets.append((found, sign))
    ear_edges = []
    for ear in ears:
        ear_edges.extend(
            co
            for co, _normal in pick_samples(
                ear,
                lambda vert: abs(vert.co.x),
                lambda vert: abs(vert.co.x) > 0.078 and vert.co.z < 0.34,
                0.018,
                10,
            )
        )
    print("SEEDS", len(crown), sum(len(item[0]) for item in brow_sets), sum(len(item[0]) for item in cheek_sets), len(ear_edges))
    body_groups = []
    if crown:
        body_groups.append(
            (crown, Vector((0.15, 1.0, -0.25)), 0.024, 0.009, 0.011, lambda co: co.z > 0.368 and co.y > -0.05)
        )
    for seeds, sign in brow_sets:
        body_groups.append(
            (seeds, Vector((sign, -0.15, -0.1)), 0.012, 0.006, 0.0018, lambda co: co.z > 0.31 and co.y < -0.06)
        )
    for seeds, sign in cheek_sets:
        body_groups.append(
            (seeds, Vector((sign, -0.2, -0.15)), 0.014, 0.007, 0.0024, lambda co, sign=sign: sign * co.x > 0.04 and co.z > 0.28)
        )
    ear_groups = []
    if ear_edges:
        ear_groups.append(
            (ear_edges, Vector((0.15, -0.05, -1.0)), 0.020, 0.007, 0.010, lambda co: abs(co.x) > 0.07)
        )
    return body_groups, ear_groups


def assign_coat(material, objects):
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(material)


def studio(background, strength):
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 48
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("Studio")
        scene.world = world
    world.use_nodes = True
    node = world.node_tree.nodes.get("Background")
    if node is None:
        world.node_tree.nodes.clear()
        node = world.node_tree.nodes.new("ShaderNodeBackground")
        output = world.node_tree.nodes.new("ShaderNodeOutputWorld")
        world.node_tree.links.new(node.outputs["Background"], output.inputs["Surface"])
    node.inputs[0].default_value = (background, background, background, 1.0)
    node.inputs[1].default_value = strength

    def light(name, location, energy, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        data.color = (1.0, 0.985, 0.96)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        direction = Vector((0.0, -0.02, 0.28)) - Vector(location)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    light("Key", (-0.5, -0.95, 0.7), 7.0, 1.3)
    light("Fill", (0.75, -0.6, 0.42), 4.2, 1.6)
    light("Top", (0.0, -0.1, 0.9), 2.2, 1.2)


def look_camera(name, location, target, scale, vertical=False):
    data = bpy.data.cameras.new(name)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    data.type = "ORTHO"
    data.ortho_scale = scale
    if vertical:
        data.sensor_fit = "VERTICAL"
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


def hide_for_render():
    keep = ("MikoBody", "EarL", "EarR", "Iris", "Pupil", "Catch", "Nose", "CoatFur")
    for obj in bpy.data.objects:
        if obj.type in {"LIGHT", "CAMERA"}:
            obj.hide_render = False
        else:
            obj.hide_render = not obj.name.startswith(keep)


def puppy_points():
    points = []
    for name in ("MikoBody", "EarL", "EarR", "Nose", "CoatFur"):
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        points.extend(vert.co.copy() for vert in obj.data.vertices)
    return points


def frame_desktop(points):
    center = Vector((0.0, 0.04, 0.17))
    location = Vector((-0.78, -1.15, 0.24))
    camera = look_camera("Desktop", location, center, 1.0, vertical=True)
    bpy.context.view_layer.update()
    matrix = camera.matrix_world.inverted()
    xs = []
    ys = []
    for point in points:
        local = matrix @ point
        xs.append(local.x)
        ys.append(local.y)
    width = max(xs) - min(xs)
    height = max(ys) - min(ys)
    # 168×200 is portrait. Vertical sensor fit makes ortho_scale the frame height.
    scale = max(height, width * (200.0 / 168.0)) * 1.08
    camera.data.ortho_scale = scale
    print("DESKTOP SCALE", round(scale, 3), "SPAN", round(width, 3), round(height, 3))
    return camera


def main():
    os.makedirs(PREVIEW, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=REV4)
    studio(0.58, 0.42)
    hide_for_render()
    look_camera("Front", (0.0, -0.78, 0.328), (0.0, -0.03, 0.328), 0.32)
    render_to(os.path.join(PREVIEW, "rev4_front.png"), 1000, 1000)

    body = bpy.data.objects["MikoBody"]
    ears = [bpy.data.objects["EarL"], bpy.data.objects["EarR"]]
    soften_finish(body)
    material = make_runtime_material()
    write_colors(body, ear=False)
    for ear in ears:
        write_colors(ear, ear=True)
    body_groups, ear_groups = coat_groups(body, ears)
    displace_surface(body, body_groups)
    for ear in ears:
        displace_surface(ear, ear_groups)
    assign_coat(material, [body, *ears])

    hide_for_render()
    look_camera("Front", (0.0, -0.78, 0.328), (0.0, -0.03, 0.328), 0.32)
    render_to(os.path.join(PREVIEW, "coat_front.png"), 1000, 1000)

    points = puppy_points()
    frame_desktop(points)
    studio(0.93, 0.55)
    render_to(os.path.join(PREVIEW, "full_light.png"), 168, 200)
    studio(0.16, 0.22)
    render_to(os.path.join(PREVIEW, "full_dark.png"), 168, 200)

    bpy.ops.wm.save_as_mainfile(filepath=COAT)
    print("BLEND", COAT)


if __name__ == "__main__":
    main()
