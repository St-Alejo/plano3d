using Godot;

namespace Plano3D.App.Scene;

/// <summary>
/// Hoja de puerta que se abre: gira sobre su bisagra (puertas) o sube (portón de garaje).
/// El recorrido la abre al acercarse; con E queda abierta o cerrada.
/// </summary>
public partial class DoorLeaf : Node3D
{
    public const string Group = "puertas";

    /// <summary>true = portón que sube; false = hoja que gira.</summary>
    public bool Lifts { get; init; }
    public float Width { get; init; }
    public float LeafHeight { get; init; }

    private double _wanted;

    /// <summary>Alguien cerca la quiere abierta (el recorrido o una persona de la simulación); dura un instante.</summary>
    public void Want() => _wanted = 0.5;
    /// <summary>Abierta a mano con E (gana sobre Wanted).</summary>
    public bool? Held { get; set; }

    private float _open; // 0 cerrada … 1 abierta
    private Vector3 _closedPos;
    private Vector3 _closedRot;

    public bool IsOpen => _open > 0.5f;

    public override void _Ready()
    {
        AddToGroup(Group);
        _closedPos = Position;
        _closedRot = Rotation;
    }

    public override void _Process(double delta)
    {
        _wanted -= delta;
        var target = Held ?? (_wanted > 0) ? 1f : 0f;
        if (Mathf.IsEqualApprox(_open, target)) return;
        _open = Mathf.MoveToward(_open, target, (float)delta * (Lifts ? 0.6f : 1.4f));
        var e = _open * _open * (3 - 2 * _open); // suave al empezar y al terminar
        if (Lifts) Position = _closedPos + Vector3.Up * (LeafHeight - 0.15f) * e;
        else Rotation = _closedRot + new Vector3(0, Mathf.DegToRad(-95) * e, 0);
    }
}
