using System.Text.Json.Nodes;

namespace Plano3D.Core.Tests;

internal static class Fixture
{
    public static JsonNode Load(string name) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name)))!;

    /// <summary>El modelo de la casa de 3 pisos de la demo.</summary>
    public static JsonObject House() => (JsonObject)Load("casa3.json")["model"]!;
}
