using Godot;
using Plano3D.Core.Editing;
using Plano3D.Core.Geometry;
using Plano3D.Core.Model;
using Plano3D.Core.Simulation;

namespace Plano3D.App.Scene;

/// <summary>
/// Simulación de uso: personas que van de un ambiente a otro de su piso por caminos A*
/// (<see cref="WalkGrid"/>), se detienen un rato y siguen; abren las puertas al pasar.
/// Sirve para juzgar circulaciones: si alguien no llega a un cuarto, falta una puerta.
/// </summary>
public partial class People : Node3D
{
    private readonly List<Person> _people = [];
    private readonly Random _rng = new(7);

    public int Count => _people.Count;
    /// <summary>Ambientes a los que no se llega desde ningún otro (los reporta el editor).</summary>
    public List<string> Unreachable { get; } = [];

    public void Rebuild(BuildingModel model, Func<Level, bool> visible)
    {
        foreach (var p in _people) p.QueueFree();
        _people.Clear();
        Unreachable.Clear();
        var palette = new[] { "c0563a", "3e6e8e", "6b8f4e", "8d6aa8", "c99a3b", "4f7f7a", "a8475f" };
        var n = 0;
        foreach (var level in model.Levels.Where(visible))
        {
            var rooms = level.Rooms.Where(r => r.Polygon.Count >= 3 && Math.Abs(BuildingGeometry.SignedArea(r.Polygon)) > 2.5).ToList();
            if (rooms.Count < 2) continue;
            var grid = WalkGrid.Build(level);
            var targets = rooms.Select(r => (Room: r, Point: grid.NearestFree(Shapes.Centroid(r.Polygon)))).Where(t => t.Point is not null).ToList();
            // ambientes sin camino desde el más grande
            var hub = targets.MaxBy(t => Math.Abs(BuildingGeometry.SignedArea(t.Room.Polygon)));
            foreach (var t in targets.Where(t => t != hub && grid.Path(hub.Point!.Value, t.Point!.Value) is null))
                Unreachable.Add($"{t.Room.Label} ({level.Name})");
            var count = Math.Clamp(rooms.Count / 2, 1, 5);
            for (var i = 0; i < count; i++)
            {
                var start = targets[_rng.Next(targets.Count)].Point!.Value;
                var person = new Person(grid, targets.Select(t => t.Point!.Value).ToList(), (float)level.Elevation, new Color(palette[n++ % palette.Length]), _rng.Next());
                AddChild(person);
                person.Spawn(start);
                _people.Add(person);
            }
        }
    }

    public void Clear()
    {
        foreach (var p in _people) p.QueueFree();
        _people.Clear();
    }
}

/// <summary>Una persona: cuerpo, cabeza, brazos y piernas que se balancean al caminar.</summary>
public partial class Person : Node3D
{
    private readonly WalkGrid _grid;
    private readonly List<Point2> _targets;
    private readonly float _floorY;
    private readonly Random _rng;
    private readonly float _speed;
    private List<Point2> _path = [];
    private int _next;
    private double _wait;
    private float _phase;
    private readonly Node3D _legL, _legR, _armL, _armR;

