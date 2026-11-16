using Godot;

namespace Plano3D.App.Scene;

/// <summary>
/// Recorrido en primera persona: una persona de 1,70 m (cápsula) que camina con WASD, mira con
/// el ratón, corre con Shift, sube escaleras por su rampa y abre las puertas al acercarse.
/// </summary>
public partial class Walker : CharacterBody3D
{
    private const float Eye = 1.6f;
    private const float WalkSpeed = 1.5f;
    private const float RunSpeed = 3.2f;
    private const float Gravity = 9.8f;

    private readonly Camera3D _cam;
    private float _yaw;
    private float _pitch;
    private float _bob;

    /// <summary>El piso donde está (para el minimapa y los pisos visibles).</summary>
    public float FeetY => GlobalPosition.Y;
    public float Yaw => _yaw;
    public Camera3D Camera => _cam;

    /// <summary>Se mueve la vista (para que el editor la sincronice con la presencia o el minimapa).</summary>
    public bool Enabled { get; set; } = true;

    public Walker()
    {
        Name = "Recorrido";
        CollisionLayer = 0;
        CollisionMask = MeshFactory.SolidLayer | MeshFactory.WalkLayer;
        FloorMaxAngle = Mathf.DegToRad(46);
        FloorSnapLength = 0.35f;
        SafeMargin = 0.02f;
        AddChild(new CollisionShape3D
        {
            Shape = new CapsuleShape3D { Radius = 0.22f, Height = 1.7f },
            Position = new Vector3(0, 0.85f, 0),
        });
        _cam = new Camera3D { Position = new Vector3(0, Eye, 0), Fov = 70, Near = 0.05f, Far = 400 };
        AddChild(_cam);
    }

    public void Place(Vector3 feet, float yaw)
    {
        GlobalPosition = feet;
        _yaw = yaw;
        _pitch = 0;
        Velocity = Vector3.Zero;
        Apply();
    }

    public override void _UnhandledInput(InputEvent e)
    {
        if (!Enabled) return;
        if (e is InputEventMouseMotion m && Input.MouseMode == Input.MouseModeEnum.Captured)
        {
            _yaw -= m.Relative.X * 0.0025f;
            _pitch = Mathf.Clamp(_pitch - m.Relative.Y * 0.0025f, -1.35f, 1.35f);
            Apply();
            GetViewport().SetInputAsHandled();
        }
        else if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } && Input.MouseMode != Input.MouseModeEnum.Captured)
        {
            Input.MouseMode = Input.MouseModeEnum.Captured;
            GetViewport().SetInputAsHandled();
        }
        else if (e is InputEventKey { Pressed: true, Keycode: Key.E, Echo: false })
        {
            ToggleNearestDoor();
            GetViewport().SetInputAsHandled();
        }
    }

    private void Apply()
    {
        Rotation = new Vector3(0, _yaw, 0);
        _cam.Rotation = new Vector3(_pitch, 0, 0);
    }

    /// <summary>Mueve con un vector de entrada (x = derecha, y = adelante); lo usan el teclado y la prueba de humo.</summary>
    public Vector2 Push { get; set; }

    public override void _PhysicsProcess(double delta)
    {
        var dt = (float)delta;
        var input = Push;
        if (Enabled)
        {
            if (Input.IsKeyPressed(Key.W) || Input.IsKeyPressed(Key.Up)) input.Y += 1;
            if (Input.IsKeyPressed(Key.S) || Input.IsKeyPressed(Key.Down)) input.Y -= 1;
            if (Input.IsKeyPressed(Key.D) || Input.IsKeyPressed(Key.Right)) input.X += 1;
            if (Input.IsKeyPressed(Key.A) || Input.IsKeyPressed(Key.Left)) input.X -= 1;
        }
        if (input.LengthSquared() > 1) input = input.Normalized();
        var speed = Input.IsKeyPressed(Key.Shift) ? RunSpeed : WalkSpeed;
        var forward = new Vector3(-Mathf.Sin(_yaw), 0, -Mathf.Cos(_yaw));
        var right = new Vector3(Mathf.Cos(_yaw), 0, -Mathf.Sin(_yaw));
        var want = (forward * input.Y + right * input.X) * speed;
        var v = Velocity;
        var accel = IsOnFloor() ? 12f : 3f;
        v.X = Mathf.MoveToward(v.X, want.X, accel * speed * dt);
        v.Z = Mathf.MoveToward(v.Z, want.Z, accel * speed * dt);
        v.Y = IsOnFloor() ? -0.5f : v.Y - Gravity * dt;
        Velocity = v;
        MoveAndSlide();
        if (GlobalPosition.Y < -20) GlobalPosition = new Vector3(GlobalPosition.X, 2, GlobalPosition.Z); // por si cae fuera

        // balanceo leve al caminar
        var moving = new Vector2(v.X, v.Z).Length();
        _bob += moving * dt * 2.2f;
        _cam.Position = new Vector3(0, Eye + Mathf.Sin(_bob * Mathf.Pi) * 0.025f * Mathf.Min(moving, 1.5f), 0);

        OpenDoorsNearby();
    }

    private void OpenDoorsNearby()
    {
        var me = GlobalPosition;
        foreach (var d in GetTree().GetNodesInGroup(DoorLeaf.Group).OfType<DoorLeaf>())
        {
            var center = DoorCenter(d);
            var near = Mathf.Abs(center.Y - me.Y) < 1.2f && new Vector2(center.X - me.X, center.Z - me.Z).Length() < 1.6f;
            if (near) d.Want();
        }
    }

    private static Vector3 DoorCenter(DoorLeaf d) =>
        d.Lifts ? d.GlobalPosition : d.GlobalPosition + d.GlobalBasis.X * (d.Width / 2);

    private void ToggleNearestDoor()
    {
        var me = GlobalPosition;
        var door = GetTree().GetNodesInGroup(DoorLeaf.Group).OfType<DoorLeaf>()
            .Where(d => Mathf.Abs(DoorCenter(d).Y - me.Y) < 1.2f)
            .MinBy(d => DoorCenter(d).DistanceTo(me));
        if (door is null || DoorCenter(door).DistanceTo(me) > 3) return;
        door.Held = !(door.Held ?? door.IsOpen);
    }
}
