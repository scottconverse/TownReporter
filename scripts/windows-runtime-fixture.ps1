# Test-only native x64 PE fixture; imports real Windows and VC runtime functions.
# Running this image exercises the OS loader, without requiring a C++ toolchain.
function New-RuntimeFixture([string]$Path, [bool]$ImportVcRuntime = $false, [int]$SleepMilliseconds = 0) {
  $bytes = [byte[]]::new(4608)
  function U16([int]$Offset, [uint16]$Value) { [BitConverter]::GetBytes($Value).CopyTo($bytes, $Offset) }
  function U32([int]$Offset, [uint32]$Value) { [BitConverter]::GetBytes($Value).CopyTo($bytes, $Offset) }
  function U64([int]$Offset, [uint64]$Value) { [BitConverter]::GetBytes($Value).CopyTo($bytes, $Offset) }
  function Name([int]$Offset, [string]$Value) { [Text.Encoding]::ASCII.GetBytes($Value + [char]0).CopyTo($bytes, $Offset) }
  U16 0 0x5a4d; U32 60 128; U32 128 0x4550
  U16 132 0x8664; U16 134 1; U16 148 240; U16 150 0x22
  U16 152 0x20b; U32 156 4096; U32 168 4096; U32 172 4096
  U64 176 0x140000000; U32 184 4096; U32 188 512
  U16 192 6; U16 200 6; U32 208 8192; U32 212 512; U16 220 3
  U64 224 1048576; U64 232 4096; U64 240 1048576; U64 248 4096; U32 260 16
  U32 272 0x1100; U32 276 60 # import directory
  Name 392 '.text'; U32 400 4096; U32 404 4096; U32 408 4096; U32 412 512; U32 428 3758096480
  # kernel32 descriptor, INT and IAT, with import-by-name records.
  U32 768 0x1180; U32 780 0x1200; U32 784 0x11a0
  U64 896 0x1240; U64 904 0x1260; U64 928 0x1240; U64 936 0x1260
  Name 1024 'kernel32.dll'; Name 1090 'ExitProcess'; Name 1122 'Sleep'
  if ($ImportVcRuntime) {
    U32 788 0x11c0; U32 800 0x1220; U32 804 0x11e0
    U64 960 0x1280; U64 992 0x1280
    Name 1056 'vcruntime140.dll'; Name 1154 'memcpy'
  }
  # sub rsp,28h; mov ecx,sleep; call [Sleep]; xor ecx,ecx; call [ExitProcess]
  ([byte[]]@(0x48,0x83,0xec,0x28,0xb9)).CopyTo($bytes, 512)
  U32 517 $SleepMilliseconds
  ([byte[]]@(0xff,0x15)).CopyTo($bytes, 521); U32 523 (0x11a8 - 0x100f)
  ([byte[]]@(0x31,0xc9,0xff,0x15)).CopyTo($bytes, 527); U32 531 (0x11a0 - 0x1017)
  [IO.File]::WriteAllBytes($Path, $bytes)
}

