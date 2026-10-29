// GreMi Gang telemetry recorder (loaded by RaceUploader.ps1).
//
// Listens for the F1 game's UDP telemetry, which Pits n' Giggles forwards to
// 127.0.0.1:20778 (Settings > UDP Forwarding). The player's own car is kept in
// full: from packets that hold every car, the player's slice is cut out.
// For the safety rating, every car's position, heading, speed and pedal/steering
// inputs are kept too, in short rows: 10 per second, and 30 per second from 5 s
// before to 3 s after a collision. One gzip file per game session; a file is
// renamed from .part to .gmtel.gz when the session ends, and the uploader sends it.
//
// File layout (after gzip): "GMTEL1\n", then records of
//   uint8 kind (0 = whole packet, 1 = header + player slice + packet trailer,
//               2 = header + uint8 row size + the first row-size bytes of every car)
//   uint16 length (little endian), then that many bytes.
// scripts/telemetry/gmtel.py reads it.
//
// GmLiveUplink (below) sends a light copy to the live race server
// (gremigaming/race-control-stats live/): every car's rows 20 times a second,
// lap data 4 times a second, and session, participants, event and results
// packets, in the same record format. No parsing here: the server does the work.
//
// Written for C# 5 so Windows PowerShell 5.1's Add-Type can compile it.

using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;

public class GmTelemetryRecorder
{
    public const int HeaderLen = 29;
    const int IdleSeconds = 90;
    const int MinTelemetryRecords = 600; // about 10 s of driving at 60 Hz
    const int FieldIntervalMs = 100;     // all-car rows: 10 per second ...
    const int LapFieldIntervalMs = 500;  // ... lap data 2 per second
    const int NearIntervalMs = 30;       // ... 30 per second around a collision
    const int CollisionBeforeMs = 5000;
    const int CollisionAfterMs = 3000;
    // Bytes kept per car: motion = position, velocity, forward and right direction;
    // lap data = up to the result status; telemetry = speed, throttle, steer, brake, clutch, gear
    // plus the surface under each wheel (the last 4 bytes of the car's telemetry)
    public const int MotionRow = 36, LapRow = 46, TelemetryRow = 20, SurfaceBytes = 4;

    static readonly string[] Tracks = {
        "Melbourne", "Paul_Ricard", "Shanghai", "Bahrain", "Catalunya", "Monaco", "Montreal",
        "Silverstone", "Hockenheim", "Hungaroring", "Spa", "Monza", "Singapore", "Suzuka",
        "Abu_Dhabi", "Texas", "Brazil", "Austria", "Sochi", "Mexico", "Baku", "Bahrain_Short",
        "Silverstone_Short", "Texas_Short", "Suzuka_Short", "Hanoi", "Zandvoort", "Imola",
        "Portimao", "Jeddah", "Miami", "Las_Vegas", "Losail", "t33", "t34", "t35", "t36", "t37",
        "t38", "Silverstone_Reverse", "Austria_Reverse", "Zandvoort_Reverse", "Madrid" };
    static readonly string[] SessionTypes = { // packet format 2024 and later
        "Unknown", "P1", "P2", "P3", "Practice", "Q1", "Q2", "Q3", "Quali", "OSQ",
        "SQ1", "SQ2", "SQ3", "SprintQuali", "OSSQ", "Race", "Race2", "Race3", "TimeTrial" };

    readonly string outDir;
    readonly int port;
    Thread thread;
    volatile bool stopping;

    public volatile string Status = "starting";
    public volatile string LastSaved = "";
    public volatile int SavedCount = 0;
    public GmLiveUplink Live; // set by RaceUploader.ps1 when a live token is saved

    FileStream file;
    GZipStream zip;
    BufferedStream gz;
    string partPath;
    DateTime startedAt;
    ulong sessionUid;
    ulong doneUid;      // a session whose results came in: its file is closed and sent straight away
    int trackId = -1;
    int sessionType = 0;
    int telemetryRecords;
    DateTime lastPacket;
    DateTime lastSession = DateTime.MinValue;
    DateTime lastParticipants = DateTime.MinValue;
    readonly DateTime[] lastField = new DateTime[3];
    DateTime fullUntil = DateTime.MinValue;
    readonly System.Collections.Generic.Queue<HeldRecord> pending = new System.Collections.Generic.Queue<HeldRecord>();

    struct HeldRecord // (time received, finished field record) waiting in case a collision follows
    {
        public DateTime At;
        public int Slot;
        public byte[] Record;
        public HeldRecord(DateTime at, int slot, byte[] record) { At = at; Slot = slot; Record = record; }
    }

