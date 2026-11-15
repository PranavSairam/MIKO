"""Blocky blue bird with a small tree: python3 bird.py <out_dir>   (MODE=build|stills|gif)"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blockrig as B
from blockrig import P, add, scale, mix, TAU, smooth, ramp, hold

OUT = os.path.abspath(sys.argv[-1]) if len(sys.argv) > 1 and not sys.argv[-1].endswith(".py") else os.getcwd()
MODE = os.environ.get("MODE", "build")
s, c = math.sin, math.cos

B.start()
B.materials({
    "blue":   ("Feather_Blue", (0.07, 0.33, 0.78), 0.55),
    "navy":   ("Feather_Navy", (0.03, 0.15, 0.45), 0.55),
    "cream":  ("Belly_Cream", (0.95, 0.90, 0.78), 0.6),
    "orange": ("Beak_Orange", (0.95, 0.42, 0.04), 0.45),
    "eye":    ("Eye", (0.004, 0.004, 0.004), 0.1),
    "white":  ("White", (0.95, 0.95, 0.95), 0.4),
    "pink":   ("Blush", (0.95, 0.50, 0.50), 0.6),
    "bark":   ("Bark", (0.30, 0.16, 0.07), 0.8),
    "leaf":   ("Leaf_Green", (0.13, 0.45, 0.10), 0.7),
    "leaf2":  ("Leaf_Light", (0.30, 0.62, 0.14), 0.7),
    "fruit":  ("Fruit_Red", (0.80, 0.06, 0.05), 0.35),
})
parts = [
    ("body",  "blue",  (0, 0.02, 0.30), (0.26, 0.34, 0.26), {"bevel": 0.03}),
    ("body",  "cream", (0, -0.152, 0.275), (0.18, 0.02, 0.17), {"bevel": 0.006}),
    ("body",  "cream", (0, -0.03, 0.168), (0.18, 0.22, 0.014), {"bevel": 0.005}),
    ("head",  "blue",  (0, -0.10, 0.52), (0.24, 0.24, 0.22), {"bevel": 0.03}),
    ("head",  "orange", (0, -0.215, 0.57), (0.09, 0.045, 0.11), {"taper": 0.35, "rot": (90, (0, -0.215, 0.515)), "bevel": 0.008}),
    ("beak",  "orange", (0, -0.215, 0.53), (0.075, 0.025, 0.09), {"taper": 0.35, "rot": (90, (0, -0.215, 0.485)), "bevel": 0.005}),
    ("head",  "eye",   (0.078, -0.222, 0.55), (0.05, 0.012, 0.055), {"bevel": 0.005}),
    ("head",  "eye",   (-0.078, -0.222, 0.55), (0.05, 0.012, 0.055), {"bevel": 0.005}),
    ("head",  "white", (0.088, -0.23, 0.565), (0.013, 0.004, 0.013), {"bevel": 0}),
    ("head",  "white", (-0.068, -0.23, 0.565), (0.013, 0.004, 0.013), {"bevel": 0}),
    ("head",  "pink",  (0.092, -0.221, 0.49), (0.04, 0.008, 0.025), {"bevel": 0.003}),
    ("head",  "pink",  (-0.092, -0.221, 0.49), (0.04, 0.008, 0.025), {"bevel": 0.003}),
    ("head",  "navy",  (0, -0.07, 0.665), (0.04, 0.10, 0.08), {"taper": 0.5, "rot": (-25, (0, -0.07, 0.625))}),
    ("head",  "navy",  (0, -0.01, 0.65), (0.035, 0.08, 0.06), {"taper": 0.5, "rot": (-35, (0, -0.01, 0.62))}),
    ("tail",  "navy",  (0, 0.265, 0.325), (0.17, 0.21, 0.03), {"rot": (22, (0, 0.17, 0.32)), "bevel": 0.008}),
]
bones = [
    ("root",  (0, 0, 0), (0, 0.15, 0), None),
    ("hips",  (0, 0.02, 0.19), (0, 0.17, 0.19), "root"),
    ("body",  (0, 0.02, 0.20), (0, 0.02, 0.42), "hips"),
    ("head",  (0, -0.06, 0.42), (0, -0.06, 0.64), "body"),
    ("beak",  (0, -0.215, 0.495), (0, -0.30, 0.49), "head"),
    ("tail",  (0, 0.17, 0.32), (0, 0.34, 0.39), "body"),
]
for side, sx in (("L", 1), ("R", -1)):
    x = sx * 0.148
    parts += [
        (f"wing.{side}", "blue", (x, 0.03, 0.335), (0.035, 0.22, 0.14), {"bevel": 0.008}),
        (f"wing_tip.{side}", "navy", (x, 0.04, 0.21), (0.03, 0.18, 0.13), {"bevel": 0.008}),
        (f"leg.{side}", "orange", (sx * 0.07, 0.02, 0.115), (0.03, 0.03, 0.17), {"bevel": 0.006}),
        (f"foot.{side}", "orange", (sx * 0.07, -0.015, 0.018), (0.075, 0.13, 0.03), {"bevel": 0.006}),
    ]
    bones += [
        (f"wing.{side}", (x, 0.03, 0.40), (x, 0.03, 0.27), "body"),
        (f"wing_tip.{side}", (x, 0.03, 0.27), (x, 0.03, 0.145), f"wing.{side}"),
        (f"leg.{side}", (sx * 0.07, 0.02, 0.19), (sx * 0.07, 0.02, 0.035), "hips"),
        (f"foot.{side}", (sx * 0.07, 0.02, 0.035), (sx * 0.07, -0.08, 0.01), f"leg.{side}"),
    ]
B.build("Bird", parts, bones, loc_bones=("hips",))

# small tree with a perch branch (static, separate object)
TREE_AT = (-1.15, 0.2, 0.0)
PERCH = (0.64, 0.0, 0.53)                      # relative to the tree
tree = B.prop("Tree", [
    ("bark",  (0, 0, 0.36), (0.17, 0.17, 0.72), {"taper": 0.8}),
    ("bark",  (0.43, 0, 0.50), (0.78, 0.06, 0.06), {"bevel": 0.012}),
    ("leaf",  (0.86, 0, 0.53), (0.11, 0.12, 0.10), {}),
    ("leaf",  (0, 0, 0.94), (0.70, 0.70, 0.46), {"bevel": 0.04}),
    ("leaf2", (0.03, -0.02, 1.27), (0.48, 0.48, 0.30), {"bevel": 0.035}),
    ("leaf",  (0, 0, 1.49), (0.27, 0.27, 0.20), {"bevel": 0.03}),
    ("leaf2", (-0.33, 0.1, 0.86), (0.16, 0.30, 0.20), {}),
    ("fruit", (0.21, -0.355, 0.90), (0.07, 0.05, 0.07), {"bevel": 0.015}),
    ("fruit", (-0.16, -0.355, 1.04), (0.07, 0.05, 0.07), {"bevel": 0.015}),
    ("fruit", (0.12, -0.245, 1.30), (0.065, 0.05, 0.065), {"bevel": 0.015}),
], location=TREE_AT)
B.empty("PerchPoint", PERCH, parent=tree)
PERCH_W = tuple(a + b for a, b in zip(TREE_AT, PERCH))

# ------------------------------------------------------------------ poses
def pulse(t, a, b, w=0.05):
    return ramp(t, a, a + w) - ramp(t, b, b + w)

def idle(t):
    return P(hips=(0, 0, 0, 0, 0, 0.004 * s(TAU * 2 * t)),
             body=(1.5 * s(TAU * 2 * t), 0, 0),
             head=(4 * pulse(t, 0.55, 0.9), 28 * pulse(t, 0.08, 0.42) - 22 * pulse(t, 0.55, 0.9), 14 * pulse(t, 0.25, 0.42)),
             tail=(-14 * max(0, s(TAU * 3 * t)) ** 6, 0, 0),
             wing__L=(0, 0, -5 * pulse(t, 0.7, 0.76, 0.03)), wing__R=(0, 0, 5 * pulse(t, 0.7, 0.76, 0.03)))

def walk(t):
    ph = TAU * t
    pose = P(hips=(0, 4 * s(ph), 0, 0, 0, 0.012 * abs(s(ph))), body=(3 * s(2 * ph), 0, 3 * s(ph)),
             head=(-8 * s(2 * ph + 0.5), -4 * s(ph), 0), tail=(4 * s(2 * ph), 6 * s(ph), 0))
    for sd, off in (("L", 0), ("R", math.pi)):
        sw = 30 * s(ph + off)
        lift = max(0, -c(ph + off))
        pose[f"leg.{sd}"] = [sw - 10 * lift, 0, 0, 0, 0, 0]
        pose[f"foot.{sd}"] = [-sw + 28 * lift, 0, 0, 0, 0, 0]
    return pose

def hop(t):
    j = max(0, s(math.pi * ramp(t, 0.25, 0.85)))          # airborne part
    cr = hold(t, 0.12, 0.3) * (1 - j) + 0.7 * ramp(t, 0.85, 0.93) * (1 - ramp(t, 0.93, 1.0))
    pose = P(hips=(0, 0, 0, 0, 0, 0.10 * j - 0.025 * cr), body=(10 * cr - 6 * j, 0, 0), head=(-8 * cr + 4 * j, 0, 0),
             tail=(-10 * j + 8 * cr, 0, 0), wing__L=(0, 0, -22 * j), wing__R=(0, 0, 22 * j))
    for sd in ("L", "R"):
        pose[f"leg.{sd}"] = [-28 * cr + 18 * j, 0, 0, 0, 0, 0]
        pose[f"foot.{sd}"] = [28 * cr + 22 * j, 0, 0, 0, 0, 0]
    return pose

FLY = P(body=(38, 0, 0), head=(-34, 0, 0), tail=(-18, 0, 0),
        leg__L=(62, 0, 0), leg__R=(62, 0, 0), foot__L=(30, 0, 0), foot__R=(30, 0, 0))

def flap(ph, amp=1.0):
    a = 92 + 42 * amp * s(ph)                   # >90 = wings above horizontal
    tip = 24 * amp * s(ph - 1.0)
    return P(wing__L=(0, 0, -a), wing__R=(0, 0, a), wing_tip__L=(0, 0, -tip), wing_tip__R=(0, 0, tip))

def fly(t):
    ph = TAU * t
    return add(FLY, flap(ph), P(hips=(0, 0, 0, 0, 0, -0.03 * s(ph)), body=(3 * c(ph), 0, 0), tail=(6 * s(ph), 0, 0)))

def take_off(t):
    e = ramp(t, 0.25, 1.0)
    cr = hold(t, 0.12, 0.4)
    ph = TAU * 1.5 * t - math.pi / 2             # ends in phase with Fly frame 0... (sin = 0 rising)
    wings = scale(flap(TAU * (1.5 * t - 1.5)), ramp(t, 0.1, 0.5))
    pose = add(scale(FLY, e), wings, P(hips=(0, 0, 0, 0, 0, -0.03 * cr), body=(12 * cr, 0, 0)))
    for sd in ("L", "R"):
        pose[f"leg.{sd}"][0] += -25 * cr
        pose[f"foot.{sd}"][0] += 25 * cr
    return pose

def land(t):
    e = 1 - ramp(t, 0.0, 0.7)
    cr = hold(t, 0.55, 0.85)
    wings = scale(flap(TAU * 1.5 * t), 1 - ramp(t, 0.55, 0.95))
    pose = add(scale(FLY, e), wings, P(hips=(0, 0, 0, 0, 0, -0.03 * cr), body=(-14 * (1 - e) * (1 - ramp(t, 0.7, 1.0)) + 10 * cr, 0, 0)))
    for sd in ("L", "R"):
        pose[f"leg.{sd}"][0] += -25 * cr
        pose[f"foot.{sd}"][0] += 25 * cr
    return pose

def peck(t):
    d = max(pulse(t, 0.12, 0.30, 0.08), pulse(t, 0.48, 0.66, 0.08))
    pose = P(body=(52 * d, 0, 0), head=(26 * d, 0, 0), beak=(14 * d, 0, 0), tail=(-20 * d, 0, 0),
             hips=(0, 0, 0, 0, 0, -0.012 * d))
    return pose

def chirp(t):
    op = max(0, s(TAU * 4 * t)) * hold(t, 0.1, 0.9)
    e = hold(t, 0.12, 0.88)
    return P(body=(-8 * e, 0, 0), head=(-14 * e - 4 * op, 0, 8 * s(TAU * 2 * t) * e), beak=(24 * op, 0, 0),
             tail=(10 * op, 0, 0), wing__L=(0, 0, -10 * op), wing__R=(0, 0, 10 * op),
             hips=(0, 0, 0, 0, 0, 0.006 * op))

B.bake([("Idle", idle, 48, True), ("Walk", walk, 16, True), ("Hop", hop, 16, True), ("Fly", fly, 10, True),
        ("TakeOff", take_off, 14, False), ("Land", land, 14, False), ("Peck", peck, 36, False), ("Chirp", chirp, 36, False)],
       active="Fly")
B.minz([("Idle", 0), ("Walk", 4), ("Hop", 0), ("Peck", 8), ("Fly", 3)])
B.stage(size=1.0, target=(-0.42, 0.1, 0.72), cam=(1.3, -4.3, 1.5), light=0.8)
B.save_export(OUT, "bird")

CLOSE, CT = (0.95, -1.75, 0.75), (0, 0.0, 0.33)
if MODE in ("stills", "all"):
    only = os.environ.get("SHOTS")
    onp = (PERCH_W, 0)
    shots = [("stand", "Idle", 0, CLOSE, CT), ("walk", "Walk", 4, (1.7, -0.9, 0.6), CT),
             ("fly", "Fly", 2, (1.1, -1.9, 0.9), (0, 0, 0.35)), ("fly_down", "Fly", 7, (0.0, -2.2, 0.7), (0, 0, 0.35)),
             ("fly_side", "Fly", 3, (2.1, -0.4, 0.5), (0, 0, 0.35)), ("peck", "Peck", 9, (1.7, -0.9, 0.6), (0, -0.1, 0.25)),
             ("scene", "Idle", 0, None, None), ("perch", "Chirp", 14, None, None, onp),
             ("perch_close", "Chirp", 14, (0.6, -2.3, 1.1), (-0.6, 0.2, 0.85), onp)]
    if only:
        shots = [x for x in shots if x[0] in only.split(",")]
    B.render_stills(OUT, "bird", shots)
if MODE in ("gif", "all"):
    A, Bp = (0.35, -0.25, 0.0), PERCH_W
    def mover(i, n):
        if i < 23:
            return (A, -30)
        if i < 53:
            u = (i - 23) / 30
            v = smooth(u)
            loc = tuple(a + (b - a) * v for a, b in zip(A, Bp))
            return ((loc[0], loc[1], loc[2] + 0.28 * s(math.pi * u)), -30 - 55 * s(math.pi * min(1, u * 1.2)) * (1 - ramp(u, 0.7, 1)) + 30 * ramp(u, 0.7, 1))
        return (Bp, 0)
    B.render_gif(OUT, "bird", [("Walk", range(0, 16), 42), ("TakeOff", range(0, 14, 2), 84), ("Fly", list(range(10)) * 3, 42),
                               ("Land", range(0, 14, 2), 84), ("Chirp", range(0, 36, 2), 84)], mover=mover)
