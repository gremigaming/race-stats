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
// Written for C# 5 so Windows PowerShell 5.1's Add-Type can compile it.

using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class GmTelemetryRecorder
{
    const int HeaderLen = 29;
    const int IdleSeconds = 90;
    const int MinTelemetryRecords = 600; // about 10 s of driving at 60 Hz
    const int FieldIntervalMs = 100;     // all-car rows: 10 per second ...
    const int LapFieldIntervalMs = 500;  // ... lap data 2 per second
    const int NearIntervalMs = 30;       // ... 30 per second around a collision
    const int CollisionBeforeMs = 5000;
    const int CollisionAfterMs = 3000;
    // Bytes kept per car: motion = position, velocity, forward and right direction;
    // lap data = up to the result status; telemetry = speed, throttle, steer, brake, clutch, gear
    const int MotionRow = 36, LapRow = 46, TelemetryRow = 16;

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

    FileStream file;
    GZipStream zip;
    BufferedStream gz;
    string partPath;
    DateTime startedAt;
    ulong sessionUid;
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

        if (trailer < 0) { Write(0, p, 0, p.Length, null, 0, 0); return; }
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
        byte[] rec = new byte[HeaderLen + 1 + numCars * row];
        Buffer.BlockCopy(p, 0, rec, 0, HeaderLen);
        rec[HeaderLen] = (byte)row;
        for (int i = 0; i < numCars; i++)
            Buffer.BlockCopy(p, HeaderLen + i * size, rec, HeaderLen + 1 + i * row, row);

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
