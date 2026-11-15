"""Blocky ginger tabby cat: python3 cat.py <out_dir>   (MODE=build|stills|gif)"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blockrig as B
from blockrig import P, add, scale, mix, TAU, smooth, ramp, hold

OUT = os.path.abspath(sys.argv[-1]) if len(sys.argv) > 1 and not sys.argv[-1].endswith(".py") else os.getcwd()
MODE = os.environ.get("MODE", "build")
s, c = math.sin, math.cos

B.start()
B.materials({
    "fur":    ("Fur_Ginger", (0.78, 0.30, 0.05), 0.6),
    "stripe": ("Fur_Stripe", (0.47, 0.15, 0.025), 0.6),
    "cream":  ("Fur_Cream", (0.93, 0.82, 0.66), 0.6),
    "paw":    ("Paw_Cream", (0.93, 0.82, 0.66), 0.6),
    "pink":   ("Pink", (0.90, 0.42, 0.48), 0.45),
    "eye":    ("Eye_Green", (0.30, 0.62, 0.12), 0.15),
    "pupil":  ("Pupil", (0.004, 0.004, 0.004), 0.1),
    "white":  ("White", (0.95, 0.95, 0.95), 0.4),
})

FX, FY, HX, HY = 0.09, -0.20, 0.105, 0.28
TOP, KNEE, ANK = 0.34, 0.18, 0.06
parts = [
    ("body",  "fur",    (0, 0.08, 0.42), (0.26, 0.56, 0.24), {}),
    ("body",  "stripe", (0, 0.00, 0.50), (0.268, 0.045, 0.10), {"bevel": 0.008}),
    ("body",  "stripe", (0, 0.12, 0.50), (0.268, 0.045, 0.10), {"bevel": 0.008}),
    ("body",  "stripe", (0, 0.24, 0.50), (0.268, 0.045, 0.10), {"bevel": 0.008}),
    ("chest", "fur",    (0, -0.20, 0.43), (0.29, 0.22, 0.27), {}),
    ("chest", "cream",  (0, -0.315, 0.40), (0.17, 0.02, 0.15), {"bevel": 0.006}),
    ("neck",  "fur",    (0, -0.28, 0.57), (0.17, 0.15, 0.16), {"rot": (-20, (0, -0.25, 0.52))}),
    ("head",  "fur",    (0, -0.36, 0.74), (0.36, 0.30, 0.28), {}),
    ("head",  "stripe", (0, -0.45, 0.882), (0.035, 0.11, 0.012), {"bevel": 0.004}),
    ("head",  "stripe", (0.07, -0.455, 0.882), (0.03, 0.09, 0.012), {"bevel": 0.004}),
    ("head",  "stripe", (-0.07, -0.455, 0.882), (0.03, 0.09, 0.012), {"bevel": 0.004}),
    ("head",  "cream",  (0, -0.525, 0.685), (0.17, 0.05, 0.10), {"bevel": 0.012}),      # muzzle
    ("head",  "pink",   (0, -0.555, 0.722), (0.05, 0.022, 0.03), {"bevel": 0.008}),     # nose
    ("head",  "eye",    (0.095, -0.512, 0.775), (0.075, 0.02, 0.075), {"bevel": 0.008}),
    ("head",  "eye",    (-0.095, -0.512, 0.775), (0.075, 0.02, 0.075), {"bevel": 0.008}),
    ("head",  "pupil",  (0.095, -0.524, 0.775), (0.024, 0.008, 0.058), {"bevel": 0.003}),
    ("head",  "pupil",  (-0.095, -0.524, 0.775), (0.024, 0.008, 0.058), {"bevel": 0.003}),
    ("head",  "white",  (0.108, -0.529, 0.795), (0.014, 0.005, 0.014), {"bevel": 0}),
    ("head",  "white",  (-0.082, -0.529, 0.795), (0.014, 0.005, 0.014), {"bevel": 0}),
    ("jaw",   "cream",  (0, -0.515, 0.628), (0.10, 0.05, 0.028), {"bevel": 0.006}),
    ("tongue", "pink",  (0, -0.50, 0.648), (0.05, 0.07, 0.012), {"bevel": 0.004}),
    ("ear.L", "fur",    (0.12, -0.36, 0.94), (0.12, 0.06, 0.14), {"taper": 0.15}),
    ("ear.R", "fur",    (-0.12, -0.36, 0.94), (0.12, 0.06, 0.14), {"taper": 0.15}),
    ("ear.L", "pink",   (0.12, -0.392, 0.925), (0.065, 0.012, 0.08), {"taper": 0.2, "bevel": 0.003}),
    ("ear.R", "pink",   (-0.12, -0.392, 0.925), (0.065, 0.012, 0.08), {"taper": 0.2, "bevel": 0.003}),
]
for sx in (1, -1):                                   # whiskers
    for z, tilt in ((0.70, 8), (0.672, -8)):
        parts.append(("head", "white", (sx * 0.15, -0.53, z), (0.13, 0.006, 0.007),
                      {"bevel": 0, "roll": (-sx * tilt, (sx * 0.085, -0.53, z))}))
bones = [
    ("root",  (0, 0, 0), (0, 0.2, 0), None),
    ("body",  (0, 0.30, 0.42), (0, 0.0, 0.42), "root"),
    ("chest", (0, 0.0, 0.42), (0, -0.28, 0.44), "body"),
    ("neck",  (0, -0.25, 0.52), (0, -0.32, 0.62), "chest"),
    ("head",  (0, -0.32, 0.62), (0, -0.32, 0.86), "neck"),
    ("jaw",   (0, -0.48, 0.635), (0, -0.55, 0.625), "head"),
    ("tongue", (0, -0.47, 0.648), (0, -0.54, 0.648), "jaw"),
    ("ear.L", (0.12, -0.36, 0.875), (0.13, -0.36, 1.0), "head"),
    ("ear.R", (-0.12, -0.36, 0.875), (-0.13, -0.36, 1.0), "head"),
]
# tail: three segments curving up and back
py, pz, par = 0.35, 0.50, "body"
for i, (ang, mat) in enumerate(((55, "fur"), (30, "fur"), (8, "stripe")), 1):
    L = 0.16
    parts.append((f"tail{i}", mat, (0, py, pz + L / 2), (0.065, 0.065, L + 0.02), {"rot": (-ang, (0, py, pz))}))
    ny, nz = py + L * s(math.radians(ang)), pz + L * c(math.radians(ang))
    bones.append((f"tail{i}", (0, py, pz), (0, ny, nz), par))
    py, pz, par = ny, nz, f"tail{i}"
B.quad_legs(parts, bones, FX, FY, HX, HY, TOP, KNEE, ANK, 0.085, 0.095, mats=("fur", "fur", "paw"), paw_extra=0.045)
B.build("Cat", parts, bones, loc_bones=("body", "tongue"))

# ------------------------------------------------------------------ poses
SITB, info = B.solve_sit(pivot=(0.30, 0.42), front=(FY, TOP), hind=(HY, TOP, KNEE), corner=(0.06, -0.12),
                         th=-52, chest=(0.0, 0.42), ankle=ANK)
print("[sit]", {k: round(v, 2) for k, v in info.items()})
TH = info["th"] + info["cb"]
SIT = add(SITB, P(neck=(-TH * 0.5, 0, 0), head=(-TH * 0.5, 0, 0),
                  tail1=(25, 35, 0), tail2=(20, 45, 0), tail3=(10, 45, 0)))

def tail_sway(t, k=1.0, n=1):
    return P(tail1=(0, 12 * k * s(TAU * n * t), 0), tail2=(0, 18 * k * s(TAU * n * t - 0.7), 0),
             tail3=(0, 24 * k * s(TAU * n * t - 1.4), 0))

def ears(t):
    return P(ear__L=(0, 0, 10 * max(0, s(TAU * 2 * t)) ** 4), ear__R=(0, 0, -10 * max(0, s(TAU * 2 * t + 2)) ** 4))

def idle(t):
    return add(tail_sway(t), ears(t),
               P(body=(0.4 * s(TAU * t), 0, 0, 0, 0, 0.003 * s(TAU * t)), chest=(0.8 * s(TAU * t + 0.5), 0, 0),
                 head=(2 * s(TAU * t + 1), 5 * s(TAU * t), 3 * s(TAU * t + 2))))

def walk(t):
    ph = TAU * t
    return add(B.quad_walk(t, amp=24, front=(12, 36, 12), hind=(18, 32, 10)), tail_sway(t, 0.6),
               P(body=(0.8 * s(2 * ph), 0, 1.2 * s(ph), 0, 0, 0.008 * c(2 * ph)),
                 chest=(0, 2.5 * s(ph), 0), neck=(1.5 * s(2 * ph + 0.6), 0, 0), head=(-1.5 * s(2 * ph + 0.6), -2.5 * s(ph), 0),
                 tail1=(-12, 0, 0)))

def sit(t):
    return add(scale(SIT, smooth(t)), P(head=(8 * s(math.pi * t), 0, 0)))

def sit_idle(t):
    return add(SIT, ears(t), P(head=(2 * s(TAU * t), 6 * s(TAU * t), 8 * s(TAU * t)), neck=(0, 3 * s(TAU * t), 0),
                               chest=(0.6 * s(TAU * 2 * t), 0, 0),
                               tail2=(0, 8 * s(TAU * 2 * t), 0), tail3=(-14 * max(0, s(TAU * 2 * t)), 14 * s(TAU * 2 * t - 0.8), 0)))

def lick_paw(t):
    e = hold(t, 0.18, 0.84)                       # raise paw, lick, lower paw
    lk = s(TAU * 5 * t) * e                       # lick strokes
    up_world, lo_world = -62 + 5 * lk, -152 + 6 * lk
    paw = P(**{"front_upper__R": (0, 0, 0)})
    paw["front_upper.R"] = [(up_world - TH) - SIT["front_upper.R"][0], 0, 14, 0, 0, 0]
    paw["front_lower.R"] = [lo_world - up_world, 0, 0, 0, 0, 0]
    paw["front_paw.R"] = [20 - SIT["front_paw.R"][0], 0, 0, 0, 0, 0]
    extra = add(paw, P(head=(30 - 7 * lk, -10, -8), neck=(10, -6, 0), jaw=(16, 0, 0),
                       tongue=(0, 0, 0, 0, -0.045 - 0.012 * lk, 0), body=(0, 0, 2)))
    return add(SIT, scale(extra, e), scale(ears(t), 0.5),
               P(tail3=(-10 * max(0, s(TAU * 2 * t)), 10 * s(TAU * 2 * t), 0)))

def stretch(t):
    e = hold(t, 0.3, 0.72)
    th = 20.0
    oy, oz = B.rot2(FY - 0.30, TOP - 0.42, th)
    phi = -math.degrees(math.acos(min(1, (0.42 + oz - ANK) / (TOP - ANK))))
    pose = P(body=(th, 0, 0), neck=(-18, 0, 0), head=(-14, 0, 0), tail1=(-30, 0, 0), tail2=(-15, 0, 0), jaw=(10, 0, 0))
    for sd in ("L", "R"):
        pose[f"front_upper.{sd}"] = [phi - th, 0, 0, 0, 0, 0]
        pose[f"front_paw.{sd}"] = [-phi, 0, 0, 0, 0, 0]
        pose[f"hind_upper.{sd}"] = [-th, 0, 0, 0, 0, 0]
    return add(scale(pose, e), tail_sway(t, 0.4))

def stand_up(t):
    return sit(1 - t)

B.bake([("Idle", idle, 48, True), ("Walk", walk, 24, True), ("Sit", sit, 20, False), ("SitIdle", sit_idle, 48, True),
        ("LickPaw", lick_paw, 84, True), ("Stretch", stretch, 60, False), ("StandUp", stand_up, 20, False)], active="Walk")
B.minz([("Idle", 0), ("Walk", 6), ("Sit", 20), ("LickPaw", 42), ("Stretch", 30)])
B.stage(size=0.72, target=(0, -0.1, 0.62), light=0.62)
B.save_export(OUT, "cat")

if MODE in ("stills", "all"):
    only = os.environ.get("SHOTS")
    shots = [("stand", "Idle", 0, None, None), ("walk", "Walk", 6, (3.4, -1.6, 1.2), None),
             ("sit_front", "SitIdle", 12, (0.0, -3.9, 1.2), None), ("sit_side", "SitIdle", 12, (3.6, -0.6, 1.1), None),
             ("lick", "LickPaw", 45, (-1.6, -3.5, 1.3), None), ("lick_side", "LickPaw", 45, (-3.6, -0.8, 1.0), None),
             ("lick_front", "LickPaw", 38, (0.0, -3.9, 1.2), None), ("stretch", "Stretch", 30, (3.4, -1.6, 1.2), None),
             ("sit_back", "SitIdle", 30, (2.2, 3.2, 1.6), None)]
    if only:
        shots = [x for x in shots if x[0] in only.split(",")]
    B.render_stills(OUT, "cat", shots)
if MODE in ("gif", "all"):
    B.render_gif(OUT, "cat", [("Walk", range(0, 24), 42), ("Sit", range(0, 21, 2), 84), ("LickPaw", range(0, 84, 2), 84),
                              ("StandUp", range(0, 21, 2), 84), ("Stretch", range(0, 60, 2), 84)], cam=(-1.8, -3.5, 1.4))
