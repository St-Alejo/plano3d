using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Plano3D.Core.Collab;
using Plano3D.Core.Json;
using Plano3D.Infrastructure.Api;

namespace Plano3D.Infrastructure.Collab;

public enum LiveStatus { Off, Connecting, Live, Offline, Closed }

public sealed record Peer(string Id, string Name, string Client, string? Level = null, string? Selection = null);

/// <summary>
/// Sala de edición en vivo del escritorio (ADR-021): WebSocket con ticket, saludo con el
/// último seq, ping cada 25 s, reconexión con espera creciente y el
/// <see cref="LiveDocument"/> que ordena lo confirmado y lo pendiente.
///
/// Los eventos llegan desde un hilo de red: quien dibuja (Godot) debe pasarlos a su hilo
/// principal.
/// </summary>
public sealed class CollabClient : IAsyncDisposable
{
    private static readonly HashSet<int> FinalCodes = [4401, 4403, 4404];

    private readonly ApiClient _api;
    private readonly string _projectId;
    private readonly string _clientKind;
    private readonly Func<ClientWebSocket> _socketFactory;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly Dictionary<string, Peer> _peers = [];
    private CancellationTokenSource? _cts;
    private ClientWebSocket? _socket;
    private Task? _loop;

    public CollabClient(ApiClient api, string projectId, string clientKind = "desktop", Func<ClientWebSocket>? socketFactory = null)
    {
        _api = api;
        _projectId = projectId;
        _clientKind = clientKind;
        _socketFactory = socketFactory ?? (() => new ClientWebSocket());
        Document.Rejected += reason => Error?.Invoke($"El servidor no aceptó un cambio: {reason}");
    }

    public LiveDocument Document { get; } = new();
    public LiveStatus Status { get; private set; } = LiveStatus.Off;
    public Peer? Me { get; private set; }
    /// <summary>Copia de quién está en la sala (se puede leer desde cualquier hilo).</summary>
    public IReadOnlyList<Peer> Peers
    {
        get
        {
            lock (_peers) return _peers.Values.ToList();
        }
    }
    public TimeSpan PingEvery { get; init; } = TimeSpan.FromSeconds(25);

    public event Action<LiveStatus, string?>? StatusChanged;
    public event Action? PeersChanged;
    /// <summary>Cambio de otra persona ya aplicado (nombre y cliente de quien lo hizo).</summary>
    public event Action<Peer?>? RemoteEdit;
    /// <summary>Arrastre en curso de otra persona (null = terminó).</summary>
    public event Action<string, JsonObject?>? Preview;
    public event Action<string>? Error;

    public Uri CollabUri(string? ticket)
    {
        var b = new UriBuilder(_api.BaseUrl) { Scheme = _api.BaseUrl.Scheme == "https" ? "wss" : "ws" };
        b.Path = $"/api/ws/collab/{Uri.EscapeDataString(_projectId)}";
        b.Query = ticket is null ? "" : $"ticket={Uri.EscapeDataString(ticket)}";
        return b.Uri;
    }

