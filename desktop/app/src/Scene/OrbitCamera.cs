using Godot;

namespace Plano3D.App.Scene;

/// <summary>
/// Cámara que orbita la casa: arrastrar con el botón izquierdo gira, con el derecho o la
/// rueda presionada desplaza, la rueda acerca. Un clic sin arrastre es «elegir».
/// </summary>
public partial class OrbitCamera : Camera3D
{
    private const float DragThreshold = 5;

    private Vector3 _target;
    private float _distance = 20;
    private float _yaw = -0.75f;
    private float _pitch = 0.62f;
    // valores hacia los que se suaviza
    private Vector3 _goalTarget;
    private float _goalDistance = 20;
    private float _goalYaw = -0.75f;
    private float _goalPitch = 0.62f;

    private Vector2? _pressAt;
    private MouseButton _button;
    private bool _dragging;

    private bool _grabbing;

    /// <summary>Clic sin arrastre sobre la vista 3D (posición en pantalla).</summary>
    public event Action<Vector2>? Clicked;

    /// <summary>
    /// Al presionar el botón izquierdo: si devuelve true, el arrastre es de quien lo pidió (mover
    /// un mueble) y la cámara no gira. Luego llegan <see cref="Grabbed"/> y <see cref="Released"/>.
    /// </summary>
    public Func<Vector2, bool>? TryGrab;
    public event Action<Vector2>? Grabbed;
    public event Action<Vector2>? Released;

    /// <summary>Encuadre guardable (marcadores de cámara).</summary>
    public readonly record struct View(Vector3 Target, float Distance, float Yaw, float Pitch);

    public View Bookmark => new(_goalTarget, _goalDistance, _goalYaw, _goalPitch);

    /// <summary>Distancia actual al punto que se mira (foco del modo foto).</summary>
    public float OrbitDistance => _distance;

    public void GoTo(View v)
    {
        _goalTarget = v.Target;
        _goalDistance = v.Distance;
        _goalYaw = v.Yaw;
        _goalPitch = v.Pitch;
    }

    public override void _Ready()
    {
        Fov = 50;
        Near = 0.05f;
        Far = 500;
        Apply();
    }

    public void Frame(Vector3 center, float radius, bool instant = false)
    {
        _goalTarget = center;
        // distancia a la que una esfera de ese radio llena el campo de visión, con un poco de aire
        _goalDistance = Math.Clamp(radius / MathF.Sin(Mathf.DegToRad(Fov) / 2) * 1.08f, 4, 200);
        if (instant)
        {
            _target = _goalTarget;
            _distance = _goalDistance;
            Apply();
        }
    }

    public override void _UnhandledInput(InputEvent e)
    {
        switch (e)
        {
            case InputEventMouseButton { ButtonIndex: MouseButton.WheelUp, Pressed: true }:
                _goalDistance = Math.Max(1.5f, _goalDistance * 0.88f);
                break;
            case InputEventMouseButton { ButtonIndex: MouseButton.WheelDown, Pressed: true }:
                _goalDistance = Math.Min(250, _goalDistance * 1.14f);
                break;
            case InputEventMouseButton mb when mb.ButtonIndex is MouseButton.Left or MouseButton.Right or MouseButton.Middle:
                if (mb.Pressed)
                {
                    _pressAt = mb.Position;
                    _button = mb.ButtonIndex;
                    _dragging = false;
                    _grabbing = mb.ButtonIndex == MouseButton.Left && TryGrab?.Invoke(mb.Position) == true;
                }
                else if (_pressAt is not null && mb.ButtonIndex == _button)
                {
                    if (_grabbing) Released?.Invoke(mb.Position);
                    else if (!_dragging && _button == MouseButton.Left) Clicked?.Invoke(mb.Position);
                    _pressAt = null;
                    _grabbing = false;
                }
                break;
            case InputEventMouseMotion mm when _pressAt is { } start:
                if (!_dragging && (mm.Position - start).Length() < DragThreshold) return;
                _dragging = true;
                if (_grabbing)
                {
                    Grabbed?.Invoke(mm.Position);
                    return;
                }
                if (_button == MouseButton.Left)
                {
                    _goalYaw -= mm.Relative.X * 0.008f;
                    _goalPitch = Math.Clamp(_goalPitch + mm.Relative.Y * 0.006f, 0.05f, 1.5f);
                }
                else
                {
                    var right = GlobalBasis.X with { Y = 0 };
                    var forward = (-GlobalBasis.Z) with { Y = 0 };
                    var k = _distance * 0.0016f;
                    _goalTarget += (-right.Normalized() * mm.Relative.X + forward.Normalized() * mm.Relative.Y) * k;
                }
                break;
        }
    }

    public override void _Process(double delta)
    {
        var t = 1 - MathF.Exp(-14 * (float)delta);
        _target = _target.Lerp(_goalTarget, t);
        _distance = Mathf.Lerp(_distance, _goalDistance, t);
        _yaw = Mathf.Lerp(_yaw, _goalYaw, t);
        _pitch = Mathf.Lerp(_pitch, _goalPitch, t);
        Apply();
    }

    private void Apply()
    {
        var dir = new Vector3(MathF.Cos(_pitch) * MathF.Sin(_yaw), MathF.Sin(_pitch), MathF.Cos(_pitch) * MathF.Cos(_yaw));
        Position = _target + dir * _distance;
        if (Position.DistanceSquaredTo(_target) > 1e-6) LookAt(_target, Vector3.Up);
    }
}
