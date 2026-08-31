# Holds a TCP port open so the watchdog's "is Postgres up?" check passes on a
# runner that has no Postgres. Runs detached: it must outlive the step that
# starts it.
param([int]$Port)
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Start-Sleep -Seconds 900
$listener.Stop()
