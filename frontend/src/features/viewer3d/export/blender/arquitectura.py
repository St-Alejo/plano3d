"""Plano 3D → Blender: deja la casa lista para render arquitectónico fotorrealista.

Se ejecuta dentro de Blender 4.x o 5.x (pestaña Scripting → Abrir → Ejecutar) o sin interfaz:

    blender -b -P blender/arquitectura.py -- casa.glb [--render] [--calidad borrador|final|alta]
        [--hora dia|atardecer|noche] [--camara "Fachada"]

Lee ``casa.glb`` y ``proyecto.json`` de la carpeta del paquete y:

- importa el modelo y arma colecciones ``Piso N / Categoría`` desde los extras del GLB;
- rehace cada material como procedural de Cycles a escala real: pañete con grano, concreto
  con poros, madera con veta, pisos de porcelanato o de tablas, telas, metal y vidrio real;
  bisela 5 mm muros, losas y fachada;
- arma el entorno: prado, entrada al garaje, andén con sardinel, calle con su raya y árboles;
- pone cielo físico, el sol a la hora del estudio solar, un plafón por ambiente y luz en los
  apliques; la hora (día, atardecer, noche) se cambia desde el panel;
- crea las cámaras del proyecto: fachada, calle, aérea, interiores a la altura de los ojos y
  los dibujos técnicos (una planta por piso y el alzado) con líneas Freestyle; sin marcadores
  de línea de tiempo (fijarían la cámara del cuadro y el render de todas saldría igual);
- configura Cycles en la tarjeta de video si la hay (muestreo adaptativo, denoise, AgX);
- agrega el panel "Plano 3D" en la barra lateral (tecla N) de la vista 3D.
"""

# sin `from __future__ import annotations`: Blender lee las anotaciones de bpy.props
# de las clases registradas y las necesita como objetos, no como texto
import colorsys
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

PANEL_CATEGORY = "Plano 3D"
BEVEL_KINDS = {"wall", "slab", "facade", "column", "roof"}
FURNITURE = "Muebles"


# --------------------------------------------------------------------------- archivos


def _script_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def package_dir() -> str:
    """La carpeta del paquete: la de casa.glb (argumento), o la de arriba de este script."""
    for arg in _script_args():
        if arg.lower().endswith(".glb") and os.path.isfile(arg):
            return os.path.dirname(os.path.abspath(arg))
    candidates = []
    if "__file__" in globals():
        candidates.append(os.path.abspath(__file__))
    # desde el editor de texto __file__ no es la ruta real: se busca el texto abierto
    for text in bpy.data.texts:
        if text.filepath and text.filepath.endswith("arquitectura.py"):
            candidates.append(bpy.path.abspath(text.filepath))
    for path in candidates:
        here = os.path.dirname(path)
        for folder in (os.path.dirname(here), here):
            if os.path.isfile(os.path.join(folder, "casa.glb")):
                return folder
    raise FileNotFoundError("No encontré casa.glb: descomprima el paquete y abra el script desde ahí")


def load_project(folder: str) -> dict:
    with open(os.path.join(folder, "proyecto.json"), encoding="utf-8") as f:
        return json.load(f)


# --------------------------------------------------------------------------- escena