    public GmTelemetryRecorder(string outDir, int port)
    {
        this.outDir = outDir;
        this.port = port;
        Directory.CreateDirectory(outDir);
        // A .part left by a crash or a PC shutdown still holds a good session
        foreach (string p in Directory.GetFiles(outDir, "*.part"))
        {
            try { File.Move(p, p.Substring(0, p.Length - 5) + "_unfinished.gmtel.gz"); } catch (Exception) { }
        }
    }

    public void Start()
    {
        thread = new Thread(Run);
        thread.IsBackground = true;
        thread.Name = "GmTelemetryRecorder";
        thread.Start();
    }

    public void Stop()
    {
        stopping = true;
        if (thread != null) thread.Join(3000);
    }

    void Run()
    {
        UdpClient udp;
        try
        {
            udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, port));
            udp.Client.ReceiveTimeout = 1000;
            udp.Client.ReceiveBufferSize = 4 * 1024 * 1024;
        }
        catch (Exception e)
        {
            Status = "can't listen on port " + port + " (" + e.Message + ")";
            return;
        }
        Status = "waiting for the game";
        IPEndPoint from = new IPEndPoint(IPAddress.Any, 0);
        while (!stopping)
        {
            byte[] packet = null;
            try { packet = udp.Receive(ref from); }
            catch (SocketException) { }
            catch (Exception e) { Status = "receive error: " + e.Message; }
            try
            {
                if (packet != null) Handle(packet);
                if (file != null && (DateTime.UtcNow - lastPacket).TotalSeconds > IdleSeconds) Close();
            }
            catch (Exception e)
            {
                Status = "error: " + e.Message;
                try { Close(); } catch (Exception) { }
            }
        }
        Close();
        udp.Close();
    }

    void Handle(byte[] p)
    {
        if (p.Length < HeaderLen) return;
        int format = BitConverter.ToUInt16(p, 0);
        int id = p[6];
        ulong uid = BitConverter.ToUInt64(p, 7);
        int player = p[27];
        if (uid == 0 || player == 255) return; // menus or spectating
        if (Live != null) Live.Offer(p);
        if (uid == doneUid) return;            // results are in, the file has gone to the uploader
        int numCars = format >= 2026 ? 24 : 22;

        int trailer;
        switch (id)
        {
            case 0: case 7: case 10: case 16: trailer = 0; break;  // motion, status, damage, telemetry 2
            case 2: trailer = 2; break;   // lap data (+ time trial car indexes)
            case 5: trailer = 4; break;   // setups (+ next front wing value)
            case 6: trailer = 3; break;   // telemetry (+ MFD panels, suggested gear)
            case 3: case 8: case 13: case 14: trailer = -1; break; // event, results, motion ex, time trial: whole
            case 1: // session: whole, every few seconds
                if ((DateTime.UtcNow - lastSession).TotalSeconds < 5 && uid == sessionUid) return;
                trailer = -1; break;
            case 4: // participants: whole, now and then
                if ((DateTime.UtcNow - lastParticipants).TotalSeconds < 30 && uid == sessionUid) return;
                trailer = -1; break;
            case 11: case 12: // session history, tyre sets: one car per packet, keep the player's
                if (p.Length <= HeaderLen || p[HeaderLen] != player) return;
                trailer = -1; break;
            default: return;
        }

        if (file == null || uid != sessionUid) Open(uid);
        lastPacket = DateTime.UtcNow;

        if (id == 1)
        {
            lastSession = lastPacket;
            if (p.Length > HeaderLen + 7)
            {
                sessionType = p[HeaderLen + 6];
                trackId = (sbyte)p[HeaderLen + 7];
            }
        }
        if (id == 4) lastParticipants = lastPacket;
        if (id == 6) telemetryRecords++;

        if (id == 3 && p.Length >= HeaderLen + 4 && p[HeaderLen] == 'C' && p[HeaderLen + 1] == 'O'
            && p[HeaderLen + 2] == 'L' && p[HeaderLen + 3] == 'L')
        {
            fullUntil = lastPacket.AddMilliseconds(CollisionAfterMs);
            FlushPending();
        }

        if (trailer < 0)
        {
            Write(0, p, 0, p.Length, null, 0, 0);
            // final classification: the session is over, so close the file now (not when the
            // next session starts) and the incident replays reach the site within a minute
            if (id == 8) { doneUid = uid; Close(); }
            return;
        }
        int body = p.Length - HeaderLen - trailer;
        if (body <= 0 || body % numCars != 0 || player >= numCars)
        {
            Write(0, p, 0, p.Length, null, 0, 0); // unknown layout: keep it all
            return;
        }
        int size = body / numCars;
        Write(1, p, HeaderLen + player * size, size, p, p.Length - trailer, trailer);

        if (id == 0) Field(0, p, numCars, size, MotionRow, FieldIntervalMs);
        else if (id == 2) Field(1, p, numCars, size, LapRow, LapFieldIntervalMs);
        else if (id == 6) Field(2, p, numCars, size, TelemetryRow, FieldIntervalMs);
    }

    // Every car's first `row` bytes, written now (10 per second, or 30 around a collision)
    // or held for 5 s in case a collision follows. Lap data is never held.
    void Field(int slot, byte[] p, int numCars, int size, int row, int intervalMs)
    {
        if (row > size) return;
        byte[] rec = FieldRecord(p, numCars, size, row, slot == 2 ? SurfaceBytes : 0);

        DateTime now = lastPacket;
        while (pending.Count > 0 && (now - pending.Peek().At).TotalMilliseconds > CollisionBeforeMs)
            pending.Dequeue();
        double since = (now - lastField[slot]).TotalMilliseconds;
        if (since >= intervalMs || (slot != 1 && now <= fullUntil && since >= NearIntervalMs))
        {
            WriteField(rec);
            lastField[slot] = now;
        }
        else if (slot != 1)
        {
            pending.Enqueue(new HeldRecord(now, slot, rec));
        }
    }

    // Header + row size + the first `row` bytes of every car (the last `tail` of them taken
    // from the end of the car's struct). Kind 2 records, also what the live uplink sends.
    public static byte[] FieldRecord(byte[] p, int numCars, int size, int row, int tail)
    {
        byte[] rec = new byte[HeaderLen + 1 + numCars * row];
        Buffer.BlockCopy(p, 0, rec, 0, HeaderLen);
        rec[HeaderLen] = (byte)row;
        for (int i = 0; i < numCars; i++)
        {
            int src = HeaderLen + i * size, dst = HeaderLen + 1 + i * row;
            Buffer.BlockCopy(p, src, rec, dst, row - tail);
            if (tail > 0) Buffer.BlockCopy(p, src + size - tail, rec, dst + row - tail, tail);
        }
        return rec;
    }

    // A collision: write what was held from the 5 s before it, 30 per second
    void FlushPending()
    {
        DateTime[] last = { DateTime.MinValue, DateTime.MinValue, DateTime.MinValue };
        while (pending.Count > 0)
        {
            HeldRecord h = pending.Dequeue();
            if ((h.At - last[h.Slot]).TotalMilliseconds < NearIntervalMs) continue;
            WriteField(h.Record);
            last[h.Slot] = h.At;
        }
    }

    void WriteField(byte[] rec)
    {
        gz.WriteByte(2);
        gz.WriteByte((byte)(rec.Length & 0xff));
        gz.WriteByte((byte)(rec.Length >> 8));
        gz.Write(rec, 0, rec.Length);
    }

    void Write(byte kind, byte[] p, int sliceStart, int sliceLen, byte[] t, int tStart, int tLen)
    {
        int len = kind == 0 ? sliceLen : HeaderLen + sliceLen + tLen;
        gz.WriteByte(kind);
        gz.WriteByte((byte)(len & 0xff));
        gz.WriteByte((byte)(len >> 8));
        if (kind == 0) { gz.Write(p, sliceStart, sliceLen); return; }
        gz.Write(p, 0, HeaderLen);
        gz.Write(p, sliceStart, sliceLen);
        if (tLen > 0) gz.Write(t, tStart, tLen);
    }

    void Open(ulong uid)
    {
        Close();
        sessionUid = uid;
        trackId = -1;
        sessionType = 0;
        telemetryRecords = 0;
        lastSession = DateTime.MinValue;
        lastParticipants = DateTime.MinValue;
        for (int i = 0; i < lastField.Length; i++) lastField[i] = DateTime.MinValue;
        fullUntil = DateTime.MinValue;
        pending.Clear();
        startedAt = DateTime.Now;
        partPath = Path.Combine(outDir, startedAt.ToString("yyyy-MM-dd_HH-mm-ss") + ".part");
        file = new FileStream(partPath, FileMode.Create, FileAccess.Write);
        zip = new GZipStream(file, CompressionMode.Compress);
        gz = new BufferedStream(zip, 1 << 16);
        byte[] magic = Encoding.ASCII.GetBytes("GMTEL1\n");
        gz.Write(magic, 0, magic.Length);
        Status = "recording";
    }

    void Close()
    {
        if (file == null) return;
        gz.Dispose(); // flushes into zip and closes it, which closes file
        gz = null;
        zip = null;
        file = null;
        if (telemetryRecords < MinTelemetryRecords)
        {
            File.Delete(partPath); // just menus or a few seconds on track
        }
        else
        {
            string track = trackId >= 0 && trackId < Tracks.Length ? Tracks[trackId] : "Unknown";
            string kind = sessionType >= 0 && sessionType < SessionTypes.Length ? SessionTypes[sessionType] : "s" + sessionType;
            string name = startedAt.ToString("yyyy-MM-dd_HH-mm-ss") + "_" + track + "_" + kind + ".gmtel.gz";
            File.Move(partPath, Path.Combine(outDir, name));
            LastSaved = name;
            SavedCount++;
        }
        Status = stopping ? "stopped" : "waiting for the game";
    }
}

