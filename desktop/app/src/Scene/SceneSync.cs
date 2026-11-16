using System.Text.Json.Nodes;
using Godot;
using Plano3D.Core.Geometry;
using Plano3D.Core.Json;
using Plano3D.Core.Model;

namespace Plano3D.App.Scene;

/// <summary>Una entidad del modelo ya dibujada.</summary>
public sealed record Drawn(string Key, string Id, string Kind, string LevelId, string Hash, Node3D Node);

/// <summary>
/// Traduce el modelo (JSON) a nodos 3D, uno por entidad y agrupados por piso (patrones
/// Builder y Observer). Al cambiar el modelo solo rehace las entidades cuyo JSON cambió:
/// una edición que llega de la web toca uno o dos nodos, no la casa entera.
/// </summary>
public partial class SceneSync : Node3D
{
    private readonly Dictionary<string, Drawn> _drawn = [];
    private readonly Dictionary<string, Node3D> _levels = [];

    public BuildingModel? Model { get; private set; }
    public IReadOnlyCollection<Drawn> Entities => _drawn.Values;

    /// <summary>Cuántas entidades se rehicieron en la última sincronización (para medir).</summary>
    public int LastRebuilt { get; private set; }

    public IEnumerable<Drawn> Find(string id) => _drawn.Values.Where(d => d.Id == id);

    public Node3D? LevelNode(string levelId) => _levels.GetValueOrDefault(levelId);

    public void Apply(JsonObject json)
    {
        var model = BuildingModel.From(json);
        Model = model;
        var seen = new HashSet<string>();
        var rebuilt = 0;
        var jsonLevels = json.Items("levels").OfType<JsonObject>().ToList();

        for (var li = 0; li < model.Levels.Count && li < jsonLevels.Count; li++)
        {
            var level = model.Levels[li];
            var jl = jsonLevels[li];
            var root = LevelRoot(level);
            var elev = level.Elevation;
            var storey = BuildingGeometry.StoreyHeight(model, level);
            var levelSalt = $"|{elev:0.###}|{storey:0.###}";

            void Upsert(string kind, string id, JsonNode? source, Func<Node3D> build)
            {
                var key = $"{level.Id}/{kind}/{id}";
                seen.Add(key);
                var hash = (source?.ToJsonString() ?? "") + levelSalt;
                if (_drawn.TryGetValue(key, out var old))
                {
                    if (old.Hash == hash) return;
                    old.Node.QueueFree();
                }
                var node = build();
                node.Name = $"{kind}_{id}".Replace("/", "_").Replace(":", "_");
                root.AddChild(node);
                _drawn[key] = new Drawn(key, id, kind, level.Id, hash, node);
                rebuilt++;
            }

            var jWalls = jl.Items("walls");
            for (var i = 0; i < level.Walls.Count; i++)
            {
                var wall = level.Walls[i];
                Upsert("wall", wall.Id, jWalls[i], () => BuildWall(wall, elev));
            }
            var jRooms = jl.Items("rooms");
            for (var i = 0; i < level.Rooms.Count; i++)
            {
                var room = level.Rooms[i];
                Upsert("room", room.Id, jRooms[i], () => BuildRoom(room, elev, storey));
            }
            var jCols = jl.Items("columns");
            for (var i = 0; i < level.Columns.Count; i++)
            {
                var c = level.Columns[i];
                Upsert("column", c.Id, jCols[i], () => Wrap(MeshFactory.Box(BuildingGeometry.ColumnBox(c, elev, storey), Materials.Column, c.Id)));
            }
            var jStairs = jl.Items("stairs");
            for (var i = 0; i < level.Stairs.Count; i++)
            {
                var s = level.Stairs[i];
                Upsert("stair", s.Id, jStairs[i], () => BuildStair(s, elev));
            }
            var jFurn = jl.Items("furniture");
            for (var i = 0; i < level.Furniture.Count; i++)
            {
                var f = level.Furniture[i];
                Upsert("furniture", f.Id, jFurn[i], () => Wrap(MeshFactory.Box(BuildingGeometry.FurnitureBox(f, elev), Materials.Furniture(f.CatalogId), f.Id)));
            }
        }

        foreach (var key in _drawn.Keys.Where(k => !seen.Contains(k)).ToList())
        {
            _drawn[key].Node.QueueFree();
            _drawn.Remove(key);
        }
        foreach (var id in _levels.Keys.Where(id => model.FindLevel(id) is null).ToList())
        {
            _levels[id].QueueFree();
            _levels.Remove(id);
        }
        LastRebuilt = rebuilt;
    }

    private Node3D LevelRoot(Level level)
    {
        if (!_levels.TryGetValue(level.Id, out var root))
        {
            root = new Node3D { Name = $"Piso_{level.Id}" };
            root.SetMeta("level", level.Id);
            AddChild(root);
            _levels[level.Id] = root;
        }
        return root;
    }

