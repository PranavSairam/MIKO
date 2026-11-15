"""Blocky koala: python3 koala.py <out_dir>   (MODE=build|stills|gif)"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blockrig as B
from blockrig import P, add, scale, mix, TAU, smooth, ramp, hold

OUT = os.path.abspath(sys.argv[-1]) if len(sys.argv) > 1 and not sys.argv[-1].endswith(".py") else os.getcwd()
MODE = os.environ.get("MODE", "build")
s, c = math.sin, math.cos

B.start()
B.materials({
    "fur":   ("Fur_Grey", (0.21, 0.225, 0.26), 0.7),
    "cream": ("Fur_Cream", (0.88, 0.86, 0.80), 0.7),
    "paw":   ("Paw_Dark", (0.13, 0.14, 0.16), 0.6),
    "nose":  ("Nose", (0.012, 0.012, 0.015), 0.25),
    "eye":   ("Eye", (0.004, 0.004, 0.004), 0.1),
    "white": ("White", (0.95, 0.95, 0.95), 0.4),
    "pink":  ("Blush", (0.92, 0.50, 0.55), 0.6),
})
FX, FY, HX, HY = 0.135, -0.17, 0.14, 0.24
TOP, KNEE, ANK = 0.26, 0.14, 0.06
parts = [
    ("body",  "fur",   (0, 0.08, 0.40), (0.40, 0.50, 0.36), {}),
    ("body",  "cream", (0, 0.12, 0.216), (0.27, 0.36, 0.02), {"bevel": 0.006}),
    ("body",  "cream", (0, 0.335, 0.40), (0.20, 0.02, 0.16), {"bevel": 0.006}),
    ("chest", "fur",   (0, -0.17, 0.41), (0.42, 0.22, 0.38), {}),
    ("chest", "cream", (0, -0.17, 0.216), (0.27, 0.20, 0.02), {"bevel": 0.006}),
    ("chest", "cream", (0, -0.285, 0.36), (0.27, 0.02, 0.22), {"bevel": 0.006}),
    ("head",  "fur",   (0, -0.36, 0.62), (0.46, 0.34, 0.38), {"bevel": 0.03}),
    ("head",  "nose",  (0, -0.545, 0.60), (0.13, 0.05, 0.17), {"bevel": 0.02}),
    ("head",  "eye",   (0.135, -0.532, 0.675), (0.05, 0.02, 0.055), {"bevel": 0.006}),
    ("head",  "eye",   (-0.135, -0.532, 0.675), (0.05, 0.02, 0.055), {"bevel": 0.006}),
    ("head",  "white", (0.145, -0.544, 0.69), (0.014, 0.005, 0.014), {"bevel": 0}),
    ("head",  "white", (-0.125, -0.544, 0.69), (0.014, 0.005, 0.014), {"bevel": 0}),
    ("head",  "pink",  (0.17, -0.531, 0.585), (0.065, 0.01, 0.035), {"bevel": 0.004}),
    ("head",  "pink",  (-0.17, -0.531, 0.585), (0.065, 0.01, 0.035), {"bevel": 0.004}),
    ("head",  "eye",   (0, -0.532, 0.485), (0.07, 0.01, 0.014), {"bevel": 0.003}),          # mouth
    ("ear.L", "fur",   (0.27, -0.33, 0.81), (0.21, 0.10, 0.21), {"bevel": 0.03}),
    ("ear.R", "fur",   (-0.27, -0.33, 0.81), (0.21, 0.10, 0.21), {"bevel": 0.03}),
    ("ear.L", "cream", (0.27, -0.385, 0.81), (0.13, 0.02, 0.13), {"bevel": 0.006}),
    ("ear.R", "cream", (-0.27, -0.385, 0.81), (0.13, 0.02, 0.13), {"bevel": 0.006}),
]
bones = [
    ("root",  (0, 0, 0), (0, 0.2, 0), None),
    ("body",  (0, 0.26, 0.40), (0, 0.0, 0.40), "root"),
    ("chest", (0, 0.0, 0.40), (0, -0.26, 0.42), "body"),
    ("head",  (0, -0.24, 0.50), (0, -0.24, 0.80), "chest"),
    ("ear.L", (0.19, -0.33, 0.74), (0.33, -0.33, 0.88), "head"),
    ("ear.R", (-0.19, -0.33, 0.74), (-0.33, -0.33, 0.88), "head"),
]
B.quad_legs(parts, bones, FX, FY, HX, HY, TOP, KNEE, ANK, 0.14, 0.15, mats=("fur", "fur", "paw"), paw_extra=0.03)
B.build("Koala", parts, bones)

# ------------------------------------------------------------------ poses
TH = -66.0
SITB, info = B.solve_sit(pivot=(0.26, 0.40), front=(FY, TOP), hind=(HY, TOP, KNEE), corner=(0.07, -0.18), th=TH,
                         hind_mode="out", clear=0.012)
print("[sit]", {k: round(v, 2) for k, v in info.items()})
ARM, FORE = -38.0, -22.0                       # resting arm: world pitch of upper arm, extra bend of forearm
SIT = dict(SITB)
SIT["body"] = [TH, 0, 0, 0, -0.10, SITB["body"][5]]
SIT["head"] = [-TH - 6, 0, 0, 0, 0, 0]
for sd, sg in (("L", 1), ("R", -1)):
    SIT[f"front_upper.{sd}"] = [ARM - TH, 0, sg * -6, 0, 0, 0]
    SIT[f"front_lower.{sd}"] = [FORE, 0, 0, 0, 0, 0]
    SIT[f"front_paw.{sd}"] = [0, 0, 0, 0, 0, 0]
    SIT[f"hind_upper.{sd}"] = [SITB[f"hind_upper.{sd}"][0], sg * 14, 0, 0, 0, 0]
SIT = add(SIT)

def ears(t, k=1.0):
    w = max(0, s(TAU * 2 * t)) ** 3
    return P(ear__L=(0, 0, 14 * k * w), ear__R=(0, 0, -14 * k * max(0, s(TAU * 2 * t + 1.5)) ** 3))

def idle(t):
    return add(ears(t), P(body=(0.5 * s(TAU * t), 0, 0, 0, 0, 0.004 * s(TAU * t)), chest=(1.0 * s(TAU * t + 0.5), 0, 0),
                          head=(3 * s(TAU * t + 1), 8 * s(TAU * t), 4 * s(TAU * t + 2))))

def walk(t):
    ph = TAU * t
    return add(B.quad_walk(t, amp=16, front=(10, 30, 10), hind=(14, 28, 8)), ears(t, 0.4),
               P(body=(1.0 * s(2 * ph), 3 * s(ph), 4 * s(ph), 0, 0, 0.012 + 0.006 * c(2 * ph)),
                 chest=(0, 3 * s(ph), 0), head=(2 * s(2 * ph + 0.6), -5 * s(ph), -3 * s(ph))))

def sit(t):
    return add(scale(SIT, smooth(t)), P(head=(8 * s(math.pi * t), 0, 0)))

def sit_idle(t):
    return add(SIT, ears(t), P(head=(3 * s(TAU * t), 7 * s(TAU * t), 9 * s(TAU * t)), chest=(1.0 * s(TAU * 2 * t), 0, 0),
                               front_upper__L=(3 * s(TAU * t), 0, 0), front_upper__R=(3 * s(TAU * t + 1), 0, 0),
                               hind_lower__L=(0, 0, 0), hind_paw__L=(8 * s(TAU * 2 * t), 0, 0),
                               hind_paw__R=(8 * s(TAU * 2 * t + 2), 0, 0)))

def wave(t):
    e = hold(t, 0.2, 0.82)
    w = s(TAU * 4 * t)
    arm = {"front_upper.R": [(-96 - SIT["front_upper.R"][0]), -62 + 16 * w, 6, 0, 0, 0],
           "front_lower.R": [-FORE - 8, 0, 0, 0, 0, 0],
           "front_paw.R": [0, 14 * w, 0, 0, 0, 0]}
    extra = add(arm, P(head=(-6, -6, -10), body=(0, 0, -3)))
    return add(SIT, scale(extra, e), ears(t, 0.6))

def sleep(t):
    br = s(TAU * t)
    return add(SIT, P(body=(4 + 0.8 * br, 0, 0), chest=(6 + 1.2 * br, 0, 0), head=(26 + 1.5 * br, 0, 10),
                      ear__L=(0, 0, 10), ear__R=(0, 0, -10),
                      front_upper__L=(6, 0, 0), front_upper__R=(6, 0, 0)))

def stand_up(t):
    return sit(1 - t)

B.bake([("Idle", idle, 48, True), ("Walk", walk, 30, True), ("Sit", sit, 22, False), ("SitIdle", sit_idle, 48, True),
        ("Wave", wave, 60, True), ("Sleep", sleep, 72, True), ("StandUp", stand_up, 22, False)], active="Walk")
B.minz([("Idle", 0), ("Walk", 8), ("Sit", 22), ("Wave", 30), ("Sleep", 0)])
B.stage(size=0.72, target=(0, -0.1, 0.60), light=0.75)
B.save_export(OUT, "koala")

if MODE in ("stills", "all"):
    only = os.environ.get("SHOTS")
    shots = [("stand", "Idle", 0, None, None), ("walk", "Walk", 8, (3.4, -1.6, 1.2), None),
             ("sit_front", "SitIdle", 12, (0.0, -3.9, 1.2), None), ("sit_side", "SitIdle", 12, (3.6, -0.6, 1.1), None),
             ("wave", "Wave", 34, (1.2, -3.7, 1.3), None), ("sleep", "Sleep", 18, (1.9, -3.3, 1.4), None)]
    if only:
        shots = [x for x in shots if x[0] in only.split(",")]
    B.render_stills(OUT, "koala", shots)
if MODE in ("gif", "all"):
    B.render_gif(OUT, "koala", [("Walk", range(0, 30), 42), ("Sit", range(0, 23, 2), 84), ("Wave", range(0, 60, 2), 84),
                                ("Sleep", range(0, 72, 4), 168), ("StandUp", range(0, 23, 2), 84)], cam=(1.6, -3.6, 1.4))