def clear_scene() -> None:
    """Empieza de cero: borra el cubo, la cámara y la luz de la escena por defecto."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)


def collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(coll)
    return coll


def import_model(folder: str) -> list[bpy.types.Object]:
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, "casa.glb"))
    return list(bpy.context.selected_objects)


def organize(objects: list[bpy.types.Object]) -> None:
    """Cada malla a su colección Piso N / Categoría; los vacíos del GLB sobran."""
    root = collection("Casa")
    for obj in objects:
        if obj.type != "MESH":
            continue
        floor = str(obj.get("level", "General"))
        category = str(obj.get("category", "Detalles"))
        target = collection(f"{floor} · {category}", collection(floor, root))
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        for coll in list(obj.users_collection):
            coll.objects.unlink(obj)
        target.objects.link(obj)
    for obj in objects:
        if obj.type == "EMPTY":
            bpy.data.objects.remove(obj, do_unlink=True)

# --------------------------------------------------------------------------- materiales
#
# Los materiales del visor son colores planos. Aquí cada familia (por el nombre que trae del
# visor) se rehace como material procedural de Cycles, con su textura, su relieve y su brillo.
# Todas las texturas se proyectan en coordenadas del mundo en metros: no necesitan UV y la
# escala es real (baldosa de 60 cm, tabla de 16 cm, poros de concreto de milímetros).


def _set(node: bpy.types.Node, names: tuple[str, ...], value: object) -> None:
    """Asigna la primera entrada que exista (los nombres cambian entre versiones de Blender)."""
    for name in names:
        if name in node.inputs:
            node.inputs[name].default_value = value
            return


def _attr(obj: object, name: str, value: object) -> None:
    """Asigna si la versión de Blender tiene ese ajuste."""
    if hasattr(obj, name):
        setattr(obj, name, value)


def _nodes_on(owner: bpy.types.Material | bpy.types.World) -> None:
    # en Blender 5 siempre usan nodos y use_nodes queda obsoleto
    if owner.node_tree is None:
        owner.use_nodes = True


def _bsdf(mat: bpy.types.Material) -> bpy.types.Node | None:
    _nodes_on(mat)
    if mat.node_tree is None:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def _hex(color: str) -> tuple[float, float, float, float]:
    c = color.lstrip("#")
    srgb = [int(c[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb]
    return (lin[0], lin[1], lin[2], 1.0)


def _shade(color: tuple[float, ...], k: float) -> tuple[float, float, float, float]:
    return (min(color[0] * k, 1.0), min(color[1] * k, 1.0), min(color[2] * k, 1.0), 1.0)


def _socket(sockets: object, identifier: str) -> bpy.types.NodeSocket:
    return next(s for s in sockets if s.identifier == identifier)


SOCKETS = {
    "roughness": ("Roughness",),
    "metallic": ("Metallic",),
    "coat": ("Coat Weight", "Clearcoat"),
    "sheen": ("Sheen Weight", "Sheen"),
    "transmission": ("Transmission Weight", "Transmission"),
    "subsurface": ("Subsurface Weight", "Subsurface"),
    "specular": ("Specular IOR Level", "Specular"),
    "ior": ("IOR",),
    "anisotropic": ("Anisotropic",),
    "emission": ("Emission Color", "Emission"),
    "emission_strength": ("Emission Strength",),
}


class Graph:
    """Arma el árbol de nodos de un material desde cero: un BSDF de principios y su salida."""

    def __init__(self, mat: bpy.types.Material) -> None:
        _nodes_on(mat)
        self.tree = mat.node_tree
        self.tree.nodes.clear()
        self.bsdf = self.node("ShaderNodeBsdfPrincipled")
        out = self.node("ShaderNodeOutputMaterial")
        self.link(self.bsdf.outputs["BSDF"], out.inputs["Surface"])
        self._pos: bpy.types.NodeSocket | None = None

    def node(self, kind: str, **inputs: object) -> bpy.types.Node:
        n = self.tree.nodes.new(kind)
        for key, value in inputs.items():
            n.inputs[key.replace("_", " ")].default_value = value
        return n

    def link(self, a: bpy.types.NodeSocket, b: bpy.types.NodeSocket) -> None:
        self.tree.links.new(a, b)

    def pos(self, scale: tuple[float, float, float] = (1.0, 1.0, 1.0)) -> bpy.types.NodeSocket:
        """Posición en el mundo (m), estirada por eje si hace falta (la veta de la madera)."""
        if self._pos is None:
            self._pos = self.node("ShaderNodeNewGeometry").outputs["Position"]
        if scale == (1.0, 1.0, 1.0):
            return self._pos
        m = self.node("ShaderNodeMapping")
        m.inputs["Scale"].default_value = scale
        self.link(self._pos, m.inputs["Vector"])
        return m.outputs["Vector"]

    def noise(self, scale: float, detail: float = 4.0, vector: bpy.types.NodeSocket | None = None, distortion: float = 0.0) -> bpy.types.Node:
        n = self.node("ShaderNodeTexNoise", Scale=scale, Detail=detail, Distortion=distortion)
        self.link(vector or self.pos(), n.inputs["Vector"])
        return n

    def ramp(self, fac: bpy.types.NodeSocket, a: tuple[float, ...], b: tuple[float, ...], lo: float = 0.0, hi: float = 1.0) -> bpy.types.NodeSocket:
        r = self.node("ShaderNodeValToRGB")
        e = r.color_ramp.elements
        e[0].position, e[0].color = lo, (*a[:3], 1.0)
        e[1].position, e[1].color = hi, (*b[:3], 1.0)
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def range(self, value: bpy.types.NodeSocket, lo: float, hi: float) -> bpy.types.NodeSocket:
        r = self.node("ShaderNodeMapRange")
        r.inputs["To Min"].default_value = lo
        r.inputs["To Max"].default_value = hi
        self.link(value, r.inputs["Value"])
        return r.outputs["Result"]

    def multiply(self, a: bpy.types.NodeSocket, b: bpy.types.NodeSocket) -> bpy.types.NodeSocket:
        m = self.node("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = "MULTIPLY"
        _socket(m.inputs, "Factor_Float").default_value = 1.0
        self.link(a, _socket(m.inputs, "A_Color"))
        self.link(b, _socket(m.inputs, "B_Color"))
        return _socket(m.outputs, "Result_Color")

    def bump(self, height: bpy.types.NodeSocket, strength: float, distance: float = 0.01) -> None:
        b = self.node("ShaderNodeBump", Strength=strength, Distance=distance)
        self.link(height, b.inputs["Height"])
        self.link(b.outputs["Normal"], self.bsdf.inputs["Normal"])

    def color(self, value: bpy.types.NodeSocket | tuple[float, ...]) -> None:
        if isinstance(value, tuple):
            self.bsdf.inputs["Base Color"].default_value = (*value[:3], 1.0)
        else:
            self.link(value, self.bsdf.inputs["Base Color"])

    def set(self, **values: object) -> None:
        for key, value in values.items():
            if isinstance(value, bpy.types.NodeSocket):
                self.link(value, next(self.bsdf.inputs[n] for n in SOCKETS[key] if n in self.bsdf.inputs))
            else:
                _set(self.bsdf, SOCKETS[key], value)


def mat_plaster(mat: bpy.types.Material, base: tuple[float, ...]) -> None:
    """Pañete pintado: color casi parejo con manchas suaves y grano fino de arena."""
    g = Graph(mat)
    big = g.noise(1.5, 3.0)
    g.color(g.ramp(big.outputs["Fac"], _shade(base, 0.95), _shade(base, 1.02), 0.3, 0.7))
    g.bump(g.noise(90.0, 6.0).outputs["Fac"], 0.12, 0.002)
    g.set(roughness=0.88, specular=0.35)


def mat_concrete(mat: bpy.types.Material, a: tuple[float, ...], b: tuple[float, ...]) -> None:
    """Concreto a la vista: manchas de fraguado, poros y brillo disparejo."""
    g = Graph(mat)
    mottle = g.noise(2.2, 6.0, distortion=0.4)
    g.color(g.ramp(mottle.outputs["Fac"], a, b, 0.35, 0.7))
    pores = g.node("ShaderNodeTexVoronoi", Scale=120.0)
    g.link(g.pos(), pores.inputs["Vector"])
    g.bump(pores.outputs["Distance"], 0.25, 0.003)
    g.set(roughness=g.range(g.noise(6.0, 2.0).outputs["Fac"], 0.65, 0.85), specular=0.4)


def mat_wood(mat: bpy.types.Material, dark: tuple[float, ...], light: tuple[float, ...], planks: bool = False, gloss: float = 0.45) -> None:
    """Madera: veta vertical en las caras verticales (puertas, closets) y a lo largo en las
    horizontales (pisos, mesas); `planks` la parte en tablas."""
    g = Graph(mat)
    up = g.node("ShaderNodeSeparateXYZ")
    g.link(g.node("ShaderNodeNewGeometry").outputs["Normal"], up.inputs["Vector"])
    flat = g.node("ShaderNodeMath")
    flat.operation = "ABSOLUTE"
    g.link(up.outputs["Z"], flat.inputs[0])
    horizontal = g.node("ShaderNodeMath")
    horizontal.operation = "GREATER_THAN"
    horizontal.inputs[1].default_value = 0.7
    g.link(flat.outputs["Value"], horizontal.inputs[0])
    pick = g.node("ShaderNodeMix")
    pick.data_type = "VECTOR"
    g.link(horizontal.outputs["Value"], _socket(pick.inputs, "Factor_Float"))
    g.link(g.pos((30.0, 30.0, 1.5)), _socket(pick.inputs, "A_Vector"))
    g.link(g.pos((1.5, 30.0, 30.0)), _socket(pick.inputs, "B_Vector"))
    veta = g.noise(1.2, 8.0, _socket(pick.outputs, "Result_Vector"), distortion=2.5)
    wood = g.ramp(veta.outputs["Fac"], dark, light, 0.35, 0.75)
    if planks:
        # tablas de 1,2 m × 16 cm, cada una de un tono un poco distinto, con su junta
        tab = g.node("ShaderNodeTexBrick", Scale=1.0, Mortar_Size=0.004, Brick_Width=1.2, Row_Height=0.16)
        tab.offset = 0.5
        tab.inputs["Color1"].default_value = (0.86, 0.86, 0.86, 1.0)
        tab.inputs["Color2"].default_value = (1.0, 1.0, 1.0, 1.0)
        tab.inputs["Mortar"].default_value = (0.25, 0.25, 0.25, 1.0)
        g.link(g.pos(), tab.inputs["Vector"])
        wood = g.multiply(wood, tab.outputs["Color"])
        g.bump(tab.outputs["Fac"], 0.3, 0.002)
    else:
        g.bump(veta.outputs["Fac"], 0.08, 0.002)
    g.color(wood)
    g.set(roughness=gloss, specular=0.45, coat=0.15 if planks else 0.0)


def mat_tiles(mat: bpy.types.Material, base: tuple[float, ...], size: float = 0.6, roughness: tuple[float, float] = (0.12, 0.85)) -> None:
    """Baldosas de `size` m con junta y tonos apenas distintos (porcelanato, placas de andén)."""
    g = Graph(mat)
    t = g.node("ShaderNodeTexBrick", Scale=1.0 / size, Mortar_Size=0.006, Brick_Width=1.0, Row_Height=1.0)
    t.offset = 0.0
    t.inputs["Color1"].default_value = _shade(base, 0.97)
    t.inputs["Color2"].default_value = _shade(base, 1.03)
    t.inputs["Mortar"].default_value = _shade(base, 0.6)
    g.link(g.pos(), t.inputs["Vector"])
    cloud = g.noise(4.0, 5.0)
    g.color(g.multiply(t.outputs["Color"], g.ramp(cloud.outputs["Fac"], (0.94,) * 3, (1.0,) * 3, 0.3, 0.7)))
    g.set(roughness=g.range(t.outputs["Fac"], *roughness), specular=0.5)
    g.bump(t.outputs["Fac"], 0.35, 0.002)


def mat_fabric(mat: bpy.types.Material, base: tuple[float, ...]) -> None:
    g = Graph(mat)
    g.color(base)
    g.bump(g.noise(600.0, 2.0).outputs["Fac"], 0.15, 0.001)
    g.set(roughness=0.95, sheen=0.6, specular=0.25)


def mat_paint(mat: bpy.types.Material, base: tuple[float, ...], roughness: float, metallic: float) -> None:
    g = Graph(mat)
    g.color(base)
    g.bump(g.noise(300.0, 2.0).outputs["Fac"], 0.03, 0.001)
    g.set(roughness=roughness, metallic=metallic, coat=0.2 if metallic > 0.2 else 0.0)


def mat_glass(mat: bpy.types.Material) -> None:
    g = Graph(mat)
    g.color((0.9, 0.96, 0.95))
    g.set(transmission=1.0, roughness=0.01, ior=1.5, specular=0.5)
    _attr(mat, "surface_render_method", "DITHERED")


def mat_emission(mat: bpy.types.Material, color: str, strength: float) -> None:
    g = Graph(mat)
    g.color(_hex(color))
    g.set(emission=_hex(color), emission_strength=strength, roughness=0.5)


def mat_grass(mat: bpy.types.Material) -> None:
    """Prado: parches de verde seco y verde vivo, y briznas en el relieve."""
    g = Graph(mat)
    patches = g.noise(0.35, 6.0, distortion=0.6)
    tone = g.ramp(patches.outputs["Fac"], _hex("#5f6e40"), _hex("#808b56"), 0.3, 0.75)
    fine = g.noise(25.0, 4.0)
    g.color(g.multiply(tone, g.ramp(fine.outputs["Fac"], (0.8,) * 3, (1.0,) * 3)))
    g.bump(g.noise(220.0, 2.0).outputs["Fac"], 0.6, 0.02)
    g.set(roughness=0.95, specular=0.3)


def mat_asphalt(mat: bpy.types.Material) -> None:
    g = Graph(mat)
    grit = g.node("ShaderNodeTexVoronoi", Scale=180.0)
    g.link(g.pos(), grit.inputs["Vector"])
    wear = g.noise(0.6, 5.0)
    base = g.ramp(wear.outputs["Fac"], _hex("#2a2b2d"), _hex("#404244"), 0.35, 0.7)
    g.color(g.multiply(base, g.ramp(grit.outputs["Distance"], (0.75,) * 3, (1.0,) * 3)))
    g.bump(grit.outputs["Distance"], 0.4, 0.004)
    g.set(roughness=0.9, specular=0.35)


def mat_leaves(mat: bpy.types.Material) -> None:
    """Follaje: tonos de hoja al sol y a la sombra, relieve de hojas sueltas y algo de traslucidez."""
    g = Graph(mat)
    g.color(g.ramp(g.noise(3.0, 4.0).outputs["Fac"], _hex("#34492a"), _hex("#6b7d45"), 0.3, 0.7))
    hojas = g.node("ShaderNodeTexVoronoi", Scale=35.0)
    g.link(g.pos(), hojas.inputs["Vector"])
    g.bump(hojas.outputs["Distance"], 0.8, 0.03)
    g.set(roughness=0.65, subsurface=0.2, specular=0.4)


def mat_bark(mat: bpy.types.Material) -> None:
    g = Graph(mat)
    v = g.noise(2.0, 6.0, g.pos((30.0, 30.0, 1.0)), distortion=1.0)
    g.color(g.ramp(v.outputs["Fac"], _hex("#2e241c"), _hex("#5a4a3c")))
    g.bump(v.outputs["Fac"], 0.6, 0.01)
    g.set(roughness=0.9)


def _is_wood(c: tuple[float, ...]) -> bool:
    """¿Un color de piso del visor es de madera (cálido y con saturación)?"""
    srgb = [x ** (1 / 2.2) for x in c[:3]]
    h, s, _v = colorsys.rgb_to_hsv(*srgb)
    return 0.04 <= h <= 0.12 and s >= 0.38


def _base_name(name: str) -> str:
    """Quita el sufijo .001 que Blender agrega a los nombres repetidos."""
    head, dot, tail = name.rpartition(".")
    return head if dot and len(tail) == 3 and tail.isdigit() else name


def tune_materials() -> None:
    """Cada material del visor (por su nombre, que el GLB conserva) a su versión fotorrealista."""
    for mat in list(bpy.data.materials):
        bsdf = _bsdf(mat)
        if bsdf is None:
            continue
        base = tuple(bsdf.inputs["Base Color"].default_value)
        name = _base_name(mat.name)
        parts = name.split(":")
        if name.startswith("glass"):
            mat_glass(mat)
        elif name == "lamp":
            mat_emission(mat, "#fff1d6", 6.0)
        elif name.startswith(("wall:", "facade:panete")) or name == "ceiling":
            mat_plaster(mat, base)
        elif name.startswith("facade:concreto") and len(parts) >= 4:
            mat_concrete(mat, _hex(parts[2]), _hex(parts[3]))
        elif name in ("column", "slab", "structure", "footing"):
            mat_concrete(mat, _shade(base, 0.92), _shade(base, 1.06))
        elif name.startswith("facade:madera") and len(parts) >= 4:
            mat_wood(mat, _shade(_hex(parts[2]), 0.75), _hex(parts[2]))
        elif name == "door":
            mat_wood(mat, _shade(base, 0.7), _shade(base, 1.15), gloss=0.4)
        elif name in ("stair", "tone:wood"):
            mat_wood(mat, _shade(base, 0.7), _shade(base, 1.2), gloss=0.35)
        elif name.startswith("floor:"):
            if _is_wood(base):
                mat_wood(mat, _shade(base, 0.72), _shade(base, 1.12), planks=True, gloss=0.3)
            else:
                mat_tiles(mat, base, 0.6)
        elif name in ("tone:fabric", "tone:soft"):
            mat_fabric(mat, base)
        elif name == "tone:metal":
            mat_paint(mat, base, 0.28, 1.0)
            _set(_bsdf(mat), SOCKETS["anisotropic"], 0.5)
        elif name == "tone:white":
            mat_paint(mat, base, 0.22, 0.0)
            _set(_bsdf(mat), SOCKETS["coat"], 0.4)
        elif name in ("tone:dark", "frame", "railing"):
            mat_paint(mat, base, 0.35, 0.7)
        elif name.startswith("facade:color:#4f7a3a"):
            mat_leaves(mat)
        elif name.startswith("facade:color:") and len(parts) >= 5:
            try:
                rough, metal = float(parts[3]), float(parts[4])
            except ValueError:
                rough, metal = 0.6, 0.0
            # los oscuros son perfilería y marcos: metal pintado
            dark = sum(base[:3]) < 0.3
            mat_paint(mat, base, min(rough, 0.45) if dark else rough, max(metal, 0.6) if dark else metal)
        else:
            _set(bsdf, SOCKETS["specular"], 0.4)


def bevel(objects: list[bpy.types.Object]) -> None:
    """Aristas con bisel de 5 mm: atrapan la luz como las de una obra real."""
    for obj in objects:
        if obj.type != "MESH" or obj.get("kind") not in BEVEL_KINDS:
            continue
        mod = obj.modifiers.new("Bisel 5 mm", "BEVEL")
        mod.width = 0.005
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.use_clamp_overlap = True
        mod.harden_normals = False


# --------------------------------------------------------------------------- entorno


def _material(name: str, build: object, *args: object) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    build(mat, *args)
    return mat


def _box(name: str, coll: bpy.types.Collection, center: Vector, size: tuple[float, float, float], angle: float, mat: bpy.types.Material) -> bpy.types.Object:
    """Caja de `size` (a lo largo del frente, a lo ancho, alto) girada `angle` alrededor de Z."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = center
    obj.scale = size
    obj.rotation_euler = (0.0, 0.0, angle)
    mesh.materials.append(mat)
    coll.objects.link(obj)
    return obj


