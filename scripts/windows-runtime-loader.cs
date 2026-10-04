using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

// Observe actual DLL loads before the program runs, including short --version
// processes. DEBUG_ONLY_THIS_PROCESS debugs only our child; no host DLL mutation.
public static class SetupRuntimeLoader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public uint Size; public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
    public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct SecurityAttributes { public uint Size; public IntPtr Descriptor; public int Inherit; }
  // Win64 DEBUG_EVENT: 16-byte header followed by a 160-byte union.
  [StructLayout(LayoutKind.Explicit, Size = 176)]
  struct DebugEvent {
    [FieldOffset(0)] public uint Code;
    [FieldOffset(4)] public uint ProcessId;
    [FieldOffset(8)] public uint ThreadId;
    [FieldOffset(16)] public IntPtr File;
    [FieldOffset(16)] public uint ExitOrException;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string app, StringBuilder command, IntPtr processSecurity,
    IntPtr threadSecurity, bool inherit, uint flags, string environment, string directory,
    ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool WaitForDebugEvent(out DebugEvent ev, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool ContinueDebugEvent(uint process, uint thread, uint status);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern uint SetErrorMode(uint mode);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateFile(string name, uint access, uint share, ref SecurityAttributes security,
    uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint size, uint flags);

  static Exception NativeError(string action) {
    int code = Marshal.GetLastWin32Error();
    return new Win32Exception(code, action + " (Win32 error " + code + "): " + new Win32Exception(code).Message);
  }
  static string OutputText(string path) {
    using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
    using (var reader = new StreamReader(stream)) return reader.ReadToEnd().Trim();
  }
  static string FilePath(IntPtr handle) {
    var path = new StringBuilder(32768);
    uint length = GetFinalPathNameByHandle(handle, path, (uint)path.Capacity, 0);
    if (length == 0 || length >= path.Capacity) throw NativeError("Could not resolve loaded DLL path");
    string value = path.ToString();
    return value.StartsWith(@"\\?\UNC\") ? @"\\" + value.Substring(8) :
      value.StartsWith(@"\\?\") ? value.Substring(4) : value;
  }
  public static string Run(string executable, string directory, int timeoutMilliseconds) {
    if (!Environment.Is64BitProcess) throw new Exception("Runtime loader gate requires Windows x64.");
    if (timeoutMilliseconds <= 0) throw new ArgumentOutOfRangeException("timeoutMilliseconds");
    executable = Path.GetFullPath(executable);
    string appDirectory = Path.GetDirectoryName(executable);
    string outputPath = Path.GetTempFileName();
    var security = new SecurityAttributes { Size = (uint)Marshal.SizeOf<SecurityAttributes>(), Inherit = 1 };
    IntPtr output = IntPtr.Zero, input = IntPtr.Zero;
    var process = new ProcessInfo();
    bool started = false, exited = false, loaderBreakpointSeen = false;
    uint oldMode = SetErrorMode(0x8003); // inherited: no loader error dialog
    var loaded = new List<string>();
    try {
      output = CreateFile(outputPath, 0x40000000, 7, ref security, 2, 0x80, IntPtr.Zero);
      if (output == new IntPtr(-1)) throw NativeError("Could not open runtime diagnostic output");
      input = CreateFile("NUL", 0x80000000, 3, ref security, 3, 0x80, IntPtr.Zero);
      if (input == new IntPtr(-1)) throw NativeError("Could not open runtime stdin");
      var startup = new StartupInfo { Size = (uint)Marshal.SizeOf<StartupInfo>(), Flags = 0x100,
        Input = input, Output = output, Error = output };
      var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
        environment[(string)entry.Key] = (string)entry.Value;
      environment["PATH"] = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot"), "System32");
      environment.Remove("NODE_OPTIONS");
      var block = new StringBuilder();
      foreach (var entry in environment) block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
      block.Append('\0');
      if (!CreateProcess(executable, new StringBuilder("\"" + executable + "\" --version"),
        IntPtr.Zero, IntPtr.Zero, true, 0x402, block.ToString(), directory, ref startup, out process))
        throw NativeError("Runtime startup failed: " + executable);
      started = true;
      var timer = Stopwatch.StartNew();
      while (!exited) {
        long remaining = timeoutMilliseconds - timer.ElapsedMilliseconds;
        if (remaining <= 0) throw new Exception("Runtime startup timed out: " + executable);
        DebugEvent ev;
        if (!WaitForDebugEvent(out ev, (uint)remaining)) {
          int error = Marshal.GetLastWin32Error();
          if (error == 121) throw new Exception("Runtime startup timed out: " + executable);
          throw new Win32Exception(error, "Could not observe runtime loader: " + executable +
            " (Win32 error " + error + "): " + new Win32Exception(error).Message);
        }
        string violation = null;
        uint status = 0x10002; // DBG_CONTINUE
        try {
          if (ev.Code == 3 || ev.Code == 6) {
            if (ev.File == IntPtr.Zero || ev.File == new IntPtr(-1))
              throw new Exception("Could not identify loaded image: " + executable);
            try {
              string path = FilePath(ev.File);
              if (ev.Code == 6 && Regex.IsMatch(Path.GetFileName(path),
                @"^(vcruntime|msvcp|msvcr|vccorlib|concrt|vcomp)[0-9].*\.dll$", RegexOptions.IgnoreCase)) {
                loaded.Add(path);
                if (!String.Equals(Path.GetDirectoryName(path), appDirectory, StringComparison.OrdinalIgnoreCase))
                  violation = "Non-staged VC runtime loaded: " + path + "; executable: " + executable;
              }
            } finally { CloseHandle(ev.File); }
          } else if (ev.Code == 1) {
            // Consume only the debugger's initial loader breakpoint. Preserve
            // all program exceptions, including subsequent breakpoint faults.
            if (ev.ExitOrException == 0x80000003 && !loaderBreakpointSeen) loaderBreakpointSeen = true;
            else status = 0x80010001; // DBG_EXCEPTION_NOT_HANDLED
          } else if (ev.Code == 5) {
            exited = true;
            if (ev.ExitOrException != 0)
              violation = "Runtime startup failed: " + executable + " (exit 0x" + ev.ExitOrException.ToString("X8") + ")";
          }
          // Kill a forbidden fallback while its load event still suspends the
          // child, before resuming any of its program instructions.
          if (violation != null && !exited && !TerminateProcess(process.Process, 1))
            throw NativeError("Could not terminate rejected runtime: " + executable);
        } finally {
          if (!ContinueDebugEvent(ev.ProcessId, ev.ThreadId, status)) throw NativeError("Could not continue runtime loader");
        }
        if (violation != null) throw new Exception(violation);
      }
      CloseHandle(output); output = IntPtr.Zero;
      return OutputText(outputPath) + Environment.NewLine + "Staged VC runtime loads: " +
        (loaded.Count == 0 ? "none (runtime does not import VC DLLs)" : String.Join(", ", loaded));
    } catch (Exception error) {
      if (started && !exited) {
        TerminateProcess(process.Process, 1);
        // Drain termination events so the child releases its file handles.
        DebugEvent ev;
        var cleanup = Stopwatch.StartNew();
        while (cleanup.ElapsedMilliseconds < 5000 && WaitForDebugEvent(out ev, 1000)) {
          if ((ev.Code == 3 || ev.Code == 6) && ev.File != IntPtr.Zero) CloseHandle(ev.File);
          ContinueDebugEvent(ev.ProcessId, ev.ThreadId, 0x10002);
          if (ev.Code == 5) break;
        }
        WaitForSingleObject(process.Process, 1000);
      }
      if (output != IntPtr.Zero && output != new IntPtr(-1)) { CloseHandle(output); output = IntPtr.Zero; }
      throw new Exception(error.Message + Environment.NewLine + OutputText(outputPath), error);
    } finally {
      if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
      if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
      if (input != IntPtr.Zero && input != new IntPtr(-1)) CloseHandle(input);
      if (output != IntPtr.Zero && output != new IntPtr(-1)) CloseHandle(output);
      SetErrorMode(oldMode);
      File.Delete(outputPath);
    }
  }
}