    public Person(WalkGrid grid, List<Point2> targets, float floorY, Color shirt, int seed)
    {
        _grid = grid;
        _targets = targets;
        _floorY = floorY;
        _rng = new Random(seed);
        _speed = 1.0f + (float)_rng.NextDouble() * 0.4f;
        var skin = new StandardMaterial3D { AlbedoColor = new Color(new[] { "e0b896", "c68e64", "8d5a3b", "f1cfb0" }[_rng.Next(4)]), Roughness = 0.7f };
        var cloth = new StandardMaterial3D { AlbedoColor = shirt, Roughness = 0.85f };
        var pants = new StandardMaterial3D { AlbedoColor = new Color(new[] { "2f3a4a", "3d3a36", "51483d" }[_rng.Next(3)]), Roughness = 0.9f };
        MeshInstance3D Part(Mesh mesh, Material m, Vector3 at) => new() { Mesh = mesh, MaterialOverride = m, Position = at };
        AddChild(Part(new CapsuleMesh { Radius = 0.17f, Height = 0.62f }, cloth, new Vector3(0, 1.18f, 0)));
        AddChild(Part(new SphereMesh { Radius = 0.11f, Height = 0.24f }, skin, new Vector3(0, 1.62f, 0)));
        Node3D Limb(Vector3 hip, float len, float r, Material m)
        {
            var pivot = new Node3D { Position = hip };
            pivot.AddChild(Part(new CapsuleMesh { Radius = r, Height = len }, m, new Vector3(0, -len / 2, 0)));
            AddChild(pivot);
            return pivot;
        }
        _legL = Limb(new Vector3(-0.08f, 0.88f, 0), 0.86f, 0.07f, pants);
        _legR = Limb(new Vector3(0.08f, 0.88f, 0), 0.86f, 0.07f, pants);
        _armL = Limb(new Vector3(-0.22f, 1.42f, 0), 0.62f, 0.05f, cloth);
        _armR = Limb(new Vector3(0.22f, 1.42f, 0), 0.62f, 0.05f, cloth);
    }

    public void Spawn(Point2 at)
    {
        Position = new Vector3((float)at.X, _floorY, (float)at.Y);
        _wait = _rng.NextDouble() * 2;
    }

    public override void _Process(double delta)
    {
        var dt = (float)delta;
        if (_wait > 0)
        {
            _wait -= delta;
            Pose(0, dt);
            if (_wait <= 0) PickTarget();
            return;
        }
        if (_next >= _path.Count)
        {
            _wait = 2 + _rng.NextDouble() * 4;
            return;
        }
        var goal = new Vector3((float)_path[_next].X, _floorY, (float)_path[_next].Y);
        var to = goal - Position;
        var dist = to.Length();
        var step = _speed * dt;
        if (dist <= step)
        {
            Position = goal;
            _next++;
        }
        else
        {
            Position += to / dist * step;
            var yaw = Mathf.Atan2(-to.X, -to.Z);
            Rotation = new Vector3(0, Mathf.LerpAngle(Rotation.Y, yaw + Mathf.Pi, Math.Min(1, dt * 8)), 0);
        }
        Pose(1, dt);
        foreach (var d in GetTree().GetNodesInGroup(DoorLeaf.Group).OfType<DoorLeaf>())
        {
            var c = d.Lifts ? d.GlobalPosition : d.GlobalPosition + d.GlobalBasis.X * (d.Width / 2);
            if (Mathf.Abs(c.Y - _floorY) < 1 && new Vector2(c.X - Position.X, c.Z - Position.Z).Length() < 1.3f) d.Want();
        }
    }

    private void PickTarget()
    {
        var here = new Point2(Position.X, Position.Z);
        for (var tries = 0; tries < 4; tries++)
        {
            var target = _targets[_rng.Next(_targets.Count)];
            if ((target - here).Length < 1) continue;
            if (_grid.Path(here, target) is { Count: > 1 } path)
            {
                _path = path;
                _next = 1;
                return;
            }
        }
        _wait = 3;
    }

    /// <summary>Balanceo de piernas y brazos (amount 0 quieto … 1 caminando).</summary>
    private void Pose(float amount, float dt)
    {
        _phase += dt * _speed * 5.5f * amount;
        var swing = Mathf.Sin(_phase) * 0.5f * amount;
        _legL.Rotation = new Vector3(swing, 0, 0);
        _legR.Rotation = new Vector3(-swing, 0, 0);
        _armL.Rotation = new Vector3(-swing * 0.8f, 0, 0);
        _armR.Rotation = new Vector3(swing * 0.8f, 0, 0);
    }
}
