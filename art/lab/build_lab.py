"""
Lazarus reanimation lab: hero scene, built from scratch by script (task 18).

Run headless (the Node runner `art/lab/build.ts` does this for you):

    blender --background --factory-startup --python art/lab/build_lab.py -- \
        --out art/lab/build [--steps blend,stills,bake,export] [--scale 100] \
        [--samples 128] [--bake-size 2048] [--bake-samples 384] [--moods buried,alive]

Steps
- blend:  save art/lab/lab.blend (procedural materials, mood light rig) for hand tuning.
- stills: Cycles renders, one per mood, to <out>/stills/<mood>.png (2400 x 800 at --scale 100).
- bake:   bake static ambient light (world-only AO and bounce, no scene lights) into the
          base colour of the two static meshes, <out>/bake_<mesh>.png.
- export: <out>/lab-raw.glb (uncompressed; build.ts adds Draco and WebP textures).

Coordinates: everything below is written in three.js coordinates (Y up, metres,
camera looking down -Z) so it lines up with web/src/scene/LabScene.tsx. `M3B`
converts to Blender (Z up) when meshes are created; the glTF exporter converts back.

Lights that change at runtime (key, arc lamps, alarm) are NOT baked. They exist here
only for the stills; the GLB carries empties where task 19 attaches three.js lights.
See art/lab/README.md for the node-name contract.

No text, logos or trademarks anywhere (Requirement 7.5). No source code textures (2.4).
"""

import bmesh
import bpy
import json
import math
import os
import random
import sys
import time
from mathutils import Matrix, Vector

# ---------------------------------------------------------------- arguments

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg(name, default):
    flag = f"--{name}"
    if flag in ARGV:
        i = ARGV.index(flag)
        if i + 1 < len(ARGV):
            return ARGV[i + 1]
    return default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(arg("out", os.path.join(HERE, "build")))
STEPS = set(arg("steps", "blend,stills,bake,export").split(","))
SCALE = int(arg("scale", "100"))
SAMPLES = int(arg("samples", "128"))
BAKE_SIZE = int(arg("bake-size", "2048"))
BAKE_SAMPLES = int(arg("bake-samples", "384"))
HAZE = float(arg("haze", "0"))
MOODS_TO_RENDER = arg("moods", "buried,reanimating,alive,relapsed").split(",")
BLEND_PATH = os.path.join(HERE, "lab.blend")

STILL_W, STILL_H = 2400, 800

# Camera: same position and vertical fov as LabScene.tsx. The aim point differs from
# R3F's default lookAt(0, 0, 0): aimed at the origin, the top of the frame is level at
# 2.37 m, so the beacon (3.1 m) and cabinet tops (2.6 m) are cut off. Task 19 should
# aim the live camera at CAMERA_TARGET (exported as the `Camera_Target` empty).
CAMERA_POS = (0.0, 2.4, 6.5)
CAMERA_TARGET = (0.0, 1.45, 0.0)
CAMERA_FOV_Y_DEG = 40.0

# Colours mirror web/src/scene/sceneLook.ts (sRGB hex).
COLD, ARC_COLD = 0x8FB3FF, 0xD6E4FF
WARM, ARC_WARM = 0xFFC58A, 0xFFD9A8
ALARM_RED = 0xFF2A1A

# One still per status: the sceneLook.ts values for that mood (reanimating at the
# flicker crest, alive after the burst has settled, relapsed with the alarm at peak).
MOODS = {
    "buried": dict(key=(COLD, 0.6), arc=(ARC_COLD, 0.15), alarm=0.0, slab=0.0, reels_moving=False, bolts=False),
    "reanimating": dict(key=(COLD, 0.5), arc=(ARC_COLD, 1.2), alarm=0.0, slab=0.2, reels_moving=True, bolts=True),
    "alive": dict(key=(WARM, 1.0), arc=(ARC_WARM, 0.9), alarm=0.0, slab=0.6, reels_moving=False, bolts=False),
    "relapsed": dict(key=(ALARM_RED, 0.25), arc=(ARC_COLD, 0.0), alarm=1.0, slab=0.0, reels_moving=False, bolts=False),
}
# sceneLook intensity 1.0 in Blender units. Art-directed, tune here.
KEY_WATTS = 2600.0
ARC_WATTS = 200.0
ALARM_WATTS = 320.0
BULB_EMISSION = 14.0
BEACON_EMISSION = 22.0
SLAB_EMISSION = 0.8
BOLT_EMISSION = 30.0
REEL_SPEED_REANIMATING = 6.0  # rad/s, sceneLook reelSpeed

# ---------------------------------------------------------------- helpers

M3B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three -> Blender


def b(x, y, z):
    """three.js point -> Blender point."""
    return Vector((x, -z, y))


def lin(hex_rgb):
    """sRGB 0xRRGGBB -> linear RGBA tuple."""

    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (c((hex_rgb >> 16) & 0xFF), c((hex_rgb >> 8) & 0xFF), c(hex_rgb & 0xFF), 1.0)


def rgb(r, g, b_):
    return (r, g, b_, 1.0)


