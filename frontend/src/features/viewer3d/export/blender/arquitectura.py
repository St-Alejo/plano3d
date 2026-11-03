"""Plano 3D → Blender: deja la casa lista para render arquitectónico.

Se ejecuta dentro de Blender 4.x (pestaña Scripting → Abrir → Ejecutar) o sin interfaz:

    blender -b -P blender/arquitectura.py -- casa.glb [--render]

Lee ``casa.glb`` y ``proyecto.json`` de la carpeta del paquete y:

- importa el modelo y arma colecciones ``Piso N / Categoría`` desde los extras del GLB;
- rehace los materiales para Cycles (vidrio con transmisión, perfilería de metal pintado,
  plafones que emiten luz) y bisela 3 mm muros, losas y fachada;
- pone cielo físico (Nishita), un sol a la hora del estudio solar y una luz por ambiente;
- crea las cámaras del proyecto (fachada, calle, aérea y una planta por piso; sin marcadores
  de línea de tiempo: fijarían la cámara del cuadro y el render de todas saldría igual);
- configura Cycles (128 muestras, denoise, AgX, 1920×1080) y el terreno;
- agrega el panel "Plano 3D" en la barra lateral (tecla N) de la vista 3D.
"""

# sin `from __future__ import annotations`: Blender lee las anotaciones de bpy.props
# de las clases registradas y las necesita como objetos, no como texto
import json
import math
import os
import sys

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


def tune_materials() -> None:
    """Ajustes por nombre de material del visor (el GLB los conserva)."""
    for mat in bpy.data.materials:
        bsdf = _bsdf(mat)
        if bsdf is None:
            continue
        name = mat.name
        if name.startswith("glass"):
            _set(bsdf, ("Base Color",), (0.92, 0.97, 0.98, 1.0))
            _set(bsdf, ("Transmission Weight", "Transmission"), 1.0)
            _set(bsdf, ("Roughness",), 0.02)
            _set(bsdf, ("IOR",), 1.45)
            _set(bsdf, ("Alpha",), 1.0)
            if hasattr(mat, "surface_render_method"):
                mat.surface_render_method = "DITHERED"
        elif name in ("frame",) or name.startswith("facade:color:#1") or name.startswith("facade:color:#2"):
            # perfilería y marcos oscuros: metal pintado, satinado
            _set(bsdf, ("Metallic",), 0.25)
            _set(bsdf, ("Roughness",), 0.35)
            _set(bsdf, ("Coat Weight", "Clearcoat"), 0.2)
        elif name == "lamp":
            _set(bsdf, ("Emission Color", "Emission"), _hex("#fff1d6"))
            _set(bsdf, ("Emission Strength",), 6.0)
        elif name.startswith("facade:color:#4f7a3a"):
            # follaje de la jardinera
            _set(bsdf, ("Roughness",), 0.8)
            _set(bsdf, ("Subsurface Weight", "Subsurface"), 0.15)
        else:
            _set(bsdf, ("Specular IOR Level", "Specular"), 0.4)


def bevel(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        if obj.type != "MESH" or obj.get("kind") not in BEVEL_KINDS:
            continue
        mod = obj.modifiers.new("Bisel 3 mm", "BEVEL")
        mod.width = 0.003
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.use_clamp_overlap = True
        mod.harden_normals = False


# --------------------------------------------------------------------------- luz y mundo


def sky_and_sun(project: dict) -> None:
    sun = project["sun"]
    d = Vector(sun["direction"]).normalized()
    world = bpy.data.worlds.get("Cielo") or bpy.data.worlds.new("Cielo")
    bpy.context.scene.world = world
    _nodes_on(world)
    nodes = world.node_tree.nodes
    nodes.clear()
    sky = nodes.new("ShaderNodeTexSky")
    # cielo físico: "NISHITA" en Blender 4.x, "MULTIPLE_SCATTERING" en 5.x
    for kind in ("NISHITA", "MULTIPLE_SCATTERING", "HOSEK_WILKIE"):
        try:
            sky.sky_type = kind
            break
        except TypeError:
            continue
    _attr(sky, "sun_disc", False)  # el disco lo pone la lámpara de sol
    _attr(sky, "sun_elevation", math.asin(max(min(d.z, 1.0), -1.0)))
    _attr(sky, "sun_rotation", math.atan2(d.x, d.y))
    _attr(sky, "air_density", 1.0)
    _attr(sky, "dust_density", 1.5)
    if sky.sky_type == "HOSEK_WILKIE":
        sky.sun_direction = d
    bg = nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.35
    out = nodes.new("ShaderNodeOutputWorld")
    world.node_tree.links.new(sky.outputs["Color"], bg.inputs["Color"])
    world.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])

    light = bpy.data.lights.new("Sol", "SUN")
    light.energy = 4.0
    light.angle = math.radians(0.6)
    light.color = (1.0, 0.96, 0.9)
    obj = bpy.data.objects.new("Sol", light)
    collection("Iluminación").objects.link(obj)
    # la lámpara alumbra hacia su −Z: su +Z apunta al sol
    obj.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def room_lights(project: dict) -> None:
    for lamp in project.get("lamps", []):
        light = bpy.data.lights.new(f"Luz {lamp['room']}", "POINT")
        light.energy = 60.0
        light.shadow_soft_size = 0.15
        light.color = (1.0, 0.88, 0.72)  # ~3500 K
        obj = bpy.data.objects.new(light.name, light)
        obj.location = Vector(lamp["location"])
        floor = collection(lamp["collection"], collection("Casa"))
        collection(f"{lamp['collection']} · Luces", floor).objects.link(obj)