def terrain(project: dict) -> None:
    """El terreno y, frente a la fachada, la entrada al garaje, el andén, la calle y árboles."""
    env = collection("Entorno")
    _box("Terreno", env, Vector((0, 0, -0.07)), (300.0, 300.0, 0.1), 0.0, _material("Pasto", mat_grass))
    site = project.get("site")
    if not site:
        return
    c = Vector((site["center"][0], site["center"][1], 0.0))
    f = Vector((site["front"][0], site["front"][1], 0.0)).normalized()
    s = Vector((site["side"][0], site["side"][1], 0.0)).normalized()
    angle = math.atan2(f.y, f.x)
    d0 = site["depth"]

    def at(along: float, across: float, z: float) -> Vector:
        return c + f * along + s * across + Vector((0, 0, z))

    def strip(name: str, a0: float, a1: float, width: float, z0: float, z1: float, mat: bpy.types.Material, across: float = 0.0) -> None:
        _box(name, env, at((a0 + a1) / 2, across, (z0 + z1) / 2), (a1 - a0, width, z1 - z0), angle, mat)

    sidewalk = _material("Andén", mat_tiles, _hex("#b5b1a8"), 1.5, (0.75, 0.9))
    driveway = _material("Entrada", mat_tiles, _hex("#a7a39a"), 1.0, (0.7, 0.9))
    asphalt = _material("Asfalto", mat_asphalt)
    paint = _material("Pintura vial", mat_paint, _hex("#e9e6dc"), 0.6, 0.0)
    curb = _material("Sardinel", mat_concrete, _hex("#9d9a93"), _hex("#bdb9b0"))
    long = 160.0
    garden, walk, road = 2.5, 2.0, 7.0
    for k, gate in enumerate(site.get("gates", [])):
        strip(f"Entrada al garaje {k + 1}", d0, d0 + garden, gate["width"] + 0.6, -0.05, 0.015, driveway, gate["offset"])
    strip("Andén", d0 + garden, d0 + garden + walk - 0.15, long, -0.05, 0.12, sidewalk)
    strip("Sardinel", d0 + garden + walk - 0.15, d0 + garden + walk, long, -0.05, 0.15, curb)
    r0 = d0 + garden + walk
    strip("Calle", r0, r0 + road, long, -0.06, 0.0, asphalt)
    for i in range(-12, 13):
        # línea central discontinua: 3 m de raya cada 6 m
        _box(f"Raya {i}", env, at(r0 + road / 2, i * 6.0, 0.001), (0.12, 3.0, 0.004), angle, paint)
    strip("Sardinel de enfrente", r0 + road, r0 + road + 0.15, long, -0.05, 0.15, curb)
    strip("Andén de enfrente", r0 + road + 0.15, r0 + road + walk, long, -0.05, 0.12, sidewalk)
    half = site["width"] / 2
    # árboles en el andén, a los lados de la casa para no taparla desde la calle
    spots = [(d0 + garden + 0.8, -(half + 3.0)), (d0 + garden + 0.8, half + 3.0), (d0 + garden + 0.8, -(half + 11.0)), (d0 + garden + 0.8, half + 11.0), (r0 + road + walk - 0.8, -(half + 6.0)), (r0 + road + walk - 0.8, half + 14.0)]
    for k, (along, across) in enumerate(spots):
        tree(at(along, across, 0.12), 5.5 + (k % 3) * 0.8, k)