    /// <summary>Muestra solo los pisos que cumplen la condición (los ocultos tampoco se eligen).</summary>
    public void ShowLevels(Func<Level, bool> visible)
    {
        if (Model is null) return;
        foreach (var level in Model.Levels)
        {
            if (!_levels.TryGetValue(level.Id, out var root)) continue;
            var on = visible(level);
            root.Visible = on;
            root.ProcessMode = on ? ProcessModeEnum.Inherit : ProcessModeEnum.Disabled;
        }
    }

    private static Node3D Wrap(Node3D child)
    {
        var n = new Node3D();
        n.AddChild(child);
        return n;
    }

    private static Node3D BuildWall(Wall wall, double elev)
    {
        var n = new Node3D();
        var mat = Materials.Wall(wall.Material);
        foreach (var box in BuildingGeometry.WallPieces(wall, elev)) n.AddChild(MeshFactory.Box(box, mat, wall.Id));
        foreach (var o in wall.OpeningsOrEmpty)
        {
            var infill = BuildingGeometry.OpeningInfill(wall, o, elev);
            var glass = MeshFactory.Box(infill, o.IsDoor ? Materials.Door : Materials.Glass, o.Id);
            if (!o.IsDoor) glass.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off; // el vidrio deja pasar el sol
            n.AddChild(glass);
            foreach (var trim in BuildingGeometry.OpeningTrim(wall, o, elev))
            {
                var m = trim.Part switch { "door_frame" => Materials.DoorFrame, "sill_stone" => Materials.Sill, _ => Materials.WindowFrame };
                n.AddChild(MeshFactory.Box(trim, m, o.Id));
            }
        }
        return n;
    }

    /// <summary>Si las lámparas de los ambientes están encendidas (de noche); las nuevas nacen igual.</summary>
    public static bool LampsOn { get; private set; }

    public void SetLamps(bool on)
    {
        LampsOn = on;
        foreach (var lamp in GetTree().GetNodesInGroup(LampGroup).OfType<Node3D>()) lamp.Visible = on;
    }

    private const string LampGroup = "lamparas";

    /// <summary>Capa visual del terreno exterior (las lámparas de adentro no la alumbran).</summary>
    public const uint OutdoorLayer = 1u << 1;

    private static Node3D BuildRoom(Room room, double elev, double storey)
    {
        var n = new Node3D();
        if (room.Polygon.Count < 3) return n;
        if (MeshFactory.Floor(room.Polygon, (float)elev + 0.01f, Materials.Floor(room.FloorMaterial, room.Label + " " + room.RoomType), room.Id) is { } floor)
            n.AddChild(floor);
        if (elev > 0.05 && MeshFactory.Slab(room.Polygon, (float)elev, (float)BuildingGeometry.SlabThickness, Materials.Slab) is { } slab)
            n.AddChild(slab);
        // lámpara de techo: luz cálida (2 700 K) que se prende de noche
        var area = Math.Abs(BuildingGeometry.SignedArea(room.Polygon));
        if (area >= 1.5)
        {
            var c = Plano3D.Core.Editing.Shapes.Centroid(room.Polygon);
            var lamp = new Node3D { Position = new Vector3((float)c.X, (float)(elev + storey - BuildingGeometry.SlabThickness - 0.06), (float)c.Y), Visible = LampsOn };
            lamp.AddToGroup(LampGroup);
            lamp.AddChild(new MeshInstance3D
            {
                Mesh = new CylinderMesh { TopRadius = 0.16f, BottomRadius = 0.2f, Height = 0.05f },
                MaterialOverride = Materials.Bulb,
                CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            });
            lamp.AddChild(new OmniLight3D
            {
                Position = new Vector3(0, -0.15f, 0),
                LightColor = Kelvin(2700),
                LightEnergy = (float)Math.Clamp(0.6 + area / 25, 0.7, 2.2),
                OmniRange = (float)Math.Clamp(Math.Sqrt(area) * 1.6, 3, 9),
                OmniAttenuation = 1.2f,
                ShadowEnabled = false,
                // sin sombras la luz atravesaría los muros: que no alumbre el terreno de afuera
                LightCullMask = ~OutdoorLayer,
            });
            n.AddChild(lamp);
        }
        return n;
    }

    private static Node3D BuildStair(Stair s, double elev)
    {
        var n = new Node3D();
        foreach (var step in BuildingGeometry.StairSteps(s, elev)) n.AddChild(MeshFactory.Box(step, Materials.Stair, s.Id));
        foreach (var part in BuildingGeometry.StairRailing(s, elev)) n.AddChild(MeshFactory.Box(part, Materials.Railing, s.Id, pickable: false));
        return n;
    }

    /// <summary>Color de una luz a cierta temperatura (aproximación de Tanner Helland).</summary>
    public static Color Kelvin(double k)
    {
        var t = k / 100;
        double r = t <= 66 ? 255 : 329.698727446 * Math.Pow(t - 60, -0.1332047592);
        double g = t <= 66 ? 99.4708025861 * Math.Log(t) - 161.1195681661 : 288.1221695283 * Math.Pow(t - 60, -0.0755148492);
        double b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.Log(t - 10) - 305.0447927307;
        return new Color((float)Math.Clamp(r, 0, 255) / 255, (float)Math.Clamp(g, 0, 255) / 255, (float)Math.Clamp(b, 0, 255) / 255);
    }
}
