"""Shared helpers for building blocky, rigidly-skinned animated animals with Blender's Python API.

Conventions: Z up, animals face -Y (so +Z in glTF), ground is z = 0.
A pose is {bone: [pitch, yaw, roll, dx, dy, dz]} in rig-space axes (degrees / units):
pitch = about X (+ tips the forward end down / swings a hanging limb back), yaw = about Z, roll = about Y.
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

FPS = 24
TAU = 2 * math.pi
smooth = lambda t: t * t * (3 - 2 * t)
clamp = lambda x, a=0.0, b=1.0: max(a, min(b, x))


class _State:
    pass


S = _State()


# ------------------------------------------------------------------ pose maths
def P(**kw):
    return {k.replace("__", "."): list(v) + [0] * (6 - len(v)) for k, v in kw.items()}


def add(*poses):
    out = {}
    for p in poses:
        for k, v in p.items():
            v = list(v) + [0] * (6 - len(v))
            cur = out.get(k, [0] * 6)
            out[k] = [a + b for a, b in zip(cur, v)]
    return out


def scale(pose, w):
    return {k: [x * w for x in v] for k, v in pose.items()}


def mix(a, b, w):
    return add(scale(a, 1 - w), scale(b, w))


def rot2(y, z, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return y * c - z * s, y * s + z * c


def ramp(t, t0, t1):
    """0 before t0, 1 after t1, smooth in between."""
    return smooth(clamp((t - t0) / (t1 - t0)))


def hold(t, a=0.2, b=0.8):
    """0 -> 1 -> 0 envelope: rises until a, holds, falls after b."""
    return ramp(t, 0, a) * (1 - ramp(t, b, 1))


# ------------------------------------------------------------------ scene / materials
def start():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S.scene = bpy.context.scene
    S.scene.render.fps = FPS
    S.props = []


def make_mat(name, rgb, rough=0.55, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*rgb, 1)
    return m


def materials(spec):
    """spec: {key: (material name, rgb, roughness[, metallic])}"""
    S.mats = {k: make_mat(v[0], v[1], *v[2:]) for k, v in spec.items()}
    S.mat_index = {k: i for i, k in enumerate(S.mats)}


# ------------------------------------------------------------------ geometry
def _part_mesh(center, size, mat, opts):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    t = opts.get("taper")
    for v in bm.verts:
        if t and v.co.z > 0:
            v.co.x *= t
            v.co.y *= t
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(center)
    for key, axis in (("rot", "X"), ("roll", "Y"), ("yaw", "Z")):
        if key in opts:
            deg, piv = opts[key]
            bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(piv), matrix=Matrix.Rotation(math.radians(deg), 3, axis))
    bev = opts.get("bevel", min(0.022, min(size) * 0.18))
    if bev > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bev, segments=2, profile=0.5, affect="EDGES")
    for f in bm.faces:
        f.material_index = S.mat_index[mat]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("tmp")
    bm.to_mesh(me)
    bm.free()
    return me


def _join(parts, mesh_name):
    main = bmesh.new()
    groups = {}
    for bone, mat, center, size, opts in parts:
        tmp = _part_mesh(center, size, mat, opts)
        n0 = len(main.verts)
        main.from_mesh(tmp)
        main.verts.ensure_lookup_table()
        groups.setdefault(bone, []).extend(range(n0, len(main.verts)))
        bpy.data.meshes.remove(tmp)
    mesh = bpy.data.meshes.new(mesh_name)
    main.to_mesh(mesh)
    main.free()
    for m in S.mats.values():
        mesh.materials.append(m)
    return mesh, groups


def build(name, parts, bones, loc_bones=("body",)):
    """parts: [(bone, material key, centre, size, opts)], bones: [(name, head, tail, parent)]"""
    mesh, groups = _join(parts, name + "Mesh")
    obj = bpy.data.objects.new(name, mesh)
    S.scene.collection.objects.link(obj)
    arm_data = bpy.data.armatures.new(name + "Rig")
    arm = bpy.data.objects.new(name + "Rig", arm_data)
    S.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, head, tail, parent in bones:
        eb = arm_data.edit_bones.new(bname)
        eb.head, eb.tail = head, tail
        if parent:
            eb.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    arm_data.display_type = "STICK"
    arm.show_in_front = True
    for bone, idx in groups.items():
        assert bone in arm_data.bones, f"part uses unknown bone {bone}"
        obj.vertex_groups.new(name=bone).add(idx, 1.0, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    S.obj, S.arm, S.name = obj, arm, name
    S.rest = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
    S.loc_bones = set(loc_bones)
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    arm.animation_data_create()
    S.actions = {}
    return obj, arm


def prop(name, parts, location=(0, 0, 0)):
    """Static (un-rigged) object, e.g. a tree. Part centres are relative to the object's origin."""
    mesh, _ = _join([("", m, c, s, o) for m, c, s, o in parts], name + "Mesh")
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    S.scene.collection.objects.link(obj)
    S.props.append(obj)
    return obj


