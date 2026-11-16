using System.Text.Json.Nodes;
using Plano3D.Core.Model;
using Plano3D.Infrastructure.Collab;

namespace Plano3D.App.Plan;

/// <summary>
/// Lo que las herramientas necesitan del editor (patrón Mediator): leer el modelo y el piso
/// activo, elegir, y confirmar una edición (que se anota para deshacer y se manda a la sala).
/// </summary>
public interface IEditorHost
{
    JsonObject? Model { get; }
    BuildingModel? Building { get; }
    string? LevelId { get; }
    IReadOnlyList<string> Selection { get; }
    IReadOnlyList<Peer> Peers { get; }
    bool GridSnap { get; }
    string CatalogId { get; }
    string WallFinish { get; }
    string FloorFinish { get; }

    void Select(IEnumerable<string> ids);
    /// <summary>Confirma una edición propia: deshacer, envío a la sala y redibujo.</summary>
    void Commit(JsonObject next, string label, IEnumerable<string>? select = null);
    /// <summary>Muestra un borrador (arrastre en curso) sin confirmarlo; null vuelve al modelo.</summary>
    void ShowDraft(JsonObject? draft);
    /// <summary>Le muestra a las demás personas lo que se arrastra (no se guarda).</summary>
    void Preview(string kind, string id, JsonObject? value);
    void Toast(string message);
}
