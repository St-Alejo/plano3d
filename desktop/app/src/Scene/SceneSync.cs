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
                Upsert("room", room.Id, jRooms[i], () => BuildRoom(room, elev));
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
            n.AddChild(MeshFactory.Box(infill, o.IsDoor ? Materials.Door : Materials.Glass, o.Id));
        }
        return n;
    }

    private static Node3D BuildRoom(Room room, double elev)
    {
        var n = new Node3D();
        if (room.Polygon.Count >= 3 && MeshFactory.Floor(room.Polygon, (float)elev + 0.01f, Materials.Floor(room.FloorMaterial, room.RoomType), room.Id) is { } floor)
            n.AddChild(floor);
        return n;
    }

    private static Node3D BuildStair(Stair s, double elev)
    {
        var n = new Node3D();
        foreach (var step in BuildingGeometry.StairSteps(s, elev)) n.AddChild(MeshFactory.Box(step, Materials.Stair, s.Id));
        return n;
    }
}