def empty(name, location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    e.location = location
    if parent:
        e.parent = parent
    S.scene.collection.objects.link(e)
    S.props.append(e)
    return e


def quad_legs(parts, bones, fx, fy, hx, hy, top, knee, ankle, thick_f, thick_h, mats=("fur", "fur", "paw"),
              paw_extra=0.06, front_parent="chest", hind_parent="body"):
    for side, sx in (("L", 1), ("R", -1)):
        for tag, lx, ly, th, par in (("front", fx, fy, thick_f, front_parent), ("hind", hx, hy, thick_h, hind_parent)):
            x = sx * lx
            parts += [
                (f"{tag}_upper.{side}", mats[0], (x, ly, (top + knee) / 2), (th, th + 0.01, top - knee + 0.03), {}),
                (f"{tag}_lower.{side}", mats[1], (x, ly, (knee + ankle) / 2), (th - 0.015, th - 0.01, knee - ankle + 0.02), {}),
                (f"{tag}_paw.{side}", mats[2], (x, ly - paw_extra * 0.4, ankle / 2), (th + 0.02, th + paw_extra, ankle),
                 {"bevel": min(0.02, ankle * 0.25)}),
            ]
            bones += [
                (f"{tag}_upper.{side}", (x, ly, top), (x, ly, knee), par),
                (f"{tag}_lower.{side}", (x, ly, knee), (x, ly, ankle), f"{tag}_upper.{side}"),
                (f"{tag}_paw.{side}", (x, ly, ankle), (x, ly - th - paw_extra * 0.6, ankle * 0.3), f"{tag}_lower.{side}"),
            ]


# ------------------------------------------------------------------ sit solver for four-legged animals
def solve_sit(pivot, front, hind, corner, th=None, clear=0.015, slant=8, hind_mode="fold", chest=None, ankle=0.0):
    """pivot=(y,z) of the body bone; front=(y, top z); hind=(y, top z, knee z);
    corner=(y,z) of the body's rear-bottom corner relative to the pivot.
    chest=(y,z) of the chest bone: if given with a fixed th, the spine curls so the front paws reach the floor."""
    py, pz = pivot
    fy, ftop = front
    hy, htop, hknee = hind
    reach = ftop - ankle

    def calc(t, cb=0.0):
        zh = clear - rot2(corner[0], corner[1], t)[1]
        if chest:
            ay, az = rot2(chest[0] - py, chest[1] - pz, t)
            by, bz = rot2(fy - chest[0], ftop - chest[1], t + cb)
            oy, oz = ay + by, az + bz
        else:
            oy, oz = rot2(fy - py, ftop - pz, t)
        return zh, oy, zh + oz

    want = ankle + reach * math.cos(math.radians(slant))
    cb = 0.0
    if th is None:
        th = min((-i / 10 for i in range(250, 800)), key=lambda t: abs(calc(t)[2] - want))
    elif chest:
        cb = min((i / 10 for i in range(0, 700)), key=lambda b: abs(calc(th, b)[2] - want))
    zh, oy, zt = calc(th, cb)
    phi = -math.degrees(math.acos(clamp((zt - ankle) / reach, -1, 1)))
    yh = fy - oy - reach * math.sin(math.radians(phi))
    jy, jz = rot2(hy - py, htop - pz, th)
    zj = zh + jz
    if hind_mode == "fold":
        a = math.degrees(math.asin(clamp((hknee - zj) / (htop - hknee), -1, 1)))
        psi, shin = -(90 + a), 0.0
    else:                          # legs stretched out in front along the floor
        psi = shin = -92.0
    pose = {"body": [th, 0, 0, 0, yh - py, zh - pz], "chest": [cb, 0, 0]}
    for s in ("L", "R"):
        pose[f"front_upper.{s}"] = [phi - th - cb, 0, 0]
        pose[f"front_paw.{s}"] = [-phi, 0, 0]
        pose[f"hind_upper.{s}"] = [psi - th, 0, 0]
        pose[f"hind_lower.{s}"] = [shin - psi, 0, 0]
    return add(pose), dict(th=th, cb=cb, phi=phi, psi=psi, zh=zh, zt=zt, zj=zj)


def quad_walk(t, amp=26, front=(14, 38, 12), hind=(20, 34, 10)):
    ph = TAU * t
    pose = {}
    for name, off, k in (("front", 0, front), ("hind", math.pi, hind)):
        for s, so in (("L", 0), ("R", math.pi)):
            p = ph + off + so
            swing = amp * math.sin(p)
            lift = max(0.0, -math.cos(p))
            pose[f"{name}_upper.{s}"] = [swing - k[0] * lift, 0, 0, 0, 0, 0]
            pose[f"{name}_lower.{s}"] = [k[1] * lift, 0, 0, 0, 0, 0]
            pose[f"{name}_paw.{s}"] = [k[2] * lift - 0.35 * swing, 0, 0, 0, 0, 0]
    return pose


# ------------------------------------------------------------------ animation
def apply_pose(pose, frame=None, prev=None):
    prev = prev if prev is not None else {}
    for pb in S.arm.pose.bones:
        v = list(pose.get(pb.name, [0] * 6))
        v += [0] * (6 - len(v))
        R = S.rest[pb.name]
        G = (Matrix.Rotation(math.radians(v[1]), 3, "Z") @ Matrix.Rotation(math.radians(v[0]), 3, "X")
             @ Matrix.Rotation(math.radians(v[2]), 3, "Y"))
        q = (R.inverted() @ G @ R).to_quaternion()
        if pb.name in prev and prev[pb.name].dot(q) < 0:
            q.negate()
        prev[pb.name] = q.copy()
        pb.rotation_quaternion = q
        pb.location = R.inverted() @ Vector(v[3:6])
        if frame is not None and pb.name != "root":
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            if pb.name in S.loc_bones:
                pb.keyframe_insert("location", frame=frame)


def set_action(act):
    ad = S.arm.animation_data
    ad.action = act
    if hasattr(ad, "action_slot") and act is not None and len(act.slots):
        ad.action_slot = act.slots[0]


def bake(clips, active):
    """clips: [(name, fn(t in 0..1) -> pose, frames, loops)]"""
    ad = S.arm.animation_data
    S.clips = clips
    for name, fn, n, loops in clips:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        set_action(act)
        prev = {}
        for f in range(n + 1):
            apply_pose(fn(f / n), frame=f, prev=prev)
        if hasattr(ad, "action_slot") and ad.action_slot is None and len(act.slots):
            ad.action_slot = act.slots[0]
        act.frame_range = (0, n)
        act.use_frame_range = True
        act.use_cyclic = bool(loops)
        S.actions[name] = act
    set_action(None)
    for name, _, n, _ in clips:
        tr = ad.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 0, S.actions[name])
        tr.mute = True
    S.active = active
    show(active, 0)
    S.scene.frame_start, S.scene.frame_end = 0, int(S.actions[active].frame_range[1])