def log(*a):
    print("[lab]", *a, flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0
    return s


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


# ---------------------------------------------------------------- materials


def _nodes(mat):
    try:
        mat.use_nodes = True  # deprecated (always on) in Blender 5, harmless
    except Exception:
        pass
    return mat.node_tree.nodes, mat.node_tree.links


def _socket(sockets, identifier):
    for s in sockets:
        if s.identifier == identifier:
            return s
    raise KeyError(identifier)


def material(name, base, rough, metal=0.0, emission=None, strength=0.0, group=None, kind=None, alt=None):
    """
    Principled material. `group` is the export material a baked surface collapses into
    (None = exported as-is). `kind` adds procedural detail for the renders and the bake:
    'noise' (painted metal grime), 'tiles' (raised floor), 'wall' (painted concrete).
    """
    m = bpy.data.materials.new(name)
    nodes, links = _nodes(m)
    p = nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = base
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emission is not None:
        p.inputs["Emission Color"].default_value = emission
        p.inputs["Emission Strength"].default_value = strength
    m["export_group"] = group or ""
    m["export_rough"] = rough
    m["export_metal"] = metal
    if kind:
        coord = nodes.new("ShaderNodeTexCoord")
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = {"noise": 3.0, "tiles": 1.6, "wall": 0.9}[kind]
        noise.inputs["Detail"].default_value = 8.0
        links.new(coord.outputs["Object"], noise.inputs["Vector"])
        ramp = nodes.new("ShaderNodeValToRGB")
        lo = tuple(v * 0.72 for v in base[:3]) + (1.0,)
        hi = tuple(min(1.0, v * 1.12) for v in base[:3]) + (1.0,)
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[0].color = lo
        ramp.color_ramp.elements[1].position = 0.7
        ramp.color_ramp.elements[1].color = hi
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        rough_map = nodes.new("ShaderNodeMapRange")
        links.new(noise.outputs["Fac"], rough_map.inputs[0])
        rough_map.inputs[3].default_value = max(0.05, rough - 0.12)
        rough_map.inputs[4].default_value = min(1.0, rough + 0.12)
        links.new(rough_map.outputs[0], p.inputs["Roughness"])
        if kind == "tiles":
            bricks = nodes.new("ShaderNodeTexBrick")
            bricks.offset = 0.0
            bricks.squash = 1.0
            mapping = nodes.new("ShaderNodeMapping")
            # Object coords are world coords (static meshes sit at the origin). Tiles lie
            # in Blender XY; 0.6 m raised-floor tiles.
            links.new(coord.outputs["Object"], mapping.inputs["Vector"])
            mapping.inputs["Location"].default_value = (0.3, 0.3, 0.0)
            links.new(mapping.outputs["Vector"], bricks.inputs["Vector"])
            bricks.inputs["Scale"].default_value = 1.0
            bricks.inputs["Brick Width"].default_value = 0.6
            bricks.inputs["Row Height"].default_value = 0.6
            bricks.inputs["Mortar Size"].default_value = 0.004
            bricks.inputs["Mortar Smooth"].default_value = 0.3
            bricks.inputs["Color1"].default_value = alt or base
            bricks.inputs["Color2"].default_value = base
            bricks.inputs["Mortar"].default_value = rgb(0.012, 0.012, 0.013)
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            _socket(mix.inputs, "Factor_Float").default_value = 0.85
            links.new(bricks.outputs["Color"], _socket(mix.inputs, "A_Color"))
            links.new(ramp.outputs["Color"], _socket(mix.inputs, "B_Color"))
            # ramp around 1.0 so the multiply only adds grime
            ramp.color_ramp.elements[0].color = rgb(0.7, 0.7, 0.7)
            ramp.color_ramp.elements[1].color = rgb(1.0, 1.0, 1.0)
            links.new(_socket(mix.outputs, "Result_Color"), p.inputs["Base Color"])
        else:
            links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    return m


class Mats:
    def __init__(self):
        # Room (baked, exported as Room_Baked)
        self.floor = material("floor_tiles", rgb(0.115, 0.118, 0.122), 0.55, group="Room_Baked", kind="tiles", alt=rgb(0.13, 0.132, 0.136))
        self.wall = material("wall_paint", rgb(0.16, 0.18, 0.17), 0.85, group="Room_Baked", kind="wall")
        self.trim = material("wall_trim", rgb(0.03, 0.03, 0.032), 0.7, group="Room_Baked")
        # Props (baked, exported as Props_Baked / Props_Gloss). Dielectric only: a
        # diffuse bake of a metal is black.
        self.cab = material("cab_paint", rgb(0.36, 0.36, 0.34), 0.5, group="Props_Baked", kind="noise")
        self.accent = material("cab_accent", rgb(0.055, 0.085, 0.12), 0.45, group="Props_Baked", kind="noise")
        self.dark = material("dark_panel", rgb(0.02, 0.02, 0.022), 0.6, group="Props_Baked")
        self.steel = material("steel_paint", rgb(0.06, 0.062, 0.066), 0.4, group="Props_Baked", kind="noise")
        self.copper = material("copper_paint", rgb(0.5, 0.24, 0.12), 0.35, group="Props_Baked")
        self.rubber = material("cable_rubber", rgb(0.012, 0.012, 0.012), 0.65, group="Props_Baked")
        self.bowl = material("reflector", rgb(0.22, 0.22, 0.21), 0.3, group="Props_Baked")
        self.cards = material("card_stock", rgb(0.5, 0.46, 0.36), 0.8, group="Props_Baked")
        self.glass = material("glass_dark", rgb(0.015, 0.017, 0.02), 0.08, group="Props_Gloss")
        # Static emissive (exported as-is, no texture)
        self.lamp_amber = material("Indicator_Amber", rgb(0.05, 0.03, 0.01), 0.4, emission=rgb(1.0, 0.45, 0.1), strength=3.0)
        self.lamp_green = material("Indicator_Green", rgb(0.01, 0.04, 0.02), 0.4, emission=rgb(0.25, 1.0, 0.35), strength=2.0)
        self.crt = material("CRT_Glow", rgb(0.01, 0.02, 0.015), 0.15, emission=rgb(0.12, 0.55, 0.3), strength=0.5)
        # Dynamic (exported as-is; task 19 drives emissive)
        self.reel_metal = material("Reel_Metal", rgb(0.62, 0.63, 0.65), 0.3, metal=0.7)
        self.reel_tape = material("Reel_Tape", rgb(0.05, 0.03, 0.018), 0.45)
        self.slab = material("Slab_Top", rgb(0.42, 0.44, 0.46), 0.35, metal=0.7, emission=lin(ARC_WARM), strength=0.0)
        self.bulb = material("ArcBulb", rgb(0.13, 0.13, 0.13), 0.2, emission=lin(ARC_COLD), strength=1.0)
        self.beacon = material("AlarmBeacon_Glass", rgb(0.2, 0.01, 0.005), 0.2, emission=lin(ALARM_RED), strength=0.0)
        # Render only
        self.mote = material("render_mote", rgb(0.8, 0.82, 0.85), 0.5)
        self.bolt = material("render_bolt", rgb(0, 0, 0), 0.5, emission=lin(ARC_COLD), strength=BOLT_EMISSION)


# ---------------------------------------------------------------- geometry builder


class Builder:
    """Accumulates primitives (in three.js coordinates) into one bmesh."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def _mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _finish(self, before, mat, matrix, smooth_axis=None, smooth_all=False):
        faces = [f for f in self.bm.faces if f not in before]
        verts = list({v for f in faces for v in f.verts})
        bmesh.ops.transform(self.bm, matrix=matrix, verts=verts)
        mi = self._mi(mat)
        for f in faces:
            f.material_index = mi
        self.bm.normal_update()
        for f in faces:
            if smooth_all:
                f.smooth = True
            elif smooth_axis is not None:
                f.smooth = abs(f.normal.dot(smooth_axis)) < 0.9
        return faces

    def box(self, mat, center, size, bevel=0.0, rot=None):
        before = set(self.bm.faces)
        geom = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = geom["verts"]
        bmesh.ops.scale(self.bm, vec=Vector(size), verts=verts)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type="OFFSET", segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
        m = Matrix.Translation(Vector(center)) @ (rot or Matrix.Identity(4))
        return self._finish(before, mat, m)

    def cyl(self, mat, center, r1, h, axis="y", r2=None, seg=24, rot=None, caps=True):
        before = set(self.bm.faces)
        bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r1 if r2 is None else r2, depth=h)
        align = {"y": Matrix.Rotation(-math.pi / 2, 4, "X"), "x": Matrix.Rotation(math.pi / 2, 4, "Y"), "z": Matrix.Identity(4)}[axis]
        r = rot or Matrix.Identity(4)
        m = Matrix.Translation(Vector(center)) @ r @ align
        ax = (r @ align).to_3x3() @ Vector((0, 0, 1))
        return self._finish(before, mat, m, smooth_axis=ax)

    def sphere(self, mat, center, radius, seg=20, rings=12, scale=(1, 1, 1), cut=None, rot=None):
        """UV sphere; `cut` keeps only vertices with local z >= cut*radius (a bowl/dome)."""
        before = set(self.bm.faces)
        geom = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=radius)
        verts = geom["verts"]
        if cut is not None:
            kill = [v for v in verts if v.co.z < cut * radius - 1e-6]
            bmesh.ops.delete(self.bm, geom=kill, context="VERTS")
            verts = [v for v in verts if v.is_valid]
        bmesh.ops.scale(self.bm, vec=Vector(scale), verts=verts)
        m = Matrix.Translation(Vector(center)) @ (rot or Matrix.Identity(4))
        return self._finish(before, mat, m, smooth_all=True)

    def ring(self, mat, center, r_in, r_out, depth, axis="z", seg=32):
        """Flat annulus with thickness (a reel rim, a cage band)."""
        before = set(self.bm.faces)
        bm = self.bm
        rings = []
        for r, z in ((r_out, depth / 2), (r_out, -depth / 2), (r_in, -depth / 2), (r_in, depth / 2)):
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)])
        for k in range(4):
            a, c = rings[k], rings[(k + 1) % 4]
            for i in range(seg):
                j = (i + 1) % seg
                bm.faces.new((a[i], a[j], c[j], c[i]))
        align = {"y": Matrix.Rotation(-math.pi / 2, 4, "X"), "x": Matrix.Rotation(math.pi / 2, 4, "Y"), "z": Matrix.Identity(4)}[axis]
        m = Matrix.Translation(Vector(center)) @ align
        faces = self._finish(before, mat, m)
        for f in faces:  # outer and inner walls smooth, flat faces sharp
            f.smooth = abs(f.normal.dot(align.to_3x3() @ Vector((0, 0, 1)))) < 0.9
        return faces

    def tube(self, mat, points, radius, seg=8, subdiv=6):
        """Swept circle along a Catmull-Rom curve through `points` (cables)."""
        pts = [Vector(p) for p in points]
        path = []
        for i in range(len(pts) - 1):
            p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
            for s in range(subdiv):
                t = s / subdiv
                t2, t3 = t * t, t * t * t
                path.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
        path.append(pts[-1])
        before = set(self.bm.faces)
        bm = self.bm
        rings = []
        normal = None
        for i, p in enumerate(path):
            tan = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
            if normal is None:
                up = Vector((0, 1, 0)) if abs(tan.y) < 0.9 else Vector((1, 0, 0))
                normal = tan.cross(up).normalized()
            else:  # parallel transport
                normal = (normal - tan * normal.dot(tan)).normalized()
            binormal = tan.cross(normal)
            rings.append([bm.verts.new(p + radius * (math.cos(2 * math.pi * k / seg) * normal + math.sin(2 * math.pi * k / seg) * binormal)) for k in range(seg)])
        for a, c in zip(rings, rings[1:]):
            for k in range(seg):
                j = (k + 1) % seg
                bm.faces.new((a[k], a[j], c[j], c[k]))
        for r in (rings[0], rings[-1][::-1]):
            bm.faces.new(r[::-1] if r is rings[0] else r)
        return self._finish(before, mat, Matrix.Identity(4), smooth_all=True)

    def build(self, name, coll, location=(0, 0, 0)):
        """Create the object. Geometry was built relative to `location` (three coords)."""
        me = bpy.data.meshes.new(name)
        bmesh.ops.transform(self.bm, matrix=M3B, verts=self.bm.verts)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        ob.location = b(*location)
        coll.objects.link(ob)
        return ob


def empty(name, coll, pos, kind="PLAIN_AXES", size=0.2):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    e.location = b(*pos)
    coll.objects.link(e)
    return e


# ---------------------------------------------------------------- scene


CABINET_X = (-3.0, -1.0, 1.0, 3.0)
CAB_Z = -2.4  # centre; depth 0.7, front face at -2.05
REEL_Y = 1.85
REEL_DX = 0.36
REEL_R = 0.3
LAMP_X = (-1.9, 1.9)
LAMP_Z = 0.6
BULB_Y = 2.25
BULB_R = 0.14
SLAB_POS = (0.0, 0.0, 0.6)
BEACON_POS = (0.0, 3.1, -2.0)
WALL_Z = -2.8
KEY_POS = (2.5, 6.0, 3.0)


def build_room(mats, coll):
    r = Builder()
    r.box(mats.floor, (0, -0.05, 0.85), (22, 0.1, 7.3))  # floor top at y=0, z -2.8..4.5
    r.box(mats.wall, (0, 2.4, WALL_Z - 0.1), (22, 4.8, 0.2))
    r.box(mats.trim, (0, 0.06, WALL_Z + 0.01), (22, 0.12, 0.04))  # skirting
    for x in (-9.0, -6.3, -4.2, 4.2, 6.3, 9.0):  # pilasters between machine bays
        r.box(mats.wall, (x, 2.4, WALL_Z + 0.08), (0.36, 4.8, 0.16), bevel=0.01)
    return r.build("Lab_Room", coll)


def tape_cabinet(p, mats, ind, x):
    z0, front = CAB_Z, CAB_Z + 0.35
    p.box(mats.cab, (x, 1.3, z0), (1.5, 2.6, 0.7), bevel=0.02)
    p.box(mats.accent, (x, 1.88, front + 0.005), (1.36, 1.0, 0.02), bevel=0.006)  # reel deck
    p.box(mats.dark, (x, 0.05, front - 0.04), (1.44, 0.1, 0.02))  # kick plate shadow line
    for dx in (-REEL_DX, REEL_DX):  # vacuum columns below the reels
        p.box(mats.cab, (x + dx, 0.9, front + 0.006), (0.26, 0.86, 0.02), bevel=0.005)
        p.box(mats.glass, (x + dx, 0.9, front + 0.018), (0.18, 0.76, 0.01))
        p.cyl(mats.steel, (x + dx, REEL_Y, front + 0.02), 0.035, 0.02, axis="z", seg=16)  # spindle boss
    p.box(mats.dark, (x, 1.36, front + 0.012), (1.3, 0.09, 0.02))  # control strip
    for k in range(6):
        bx = x - 0.5 + k * 0.2
        p.box(mats.steel, (bx, 1.36, front + 0.03), (0.07, 0.045, 0.02), bevel=0.004)
    for k in range(4):
        ind.cyl(mats.lamp_amber if k % 2 == 0 else mats.lamp_green, (x - 0.15 + k * 0.1, 2.48, front + 0.016), 0.013, 0.012, axis="z", seg=10)
    for k in range(7):  # top vent slats
        p.box(mats.dark, (x, 2.5 - 0.02, front - 0.3 + k * 0.045), (1.2, 0.012, 0.018))


def cpu_cabinet(p, mats, ind, x, rng):
    z0, front = -2.4, -2.0
    p.box(mats.accent, (x, 1.0, z0), (2.2, 2.0, 0.8), bevel=0.02)
    p.box(mats.cab, (x, 1.25, front + 0.005), (1.9, 0.9, 0.02), bevel=0.006)
    p.box(mats.dark, (x, 1.32, front + 0.016), (1.6, 0.6, 0.01))
    # Regular register rows (a random grid can read as pixel lettering at still size).
    for row in range(4):
        for col in range(12):
            if (col + row) % 3 != 0 or rng.random() < 0.2:
                ind.cyl(mats.lamp_amber if row % 2 == 0 else mats.lamp_green, (x - 0.66 + col * 0.12, 1.1 + row * 0.14, front + 0.024), 0.011, 0.01, axis="z", seg=8)
    for k in range(12):  # toggle switch row
        p.box(mats.steel, (x - 0.66 + k * 0.12, 0.92, front + 0.03), (0.025, 0.06, 0.03))
    p.box(mats.dark, (x, 0.45, front + 0.004), (1.9, 0.6, 0.01))


def disk_drive(p, mats, x):
    z0 = -2.35
    p.box(mats.cab, (x, 0.5, z0), (0.9, 1.0, 0.8), bevel=0.02)
    p.box(mats.accent, (x, 1.005, z0), (0.82, 0.01, 0.72))
    p.box(mats.glass, (x, 1.02, z0 + 0.05), (0.6, 0.02, 0.5))
    p.box(mats.dark, (x, 0.75, z0 + 0.405), (0.7, 0.12, 0.01))


def card_reader(p, mats, ind):
    x, z = 3.5, 0.9
    p.box(mats.cab, (x, 0.47, z), (1.3, 0.94, 0.62), bevel=0.02)
    p.box(mats.accent, (x, 0.96, z), (1.34, 0.04, 0.66), bevel=0.01)
    rot = Matrix.Rotation(math.radians(-18), 4, "X")
    p.box(mats.steel, (x - 0.35, 1.13, z - 0.05), (0.3, 0.3, 0.22), rot=rot, bevel=0.008)  # input hopper
    p.box(mats.cards, (x - 0.35, 1.16, z - 0.05), (0.22, 0.2, 0.12), rot=rot)  # card deck
    for k in range(3):  # output stackers
        p.box(mats.steel, (x + 0.15 + k * 0.17, 1.03, z + 0.1), (0.14, 0.1, 0.22), bevel=0.005)
        p.box(mats.cards, (x + 0.15 + k * 0.17, 1.07, z + 0.12), (0.11, 0.04, 0.12))
    p.box(mats.dark, (x, 0.75, z + 0.315), (1.0, 0.1, 0.01))
    for k in range(3):
        ind.cyl(mats.lamp_green if k == 0 else mats.lamp_amber, (x + 0.3 + k * 0.08, 0.75, z + 0.322), 0.012, 0.01, axis="z", seg=10)


def console(p, mats, ind):
    x, z = -3.6, 0.8
    p.box(mats.steel, (x, 0.74, z), (1.5, 0.05, 0.75), bevel=0.01)  # desk top
    for dx in (-0.68, 0.68):
        p.box(mats.cab, (x + dx, 0.36, z), (0.1, 0.72, 0.7), bevel=0.01)
    # CRT terminal: body, hood and a blank screen (no text, Req 2.4/7.5)
    p.box(mats.cab, (x + 0.1, 1.02, z - 0.1), (0.55, 0.5, 0.5), bevel=0.04)
    p.box(mats.cab, (x + 0.1, 0.86, z + 0.12), (0.55, 0.1, 0.25), rot=Matrix.Rotation(math.radians(8), 4, "X"), bevel=0.01)  # keyboard
    ind.box(mats.crt, (x + 0.1, 1.05, z + 0.152), (0.4, 0.3, 0.01), bevel=0.004)
    for k in range(10):
        p.box(mats.dark, (x - 0.06 + k * 0.035, 0.885, z + 0.16), (0.025, 0.012, 0.025))


def lamp_bowl(p, mats, x):
    side = -1 if x > 0 else 1
    toward = Vector((side, -0.55, 0)).normalized()
    # dome along local +z, flipped so it opens toward `toward`
    q = Vector((0, 0, 1)).rotation_difference(-toward).to_matrix().to_4x4()
    centre = Vector((x, BULB_Y, LAMP_Z)) - toward * 0.03
    p.sphere(mats.bowl, tuple(centre), 0.3, seg=28, rings=14, scale=(1, 1, 0.8), cut=0.0, rot=q)
    p.box(mats.steel, (x, 2.07, LAMP_Z), (0.05, 0.16, 0.05))
    p.box(mats.steel, tuple(centre - Vector((0, 0.24, 0))), (0.04, 0.2, 0.04))
    # electrode housing behind the bulb
    p.cyl(mats.copper, tuple(centre - toward * 0.12), 0.03, 0.14, axis="z", rot=q)


def slab_base(p, mats):
    x, _, z = SLAB_POS
    p.box(mats.steel, (x, 0.03, z), (1.1, 0.06, 0.7), bevel=0.01)
    p.cyl(mats.steel, (x, 0.45, z), 0.17, 0.8, seg=28)
    p.cyl(mats.dark, (x, 0.6, z), 0.18, 0.04, seg=28)
    p.box(mats.steel, (x, 0.875, z), (1.7, 0.05, 0.62), bevel=0.01)
    for dx in (-1.12, 1.12):  # electrode posts at the slab ends
        p.cyl(mats.copper, (x + dx, 1.13, z), 0.022, 0.14, seg=12)
        p.sphere(mats.copper, (x + dx, 1.21, z), 0.035, seg=12, rings=8)


def cable_tray(p, mats):
    y, z = 2.95, -2.6
    for dz in (-0.16, 0.16):
        p.box(mats.steel, (0, y, z + dz), (18.0, 0.07, 0.02))
    for k in range(60):
        p.box(mats.steel, (-8.85 + k * 0.3, y - 0.03, z), (0.025, 0.012, 0.32))
    rng = random.Random(11)
    for k in range(5):  # cable bundle in the tray
        dz = -0.1 + k * 0.05
        p.tube(mats.rubber, [(-9, y, z + dz), (-3, y + 0.01, z + dz + rng.uniform(-0.02, 0.02)), (3, y + 0.01, z + dz), (9, y, z + dz)], 0.018, seg=6, subdiv=4)
    for x in CABINET_X:  # drops into each tape drive
        p.tube(mats.rubber, [(x + 0.4, y, z), (x + 0.42, 2.78, z + 0.05), (x + 0.45, 2.6, z + 0.12)], 0.035, seg=8, subdiv=4)
    for k in range(5):  # wall brackets
        p.box(mats.steel, (-8 + k * 4, y + 0.1, z - 0.08), (0.04, 0.2, 0.44))


def floor_cables(p, mats):
    y = 0.022
    runs = [
        [(-3.4, y, -2.05), (-2.8, y, -1.2), (-2.3, y, -0.2), (-1.9, y, 0.45)],
        [(3.3, y, -2.05), (2.9, y, -1.0), (2.2, y, 0.1), (1.9, y, 0.45)],
        [(-1.2, y, -2.05), (-0.9, y, -1.0), (-0.3, y, 0.0), (-0.1, y, 0.38)],
        [(1.2, y, -2.05), (0.8, y, -0.9), (0.25, y, 0.05), (0.1, y, 0.38)],
        [(-1.75, y, 0.62), (-1.0, y, 0.95), (-0.25, y, 0.75)],
        [(1.75, y, 0.62), (1.1, y, 1.0), (0.25, y, 0.8)],
    ]
    for pts in runs:
        p.tube(mats.rubber, pts, 0.02, seg=8, subdiv=8)


def beacon_mount(p, mats):
    x, y, z = BEACON_POS
    p.box(mats.steel, (x, y - 0.19, (z + WALL_Z) / 2), (0.06, 0.06, abs(WALL_Z - z) + 0.1))
    p.box(mats.steel, (x, y - 0.19, WALL_Z + 0.02), (0.2, 0.2, 0.03))
    p.cyl(mats.steel, (x, y - 0.13, z), 0.1, 0.07, seg=24)
    for k in range(3):  # wire guard
        a = 2 * math.pi * k / 3
        p.cyl(mats.steel, (x + 0.13 * math.cos(a), y, z + 0.13 * math.sin(a)), 0.006, 0.26, seg=6)
    p.ring(mats.steel, (x, y + 0.06, z), 0.125, 0.135, 0.01, axis="y", seg=24)


def reel(mats, coll, name, pos):
    r = Builder()
    r.cyl(mats.reel_metal, (0, 0, -0.02), REEL_R, 0.006, axis="z", seg=40)  # back flange
    r.cyl(mats.reel_tape, (0, 0, 0.0), 0.215, 0.026, axis="z", seg=40)  # wound tape
    r.ring(mats.reel_metal, (0, 0, 0.018), REEL_R - 0.035, REEL_R, 0.006, axis="z", seg=40)  # front rim
    r.cyl(mats.reel_metal, (0, 0, 0.018), 0.065, 0.012, axis="z", seg=24)  # hub
    # Five spokes: the visible cue that the reel is turning. (Not three: three spokes in
    # a ring reads as a well-known car badge, Requirement 7.5.)
    for k in range(5):
        a = 2 * math.pi * k / 5
        rot = Matrix.Rotation(a, 4, "Z")
        r.box(mats.reel_metal, tuple(rot @ Vector((0.17, 0, 0.018))), (0.2, 0.032, 0.006), rot=rot)
    return r.build(name, coll, location=pos)


def build_scene(mats):
    lab = collection("Lab")
    render_only = collection("RenderOnly")

    room = build_room(mats, lab)
    p, ind = Builder(), Builder()
    rng = random.Random(1970)
    for x in CABINET_X:
        tape_cabinet(p, mats, ind, x)
    for x in (-5.35, 5.35):
        cpu_cabinet(p, mats, ind, x, rng)
    for x in (-7.3, -8.3, 7.3, 8.3):
        disk_drive(p, mats, x)
    card_reader(p, mats, ind)
    console(p, mats, ind)
    for x in LAMP_X:
        p.cyl(mats.steel, (x, 0.02, LAMP_Z), 0.2, 0.04, seg=24)
        for k in range(3):
            a = 2 * math.pi * k / 3 + 0.3
            p.box(mats.steel, (x + 0.2 * math.cos(a), 0.03, LAMP_Z + 0.2 * math.sin(a)), (0.36, 0.035, 0.05), rot=Matrix.Rotation(-a, 4, "Y"), bevel=0.006)
        p.cyl(mats.steel, (x, 1.0, LAMP_Z), 0.03, 1.94, seg=16)
        p.cyl(mats.steel, (x, 1.25, LAMP_Z), 0.045, 0.12, seg=16)
        lamp_bowl(p, mats, x)
    slab_base(p, mats)
    cable_tray(p, mats)
    floor_cables(p, mats)
    beacon_mount(p, mats)
    props = p.build("Lab_Props", lab)
    indicators = ind.build("Lab_Indicators", lab)

    s = Builder()
    s.box(mats.slab, (0, 0, 0), (2.4, 0.16, 0.9), bevel=0.025)
    slab = s.build("Slab", lab, location=(SLAB_POS[0], 0.98, SLAB_POS[2]))

    bulbs = []
    for x, side in zip(LAMP_X, "LR"):
        bb = Builder()
        bb.sphere(mats.bulb, (0, 0, 0), BULB_R, seg=24, rings=14)
        bulbs.append(bb.build(f"ArcLamp_{side}_Bulb", lab, location=(x, BULB_Y, LAMP_Z)))
        empty(f"ArcLamp_{side}_Light", lab, (x, BULB_Y, LAMP_Z))

    bc = Builder()
    bc.sphere(mats.beacon, (0, 0, 0), 0.12, seg=24, rings=12, scale=(1, 1, 1.15), cut=-0.15, rot=Matrix.Rotation(-math.pi / 2, 4, "X"))
    beacon = bc.build("AlarmBeacon", lab, location=BEACON_POS)
    empty("AlarmBeacon_Light", lab, BEACON_POS)

    reels = []
    for i, x in enumerate(CABINET_X):
        for dx, side in ((-REEL_DX, "L"), (REEL_DX, "R")):
            reels.append(reel(mats, lab, f"Reel_{i}_{side}", (x + dx, REEL_Y, CAB_Z + 0.36)))

    empty("KeyLight", lab, KEY_POS)
    empty("KeyLight_Target", lab, (0, 0, 0))
    empty("Camera_Target", lab, CAMERA_TARGET)

    cam_data = bpy.data.cameras.new("Camera_Hero")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle_y = math.radians(CAMERA_FOV_Y_DEG)
    cam_data.clip_start, cam_data.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new("Camera_Hero", cam_data)
    cam.location = b(*CAMERA_POS)
    direction = b(*CAMERA_TARGET) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    lab.objects.link(cam)
    bpy.context.scene.camera = cam

    # Lamps and the beacon glass must not block their own lights in Cycles.
    for ob in bulbs + [beacon]:
        ob.visible_shadow = False

    build_render_only(mats, render_only)
    return dict(room=room, props=props, indicators=indicators, slab=slab, bulbs=bulbs, beacon=beacon, reels=reels, render_only=render_only)


def build_render_only(mats, coll):
    # Dust motes: same deterministic positions as LabScene.tsx's <Motes/>.
    m = Builder()
    seed = 7

    def rand():
        nonlocal seed
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647

    for _ in range(240):
        x = (rand() - 0.5) * 8
        y = rand() * 3.5
        z = (rand() - 0.5) * 6
        m.sphere(mats.mote, (x, y, z), 0.0045, seg=6, rings=4)
    m.build("render_motes", coll)

    # Arc discharge from each bulb to the slab electrodes (reanimating only).
    rng = random.Random(42)
    bolts = Builder()
    for x, ex in zip(LAMP_X, (-1.12, 1.12)):
        start = Vector((x + (0.12 if x < 0 else -0.12), BULB_Y - 0.05, LAMP_Z))
        end = Vector((ex, 1.24, LAMP_Z))
        for strand in range(2):
            pts = [start]
            n = 11
            for k in range(1, n):
                t = k / n
                q = start.lerp(end, t)
                jitter = 0.06 * math.sin(math.pi * t) + 0.015
                pts.append(q + Vector((rng.uniform(-1, 1) * jitter, rng.uniform(-1, 1) * jitter, rng.uniform(-1, 1) * jitter)))
            pts.append(end)
            bolts.tube(mats.bolt, pts, 0.0022 if strand == 0 else 0.0012, seg=5, subdiv=3)
    bo = bolts.build("render_bolts", coll)
    bo.visible_shadow = False

    # Thin haze so the arc lamps and key light read as beams (--haze 0 turns it off;
    # measured ~100x slower renders on an M5 Pro at density 0.012, so off by default).
    if HAZE > 0:
        h = Builder()
        h.box(mats.mote, (0, 2.3, 0.85), (21.5, 4.6, 7.2))
        haze = h.build("render_haze", coll)
        vm = bpy.data.materials.new("render_haze")
        nodes, links = _nodes(vm)
        for n in list(nodes):
            if n.type == "BSDF_PRINCIPLED":
                nodes.remove(n)
        vol = nodes.new("ShaderNodeVolumePrincipled")
        vol.inputs["Density"].default_value = HAZE
        vol.inputs["Anisotropy"].default_value = 0.35
        out = nodes.get("Material Output")
        links.new(vol.outputs[0], out.inputs["Volume"])
        haze.data.materials.clear()
        haze.data.materials.append(vm)

    # Light rig for the stills.
    def light(name, kind, pos, radius):
        ld = bpy.data.lights.new(name, kind)
        ld.shadow_soft_size = radius
        lo = bpy.data.objects.new(name, ld)
        lo.location = b(*pos)
        coll.objects.link(lo)
        return lo

    key = light("render_key", "SPOT", KEY_POS, 0.4)
    key.data.spot_size = 2 * 0.6
    key.data.spot_blend = 0.6
    key.rotation_euler = (b(0, 0, 0) - key.location).to_track_quat("-Z", "Y").to_euler()
    for x, side in zip(LAMP_X, "LR"):
        light(f"render_arc_{side}", "POINT", (x, BULB_Y, LAMP_Z), BULB_R * 0.8)
    light("render_alarm", "POINT", BEACON_POS, 0.08)
    # A faint rim from behind the camera so the room is not pitch black in Relapsed.
    rim = light("render_fill", "AREA", (0, 4.2, 7.5), 3.0)
    rim.data.size = 6.0
    rim.rotation_euler = (b(0, 1.0, -2.0) - rim.location).to_track_quat("-Z", "Y").to_euler()


# ---------------------------------------------------------------- render setup


def setup_cycles(scene, samples):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    device = "CPU"
    try:
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == "METAL"]
        for d in prefs.devices:
            d.use = d.type == "METAL"
        if gpus:
            device = "GPU"
    except Exception as e:  # no Metal: CPU still works, just slower
        log("Metal unavailable, using CPU:", e)
    scene.cycles.device = device
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.volume_bounces = 0
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.sample_clamp_indirect = 4.0
    scene.cycles.volume_step_rate = 4.0
    return device


def set_world(scene, color, strength):
    w = scene.world or bpy.data.worlds.new("World")
    scene.world = w
    nodes, _ = _nodes(w)
    bg = nodes.get("Background")
    bg.inputs["Color"].default_value = color
    bg.inputs["Strength"].default_value = strength


def set_color_management(scene):
    for vt in ("AgX", "Filmic"):
        try:
            scene.view_settings.view_transform = vt
            break
        except Exception:
            continue
    for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
        try:
            scene.view_settings.look = look
            break
        except Exception:
            continue
    scene.view_settings.exposure = 0.0


def apply_mood(scene, objs, mats, mood):
    cfg = MOODS[mood]
    key_c, key_i = cfg["key"]
    arc_c, arc_i = cfg["arc"]
    o = bpy.data.objects
    o["render_key"].data.color = lin(key_c)[:3]
    o["render_key"].data.energy = KEY_WATTS * key_i
    for side in "LR":
        o[f"render_arc_{side}"].data.color = lin(arc_c)[:3]
        o[f"render_arc_{side}"].data.energy = ARC_WATTS * arc_i
        o[f"render_arc_{side}"].hide_render = arc_i <= 0
    o["render_alarm"].data.color = lin(ALARM_RED)[:3]
    o["render_alarm"].data.energy = ALARM_WATTS * cfg["alarm"]
    o["render_alarm"].hide_render = cfg["alarm"] <= 0
    o["render_fill"].data.color = lin(key_c)[:3]
    o["render_fill"].data.energy = 60.0
    pb = mats.bulb.node_tree.nodes.get("Principled BSDF")
    pb.inputs["Emission Color"].default_value = lin(arc_c)
    pb.inputs["Emission Strength"].default_value = BULB_EMISSION * arc_i
    pc = mats.beacon.node_tree.nodes.get("Principled BSDF")
    pc.inputs["Emission Strength"].default_value = BEACON_EMISSION * cfg["alarm"]
    ps = mats.slab.node_tree.nodes.get("Principled BSDF")
    ps.inputs["Emission Color"].default_value = lin(ARC_WARM)
    ps.inputs["Emission Strength"].default_value = SLAB_EMISSION * cfg["slab"]
    o["render_bolts"].hide_render = not cfg["bolts"]
    # Reels: motion blur from a one-frame spin at the reanimating reel speed.
    scene.render.use_motion_blur = cfg["reels_moving"]
    scene.render.motion_blur_shutter = 0.5
    scene.frame_set(1)
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for i, r in enumerate(objs["reels"]):
        r.animation_data_clear()
        r.rotation_euler = (0, 0.37 * i, 0)  # vary the spoke angle between reels
        if cfg["reels_moving"]:
            per_frame = REEL_SPEED_REANIMATING / scene.render.fps
            base = r.rotation_euler[1]
            r.rotation_euler[1] = base + per_frame
            r.keyframe_insert("rotation_euler", index=1, frame=0)
            r.rotation_euler[1] = base - per_frame
            r.keyframe_insert("rotation_euler", index=1, frame=2)
    scene.frame_set(1)


def render_stills(scene, objs, mats):
    setup_cycles(scene, SAMPLES)
    set_world(scene, rgb(0.004, 0.0045, 0.006), 1.0)
    set_color_management(scene)
    scene.render.resolution_x = STILL_W
    scene.render.resolution_y = STILL_H
    scene.render.resolution_percentage = SCALE
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    for ob in objs["render_only"].objects:
        ob.hide_render = False
    os.makedirs(os.path.join(OUT, "stills"), exist_ok=True)
    times = {}
    for mood in MOODS_TO_RENDER:
        apply_mood(scene, objs, mats, mood)
        scene.render.filepath = os.path.join(OUT, "stills", f"{mood}.png")
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        times[mood] = round(time.time() - t0, 1)
        log(f"rendered {mood} in {times[mood]} s")
    apply_mood(scene, objs, mats, "buried")
    for r in objs["reels"]:
        r.animation_data_clear()
    scene.render.use_motion_blur = False
    return times


# ---------------------------------------------------------------- bake + export


def select_only(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def unwrap(ob):
    select_only(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake(scene, objs):
    """World-only ambient (uniform white sky over the open-topped room): base colour x AO x bounce."""
    setup_cycles(scene, BAKE_SAMPLES)
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    set_world(scene, rgb(1, 1, 1), 1.0)
    for ob in objs["render_only"].objects:
        ob.hide_render = True
    images, times = {}, {}
    for key in ("room", "props"):
        ob = objs[key]
        unwrap(ob)
        img = bpy.data.images.new(f"bake_{ob.name}", BAKE_SIZE, BAKE_SIZE, alpha=False)
        for mat in ob.data.materials:
            nodes, _ = _nodes(mat)
            n = nodes.new("ShaderNodeTexImage")
            n.image = img
            n.name = "bake_target"
            nodes.active = n
        select_only(ob)
        t0 = time.time()
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, margin=8, use_clear=True)
        times[ob.name] = round(time.time() - t0, 1)
        path = os.path.join(OUT, f"bake_{ob.name}.png")
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        images[key] = img
        log(f"baked {ob.name} in {times[ob.name]} s -> {path}")
    return images, times


def export_material(name, image, rough, metal):
    m = bpy.data.materials.new(name)
    nodes, links = _nodes(m)
    p = nodes.get("Principled BSDF")
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        links.new(tex.outputs["Color"], p.inputs["Base Color"])
    return m


def collapse_materials(ob, image):
    """Swap the procedural materials of a baked mesh for one baked material per export group."""
    me = ob.data
    groups, new_mats, remap = {}, [], []
    for mat in me.materials:
        g = mat["export_group"]
        if g not in groups:
            groups[g] = len(new_mats)
            rough = 0.12 if g.endswith("Gloss") else 0.6 if g.startswith("Props") else 0.8
            new_mats.append(export_material(g, image, rough, 0.0))
        remap.append(groups[g])
    idx = [0] * len(me.polygons)
    me.polygons.foreach_get("material_index", idx)
    # Replace the slots first: clearing them resets material_index.
    me.materials.clear()
    for m in new_mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", [remap[i] for i in idx])
    me.update()


def set_export_emission(mats):
    """GLB emissive defaults: the colour task 19 animates, at strength 1 (slab and beacon start off)."""
    for mat, color, strength in ((mats.bulb, lin(ARC_COLD), 1.0), (mats.slab, lin(ARC_WARM), 0.0), (mats.beacon, lin(ALARM_RED), 0.0)):
        p = mat.node_tree.nodes.get("Principled BSDF")
        p.inputs["Emission Color"].default_value = color
        p.inputs["Emission Strength"].default_value = strength
    for mat in (mats.lamp_amber, mats.lamp_green, mats.crt):
        p = mat.node_tree.nodes.get("Principled BSDF")
        p.inputs["Emission Strength"].default_value = 1.0


def export(objs, images, mats):
    collapse_materials(objs["room"], images["room"])
    collapse_materials(objs["props"], images["props"])
    set_export_emission(mats)
    for ob in list(objs["render_only"].objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    path = os.path.join(OUT, "lab-raw.glb")
    wanted = dict(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_cameras=True,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_draco_mesh_compression_enable=False,  # build.ts compresses (Draco + WebP) in one pass
    )
    allowed = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in allowed or k == "filepath"})
    log("exported", path)


# ---------------------------------------------------------------- main


def main():
    os.makedirs(OUT, exist_ok=True)
    scene = reset()
    mats = Mats()
    objs = build_scene(mats)
    scene.render.fps = 24
    setup_cycles(scene, SAMPLES)
    set_world(scene, rgb(0.004, 0.0045, 0.006), 1.0)
    set_color_management(scene)
    apply_mood(scene, objs, mats, "buried")
    report = {"blender": bpy.app.version_string, "steps": sorted(STEPS)}
    if "blend" in STEPS:
        bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
        log("saved", BLEND_PATH)
    if "stills" in STEPS:
        report["still_seconds"] = render_stills(scene, objs, mats)
        report["still_samples"] = SAMPLES
        report["still_size"] = [STILL_W * SCALE // 100, STILL_H * SCALE // 100]
    if "bake" in STEPS or "export" in STEPS:
        images, times = bake(scene, objs)
        report["bake_seconds"] = times
        report["bake_size"] = BAKE_SIZE
        report["bake_samples"] = BAKE_SAMPLES
        if "export" in STEPS:
            export(objs, images, mats)
    with open(os.path.join(OUT, "blender-report.json"), "w") as f:
        json.dump(report, f, indent=2)
    log("report", json.dumps(report))


try:
    main()
except Exception:
    import traceback

    traceback.print_exc()
    sys.exit(1)