def terrain(project: dict) -> None:
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.02))
    ground = bpy.context.active_object
    ground.name = "Terreno"
    for coll in list(ground.users_collection):
        coll.objects.unlink(ground)
    collection("Entorno").objects.link(ground)
    mat = bpy.data.materials.new("Pasto")
    _nodes_on(mat)
    nodes = mat.node_tree.nodes
    bsdf = _bsdf(mat)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 40.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = _hex("#4d6b32")
    ramp.color_ramp.elements[1].color = _hex("#7d9a55")
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    links = mat.node_tree.links
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    _set(bsdf, ("Roughness",), 0.95)
    ground.data.materials.append(mat)


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
        target = Vector(spec["target"])
        obj.location = loc
        cam.clip_end = 1000
        if spec.get("lens", 0) == 0:
            cam.type = "ORTHO"
            cam.ortho_scale = spec.get("ortho_scale", 20)
            obj.rotation_euler = (0.0, 0.0, 0.0)
        else:
            cam.lens = spec["lens"]
            cam.sensor_width = 36
            if spec.get("level"):
                # cámara horizontal: el centro de la fachada se sube con shift, sin fugas verticales
                flat = Vector((target.x - loc.x, target.y - loc.y, 0.0))
                obj.rotation_euler = flat.to_track_quat("-Z", "Y").to_euler()
                height = project.get("height") or 3
                dist = max(flat.length, 1.0)
                cam.shift_y = min(0.45, ((height / 2 - loc.z) / dist) * cam.lens / cam.sensor_width)
            else:
                obj.rotation_euler = (target - loc).to_track_quat("-Z", "Y").to_euler()
        if "floor" in spec:
            obj["floor"] = spec["floor"]
        out.append(obj)
    if out:
        scene.camera = out[0]
    return out


# --------------------------------------------------------------------------- render


def render_settings() -> None:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    view = scene.view_settings
    try:
        view.view_transform = "AgX"
    except TypeError:
        view.view_transform = "Filmic"
    try:
        view.look = "AgX - Base Contrast"
    except TypeError:
        pass
    scene.unit_settings.system = "METRIC"


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


def render_all(folder: str) -> list[str]:
    scene = bpy.context.scene
    out_dir = os.path.join(folder, "renders")
    os.makedirs(out_dir, exist_ok=True)
    done = []
    for obj in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        scene.camera = obj
        show_floors(obj.get("floor"))
        safe = "".join(ch if ch.isalnum() else "_" for ch in obj.name)
        scene.render.filepath = os.path.join(out_dir, f"{safe}.png")
        bpy.ops.render.render(write_still=True)
        done.append(scene.render.filepath)
    show_floors(None)
    return done


# --------------------------------------------------------------------------- panel


def _camera_items(_self: object, _context: object) -> list[tuple[str, str, str]]:
    return [(o.name, o.name, "") for o in bpy.data.objects if o.type == "CAMERA"]


def _on_camera(self: bpy.types.PropertyGroup, context: bpy.types.Context) -> None:
    obj = bpy.data.objects.get(self.camera)
    if obj:
        context.scene.camera = obj
        show_floors(obj.get("floor"))


def _on_furniture(self: bpy.types.PropertyGroup, _context: bpy.types.Context) -> None:
    set_furniture(self.furniture)


class PLANO3D_Props(bpy.types.PropertyGroup):
    camera: bpy.props.EnumProperty(name="Cámara", items=_camera_items, update=_on_camera)
    furniture: bpy.props.BoolProperty(name="Muebles", default=True, update=_on_furniture)
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
    cameras(project)
    render_settings()
    register()
    bpy.context.scene.plano3d.folder = folder
    blend = os.path.join(folder, "casa.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print(f"Plano 3D: escena lista en {blend} ({len(meshes)} mallas, {len(project['cameras'])} cámaras)")
    if "--render" in _script_args():
        for path in render_all(folder):
            print("render:", path)


if __name__ == "__main__":
    main()
