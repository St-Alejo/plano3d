using System.Text.Json.Nodes;
using Plano3D.Core.Ops;

namespace Plano3D.Core.Editing;

/// <summary>Una edición propia: cómo rehacerla y cómo deshacerla, en ops por entidad.</summary>
public sealed record HistoryEntry(string Label, JsonArray Forward, JsonArray Inverse);

/// <summary>
/// Deshacer y rehacer que no pisa a las demás personas: cada paso guarda sus ops y las
/// inversas (también por entidad), y deshacer aplica las inversas sobre el modelo de ese
/// momento, no sobre una foto vieja. Si otra persona cambió otro muro mientras tanto, su
/// cambio se queda; si borró lo mismo que se deshace, esa op simplemente se salta.
/// </summary>
public sealed class EditHistory(int limit = 200)
{
    private readonly LinkedList<HistoryEntry> _undo = new();
    private readonly Stack<HistoryEntry> _redo = new();

    public bool CanUndo => _undo.Count > 0;
    public bool CanRedo => _redo.Count > 0;
    public string? UndoLabel => _undo.Last?.Value.Label;
    public string? RedoLabel => _redo.Count > 0 ? _redo.Peek().Label : null;
    public int Count => _undo.Count;

    /// <summary>Anota una edición (si no cambió nada, no se anota). Borra lo que se podía rehacer.</summary>
    public void Record(string label, JsonObject before, JsonObject after)
    {
        var forward = ModelOps.Diff(before, after);
        if (forward.Count == 0) return;
        var inverse = ModelOps.Diff(after, before);
        _undo.AddLast(new HistoryEntry(label, ToArray(forward), ToArray(inverse)));
        while (_undo.Count > limit) _undo.RemoveFirst();
        _redo.Clear();
    }

    public (JsonObject Model, string Label)? Undo(JsonObject current)
    {
        if (_undo.Last is not { } node) return null;
        _undo.RemoveLast();
        _redo.Push(node.Value);
        return (ApplyLenient(current, node.Value.Inverse), node.Value.Label);
    }

    public (JsonObject Model, string Label)? Redo(JsonObject current)
    {
        if (_redo.Count == 0) return null;
        var entry = _redo.Pop();
        _undo.AddLast(entry);
        return (ApplyLenient(current, entry.Forward), entry.Label);
    }

    public void Clear()
    {
        _undo.Clear();
        _redo.Clear();
    }

    private static JsonArray ToArray(List<JsonObject> ops) => new(ops.Select(o => (JsonNode)o).ToArray());

    /// <summary>Aplica lo que se pueda: una op que ya no aplica (piso borrado por otra persona) se salta.</summary>
    public static JsonObject ApplyLenient(JsonObject model, JsonArray ops)
    {
        try
        {
            return ModelOps.Apply(model, ops.Select(o => o?.DeepClone()));
        }
        catch (InvalidOpException)
        {
            var m = model;
            foreach (var op in ops)
            {
                try
                {
                    m = ModelOps.Apply(m, [op?.DeepClone()]);
                }
                catch (InvalidOpException)
                {
                }
            }
            return m;
        }
    }
}