public class GmLiveUplink
{
    const int HeaderLen = GmTelemetryRecorder.HeaderLen;
    const int RowMs = 45;          // motion and telemetry rows: about 20 per second
    const int LapMs = 245;         // lap data: about 4 per second
    const int SlowMs = 5000;       // session and participants packets
    const int SendMs = 50;         // one batch every 50 ms
    const int KeepMs = 60000;      // batches kept for a resend after a dropout
    const int MaxKept = 1500;

    struct Batch
    {
        public uint Seq;
        public DateTime At;
        public byte[] Data;
        public Batch(uint seq, DateTime at, byte[] data) { Seq = seq; At = at; Data = data; }
    }

    readonly Uri uri;
    readonly string token;
    readonly ulong streamId;
    readonly object gate = new object();
    MemoryStream batch = new MemoryStream();
    readonly Queue<Batch> kept = new Queue<Batch>();
    readonly DateTime[] last = new DateTime[5]; // motion, telemetry, lap, session, participants
    ulong sessionUid;
    uint seq;
    uint sentUpTo;
    volatile uint acked;
    ClientWebSocket ws;
    DateTime nextTry = DateTime.MinValue;
    int backoff = 5;
    Thread thread;
    volatile bool stopping;

    public volatile string Status = "waiting for a session";