def tree(base: Vector, height: float, seed: int) -> None:
    """Árbol de calle: tronco, y una copa de icosfera deformada con nubes de ruido."""
    coll = collection("Entorno · Árboles", collection("Entorno"))
    bark = bpy.data.materials.get("Corteza") or _material("Corteza", mat_bark)
    leaves = bpy.data.materials.get("Follaje") or _material("Follaje", mat_leaves)
    trunk_h = height * 0.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.13, depth=trunk_h, location=base + Vector((0, 0, trunk_h / 2)))
    trunk = bpy.context.active_object
    trunk.name = f"Tronco {seed}"
    trunk.data.materials.append(bark)
    tex = bpy.data.textures.get("Copa") or bpy.data.textures.new("Copa", "CLOUDS")
    tex.noise_scale = 0.35
    _attr(tex, "noise_depth", 4)
    # la copa son varios racimos de hojas alrededor de la punta del tronco, no una bola
    r = height * 0.2
    top = base + Vector((0, 0, height * 0.66))
    clumps = [(0.0, 0.0, 0.25, 1.15)] + [(math.cos(a) * r * 1.1, math.sin(a) * r * 1.1, -0.15 + 0.3 * ((k + seed) % 2), 0.85) for k, a in enumerate(math.radians(seed * 37 + d) for d in (0, 72, 144, 216, 288))]
    parts = [trunk]
    for k, (dx, dy, dz, size) in enumerate(clumps):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=r * size, location=top + Vector((dx, dy, dz * r * 2)))
        crown = bpy.context.active_object
        crown.name = f"Copa {seed}.{k}"
        disp = crown.modifiers.new("Hojas", "DISPLACE")
        disp.texture = tex
        disp.strength = r * 0.45
        disp.texture_coords = "GLOBAL"
        crown.data.materials.append(leaves)
        for poly in crown.data.polygons:
            poly.use_smooth = True
        parts.append(crown)
    for obj in parts:
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        coll.objects.link(obj)