def show(clip, frame):
    set_action(S.actions[clip])
    S.scene.frame_set(frame)


def minz(checks, n=5):
    for clip, frame in checks:
        show(clip, frame)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = S.obj.evaluated_get(dg)
        me = ev.to_mesh()
        zs = {}
        for v in me.vertices:
            z = (ev.matrix_world @ v.co).z
            for g in v.groups:
                nm = S.obj.vertex_groups[g.group].name
                zs[nm] = min(zs.get(nm, 9), z)
        ev.to_mesh_clear()
        low = sorted(zs.items(), key=lambda kv: kv[1])[:n]
        print(f"[minz] {clip}@{frame}: " + ", ".join(f"{k}={v:.3f}" for k, v in low))


# ------------------------------------------------------------------ stage, save, export, render
def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def stage(size=1.0, target=(0, -0.15, 0.66), cam=(2.0, -3.4, 1.4), sky=(0.75, 0.82, 0.9), light=1.0):
    sc = S.scene
    S.size, S.target, S.cam_loc = size, tuple(x * size for x in target), tuple(x * size for x in cam)
    c = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    c.data.lens = 58
    c.location = S.cam_loc
    look_at(c, S.target)
    sc.collection.objects.link(c)
    sc.camera = c
    S.cam = c
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 2.6 * light
    sun.data.angle = math.radians(12)
    sun.location = (2 * size, -3 * size, 5 * size)
    look_at(sun, (0, 0, 0.5 * size))
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 250 * size * size * light
    fill.data.size = 3 * size
    fill.location = (-2.5 * size, -2.5 * size, 2.0 * size)
    look_at(fill, (0, 0, 0.7 * size))
    sc.collection.objects.link(fill)
    w = bpy.data.worlds.new("World")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (*sky, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.7 * (0.5 + 0.5 * light)
    sc.world = w


def save_export(out, base):
    os.makedirs(out, exist_ok=True)
    show(S.active, 0)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, base + ".blend"))
    bpy.ops.object.select_all(action="DESELECT")
    for o in [S.obj, S.arm] + S.props:
        o.select_set(True)
    bpy.context.view_layer.objects.active = S.arm
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, base + ".glb"), export_format="GLB", use_selection=True,
                              export_animations=True, export_animation_mode="ACTIONS", export_yup=True,
                              export_force_sampling=True)
    print("[saved]", base + ".blend", base + ".glb")


