using System.Text.Json.Nodes;
using Plano3D.Core.Ops;

namespace Plano3D.Core.Collab;

/// <summary>Un lote de cambios propio, enviado y aún sin confirmar.</summary>
public sealed record Batch(string OpId, JsonArray Ops);

/// <summary>
/// El proyecto abierto en la sala de edición en vivo (ADR-021), sin red ni interfaz.
///
/// El servidor ordena todo. Se guarda <see cref="Confirmed"/> (el modelo del servidor en
/// <see cref="Seq"/>) y los lotes propios pendientes; lo que se ve es lo confirmado más lo
/// pendiente. Al llegar un cambio de otra persona se aplica sobre lo confirmado y se vuelven
/// a poner encima los pendientes (rebase). Mismo algoritmo que <c>CollabSession.ts</c> de la web.
/// </summary>
public sealed class LiveDocument
{
    private readonly List<Batch> _pending = [];
    private readonly string _prefix = Guid.NewGuid().ToString("N")[..8];
    private int _counter;

    public JsonObject? Confirmed { get; private set; }
    public long? Seq { get; private set; }
    public int Revision { get; private set; }
    /// <summary>Lo que se muestra: lo confirmado con los pendientes encima.</summary>
    public JsonObject? View { get; private set; }
    public IReadOnlyList<Batch> Pending => _pending;

    /// <summary>Cambió lo que se ve (por un cambio de otra persona, un rechazo o una carga entera).</summary>
    public event Action<JsonObject>? ViewChanged;
    /// <summary>El servidor rechazó un lote propio.</summary>
    public event Action<string>? Rejected;

    /// <summary>Último seq conocido para el saludo al reconectar (null = mandar el modelo entero).</summary>
    public long? LastSeq => Confirmed is null ? null : Seq;

    /// <summary>Saludo del servidor: modelo entero o los lotes perdidos desde la última conexión.</summary>
    /// <returns>Los lotes pendientes que hay que reenviar.</returns>
    public IReadOnlyList<Batch> Welcome(JsonObject? model, IEnumerable<JsonObject>? missed, long seq, int revision)
    {
        if (model is not null)
        {
            Confirmed = model;
        }
        else if (Confirmed is not null)
        {
            foreach (var entry in missed ?? [])
            {
                Confirmed = ModelOps.Apply(Confirmed, (JsonArray)entry["ops"]!);
                var opId = (string?)entry["op_id"];
                _pending.RemoveAll(b => b.OpId == opId);
            }
        }
        Seq = seq;
        Revision = revision;
        Render();
        return _pending.ToList();
    }

    /// <summary>Un lote ordenado por el servidor (propio o de otra persona).</summary>
    /// <returns>true si vino de otra persona (hay que avisar y redibujar).</returns>
    public bool Applied(long seq, string opId, JsonArray ops)
    {
        if (Confirmed is null) return false;
        Confirmed = ModelOps.Apply(Confirmed, ops);
        Seq = seq;
        var mine = _pending.FindIndex(b => b.OpId == opId);
        if (mine >= 0)
        {
            _pending.RemoveAt(mine);
            return false;
        }
        Render();
        return true;
    }

    public void Reject(string opId, string reason)
    {
        _pending.RemoveAll(b => b.OpId == opId);
        Render();
        Rejected?.Invoke(reason);
    }

    /// <summary>Una edición por REST: llega el modelo entero.</summary>
    public void Snapshot(JsonObject model, long seq, int revision)
    {
        Confirmed = model;
        Seq = seq;
        Revision = revision;
        Render();
    }

    public void Saved(int revision) => Revision = revision;

    /// <summary>
    /// Edición local: compara con lo que se veía y arma el lote a enviar (null si no cambió nada).
    /// </summary>
    public Batch? Edit(JsonObject edited)
    {
        if (View is null) return null;
        var ops = ModelOps.Diff(View, edited);
        View = edited;
        if (ops.Count == 0) return null;
        var batch = new Batch($"{_prefix}-{++_counter}", new JsonArray(ops.Select(o => (JsonNode)o).ToArray()));
        _pending.Add(batch);
        return batch;
    }

    /// <summary>Algo no cuadra: se olvida lo confirmado para pedir el modelo entero al reconectar.</summary>
    public void Forget()
    {
        Confirmed = null;
        Seq = null;
    }

    private void Render()
    {
        if (Confirmed is null) return;
        var view = Confirmed;
        var kept = new List<Batch>();
        foreach (var b in _pending)
        {
            try
            {
                view = ModelOps.Apply(view, b.Ops);
                kept.Add(b);
            }
            catch (InvalidOpException)
            {
                // lo pisó un cambio de otra persona (p. ej. borró el piso): se descarta
            }
        }
        _pending.Clear();
        _pending.AddRange(kept);
        View = view;
        ViewChanged?.Invoke(view);
    }
}
