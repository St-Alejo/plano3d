using System.Text.Json;
using System.Text.Json.Nodes;

namespace Plano3D.Core.Json;

/// <summary>
/// Utilidades de JSON con la misma semántica que el contrato de ops (ADR-019):
/// <c>null</c> equivale a "valor por defecto" y el orden de las claves no importa.
/// </summary>
public static class JsonUtil
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString,
    };

    public static JsonNode? Clone(JsonNode? node) => node?.DeepClone();

    /// <summary>Copia sin las claves con null, en profundidad.</summary>
    public static JsonNode? Canonical(JsonNode? node)
    {
        switch (node)
        {
            case null:
                return null;
            case JsonObject obj:
                var outObj = new JsonObject();
                foreach (var (key, value) in obj)
                {
                    if (value is null) continue;
                    outObj[key] = Canonical(value);
                }
                return outObj;
            case JsonArray arr:
                var outArr = new JsonArray();
                foreach (var item in arr) outArr.Add(Canonical(item));
                return outArr;
            default:
                return node.DeepClone();
        }
    }

    /// <summary>Igualdad estructural: números por valor (0 == 0.0), objetos sin importar el orden.</summary>
    public static bool JsonEquals(JsonNode? a, JsonNode? b)
    {
        if (a is null || b is null) return a is null && b is null;
        switch (a)
        {
            case JsonObject oa when b is JsonObject ob:
                if (oa.Count != ob.Count) return false;
                foreach (var (key, value) in oa)
                {
                    if (!ob.TryGetPropertyValue(key, out var other)) return false;
                    if (!JsonEquals(value, other)) return false;
                }
                return true;
            case JsonArray xa when b is JsonArray xb:
                if (xa.Count != xb.Count) return false;
                for (var i = 0; i < xa.Count; i++)
                    if (!JsonEquals(xa[i], xb[i])) return false;
                return true;
            case JsonValue va when b is JsonValue vb:
                return ValueEquals(va, vb);
            default:
                return false;
        }
    }

    private static bool ValueEquals(JsonValue a, JsonValue b)
    {
        var ka = a.GetValueKind();
        var kb = b.GetValueKind();
        if (ka == JsonValueKind.Number && kb == JsonValueKind.Number)
            return AsDouble(a).Equals(AsDouble(b));
        if (ka != kb) return false;
        return ka switch
        {
            JsonValueKind.String => a.GetValue<string>() == b.GetValue<string>(),
            JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null => true,
            _ => a.ToJsonString() == b.ToJsonString(),
        };
    }

    /// <summary>
    /// Número como double, venga de un JSON leído o de un valor creado en código (int, long,
    /// decimal…): <c>GetValue&lt;double&gt;()</c> falla con estos últimos.
    /// </summary>
    public static double AsDouble(JsonValue v) =>
        v.TryGetValue<double>(out var d) ? d : double.Parse(v.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture);

    public static string? Str(this JsonNode? node, string key) =>
        node is JsonObject o && o.TryGetPropertyValue(key, out var v) && v is JsonValue jv && jv.GetValueKind() == JsonValueKind.String
            ? jv.GetValue<string>()
            : null;

    public static JsonArray Items(this JsonObject obj, string key) =>
        obj.TryGetPropertyValue(key, out var v) && v is JsonArray arr ? arr : new JsonArray();
}
