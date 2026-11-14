# MIKO head sculpt. Replaces only the head of the Rev 2 body.
# Blender Z-up, the puppy faces -Y. Origin stays on the ground between the paws.
# The head is one volume. Eye openings and eyelid rims are cut after the
# last remesh. Ears are a folded surface and are never voxel-remeshed.

import math
import os

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

ROOT = "/Users/sairampranav/PET_BOT/art/miko-puppy"
PREVIEW = os.path.join(ROOT, "preview", "rev4")
SOURCE = os.path.join(ROOT, "source")
REV2 = os.path.join(SOURCE, "miko-puppy-rev2.blend")
REV4 = os.path.join(SOURCE, "miko-puppy-rev4.blend")

EYE_X = 0.032
EYE_Z = 0.324
EYE_HALF_W = 0.0185
EYE_HALF_H = 0.0155


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


def set_input(node, names, value):
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return


def make_material(name, color, roughness, specular=0.0, emission=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    set_input(bsdf, ["Roughness"], roughness)
    set_input(bsdf, ["Specular IOR Level", "Specular"], specular)
    set_input(bsdf, ["Coat Weight", "Coat"], 0.0)
    set_input(bsdf, ["Sheen Weight", "Sheen"], 0.0)
    if emission:
        set_input(bsdf, ["Emission Color", "Emission"], (1.0, 1.0, 1.0, 1.0))
        set_input(bsdf, ["Emission Strength"], emission)
    return material


def apply_modifier(obj, modifier):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def shade_smooth(obj):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth()


def is_old_head(co):
    if co.z > 0.262 and co.y < 0.06:
        return True
    if co.y < -0.045 and co.z > 0.245:
        return True
    if abs(co.x) > 0.055 and co.z > 0.248 and co.y < 0.02:
        return True
    return False


def paw_span(obj):
    lows = [v.co for v in obj.data.vertices if v.co.z < 0.03]
    if not lows:
        return None
    return (
        min(v.z for v in lows),
        max(v.z for v in lows),
        min(v.x for v in lows),
        max(v.x for v in lows),
        min(v.y for v in lows),
        max(v.y for v in lows),
        len(lows),
    )


def delete_old_head(obj):
    before = paw_span(obj)
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    dead = [vert for vert in bm.verts if is_old_head(vert.co)]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    boundary = [edge for edge in bm.edges if edge.is_boundary]
    bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    print("CUT", len(dead), "paws", before, "->", paw_span(obj))


def body_snapshot(obj):
    tree = KDTree(len(obj.data.vertices))
    for index, vert in enumerate(obj.data.vertices):
        tree.insert(vert.co, index)
    tree.balance()
    return tree


def report_body_drift(tree, obj):
    worst = 0.0
    checked = 0
    for vert in obj.data.vertices:
        if vert.co.z > 0.20:
            continue
        _, _, dist = tree.find(vert.co)
        worst = max(worst, dist)
        checked += 1
    print(f"BODY DRIFT checked {checked} worst {worst:.5f}")
    return worst


def head_point(p):
    # p is a unit direction. -Y is the face, +Z is up.
    x, y, z = p.x, p.y, p.z
    front = smoothstep(0.05, -0.7, y)
    side = abs(x)

    px = x * 0.072
    py = y * 0.058
    pz = z * 0.064

    cheek = smoothstep(0.25, 0.8, side) * front * smoothstep(0.45, -0.15, z)
    px += math.copysign(0.008 * cheek, x if abs(x) > 1e-6 else 1.0)
    py -= 0.006 * cheek

    # One short muzzle. It stays wide where it leaves the cheeks.
    low = smoothstep(0.16, -0.22, z)
    narrow = 1.0 - smoothstep(0.02, 0.55, side)
    muzzle = front * low * narrow
    py -= 0.015 * muzzle
    pz -= 0.006 * muzzle
    px *= 1.0 - 0.10 * muzzle

    # Brow shelf above where the eyes will sit.
    eye_side = math.exp(-((side - 0.46) ** 2) / 0.035)
    brow_h = math.exp(-((z - 0.20) ** 2) / 0.018)
    brow = front * eye_side * brow_h
    py -= 0.012 * brow
    pz += 0.004 * brow

    crown = smoothstep(0.40, 0.92, z)
    pz += 0.012 * crown
    px *= 1.0 + 0.05 * crown

    jaw = smoothstep(0.0, -0.7, z) * smoothstep(0.05, -0.45, y)
    py -= 0.006 * jaw

    # Neck reaches down over the Rev 2 throat and shifts back into the chest.
    neck = smoothstep(-0.22, -0.98, z)
    px *= 1.0 + 0.08 * neck
    py = py * (1.0 - 0.45 * neck) + 0.010 * neck
    pz -= 0.040 * neck

    return Vector((px, py - 0.042, pz + 0.322))


def build_head():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64, radius=1.0, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = "MikoHead"
    for vert in obj.data.vertices:
        direction = vert.co.normalized()
        vert.co = head_point(direction)
    obj.data.update()

    remesh = obj.modifiers.new("Remesh", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = 0.0017
    remesh.use_smooth_shade = True
    apply_modifier(obj, remesh)

    smooth = obj.modifiers.new("Smooth", "SMOOTH")
    smooth.iterations = 2
    smooth.factor = 0.25
    apply_modifier(obj, smooth)
    shade_smooth(obj)
    print("HEAD VERTS", len(obj.data.vertices))
    return obj


def boolean_union(body, head):
    modifier = body.modifiers.new("HeadUnion", "BOOLEAN")
    modifier.operation = "UNION"
    modifier.object = head
    applied = False
    for solver in ("MANIFOLD", "EXACT", "FLOAT"):
        try:
            modifier.solver = solver
            apply_modifier(body, modifier)
            applied = solver
            break
        except Exception as error:
            print("BOOLEAN", solver, "failed", error)
            modifier = body.modifiers.get("HeadUnion")
            if modifier is None:
                modifier = body.modifiers.new("HeadUnion", "BOOLEAN")
                modifier.operation = "UNION"
                modifier.object = head
    if not applied:
        raise RuntimeError("Boolean union failed")
    bpy.data.objects.remove(head, do_unlink=True)
    print("UNION", applied, "VERTS", len(body.data.vertices))


def smooth_neck(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for _ in range(16):
        moves = []
        for vert in bm.verts:
            co = vert.co
            if not (0.200 < co.z < 0.292 and -0.075 < co.y < 0.040 and abs(co.x) < 0.085):
                continue
            if not vert.link_edges:
                continue
            average = Vector()
            for edge in vert.link_edges:
                average += edge.other_vert(vert).co
            average /= len(vert.link_edges)
            moves.append((vert, co.lerp(average, 0.62)))
        for vert, co in moves:
            vert.co = co
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def front_point(obj, x, z):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    hit, location, _normal, _index = obj.ray_cast(
        Vector((x, -0.45, z)),
        Vector((0.0, 1.0, 0.0)),
        distance=0.6,
        depsgraph=depsgraph,
    )
    if hit and location.y < -0.05:
        return location.copy()
    best = None
    best_d = 1e9
    for vert in obj.data.vertices:
        distance = (vert.co.x - x) ** 2 + (vert.co.z - z) ** 2
        if distance < best_d and vert.co.y < -0.06:
            best_d = distance
            best = vert.co.copy()
    return best


def loop_from_edges(edges):
    if not edges:
        return []
    neighbors = {}
    for edge in edges:
        for vert in edge.verts:
            neighbors.setdefault(vert, []).append(edge)
    start = edges[0].verts[0]
    loop = [start]
    previous = None
    current = start
    for _ in range(len(edges) + 2):
        nxt = None
        for edge in neighbors.get(current, []):
            other = edge.other_vert(current)
            if other is not previous:
                nxt = other
                break
        if nxt is None or nxt is start:
            break
        previous = current
        current = nxt
        loop.append(current)
    return loop


def shape_eyes(obj):
    bpy.context.view_layer.update()
    centers = []
    for sign in (1.0, -1.0):
        point = front_point(obj, sign * EYE_X, EYE_Z)
        print("EYE SURFACE", sign, tuple(round(c, 4) for c in point))
        centers.append(point)

    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()

    for center in centers:
        for vert in bm.verts:
            dx = vert.co.x - center.x
            dz = vert.co.z - center.z
            if vert.normal.y > -0.15:
                continue
            # Brow overlaps the top of the eye.
            if abs(dx) < 0.022 and 0.004 < dz < 0.020:
                across = 1.0 - abs(dx) / 0.022
                height = 1.0 - abs(dz - 0.011) / 0.009
                amount = max(0.0, across) * max(0.0, height)
                vert.co.y -= 0.0055 * amount
                vert.co.z -= 0.0014 * amount
            # Shallow socket so the eye sits in the face.
            rx = dx / (EYE_HALF_W + 0.004)
            rz = dz / (EYE_HALF_H + 0.003)
            radius = rx * rx + rz * rz
            if radius < 1.0 and dz < 0.007:
                vert.co.y += 0.0040 * (1.0 - radius)

    bm.normal_update()
    openings = []
    for center in centers:
        doomed = []
        for face in bm.faces:
            c = face.calc_center_median()
            dx = (c.x - center.x) / EYE_HALF_W
            dz = (c.z - center.z) / EYE_HALF_H
            if dx * dx + dz * dz <= 1.0 and face.normal.y < -0.2 and c.y < center.y + 0.012:
                doomed.append(face)
        print("EYE FACES", len(doomed))
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.edges.ensure_lookup_table()
        boundary = [
            edge
            for edge in bm.edges
            if edge.is_boundary and (edge.verts[0].co - center).length < 0.03
        ]
        outer = loop_from_edges(boundary)
        for vert in outer:
            ang = math.atan2(vert.co.z - center.z, vert.co.x - center.x)
            sine = math.sin(ang)
            cosine = math.cos(ang)
            vert.co.x = center.x + cosine * 0.0190
            vert.co.z = center.z + sine * 0.0160
            # The brow sits forward of the opening.
            vert.co.y = center.y - 0.0042 * max(0.0, sine)
        extruded = bmesh.ops.extrude_edge_only(bm, edges=boundary)
        new_verts = [g for g in extruded["geom"] if isinstance(g, bmesh.types.BMVert)]
        opening = []
        for vert in new_verts:
            ang = math.atan2(vert.co.z - center.z, vert.co.x - center.x)
            sine = math.sin(ang)
            cosine = math.cos(ang)
            lid = abs(sine)
            # Corners sit back in the socket. The upper and lower rims come forward.
            vert.co.x = center.x + cosine * 0.0130
            vert.co.y = center.y + 0.0032 * (1.0 - lid) - 0.0024 * lid
            vert.co.z = center.z + sine * 0.0122
            if sine > 0.0:
                vert.co.z -= 0.0048 * sine
            else:
                vert.co.z -= 0.0022 * sine
            opening.append(vert)
        pinned = {vert: vert.co.copy() for vert in opening}
        for _ in range(12):
            moves = []
            for vert in bm.verts:
                if vert in pinned or not vert.link_edges:
                    continue
                if (vert.co - center).length > 0.030 or vert.co.y > center.y + 0.016:
                    continue
                average = Vector()
                for edge in vert.link_edges:
                    average += edge.other_vert(vert).co
                average /= len(vert.link_edges)
                moves.append((vert, vert.co.lerp(average, 0.55)))
            for vert, co in moves:
                vert.co = co
        for vert, co in pinned.items():
            vert.co = co
        openings.append([vert.co.copy() for vert in opening])
        print("EYE LOOP", len(opening))

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    shade_smooth(obj)
    return centers, openings


def shape_muzzle(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    front = None
    for vert in bm.verts:
        if abs(vert.co.x) < 0.012 and 0.275 < vert.co.z < 0.305:
            if front is None or vert.co.y < front.co.y:
                front = vert
    if front is None:
        print("NO NOSE TIP")
        bm.free()
        return None
    tip = front.co.copy()
    print("NOSE TIP", tuple(round(c, 4) for c in tip))

    for vert in bm.verts:
        co = vert.co
        if co.y > tip.y + 0.016 or abs(co.x) > 0.026 or not (tip.z - 0.020 < co.z < tip.z + 0.010):
            continue
        # Shallow center groove. The nose leather is a separate form.
        if abs(co.x) < 0.0032 and tip.z - 0.014 < co.z < tip.z + 0.002:
            co.y += 0.0016 * (1.0 - abs(co.x) / 0.0032)
        for sign in (1.0, -1.0):
            pad = math.sqrt((co.x - sign * 0.010) ** 2 + (co.z - (tip.z - 0.008)) ** 2)
            if pad < 0.009:
                co.y -= 0.0020 * (1.0 - pad / 0.009)
        mouth_z = tip.z - 0.015
        if abs(co.z - mouth_z) < 0.0020 and abs(co.x) < 0.016:
            along = 1.0 - abs(co.x) / 0.016
            co.y += 0.0018 * along

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return tip


def catmull(points, t):
    count = len(points)
    scaled = max(0.0, min(0.9999, t)) * (count - 1)
    index = min(count - 2, int(scaled))
    u = scaled - index
    p0 = points[max(0, index - 1)]
    p1 = points[index]
    p2 = points[min(count - 1, index + 1)]
    p3 = points[min(count - 1, index + 2)]
    u2 = u * u
    u3 = u2 * u
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * u
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * u3
    )


def sample_keys(keys, t):
    for index in range(len(keys) - 1):
        t0, v0 = keys[index]
        t1, v1 = keys[index + 1]
        if t <= t1 or index == len(keys) - 2:
            span = t1 - t0
            u = 0.0 if span == 0 else (t - t0) / span
            return v0 * (1.0 - u) + v1 * u
    return keys[-1][1]


def build_nose(tip, material):
    # Deform in local space. -Y is the front of the nose.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=0.0082, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = "Nose"
    for vert in obj.data.vertices:
        if vert.co.z >= 0.0:
            vert.co.x *= 1.5
            vert.co.z *= 1.08
        else:
            taper = min(1.0, -vert.co.z / 0.0082)
            vert.co.x *= 1.0 - 0.5 * taper
            vert.co.z *= 0.78
        if vert.co.y < 0.001:
            for sign in (1.0, -1.0):
                dist = math.sqrt((vert.co.x - sign * 0.0032) ** 2 + (vert.co.z + 0.0004) ** 2)
                if dist < 0.0022:
                    vert.co.y += 0.0017 * (1.0 - dist / 0.0022)
    obj.location = Vector((0.0, tip.y + 0.0055, tip.z + 0.001))
    obj.data.update()
    shade_smooth(obj)
    obj.data.materials.append(material)
    print("NOSE", tuple(round(c, 4) for c in obj.location))
    return obj


def build_ear(sign, coat):
    spine = [
        Vector((sign * 0.038, -0.024, 0.356)),
        Vector((sign * 0.056, -0.030, 0.350)),
        Vector((sign * 0.070, -0.032, 0.340)),
        Vector((sign * 0.084, -0.036, 0.326)),
        Vector((sign * 0.082, -0.048, 0.304)),
        Vector((sign * 0.074, -0.056, 0.286)),
        Vector((sign * 0.066, -0.060, 0.270)),
    ]
    widths = (
        (0.00, 0.018),
        (0.12, 0.034),
        (0.30, 0.050),
        (0.52, 0.056),
        (0.76, 0.048),
        (1.00, 0.040),
    )
    rows, cols = 40, 18
    mesh = bpy.data.meshes.new("Ear")
    obj = bpy.data.objects.new("EarL" if sign > 0 else "EarR", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    grid = []
    previous_across = Vector((sign, 0.0, 0.0))
    for i in range(rows):
        v = i / (rows - 1)
        center = catmull(spine, v)
        ahead = catmull(spine, min(1.0, v + 0.02))
        behind = catmull(spine, max(0.0, v - 0.02))
        tangent = ahead - behind
        if tangent.length < 1e-8:
            tangent = Vector((0.0, 0.0, -1.0))
        tangent.normalize()
        across = previous_across - tangent * previous_across.dot(tangent)
        if across.length < 1e-6:
            across = Vector((sign, 0.0, 0.0))
        across.normalize()
        if across.x * sign < 0.0:
            across.negate()
        normal = across.cross(tangent)
        if normal.length < 1e-8:
            normal = Vector((0.0, -1.0, 0.0))
        normal.normalize()
        if normal.y > 0.0:
            normal.negate()
        previous_across = across
        half = sample_keys(widths, v) * 0.5
        line = []
        for j in range(cols):
            u = (j / (cols - 1)) * 2.0 - 1.0
            edge = u * u
            # Soft pad: the middle of the ear comes slightly forward.
            pad = normal * (0.0035 * (1.0 - edge))
            # Round the bottom so the tip is an arc, not a point.
            tip_round = Vector((0.0, 0.0, 0.0))
            if v > 0.72:
                tip_round = tangent * (0.014 * ((v - 0.72) / 0.28) * (1.0 - edge))
            point = center + across * (u * half) + pad + tip_round
            line.append(bm.verts.new(point))
        grid.append(line)
    for i in range(rows - 1):
        for j in range(cols - 1):
            bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    solid = obj.modifiers.new("Thickness", "SOLIDIFY")
    solid.thickness = 0.009
    solid.offset = 0.0
    apply_modifier(obj, solid)
    subsurf = obj.modifiers.new("Round", "SUBSURF")
    subsurf.levels = 1
    subsurf.render_levels = 1
    apply_modifier(obj, subsurf)
    shade_smooth(obj)
    obj.data.materials.append(coat)
    return obj


def add_sphere(name, location, radius, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    shade_smooth(obj)
    return obj


def build_eyeballs(obj, openings, iris_mat, pupil_mat, catch_mat):
    for index, opening in enumerate(openings):
        if not opening:
            continue
        sign = 1.0 if index == 0 else -1.0
        xs = [co.x for co in opening]
        ys = [co.y for co in opening]
        zs = [co.z for co in opening]
        center_x = sum(xs) / len(xs)
        center_z = sum(zs) / len(zs)
        front = min(ys)
        radius = 0.0120
        center = Vector((center_x, front + 0.0026 + radius, center_z - 0.0004))
        side = "L" if sign > 0 else "R"
        add_sphere(f"Iris{side}", center, radius, iris_mat)
        pupil = center.copy()
        pupil.y -= 0.0028
        add_sphere(f"Pupil{side}", pupil, 0.0050, pupil_mat)
        catch = center.copy()
        # Upper area, toward the viewer's left, still behind the lid.
        catch.x += -0.0024
        catch.y = front + 0.0016
        catch.z += 0.0028
        add_sphere(f"Catch{side}", catch, 0.00135, catch_mat)
        print("EYEBALL", side, tuple(round(c, 4) for c in center), "front", round(front, 4))


def studio():
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
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.70, 0.70, 0.70, 1.0)
    background.inputs[1].default_value = 0.28

    def light(name, location, energy, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        data.color = (1.0, 0.98, 0.96)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        direction = Vector((0.0, -0.02, 0.30)) - Vector(location)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    light("Key", (-0.48, -0.95, 0.72), 8.0, 1.25)
    light("Fill", (0.72, -0.62, 0.42), 4.8, 1.55)
    light("Top", (0.0, -0.15, 0.90), 2.4, 1.2)


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


def hide_except_puppy():
    keep = ("MikoBody", "EarL", "EarR", "Iris", "Pupil", "Catch", "Nose", "Ground")
    for obj in bpy.data.objects:
        obj.hide_render = obj.type not in {"LIGHT", "CAMERA"} and not obj.name.startswith(keep)


def main():
    os.makedirs(PREVIEW, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=REV2)
    for name in ("EyeL", "EyeR", "CatchL", "CatchR", "Nose"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)

    body = bpy.data.objects["MikoBody"]
    print("PAWS BEFORE", paw_span(body))
    delete_old_head(body)
    snapshot = body_snapshot(body)

    coat = make_material("Coat", rgb("#E6C09A"), 1.0, 0.02)
    nose = make_material("Nose", rgb("#2A221C"), 0.72, 0.04)
    iris = make_material("Iris", rgb("#6A4330"), 0.42, 0.18)
    pupil = make_material("Pupil", rgb("#16110E"), 0.35, 0.12)
    catch = make_material("Catch", rgb("#F7F4EF"), 0.4, 0.1, emission=3.0)

    head = build_head()
    boolean_union(body, head)
    print("PAWS AFTER UNION", paw_span(body))
    report_body_drift(snapshot, body)
    smooth_neck(body)

    body.data.materials.clear()
    body.data.materials.append(coat)
    shade_smooth(body)

    _centers, openings = shape_eyes(body)
    tip = shape_muzzle(body)
    if tip is not None:
        build_nose(tip, nose)
    build_ear(1.0, coat)
    build_ear(-1.0, coat)
    build_eyeballs(body, openings, iris, pupil, catch)

    withers = max(
        vert.co.z
        for vert in body.data.vertices
        if abs(vert.co.x) < 0.02 and 0.04 < vert.co.y < 0.10
    )
    print("WITHERS", round(withers, 4), "PAWS", paw_span(body), "VERTS", len(body.data.vertices))

    studio()
    hide_except_puppy()
    look_camera("Front", (0.0, -0.78, 0.328), (0.0, -0.03, 0.328), 0.32)
    render_to(os.path.join(PREVIEW, "front.png"), 1100, 1100)
    angle = math.radians(40.0)
    distance = 0.78
    look_camera(
        "Three",
        (math.sin(angle) * distance, -math.cos(angle) * distance, 0.345),
        (0.0, -0.03, 0.322),
        0.34,
    )
    render_to(os.path.join(PREVIEW, "three.png"), 1100, 1100)
    look_camera("Side", (0.85, -0.02, 0.32), (0.0, -0.03, 0.32), 0.28)
    render_to(os.path.join(PREVIEW, "side.png"), 1100, 1100)
    look_camera("Full", (-0.72, -0.95, 0.30), (0.0, -0.01, 0.18), 0.58)
    render_to(os.path.join(PREVIEW, "full168.png"), 168, 200)
    render_to(os.path.join(PREVIEW, "full.png"), 840, 1000)

    bpy.ops.wm.save_as_mainfile(filepath=REV4)
    print("BLEND", REV4)


if __name__ == "__main__":
    main()