# --------------------------------------------------------------------------- luz y mundo

TIMES = {
    # hora: (sol prendido, energía del sol, color del sol, fuerza del cielo, W por ambiente, W por aplique)
    "dia": (True, 4.0, (1.0, 0.96, 0.9), 0.35, 40.0, 0.0),
    "atardecer": (True, 2.2, (1.0, 0.62, 0.36), 0.5, 70.0, 25.0),
    "noche": (False, 0.0, (1.0, 1.0, 1.0), 0.02, 90.0, 40.0),
}


def sky_and_sun(project: dict) -> None:
    d = Vector(project["sun"]["direction"]).normalized()
    scene = bpy.context.scene
    scene["sun_direction"] = list(d)
    world = bpy.data.worlds.get("Cielo") or bpy.data.worlds.new("Cielo")
    scene.world = world
    _nodes_on(world)
    nodes = world.node_tree.nodes
    nodes.clear()
    sky = nodes.new("ShaderNodeTexSky")
    sky.name = "Cielo"
    # cielo físico: "NISHITA" en Blender 4.x, "MULTIPLE_SCATTERING" en 5.x
    for kind in ("NISHITA", "MULTIPLE_SCATTERING", "HOSEK_WILKIE"):
        try:
            sky.sky_type = kind
            break
        except TypeError:
            continue
    _attr(sky, "sun_disc", False)  # el disco lo pone la lámpara de sol
    _attr(sky, "air_density", 1.0)
    _attr(sky, "dust_density", 1.5)
    bg = nodes.new("ShaderNodeBackground")
    bg.name = "Fondo"
    out = nodes.new("ShaderNodeOutputWorld")
    world.node_tree.links.new(sky.outputs["Color"], bg.inputs["Color"])
    world.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])
    light = bpy.data.lights.new("Sol", "SUN")
    light.angle = math.radians(0.6)
    collection("Iluminación").objects.link(bpy.data.objects.new("Sol", light))