    public void Start()
    {
        if (_loop is not null) return;
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cts.Token));
    }

    public async Task StopAsync()
    {
        if (_cts is null) return;
        await _cts.CancelAsync();
        try
        {
            if (_loop is not null) await _loop;
        }
        catch (OperationCanceledException)
        {
        }
        _loop = null;
        SetStatus(LiveStatus.Off, null);
    }

    /// <summary>Edición local: manda el lote si hay cambios (se reenvía solo al reconectar).</summary>
    public async Task EditAsync(JsonObject edited)
    {
        var batch = Document.Edit(edited);
        if (batch is not null) await SendAsync(OpsMessage(batch));
    }

    public Task PresenceAsync(string level, string? selection, string tool = "select") =>
        SendAsync(new JsonObject { ["type"] = "presence", ["state"] = new JsonObject { ["level"] = level, ["selection"] = selection, ["tool"] = tool } });

    public Task PreviewAsync(JsonObject? entity) => SendAsync(new JsonObject { ["type"] = "preview", ["entity"] = entity });

    // ------------------------------------------------------------------ bucle de conexión
    private async Task RunAsync(CancellationToken ct)
    {
        var attempt = 0;
        while (!ct.IsCancellationRequested)
        {
            SetStatus(LiveStatus.Connecting, null);
            int? closeCode = null;
            try
            {
                string? ticket = _api.SignedIn ? await _api.WsTicketAsync(ct) : null;
                using var socket = _socketFactory();
                _socket = socket;
                await socket.ConnectAsync(CollabUri(ticket), ct);
                await SendAsync(new JsonObject { ["type"] = "hello", ["client"] = _clientKind, ["last_seq"] = Document.LastSeq });
                using var pingCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                var ping = PingLoopAsync(pingCts.Token);
                closeCode = await ReceiveLoopAsync(socket, () => attempt = 0, ct);
                await pingCts.CancelAsync();
                await ping;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception e) when (e is WebSocketException or HttpRequestException or ApiException or IOException)
            {
                if (e is ApiException { Status: System.Net.HttpStatusCode.Unauthorized }) closeCode = 4401;
            }
            finally
            {
                _socket = null;
            }
            if (closeCode is { } code && FinalCodes.Contains(code))
            {
                SetStatus(LiveStatus.Closed, code == 4404 ? "El proyecto no está disponible" : "Sin permiso para editar en vivo");
                return;
            }
            if (Status == LiveStatus.Closed) return;
            SetStatus(LiveStatus.Offline, null);
            var delay = Math.Min(15_000, 500 * Math.Pow(2, attempt++)) * (0.75 + Random.Shared.NextDouble() * 0.5);
            try
            {
                await Task.Delay(TimeSpan.FromMilliseconds(delay), ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task PingLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(PingEvery, ct);
                await SendAsync(new JsonObject { ["type"] = "ping" });
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task<int?> ReceiveLoopAsync(ClientWebSocket socket, Action onWelcome, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        using var message = new MemoryStream();
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close) return (int?)socket.CloseStatus;
            message.Write(buffer, 0, result.Count);
            if (!result.EndOfMessage) continue;
            var text = Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
            message.SetLength(0);
            if (JsonNode.Parse(text) is not JsonObject msg) continue;
            if (msg.Str("type") == "welcome") onWelcome();
            await HandleAsync(msg);
        }
        return (int?)socket.CloseStatus;
    }

    // ------------------------------------------------------------------ mensajes del servidor
    internal async Task HandleAsync(JsonObject msg)
    {
        switch (msg.Str("type"))
        {
            case "welcome":
                Me = ParsePeer(msg["you"]);
                lock (_peers)
                {
                    _peers.Clear();
                    foreach (var p in (msg["peers"] as JsonArray ?? []).Select(ParsePeer).OfType<Peer>()) _peers[p.Id] = p;
                }
                var resend = Document.Welcome(
                    msg["model"] as JsonObject,
                    (msg["missed"] as JsonArray)?.OfType<JsonObject>(),
                    (long?)msg["seq"] ?? 0,
                    (int?)msg["revision"] ?? 0);
                foreach (var b in resend) await SendAsync(OpsMessage(b));
                SetStatus(LiveStatus.Live, null);
                PeersChanged?.Invoke();
                break;
            case "applied":
                var fromOther = Document.Applied((long?)msg["seq"] ?? 0, msg.Str("op_id") ?? "", (JsonArray)msg["ops"]!);
                if (fromOther)
                {
                    var author = msg.Str("author");
                    Peer? who = null;
                    if (author is not null)
                        lock (_peers) who = _peers.GetValueOrDefault(author);
                    RemoteEdit?.Invoke(who);
                    if (author is not null) Preview?.Invoke(author, null);
                }
                break;
            case "reject":
                Document.Reject(msg.Str("op_id") ?? "", msg.Str("reason") ?? "");
                break;
            case "snapshot":
                Document.Snapshot((JsonObject)msg["model"]!, (long?)msg["seq"] ?? 0, (int?)msg["revision"] ?? 0);
                break;
            case "saved":
                Document.Saved((int?)msg["revision"] ?? 0);
                break;
            case "peer_joined":
                if (ParsePeer(msg["peer"]) is { } joined)
                    lock (_peers) _peers[joined.Id] = joined;
                PeersChanged?.Invoke();
                break;
            case "peer_left":
                lock (_peers) _peers.Remove(msg.Str("peer_id") ?? "");
                PeersChanged?.Invoke();
                break;
            case "presence":
                var id = msg.Str("peer_id") ?? "";
                bool known;
                lock (_peers)
                {
                    known = _peers.TryGetValue(id, out var peer);
                    if (known) _peers[id] = peer! with { Level = msg["state"].Str("level"), Selection = msg["state"].Str("selection") };
                }
                if (known) PeersChanged?.Invoke();
                break;
            case "preview":
                Preview?.Invoke(msg.Str("peer_id") ?? "", msg["entity"] as JsonObject);
                break;
            case "closed":
                SetStatus(LiveStatus.Closed, msg.Str("reason"));
                await _cts!.CancelAsync();
                break;
            case "error":
                Error?.Invoke(msg.Str("reason") ?? "Error de la sala");
                break;
        }
    }

    private static Peer? ParsePeer(JsonNode? n) =>
        n is JsonObject o ? new Peer(o.Str("id") ?? "", o.Str("name") ?? "", o.Str("client") ?? "web", o["presence"].Str("level"), o["presence"].Str("selection")) : null;

    private static JsonObject OpsMessage(Batch b) =>
        new() { ["type"] = "ops", ["op_id"] = b.OpId, ["ops"] = b.Ops.DeepClone() };

    private async Task SendAsync(JsonObject msg)
    {
        var socket = _socket;
        if (socket is null || socket.State != WebSocketState.Open) return; // se reenvía al reconectar
        var bytes = Encoding.UTF8.GetBytes(msg.ToJsonString());
        await _sendLock.WaitAsync();
        try
        {
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception e) when (e is WebSocketException or ObjectDisposedException)
        {
            // se cayó: el bucle reconecta y reenvía lo pendiente
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private void SetStatus(LiveStatus status, string? detail)
    {
        if (Status == status && detail is null) return;
        Status = status;
        StatusChanged?.Invoke(status, detail);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _sendLock.Dispose();
        _cts?.Dispose();
    }
}