def _render_setup(res, samples):
    sc = S.scene
    if "Ground" not in bpy.data.objects:
        gm = bpy.data.meshes.new("Ground")
        gb = bmesh.new()
        bmesh.ops.create_grid(gb, x_segments=1, y_segments=1, size=20 * S.size)
        gb.to_mesh(gm)
        gb.free()
        gm.materials.append(make_mat("GroundMat", (0.42, 0.45, 0.5), 0.9))
        sc.collection.objects.link(bpy.data.objects.new("Ground", gm))
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.view_settings.view_transform = "Standard"


def _place(where):
    loc, rz = where
    S.arm.location = loc
    S.arm.rotation_euler = (0, 0, math.radians(rz))


def _aim(cam=None, target=None):
    S.cam.location = tuple(x * S.size for x in cam) if cam else S.cam_loc
    look_at(S.cam, tuple(x * S.size for x in target) if target else S.target)


def render_stills(out, base, shots, res=480, samples=32):
    """shots: [(tag, clip, frame, cam or None, target or None)] -> one contact sheet"""
    from PIL import Image
    _render_setup(res, samples)
    paths = []
    for tag, clip, frame, cam, target, *rest in shots:
        show(clip, frame)
        _aim(cam, target)
        _place(rest[0] if rest else ((0, 0, 0), 0))
        p = os.path.join(out, "stills", f"{base}_{tag}.png")
        S.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    cols = 3
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (res * cols, res * rows), (190, 200, 215))
    for i, p in enumerate(paths):
        sheet.paste(Image.open(p).convert("RGB"), ((i % cols) * res, (i // cols) * res))
    _place(((0, 0, 0), 0))
    sheet.save(os.path.join(out, base + "_poses.png"))
    print("[stills]", len(paths))


def render_gif(out, base, seq, res=300, samples=12, cam=None, target=None, mover=None):
    """seq: [(clip, frames iterable, ms per frame)]; mover(i, n) -> ((x, y, z), turn in degrees) for travelling shots"""
    from PIL import Image
    _render_setup(res, samples)
    _aim(cam, target)
    frames, durs = [], []
    total = sum(len(list(fr)) for _, fr, _ in seq)
    i = 0
    for clip, fr, ms in seq:
        for f in fr:
            show(clip, f)
            if mover:
                _place(mover(i, total))
            p = os.path.join(out, "frames", f"{base}_{i:03d}.png")
            S.scene.render.filepath = p
            bpy.ops.render.render(write_still=True)
            frames.append(Image.open(p).convert("RGB").quantize(128))
            durs.append(ms)
            i += 1
    _place(((0, 0, 0), 0))
    frames[0].save(os.path.join(out, base + "_preview.gif"), save_all=True, append_images=frames[1:], duration=durs, loop=0)
    print("[gif]", len(frames))