def _aim_sun(d: Vector) -> None:
    sky = bpy.context.scene.world.node_tree.nodes["Cielo"]
    _attr(sky, "sun_elevation", math.asin(max(min(d.z, 1.0), -1.0)))
    _attr(sky, "sun_rotation", math.atan2(d.x, d.y))
    if sky.sky_type == "HOSEK_WILKIE":
        sky.sun_direction = d
    # la lámpara alumbra hacia su −Z: su +Z apunta al sol
    bpy.data.objects["Sol"].rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def set_time(mode: str) -> None:
    """Día (el sol del estudio solar), atardecer (sol rasante y luces prendidas) o noche."""
    on, energy, color, sky_strength, room_w, facade_w = TIMES.get(mode, TIMES["dia"])
    scene = bpy.context.scene
    d = Vector(scene.get("sun_direction", (0.3, -0.5, 0.8))).normalized()
    if mode == "atardecer":
        flat = Vector((d.x, d.y, 0.0)).normalized()
        d = (flat * math.cos(math.radians(5)) + Vector((0, 0, math.sin(math.radians(5))))).normalized()
    _aim_sun(d)
    sun = bpy.data.objects["Sol"]
    sun.hide_render = sun.hide_viewport = not on
    sun.data.energy = energy
    sun.data.color = color
    nodes = scene.world.node_tree.nodes
    nodes["Fondo"].inputs["Strength"].default_value = sky_strength
    for obj in bpy.data.objects:
        if obj.type == "LIGHT" and obj.get("role") in ("room", "facade"):
            obj.data.energy = room_w * float(obj.get("power", 1.0)) if obj["role"] == "room" else facade_w
    lamp = bpy.data.materials.get("lamp")
    if lamp and _bsdf(lamp):
        _set(_bsdf(lamp), SOCKETS["emission_strength"], 1.0 if mode == "dia" else 12.0)