    public GmLiveUplink(string url, string token)
    {
        uri = new Uri(url);
        this.token = token;
        streamId = BitConverter.ToUInt64(Guid.NewGuid().ToByteArray(), 0);
    }

    public void Start()
    {
        thread = new Thread(Run);
        thread.IsBackground = true;
        thread.Name = "GmLiveUplink";
        thread.Start();
    }

    public void Stop()
    {
        stopping = true;
        if (thread != null) thread.Join(3000);
    }

    // Called by the recorder for every game packet; only copies bytes, never blocks on the network
    public void Offer(byte[] p)
    {
        try
        {
            if (p.Length < HeaderLen) return;
            int format = BitConverter.ToUInt16(p, 0);
            int id = p[6];
            ulong uid = BitConverter.ToUInt64(p, 7);
            DateTime now = DateTime.UtcNow;
            if (uid != sessionUid)
            {
                sessionUid = uid;
                for (int i = 0; i < last.Length; i++) last[i] = DateTime.MinValue;
            }
            int numCars = format >= 2026 ? 24 : 22;
            switch (id)
            {
                case 0: Field(p, numCars, 0, 0, GmTelemetryRecorder.MotionRow, 0, RowMs, now); break;
                case 6: Field(p, numCars, 1, 3, GmTelemetryRecorder.TelemetryRow, GmTelemetryRecorder.SurfaceBytes, RowMs, now); break;
                case 2: Field(p, numCars, 2, 2, GmTelemetryRecorder.LapRow, 0, LapMs, now); break;
                case 1: if (Due(3, SlowMs, now)) Add(0, p); break;
                case 4: if (Due(4, SlowMs, now)) Add(0, p); break;
                case 3:
                    if (p.Length >= HeaderLen + 4 && p[HeaderLen] == 'B' && p[HeaderLen + 1] == 'U'
                        && p[HeaderLen + 2] == 'T' && p[HeaderLen + 3] == 'N') return; // button presses
                    Add(0, p);
                    break;
                case 8: Add(0, p); break; // final classification
            }
        }
        catch (Exception e) { Status = "error: " + e.Message; }
    }

