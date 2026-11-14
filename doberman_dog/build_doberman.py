"""Builds a blocky Doberman doll: mesh, rig, animations. Saves .blend, exports .glb, renders previews.

Run:  python3 build_doberman.py <output_dir>      (needs `pip install bpy`)
  or: blender -b -P build_doberman.py -- <output_dir>
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[-1]) if len(sys.argv) > 1 and not sys.argv[-1].endswith(".py") else os.getcwd()
os.makedirs(OUT, exist_ok=True)
RENDER = os.environ.get("DOG_RENDER", "1") == "1"
FPS = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

# ---------------------------------------------------------------- materials
def make_mat(name, rgb, rough=0.55, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = (*rgb, 1)
    return m

MATS = {
    "black":  make_mat("Coat_Black", (0.012, 0.012, 0.016), 0.42),
    "tan":    make_mat("Coat_Tan", (0.46, 0.16, 0.035), 0.6),
    "eye":    make_mat("Eye", (0.004, 0.003, 0.003), 0.08),
    "glint":  make_mat("Eye_Glint", (0.9, 0.9, 0.9), 0.3),
    "nose":   make_mat("Nose", (0.008, 0.008, 0.01), 0.2),
    "collar": make_mat("Collar_Red", (0.62, 0.03, 0.03), 0.5),
    "gold":   make_mat("Tag_Gold", (0.9, 0.62, 0.12), 0.25, metal=1.0),
    "tongue": make_mat("Tongue", (0.85, 0.25, 0.3), 0.5),
}
MAT_INDEX = {k: i for i, k in enumerate(MATS)}

# ---------------------------------------------------------------- geometry
# Dog faces -Y (toward the viewer in Blender's front view / +Z in glTF). Z is up. Ground is z = 0.
# part: (bone, material, centre, size, options)
LX_F, LX_H = 0.115, 0.15          # front / hind leg x offsets
LY_F, LY_H = -0.26, 0.27          # front / hind leg y positions
PARTS = [
    ("body",  "black", (0, 0.10, 0.62), (0.30, 0.50, 0.30), {}),
    ("chest", "black", (0, -0.22, 0.63), (0.36, 0.30, 0.36), {}),
    ("chest", "tan",   (0.09, -0.375, 0.66), (0.11, 0.02, 0.10), {"bevel": 0.006}),
    ("chest", "tan",   (-0.09, -0.375, 0.66), (0.11, 0.02, 0.10), {"bevel": 0.006}),
    ("neck",  "black", (0, -0.35, 0.86), (0.19, 0.19, 0.32), {"rot": (-22, (0, -0.32, 0.74))}),
    ("neck",  "collar", (0, -0.35, 0.86), (0.215, 0.215, 0.06), {"rot": (-22, (0, -0.32, 0.74)), "bevel": 0.008}),
    ("neck",  "gold",  (0, -0.465, 0.83), (0.055, 0.015, 0.06), {"rot": (-22, (0, -0.32, 0.74)), "bevel": 0.006}),
    # head
    ("head",  "black", (0, -0.46, 1.09), (0.36, 0.32, 0.30), {}),
    ("head",  "tan",   (0, -0.725, 1.005), (0.19, 0.22, 0.10), {}),              # muzzle
    ("head",  "black", (0, -0.715, 1.065), (0.13, 0.22, 0.03), {"bevel": 0.008}),  # muzzle bridge
    ("head",  "nose",  (0, -0.845, 1.05), (0.085, 0.04, 0.06), {"bevel": 0.012}),
    ("head",  "tan",   (0.125, -0.625, 0.99), (0.07, 0.02, 0.08), {"bevel": 0.006}),   # cheeks
    ("head",  "tan",   (-0.125, -0.625, 0.99), (0.07, 0.02, 0.08), {"bevel": 0.006}),
    ("head",  "eye",   (0.10, -0.622, 1.125), (0.07, 0.02, 0.08), {"bevel": 0.006}),
    ("head",  "eye",   (-0.10, -0.622, 1.125), (0.07, 0.02, 0.08), {"bevel": 0.006}),
    ("head",  "glint", (0.115, -0.634, 1.145), (0.016, 0.006, 0.016), {"bevel": 0}),
    ("head",  "glint", (-0.085, -0.634, 1.145), (0.016, 0.006, 0.016), {"bevel": 0}),
    ("head",  "tan",   (0.10, -0.622, 1.195), (0.045, 0.016, 0.03), {"bevel": 0.005}),  # eyebrow dots
    ("head",  "tan",   (-0.10, -0.622, 1.195), (0.045, 0.016, 0.03), {"bevel": 0.005}),
    ("jaw",   "tan",   (0, -0.71, 0.935), (0.15, 0.19, 0.04), {"bevel": 0.008}),
    ("jaw",   "tongue", (0, -0.73, 0.958), (0.08, 0.16, 0.012), {"bevel": 0.004}),
    ("ear.L", "black", (0.125, -0.38, 1.34), (0.10, 0.07, 0.22), {"taper": 0.3, "roll": (-8, (0.125, -0.38, 1.23))}),
    ("ear.R", "black", (-0.125, -0.38, 1.34), (0.10, 0.07, 0.22), {"taper": 0.3, "roll": (8, (-0.125, -0.38, 1.23))}),
    ("tail",  "black", (0, 0.37, 0.80), (0.07, 0.07, 0.17), {"rot": (25, (0, 0.34, 0.74)), "taper": 0.7}),
]
for side, sx in (("L", 1), ("R", -1)):
    for tag, lx, ly in (("front", LX_F, LY_F), ("hind", LX_H, LY_H)):
        x = sx * lx
        thick = 0.115 if tag == "front" else 0.125
        PARTS += [
            (f"{tag}_upper.{side}", "black", (x, ly, 0.40), (thick, thick + 0.01, 0.27), {}),
            (f"{tag}_lower.{side}", "black", (x, ly, 0.18), (thick - 0.015, thick - 0.01, 0.22), {}),
            (f"{tag}_paw.{side}",   "tan",   (x, ly - 0.025, 0.04), (thick + 0.02, thick + 0.07, 0.08), {"bevel": 0.02}),
        ]

def build_part(center, size, mat, opts):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        t = opts.get("taper")
        if t and v.co.z > 0:
            v.co.x *= t; v.co.y *= t
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2])) + Vector(center)
    if "rot" in opts:      # pitch about X through pivot
        deg, piv = opts["rot"]
        bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(piv), matrix=Matrix.Rotation(math.radians(deg), 3, "X"))
    if "roll" in opts:     # roll about Y through pivot
        deg, piv = opts["roll"]
        bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(piv), matrix=Matrix.Rotation(math.radians(deg), 3, "Y"))
    bev = opts.get("bevel", min(0.022, min(size) * 0.18))
    if bev > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bev, segments=2, profile=0.5, affect="EDGES")
    for f in bm.faces:
        f.material_index = MAT_INDEX[mat]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("tmp")
    bm.to_mesh(me); bm.free()
    return me

main = bmesh.new()
groups = {}
for bone, mat, center, size, opts in PARTS:
    tmp = build_part(center, size, mat, opts)
    n0 = len(main.verts)
    main.from_mesh(tmp)
    main.verts.ensure_lookup_table()
    groups.setdefault(bone, []).extend(range(n0, len(main.verts)))
    bpy.data.meshes.remove(tmp)

mesh = bpy.data.meshes.new("DobermanMesh")
main.to_mesh(mesh); main.free()
for m in MATS.values():
    mesh.materials.append(m)
dog = bpy.data.objects.new("Doberman", mesh)
scene.collection.objects.link(dog)

# ---------------------------------------------------------------- armature
BONES = [  # name, head, tail, parent
    ("root",  (0, 0, 0), (0, 0.25, 0), None),
    ("body",  (0, 0.28, 0.62), (0, -0.05, 0.62), "root"),
    ("chest", (0, -0.05, 0.62), (0, -0.36, 0.64), "body"),
    ("neck",  (0, -0.30, 0.74), (0, -0.40, 0.97), "chest"),
    ("head",  (0, -0.40, 0.97), (0, -0.40, 1.24), "neck"),
    ("jaw",   (0, -0.60, 0.96), (0, -0.81, 0.94), "head"),
    ("ear.L", (0.125, -0.38, 1.23), (0.14, -0.38, 1.45), "head"),
    ("ear.R", (-0.125, -0.38, 1.23), (-0.14, -0.38, 1.45), "head"),
    ("tail",  (0, 0.34, 0.74), (0, 0.42, 0.90), "body"),
]
for side, sx in (("L", 1), ("R", -1)):
    for tag, lx, ly, par in (("front", LX_F, LY_F, "chest"), ("hind", LX_H, LY_H, "body")):
        x = sx * lx
        BONES += [
            (f"{tag}_upper.{side}", (x, ly, 0.52), (x, ly, 0.28), par),
            (f"{tag}_lower.{side}", (x, ly, 0.28), (x, ly, 0.08), f"{tag}_upper.{side}"),
            (f"{tag}_paw.{side}",   (x, ly, 0.08), (x, ly - 0.11, 0.02), f"{tag}_lower.{side}"),
        ]

arm_data = bpy.data.armatures.new("DobermanRig")
arm = bpy.data.objects.new("DobermanRig", arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for name, head, tail, parent in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = head, tail
    if parent:
        eb.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")
arm_data.display_type = "STICK"
arm.show_in_front = True

for bone, idx in groups.items():
    dog.vertex_groups.new(name=bone).add(idx, 1.0, "REPLACE")
dog.parent = arm
mod = dog.modifiers.new("Armature", "ARMATURE")
mod.object = arm

REST = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"

# ---------------------------------------------------------------- poses
# A pose is {bone: [pitch, yaw, roll, dx, dy, dz]} in rig-space axes (degrees / units):
#   pitch = about X (+ tips the forward end down), yaw = about Z, roll = about Y.
def P(**kw):
    return {k.replace("__", "."): list(v) + [0] * (6 - len(v)) for k, v in kw.items()}

def add(*poses):
    out = {}
    for p in poses:
        for k, v in p.items():
            cur = out.setdefault(k, [0] * 6)
            out[k] = [a + b for a, b in zip(cur, v)]
    return out

def scale(pose, w):
    return {k: [x * w for x in v] for k, v in pose.items()}

def rot2(y, z, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return y * c - z * s, y * s + z * c

def make_sit():
    th = -47.0                       # body pitch: front end up
    zh = 0.185                       # hip pivot height when seated
    leg = 0.52                       # shoulder/hip joint height at rest
    thigh, shin = 0.24, 0.28
    # front legs: stay planted, nearly straight
    oy, oz = rot2(LY_F - 0.28, 0.52 - 0.62, th)
    zt = zh + oz
    phi = -math.degrees(math.acos(min(1.0, zt / leg)))
    yh = LY_F - oy - leg * math.sin(math.radians(phi))
    # hind legs: thigh folds forward, shin drops to the floor
    hy, hz = rot2(LY_H - 0.28, 0.52 - 0.62, th)
    a = math.degrees(math.asin(max(-1, min(1, (shin - (zh + hz)) / thigh))))
    psi = -(90 + a)
    pose = {
        "body": [th, 0, 0, 0, yh - 0.28, zh - 0.62],
        "neck": [25, 0, 0], "head": [22, 0, 0], "tail": [20, 0, 0],
    }
    for s, sx in (("L", 1), ("R", -1)):
        pose[f"front_upper.{s}"] = [phi - th, 0, 0]
        pose[f"front_paw.{s}"] = [-phi, 0, 0]
        pose[f"hind_upper.{s}"] = [psi - th, 0, 0]
        pose[f"hind_lower.{s}"] = [-psi, 0, 0]
    return {k: v + [0] * (6 - len(v)) for k, v in pose.items()}

SIT = make_sit()
TAU = 2 * math.pi
smooth = lambda t: t * t * (3 - 2 * t)

def idle(t):
    s = math.sin
    return P(body=(0.4 * s(TAU * t), 0, 0, 0, 0, 0.004 * s(TAU * t)),
             chest=(0.8 * s(TAU * t + 0.5), 0, 0),
             head=(2 * s(TAU * t + 1), 4 * s(TAU * t), 3 * s(TAU * t + 2)),
             tail=(0, 22 * s(TAU * 3 * t), 0),
             ear__L=(3 * max(0, s(TAU * 2 * t)), 0, 0), ear__R=(3 * max(0, s(TAU * 2 * t + 1)), 0, 0))

def walk(t):
    ph = TAU * t
    pose = P(body=(1.0 * math.sin(2 * ph), 0, 1.5 * math.sin(ph), 0, 0, 0.012 * math.cos(2 * ph)),
             neck=(2.5 * math.sin(2 * ph + 0.6), 0, 0),
             head=(-2.0 * math.sin(2 * ph + 0.6), 0, -1.5 * math.sin(ph)),
             tail=(0, 16 * math.sin(ph), 0),
             ear__L=(4 * math.sin(2 * ph), 0, 0), ear__R=(4 * math.sin(2 * ph), 0, 0))
    for name, off in (("front", 0), ("hind", math.pi)):
        for s, so in (("L", 0), ("R", math.pi)):
            p = ph + off + so
            swing = 26 * math.sin(p)                 # + = leg back
            lift = max(0.0, -math.cos(p))            # leg travelling forward
            if name == "front":
                up, lo, paw = swing - 14 * lift, 38 * lift, 12 * lift
            else:
                up, lo, paw = swing - 20 * lift, 34 * lift, 10 * lift
            pose[f"{name}_upper.{s}"] = [up, 0, 0, 0, 0, 0]
            pose[f"{name}_lower.{s}"] = [lo, 0, 0, 0, 0, 0]
            pose[f"{name}_paw.{s}"] = [paw - 0.35 * swing, 0, 0, 0, 0, 0]
    return pose

def sit(t):
    w = smooth(t)
    return add(scale(SIT, w), P(head=(10 * math.sin(math.pi * t), 0, 0)))

def sit_idle(t):
    s = math.sin
    return add(SIT, P(head=(2 * s(TAU * t), 5 * s(TAU * t), 9 * s(TAU * t)),
                      neck=(0, 3 * s(TAU * t), 0),
                      jaw=(13 + 4 * s(TAU * 6 * t), 0, 0),
                      chest=(0.8 * s(TAU * 6 * t), 0, 0),
                      tail=(0, 28 * s(TAU * 4 * t), 0),
                      ear__L=(4 * max(0, s(TAU * t)), 0, 0), ear__R=(4 * max(0, s(TAU * t + 2)), 0, 0)))

def stand_up(t):
    return sit(1 - t)

CLIPS = [("Idle", idle, 48), ("Walk", walk, 24), ("Sit", sit, 20), ("SitIdle", sit_idle, 48), ("StandUp", stand_up, 20)]

def apply_pose(pose, frame=None, prev=None):
    prev = prev if prev is not None else {}
    for pb in arm.pose.bones:
        v = pose.get(pb.name, [0] * 6)
        R = REST[pb.name]
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
            if pb.name == "body":
                pb.keyframe_insert("location", frame=frame)

arm.animation_data_create()
ad = arm.animation_data
ACTIONS = {}

def set_action(act):
    ad.action = act
    if hasattr(ad, "action_slot") and act is not None and len(act.slots):
        ad.action_slot = act.slots[0]

for name, fn, n in CLIPS:
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
    if name in ("Idle", "Walk", "SitIdle"):
        act.use_cyclic = True
    ACTIONS[name] = act

# stash every clip on a muted NLA track so all of them are kept and exported
set_action(None)
for name, _, n in CLIPS:
    tr = ad.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 0, ACTIONS[name])
    tr.mute = True
set_action(ACTIONS["Walk"])
scene.frame_start, scene.frame_end = 0, 24
scene.frame_set(0)

# ---------------------------------------------------------------- ground check
def min_z_report(label):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = dog.evaluated_get(dg)
    me = ev.to_mesh()
    zs = {}
    for v in me.vertices:
        z = (ev.matrix_world @ v.co).z
        for g in v.groups:
            nm = dog.vertex_groups[g.group].name
            zs[nm] = min(zs.get(nm, 9), z)
    ev.to_mesh_clear()
    low = sorted(zs.items(), key=lambda kv: kv[1])[:6]
    print(f"[minz] {label}: " + ", ".join(f"{k}={v:.3f}" for k, v in low))

for name, frame in (("Idle", 0), ("Walk", 0), ("Walk", 6), ("Walk", 12), ("Sit", 20), ("SitIdle", 12)):
    set_action(ACTIONS[name]); scene.frame_set(frame); min_z_report(f"{name}@{frame}")

# ---------------------------------------------------------------- camera + lights (kept in the .blend)
def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()

cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
cam.data.lens = 50
cam.location = (1.9, -3.3, 1.5)
look_at(cam, (0, -0.05, 0.62))
scene.collection.objects.link(cam)
scene.camera = cam
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
sun.data.energy = 2.6; sun.data.angle = math.radians(12)
sun.location = (2, -3, 5); look_at(sun, (0, 0, 0.5))
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
fill.data.energy = 250; fill.data.size = 3
fill.location = (-2.5, -2.5, 2.0); look_at(fill, (0, 0, 0.7))
scene.collection.objects.link(fill)
world = bpy.data.worlds.new("World"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.82, 0.9, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
scene.world = world

# ---------------------------------------------------------------- save + export
set_action(ACTIONS["Walk"]); scene.frame_set(0)
blend_path = os.path.join(OUT, "doberman.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print("[saved]", blend_path)

bpy.ops.object.select_all(action="DESELECT")
dog.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "doberman.glb"), export_format="GLB", use_selection=True,
                          export_animations=True, export_animation_mode="ACTIONS", export_yup=True,
                          export_force_sampling=True)
print("[exported] doberman.glb")

# ---------------------------------------------------------------- previews (not saved into the .blend)
if RENDER:
    gm = bpy.data.meshes.new("Ground")
    gb = bmesh.new(); bmesh.ops.create_grid(gb, x_segments=1, y_segments=1, size=20); gb.to_mesh(gm); gb.free()
    ground = bpy.data.objects.new("Ground", gm)
    gm.materials.append(make_mat("GroundMat", (0.42, 0.45, 0.5), 0.9))
    scene.collection.objects.link(ground)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(os.environ.get("DOG_SAMPLES", "40"))
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
    scene.render.resolution_x = scene.render.resolution_y = int(os.environ.get("DOG_RES", "640"))
    scene.view_settings.view_transform = "Standard"
    shots = [("stand", "Idle", 0, (1.9, -3.3, 1.5)), ("walk", "Walk", 6, (3.4, -1.6, 1.2)),
             ("walk_b", "Walk", 16, (1.9, -3.3, 1.5)),
             ("sit_front", "SitIdle", 12, (0.0, -3.9, 1.2)), ("sit_side", "SitIdle", 12, (3.6, -0.6, 1.1)),
             ("sit_34", "SitIdle", 30, (1.9, -3.3, 1.5)), ("sit_mid", "Sit", 10, (3.4, -1.6, 1.2))]
    only = os.environ.get("DOG_SHOTS")
    for tag, clip, frame, loc in shots:
        if only and tag not in only.split(","):
            continue
        set_action(ACTIONS[clip]); scene.frame_set(frame)
        cam.location = loc; look_at(cam, (0, -0.15, 0.66)); cam.data.lens = 62
        scene.render.filepath = os.path.join(OUT, f"preview_{tag}.png")
        bpy.ops.render.render(write_still=True)
        print("[render]", tag)