def _ceiling_above(point: Vector) -> float | None:
    """Altura de la cara de abajo del techo sobre `point` (la losa del piso de arriba o la cubierta)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    hit, loc, *_ = bpy.context.scene.ray_cast(depsgraph, point, Vector((0, 0, 1)), distance=3.0)
    return loc.z if hit else None


def room_lights(project: dict) -> None:
    # los plafones del visor quedan a la altura de los muros, metidos en la losa de arriba: se
    # bajan hasta la cara de abajo del techo para que se vean y no tapen su luz
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.get("kind") == "lamp"]:
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        top = max(c.z for c in corners)
        mid = sum(corners, Vector()) / 8
        ceiling = _ceiling_above(Vector((mid.x, mid.y, top - 0.4)))
        if ceiling is not None and ceiling < top:
            obj.location.z -= top - ceiling
    for lamp in project.get("lamps", []):
        # plafón: luz de área en disco que alumbra hacia abajo (−Z), cálida como la de una casa
        light = bpy.data.lights.new(f"Luz {lamp['room']}", "AREA")
        light.shape = "DISK"
        light.size = 0.35
        light.color = (1.0, 0.88, 0.72)
        obj = bpy.data.objects.new(light.name, light)
        obj["role"] = "room"
        # potencia según el tamaño del ambiente: de día 4 W por m² (mínimo 30 W), y en proporción a la hora
        obj["power"] = max(30.0, 4.0 * float(lamp.get("area", 10.0))) / 40.0
        obj.visible_camera = False  # alumbra, pero no se ve como un disco blanco en la planta
        obj.location = Vector(lamp["location"])
        ceiling = _ceiling_above(obj.location - Vector((0, 0, 0.4)))
        if ceiling is not None:
            obj.location.z = ceiling - 0.08
        floor = collection(lamp["collection"], collection("Casa"))
        collection(f"{lamp['collection']} · Luces", floor).objects.link(obj)
    # una luz chica debajo de cada aplique de la fachada
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o.get("kind") == "facade" and any(s.material and _base_name(s.material.name) == "lamp" for s in o.material_slots)]:
        light = bpy.data.lights.new(f"Aplique {obj.name}", "POINT")
        light.shadow_soft_size = 0.05
        light.color = (1.0, 0.82, 0.6)
        lo = bpy.data.objects.new(light.name, light)
        lo["role"] = "facade"
        lo.visible_camera = False
        lo.location = obj.matrix_world.translation + Vector((0, 0, -0.12))
        collection("Iluminación").objects.link(lo)


def window_portals(project: dict) -> None:
    """Un portal de luz en cada ventana: guía la luz del cielo hacia adentro y limpia el ruido
    de los interiores (no agrega luz; sólo le dice a Cycles por dónde entra)."""
    site = project.get("site") or {}
    center = Vector((*site.get("center", (0.0, 0.0)), 0.0))
    panes = [o for o in bpy.data.objects if o.type == "MESH" and o.get("kind") == "window" and any(s.material and s.material.name.startswith("glass") for s in o.material_slots)]
    for obj in panes:
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
        hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
        size = hi - lo
        if size.z < 0.2 or max(size.x, size.y) < 0.2:
            continue
        mid = (lo + hi) / 2
        # la normal es el eje delgado del vidrio, del lado que mira hacia el centro de la casa
        axis = Vector((1, 0, 0)) if size.x < size.y else Vector((0, 1, 0))
        inward = axis if (center - mid).dot(axis) > 0 else -axis
        light = bpy.data.lights.new(f"Portal {obj.name}", "AREA")
        light.shape = "RECTANGLE"
        light.size = max(size.x, size.y)
        light.size_y = size.z
        light.cycles.is_portal = True
        portal = bpy.data.objects.new(light.name, light)
        portal.location = mid
        # el área alumbra hacia su −Z: hacia adentro, con su eje Y vertical
        portal.rotation_euler = inward.to_track_quat("-Z", "Y").to_euler()
        collection("Iluminación · Portales", collection("Iluminación")).objects.link(portal)


# --------------------------------------------------------------------------- cámaras


def cameras(project: dict) -> list[bpy.types.Object]:
    out = []
    scene = bpy.context.scene
    coll = collection("Cámaras")
    for spec in project["cameras"]:
        cam = bpy.data.cameras.new(spec["name"])
        obj = bpy.data.objects.new(spec["name"], cam)
        coll.objects.link(obj)
        loc = Vector(spec["location"])
        look = Vector(spec["target"]) - loc
        flat = Vector((look.x, look.y, 0.0))
        obj.location = loc
        cam.clip_end = 1000
        if spec.get("lens", 0) == 0:
            cam.type = "ORTHO"
            cam.ortho_scale = spec.get("ortho_scale", 20)
            # planta: mirando derecho hacia abajo; alzado: horizontal hacia la fachada
            obj.rotation_euler = (0.0, 0.0, 0.0) if flat.length < 1e-3 else flat.to_track_quat("-Z", "Y").to_euler()
        else:
            cam.lens = spec["lens"]
            cam.sensor_width = 36
            if spec.get("level"):
                # cámara horizontal: las verticales quedan rectas, como en fotografía de arquitectura
                obj.rotation_euler = flat.to_track_quat("-Z", "Y").to_euler()
                if not spec.get("interior"):
                    # el centro de la fachada se sube con shift, sin fugas verticales
                    height = project.get("height") or 3
                    dist = max(flat.length, 1.0)
                    cam.shift_y = min(0.45, ((height / 2 - loc.z) / dist) * cam.lens / cam.sensor_width)
            else:
                obj.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
        if "floor" in spec:
            obj["floor"] = spec["floor"]
        obj["lines"] = bool(spec.get("lines"))
        # adentro llega mucha menos luz que en la calle: como un fotógrafo, se abre la exposición
        obj["exposure"] = 1.5 if spec.get("interior") else 0.0
        out.append(obj)
    if out:
        scene.camera = out[0]
    return out


# --------------------------------------------------------------------------- render

QUALITY = {
    # calidad: (muestras, ancho, alto)
    "borrador": (48, 1280, 720),
    "final": (256, 1920, 1080),
    "alta": (768, 3840, 2160),
}


def use_gpu() -> str:
    """Renderiza en la tarjeta de video si hay una compatible (OptiX, CUDA, HIP, oneAPI, Metal)."""
    scene = bpy.context.scene
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return "CPU"
    for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        refresh = getattr(prefs, "refresh_devices", None) or getattr(prefs, "get_devices", None)
        if refresh:
            refresh()
        if any(d.type == kind for d in prefs.devices):
            for dev in prefs.devices:
                dev.use = dev.type == kind
            scene.cycles.device = "GPU"
            return kind
    scene.cycles.device = "CPU"
    return "CPU"


def set_quality(name: str) -> None:
    samples, w, h = QUALITY.get(name, QUALITY["final"])
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.resolution_x = w
    scene.render.resolution_y = h


def render_settings() -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.01
    cy.use_denoising = True
    _attr(cy, "denoiser", "OPENIMAGEDENOISE")
    cy.max_bounces = 12
    cy.diffuse_bounces = 6
    cy.glossy_bounces = 6
    cy.transmission_bounces = 12
    cy.transparent_max_bounces = 16
    # sin cáusticas: con vidrio sólo traen ruido
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    set_quality("final")
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    view = scene.view_settings
    try:
        view.view_transform = "AgX"
    except TypeError:
        view.view_transform = "Filmic"
    for look in ("AgX - Medium High Contrast", "Medium High Contrast", "AgX - Base Contrast"):
        try:
            view.look = look
            break
        except TypeError:
            continue
    scene.unit_settings.system = "METRIC"
    lines_style()


def lines_style() -> None:
    """Líneas negras finas (Freestyle) para las plantas y el alzado: se prenden por cámara."""
    scene = bpy.context.scene
    if not hasattr(scene.render, "use_freestyle"):
        return
    scene.render.line_thickness_mode = "ABSOLUTE"
    scene.render.line_thickness = 1.3
    fs = scene.view_layers[0].freestyle_settings
    fs.crease_angle = math.radians(134)
    lineset = fs.linesets[0] if len(fs.linesets) else fs.linesets.new("Líneas")
    lineset.select_by_visibility = True
    lineset.select_silhouette = True
    lineset.select_border = True
    lineset.select_crease = True
    # sólo la casa: en los árboles y la calle las líneas ensucian el dibujo
    casa = bpy.data.collections.get("Casa")
    if casa:
        lineset.select_by_collection = True
        lineset.collection = casa
    lineset.linestyle.color = (0.06, 0.06, 0.07)
    lineset.linestyle.thickness = 1.3
    scene.render.use_freestyle = False


def prepare_camera(obj: bpy.types.Object) -> None:
    """Deja la escena como la pide la cámara: los pisos que se ven, las líneas y la exposición."""
    scene = bpy.context.scene
    scene.camera = obj
    show_floors(obj.get("floor"))
    if hasattr(scene.render, "use_freestyle"):
        scene.render.use_freestyle = bool(obj.get("lines"))
    scene.view_settings.exposure = float(obj.get("exposure", 0.0))


def floor_collections() -> list[tuple[int, bpy.types.Collection]]:
    out = []
    casa = bpy.data.collections.get("Casa")
    for coll in casa.children if casa else []:
        if coll.name.startswith("Piso "):
            try:
                out.append((int(coll.name.split()[1]), coll))
            except (IndexError, ValueError):
                continue
    return sorted(out, key=lambda x: x[0])


def show_floors(up_to: int | None) -> None:
    """Muestra los pisos hasta `up_to` (None = todos) y la cubierta solo con todos."""
    for n, coll in floor_collections():
        hidden = up_to is not None and n > up_to
        coll.hide_render = hidden
        coll.hide_viewport = hidden
        for child in coll.children:
            if child.name.endswith("· Cubierta"):
                child.hide_render = up_to is not None
                child.hide_viewport = up_to is not None


def set_furniture(on: bool) -> None:
    for coll in bpy.data.collections:
        if coll.name.endswith(f"· {FURNITURE}"):
            coll.hide_render = not on
            coll.hide_viewport = not on


def render_all(folder: str, only: str | None = None) -> list[str]:
    """Una imagen por cámara (o sólo las que contienen `only` en el nombre) en renders/."""
    scene = bpy.context.scene
    out_dir = os.path.join(folder, "renders")
    os.makedirs(out_dir, exist_ok=True)
    done = []
    current = scene.camera
    for obj in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        if only and only.lower() not in obj.name.lower():
            continue
        prepare_camera(obj)
        safe = "".join(ch if ch.isalnum() else "_" for ch in obj.name)
        scene.render.filepath = os.path.join(out_dir, f"{safe}.png")
        bpy.ops.render.render(write_still=True)
        done.append(scene.render.filepath)
    if current:
        prepare_camera(current)
    return done


# --------------------------------------------------------------------------- panel


def _camera_items(_self: object, _context: object) -> list[tuple[str, str, str]]:
    return [(o.name, o.name, "") for o in bpy.data.objects if o.type == "CAMERA"]


def _on_camera(self: bpy.types.PropertyGroup, _context: bpy.types.Context) -> None:
    obj = bpy.data.objects.get(self.camera)
    if obj:
        prepare_camera(obj)


def _on_furniture(self: bpy.types.PropertyGroup, _context: bpy.types.Context) -> None:
    set_furniture(self.furniture)


def _on_time(self: bpy.types.PropertyGroup, _context: bpy.types.Context) -> None:
    set_time(self.time)


def _on_quality(self: bpy.types.PropertyGroup, _context: bpy.types.Context) -> None:
    set_quality(self.quality)


class PLANO3D_Props(bpy.types.PropertyGroup):
    camera: bpy.props.EnumProperty(name="Cámara", items=_camera_items, update=_on_camera)
    furniture: bpy.props.BoolProperty(name="Muebles", default=True, update=_on_furniture)
    time: bpy.props.EnumProperty(
        name="Hora",
        items=[
            ("dia", "Día", "El sol a la hora del estudio solar"),
            ("atardecer", "Atardecer", "Sol rasante y luces prendidas"),
            ("noche", "Noche", "Sólo las luces de la casa"),
        ],
        default="dia",
        update=_on_time,
    )
    quality: bpy.props.EnumProperty(
        name="Calidad",
        items=[
            ("borrador", "Borrador", "48 muestras, 1280×720"),
            ("final", "Final", "256 muestras, 1920×1080"),
            ("alta", "Alta (4K)", "768 muestras, 3840×2160"),
        ],
        default="final",
        update=_on_quality,
    )
    folder: bpy.props.StringProperty(name="Carpeta", subtype="DIR_PATH")


class PLANO3D_OT_floor(bpy.types.Operator):
    bl_idname = "plano3d.floor"
    bl_label = "Ver piso"
    bl_description = "Muestra hasta este piso (0 = todos)"
    n: bpy.props.IntProperty(default=0)

    def execute(self, context: bpy.types.Context) -> set[str]:
        show_floors(self.n or None)
        return {"FINISHED"}


class PLANO3D_OT_render_all(bpy.types.Operator):
    bl_idname = "plano3d.render_all"
    bl_label = "Renderizar todas las cámaras"
    bl_description = "Una imagen por cámara en la carpeta renders/ del paquete"

    def execute(self, context: bpy.types.Context) -> set[str]:
        files = render_all(context.scene.plano3d.folder)
        self.report({"INFO"}, f"{len(files)} imágenes en renders/")
        return {"FINISHED"}


class PLANO3D_PT_panel(bpy.types.Panel):
    bl_label = "Plano 3D"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = PANEL_CATEGORY

    def draw(self, context: bpy.types.Context) -> None:
        props = context.scene.plano3d
        col = self.layout.column(align=True)
        col.prop(props, "camera")
        col.prop(props, "time")
        col.prop(props, "quality")
        col.prop(props, "furniture")
        row = self.layout.row(align=True)
        row.operator(PLANO3D_OT_floor.bl_idname, text="Todos").n = 0
        for n, _coll in floor_collections():
            row.operator(PLANO3D_OT_floor.bl_idname, text=str(n)).n = n
        self.layout.operator(PLANO3D_OT_render_all.bl_idname, icon="RENDER_STILL")


CLASSES = (PLANO3D_Props, PLANO3D_OT_floor, PLANO3D_OT_render_all, PLANO3D_PT_panel)


def register() -> None:
    for cls in CLASSES:
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass
        bpy.utils.register_class(cls)
    bpy.types.Scene.plano3d = bpy.props.PointerProperty(type=PLANO3D_Props)


# --------------------------------------------------------------------------- principal


def _option(name: str, default: str) -> str:
    """El valor de `--nombre valor` en los argumentos del script."""
    args = _script_args()
    if f"--{name}" in args:
        i = args.index(f"--{name}")
        if i + 1 < len(args):
            return args[i + 1]
    return default


def main() -> None:
    folder = package_dir()
    project = load_project(folder)
    clear_scene()
    objects = import_model(folder)
    organize(objects)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    tune_materials()
    bevel(meshes)
    terrain(project)
    sky_and_sun(project)
    room_lights(project)
    window_portals(project)
    cameras(project)
    render_settings()
    device = use_gpu()
    register()
    props = bpy.context.scene.plano3d
    props.folder = folder
    props.time = _option("hora", "dia")
    props.quality = _option("calidad", "final")
    set_time(props.time)
    set_quality(props.quality)
    blend = os.path.join(folder, "casa.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"Plano 3D: escena lista en {blend} ({len(meshes)} mallas, {len(project['cameras'])} cámaras, {device})")
    if "--render" in _script_args():
        only = _option("camara", "")
        for path in render_all(folder, only or None):
            print("render:", path)


if __name__ == "__main__":
    main()