    bool Due(int slot, int ms, DateTime now)
    {
        if ((now - last[slot]).TotalMilliseconds < ms) return false;
        last[slot] = now;
        return true;
    }

    void Field(byte[] p, int numCars, int slot, int trailer, int row, int tail, int ms, DateTime now)
    {
        int body = p.Length - HeaderLen - trailer;
        if (body <= 0 || body % numCars != 0 || body / numCars < row) return;
        if (!Due(slot, ms, now)) return;
        Add(2, GmTelemetryRecorder.FieldRecord(p, numCars, body / numCars, row, tail));
    }

    void Add(byte kind, byte[] rec)
    {
        lock (gate)
        {
            if (batch.Length > (1 << 20)) return; // sender stuck: drop rather than grow
            batch.WriteByte(kind);
            batch.WriteByte((byte)(rec.Length & 0xff));
            batch.WriteByte((byte)(rec.Length >> 8));
            batch.Write(rec, 0, rec.Length);
        }
    }

    void Run()
    {
        while (!stopping)
        {
            Thread.Sleep(SendMs);
            try { Tick(); }
            catch (Exception e)
            {
                Status = "offline, retrying (" + e.Message + ")";
                Drop();
            }
        }
        Drop();
    }

    void Tick()
    {
        byte[] data = null;
        lock (gate)
        {
            if (batch.Length > 0)
            {
                data = batch.ToArray();
                batch = new MemoryStream();
            }
        }
        DateTime now = DateTime.UtcNow;
        if (data != null) kept.Enqueue(new Batch(++seq, now, Pack(seq, data)));
        uint a = acked;
        while (kept.Count > 0 && (kept.Peek().Seq <= a || kept.Count > MaxKept
               || (now - kept.Peek().At).TotalMilliseconds > KeepMs))
            kept.Dequeue();
        if (kept.Count == 0) return;

        if (ws == null || ws.State != WebSocketState.Open)
        {
            if (now < nextTry) return;
            Drop();
            nextTry = now.AddSeconds(backoff);
            backoff = Math.Min(backoff * 2, 60);
            Connect();
            sentUpTo = a; // everything not acked goes again
            backoff = 5;
            Status = "live";
        }
        foreach (Batch b in kept)
        {
            if (b.Seq <= sentUpTo) continue;
            if (!ws.SendAsync(new ArraySegment<byte>(b.Data), WebSocketMessageType.Binary, true,
                              CancellationToken.None).Wait(5000))
                throw new Exception("send timed out");
            sentUpTo = b.Seq;
        }
    }

    byte[] Pack(uint s, byte[] data)
    {
        MemoryStream m = new MemoryStream();
        m.Write(BitConverter.GetBytes(streamId), 0, 8);
        m.Write(BitConverter.GetBytes(s), 0, 4);
        m.Write(BitConverter.GetBytes((ulong)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds), 0, 8);
        using (System.IO.Compression.DeflateStream z = new System.IO.Compression.DeflateStream(
                   m, System.IO.Compression.CompressionMode.Compress, true))
            z.Write(data, 0, data.Length);
        return m.ToArray();
    }

    void Connect()
    {
        ClientWebSocket c = new ClientWebSocket();
        c.Options.SetRequestHeader("Authorization", "Bearer " + token);
        c.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        if (!c.ConnectAsync(uri, CancellationToken.None).Wait(10000))
        {
            c.Abort();
            throw new Exception("connect timed out");
        }
        ws = c;
        Thread r = new Thread(() => Receive(c));
        r.IsBackground = true;
        r.Name = "GmLiveUplinkAcks";
        r.Start();
    }

    // "ack <sequence>" from the server: those batches arrived and don't need a resend
    void Receive(ClientWebSocket c)
    {
        byte[] buf = new byte[256];
        try
        {
            while (c.State == WebSocketState.Open)
            {
                WebSocketReceiveResult r = c.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None).Result;
                if (r.MessageType == WebSocketMessageType.Close) break;
                string text = Encoding.ASCII.GetString(buf, 0, r.Count);
                uint n;
                if (text.StartsWith("ack ") && uint.TryParse(text.Substring(4), out n) && n > acked) acked = n;
            }
        }
        catch (Exception) { }
    }

    void Drop()
    {
        if (ws == null) return;
        try { ws.Abort(); ws.Dispose(); } catch (Exception) { }
        ws = null;
    }
}
